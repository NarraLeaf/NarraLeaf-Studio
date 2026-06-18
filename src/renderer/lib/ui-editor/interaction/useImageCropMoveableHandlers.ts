import { useCallback, useLayoutEffect, useRef } from "react";
import type {
    OnDrag,
    OnDragEnd,
    OnDragStart,
    OnResize,
    OnResizeEnd,
    OnResizeStart,
} from "react-moveable";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { ImageFill, ImageFillCropPlacement } from "@shared/types/ui-editor/imageFill";
import { DEFAULT_RECTANGLE_CROP_PLACEMENT } from "@shared/types/ui-editor/rectangleLike";
import { computeCoverCropPlacement } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { buildImageFillPropsUpdate } from "@/lib/ui-editor/widget-modules/shared/chrome/imageFillProps";

const MIN_SIZE_PCT = 5;
const CROP_PLACEMENT_EPSILON = 0.001;

interface ImageCropHandlersConfig {
    documentService: UIDocumentService;
    elementId: string;
    container: HTMLElement | null;
    imageTarget: HTMLElement | null;
    beginTransform: () => void;
    endTransform: () => void;
    scheduleMoveableRectUpdate: () => void;
}

function parsePixelValue(value: string): number | null {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function readCropPlacementFromDom(
    container: HTMLElement,
    imageTarget: HTMLElement,
): ImageFillCropPlacement | null {
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    if (containerWidth <= 0 || containerHeight <= 0) {
        return null;
    }

    const computed = window.getComputedStyle(imageTarget);
    const widthPx = parsePixelValue(computed.width) ?? imageTarget.offsetWidth;
    const heightPx = parsePixelValue(computed.height) ?? imageTarget.offsetHeight;
    const leftPx = parsePixelValue(computed.left) ?? imageTarget.offsetLeft;
    const topPx = parsePixelValue(computed.top) ?? imageTarget.offsetTop;
    if (widthPx <= 0 || heightPx <= 0) {
        return null;
    }

    return {
        leftPct: (leftPx / containerWidth) * 100,
        topPct: (topPx / containerHeight) * 100,
        widthPct: (widthPx / containerWidth) * 100,
        heightPct: (heightPx / containerHeight) * 100,
    };
}

function isDefaultCropPlacement(placement: ImageFillCropPlacement): boolean {
    return (
        Math.abs(placement.leftPct - DEFAULT_RECTANGLE_CROP_PLACEMENT.leftPct) < CROP_PLACEMENT_EPSILON &&
        Math.abs(placement.topPct - DEFAULT_RECTANGLE_CROP_PLACEMENT.topPct) < CROP_PLACEMENT_EPSILON &&
        Math.abs(placement.widthPct - DEFAULT_RECTANGLE_CROP_PLACEMENT.widthPct) < CROP_PLACEMENT_EPSILON &&
        Math.abs(placement.heightPct - DEFAULT_RECTANGLE_CROP_PLACEMENT.heightPct) < CROP_PLACEMENT_EPSILON
    );
}

function getNaturalImageSize(imageTarget: HTMLElement): { width: number; height: number } | null {
    if (!(imageTarget instanceof HTMLImageElement)) {
        return null;
    }
    if (imageTarget.naturalWidth <= 0 || imageTarget.naturalHeight <= 0) {
        return null;
    }
    return {
        width: imageTarget.naturalWidth,
        height: imageTarget.naturalHeight,
    };
}

function resolveInitialCropPlacement(
    container: HTMLElement,
    imageTarget: HTMLElement,
    storedPlacement?: ImageFillCropPlacement,
): ImageFillCropPlacement {
    if (storedPlacement) {
        return storedPlacement;
    }

    const domPlacement = readCropPlacementFromDom(container, imageTarget);
    if (domPlacement && !isDefaultCropPlacement(domPlacement)) {
        return domPlacement;
    }

    const naturalSize = getNaturalImageSize(imageTarget);
    const coverPlacement = naturalSize
        ? computeCoverCropPlacement({
              imageWidth: naturalSize.width,
              imageHeight: naturalSize.height,
              containerWidth: container.clientWidth,
              containerHeight: container.clientHeight,
          })
        : null;

    return coverPlacement ?? domPlacement ?? DEFAULT_RECTANGLE_CROP_PLACEMENT;
}

function applyCropPlacementStyles(
    imageTarget: HTMLElement,
    placement: ImageFillCropPlacement,
    options: { clearTransform?: boolean } = {},
): void {
    if (options.clearTransform !== false) {
        imageTarget.style.transform = "";
    }
    imageTarget.style.left = `${placement.leftPct}%`;
    imageTarget.style.top = `${placement.topPct}%`;
    imageTarget.style.width = `${placement.widthPct}%`;
    imageTarget.style.height = `${placement.heightPct}%`;
}

export function useImageCropMoveableHandlers(config: ImageCropHandlersConfig) {
    const lastDragRef = useRef<{ translateX: number; translateY: number } | null>(null);
    const lastResizeRef = useRef<{
        width: number;
        height: number;
        translateX: number;
        translateY: number;
    } | null>(null);
    const gestureBaseRef = useRef<ImageFillCropPlacement | null>(null);

    const ensureStoredCropPlacement = useCallback(() => {
        const { container, imageTarget, documentService, elementId, scheduleMoveableRectUpdate } =
            config;
        if (!container || !imageTarget || !elementId) {
            return null;
        }

        const doc = documentService.getDocument();
        const element = doc.elements[elementId];
        if (!element) {
            return null;
        }

        const prevFill = (element.props?.imageFill as ImageFill) ?? {
            mode: "crop",
            assetId: null,
        };
        const placement = resolveInitialCropPlacement(container, imageTarget, prevFill.cropPlacement);
        if (prevFill.cropPlacement) {
            return placement;
        }

        const nextFill: ImageFill = {
            ...prevFill,
            mode: "crop",
            cropPlacement: placement,
        };
        documentService.updateElementProps(elementId, buildImageFillPropsUpdate(element, nextFill));
        applyCropPlacementStyles(imageTarget, placement, { clearTransform: false });
        scheduleMoveableRectUpdate();
        return placement;
    }, [config]);

    useLayoutEffect(() => {
        ensureStoredCropPlacement();
    }, [ensureStoredCropPlacement]);

    /**
     * Persist the crop placement from tracked pixel deltas, then directly
     * apply the resulting CSS to the image target so the visual state is
     * immediately correct.
     *
     * We MUST write the styles ourselves instead of relying on React's
     * reconciliation because:
     *   1. Moveable manipulates inline styles directly (transform, width, height).
     *   2. When we clear those overrides React still considers its previous
     *      render values "current" and only patches properties that CHANGED
     *      between renders.  For a pure drag (no size change) React would
     *      skip re-applying width/height, leaving them blank after the clear.
     *   3. Writing the authoritative values here avoids the gap entirely.
     *
     * Uses container.clientWidth / clientHeight (the padding-box in local CSS
     * coordinates) which is immune to ancestor CSS transforms (rotation,
     * viewport zoom / pan).
     */
    const updatePlacement = useCallback(
        (override?: {
            widthPx?: number;
            heightPx?: number;
            translateX?: number;
            translateY?: number;
        }) => {
            const { container, imageTarget, documentService, elementId, scheduleMoveableRectUpdate } =
                config;
            if (!container || !imageTarget || !elementId) {
                return;
            }

            // Local dimensions – unaffected by ancestor CSS transforms.
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;
            if (containerWidth === 0 || containerHeight === 0) {
                return;
            }

            const doc = documentService.getDocument();
            const element = doc.elements[elementId];
            if (!element) {
                return;
            }

            const prevFill = (element.props?.imageFill as ImageFill) ?? {
                mode: "crop",
                assetId: null,
            };
            const prev = gestureBaseRef.current ??
                resolveInitialCropPlacement(container, imageTarget, prevFill.cropPlacement);

            // Convert stored percentages → local pixels
            const baseWidthPx = (prev.widthPct / 100) * containerWidth;
            const baseHeightPx = (prev.heightPct / 100) * containerHeight;
            const baseLeftPx = (prev.leftPct / 100) * containerWidth;
            const baseTopPx = (prev.topPct / 100) * containerHeight;

            // Apply overrides
            const nextWidthPx = override?.widthPx ?? baseWidthPx;
            const nextHeightPx = override?.heightPx ?? baseHeightPx;
            const translateX = override?.translateX ?? 0;
            const translateY = override?.translateY ?? 0;
            const nextLeftPx = baseLeftPx + translateX;
            const nextTopPx = baseTopPx + translateY;

            // Convert back to percentages
            const leftPct = (nextLeftPx / containerWidth) * 100;
            const topPct = (nextTopPx / containerHeight) * 100;
            const widthPct = Math.max(MIN_SIZE_PCT, (nextWidthPx / containerWidth) * 100);
            const heightPct = Math.max(MIN_SIZE_PCT, (nextHeightPx / containerHeight) * 100);

            // ── 1. Update the document model ────────────────────────────────
            const nextFill: ImageFill = {
                ...prevFill,
                mode: "crop",
                cropPlacement: { leftPct, topPct, widthPct, heightPct },
            };
            documentService.updateElementProps(elementId, buildImageFillPropsUpdate(element, nextFill));

            // ── 2. Directly apply styles to the DOM element ─────────────────
            // This removes the Moveable-applied transform and sets the
            // authoritative percentage values so that the image is visually
            // correct even before React reconciles.
            applyCropPlacementStyles(imageTarget, { leftPct, topPct, widthPct, heightPct });

            scheduleMoveableRectUpdate();
        },
        [config],
    );

    // ── Drag ─────────────────────────────────────────────────────────────

    const handleDragStart = useCallback(
        (_event: OnDragStart) => {
            if (!config.imageTarget) {
                return;
            }
            gestureBaseRef.current = ensureStoredCropPlacement();
            config.beginTransform();
        },
        [config, ensureStoredCropPlacement],
    );

    const handleDrag = useCallback((event: OnDrag) => {
        if (!event.target) {
            return;
        }
        lastDragRef.current = {
            translateX: event.beforeTranslate[0],
            translateY: event.beforeTranslate[1],
        };
        event.target.style.transform = event.transform;
    }, []);

    const handleDragEnd = useCallback(
        (_event: OnDragEnd) => {
            if (!config.imageTarget || !config.container) {
                config.endTransform();
                return;
            }
            if (lastDragRef.current) {
                updatePlacement({
                    translateX: lastDragRef.current.translateX,
                    translateY: lastDragRef.current.translateY,
                });
            }
            lastDragRef.current = null;
            gestureBaseRef.current = null;
            config.endTransform();
        },
        [config, updatePlacement],
    );

    // ── Resize ───────────────────────────────────────────────────────────

    const handleResizeStart = useCallback(
        (_event: OnResizeStart) => {
            if (!config.imageTarget) {
                return;
            }
            gestureBaseRef.current = ensureStoredCropPlacement();
            config.beginTransform();
        },
        [config, ensureStoredCropPlacement],
    );

    const handleResize = useCallback((event: OnResize) => {
        if (!event.target) {
            return;
        }
        const translateX = event.drag?.beforeTranslate?.[0] ?? 0;
        const translateY = event.drag?.beforeTranslate?.[1] ?? 0;
        lastResizeRef.current = {
            width: event.width,
            height: event.height,
            translateX,
            translateY,
        };
        event.target.style.width = `${event.width}px`;
        event.target.style.height = `${event.height}px`;
        if (event.drag) {
            event.target.style.transform = event.drag.transform;
        }
    }, []);

    const handleResizeEnd = useCallback(
        (_event: OnResizeEnd) => {
            if (!config.imageTarget || !config.container) {
                config.endTransform();
                return;
            }
            if (lastResizeRef.current) {
                updatePlacement({
                    widthPx: lastResizeRef.current.width,
                    heightPx: lastResizeRef.current.height,
                    translateX: lastResizeRef.current.translateX,
                    translateY: lastResizeRef.current.translateY,
                });
            }
            lastResizeRef.current = null;
            gestureBaseRef.current = null;
            config.endTransform();
        },
        [config, updatePlacement],
    );

    return {
        handleDragStart,
        handleDrag,
        handleDragEnd,
        handleResizeStart,
        handleResize,
        handleResizeEnd,
    };
}
