import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type {
    OnDrag,
    OnDragEnd,
    OnDragStart,
    OnResize,
    OnResizeEnd,
    OnResizeStart,
} from "react-moveable";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { ImageFill, ImageFillCropPlacement, ImageFillMode } from "@shared/types/ui-editor/imageFill";
import { DEFAULT_RECTANGLE_CROP_PLACEMENT } from "@shared/types/ui-editor/rectangleLike";
import { computeCropPlacementForMode } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { buildImageFillPropsUpdate } from "@/lib/ui-editor/widget-modules/shared/chrome/imageFillProps";

const MIN_SIZE_PCT = 5;
const CROP_PLACEMENT_EPSILON = 0.001;
const IMAGE_FILL_BASE_TRANSFORM =
    "scale(calc(var(--nl-image-base-flip-x, 1) * var(--nl-image-drag-flip-x, 1)), calc(var(--nl-image-base-flip-y, 1) * var(--nl-image-drag-flip-y, 1)))";

interface ImageCropHandlersConfig {
    documentService: UIDocumentService;
    elementId: string;
    container: HTMLElement | null;
    imageTarget: HTMLElement | null;
    beginTransform: () => void;
    endTransform: () => void;
    scheduleMoveableRectUpdate: () => void;
    updateMoveableRectNow: () => void;
}

interface NativeCropRuntime {
    container: HTMLElement | null;
    imageTarget: HTMLElement | null;
    elementId: string;
    beginTransform: () => void;
    endTransform: () => void;
    scheduleMoveableRectUpdate: () => void;
    updateMoveableRectNow: () => void;
    ensureStoredCropPlacement?: () => ImageFillCropPlacement | null;
    updatePlacement?: (
        override?: {
            widthPx?: number;
            heightPx?: number;
            translateX?: number;
            translateY?: number;
        },
        options?: { scheduleRectUpdate?: boolean },
    ) => ImageFillCropPlacement | null;
    commitPlacement?: (placement: ImageFillCropPlacement) => boolean;
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

function readRenderedFillMode(imageTarget: HTMLElement): ImageFillMode | null {
    const raw = imageTarget.dataset.uiImageFillMode;
    if (raw === "cover" || raw === "contain" || raw === "stretch" || raw === "crop" || raw === "tile") {
        return raw;
    }
    return null;
}

function readRenderedAssetId(imageTarget: HTMLElement): string | null {
    const raw = imageTarget.dataset.uiImageFillAssetId;
    return raw && raw.trim() ? raw.trim() : null;
}

function resolveInitialCropPlacement(
    container: HTMLElement,
    imageTarget: HTMLElement,
    fill?: ImageFill,
): ImageFillCropPlacement {
    const mode = readRenderedFillMode(imageTarget) ?? fill?.mode ?? "cover";
    if (mode === "crop" && fill?.cropPlacement) {
        return fill.cropPlacement;
    }

    const naturalSize = getNaturalImageSize(imageTarget);
    const placementFromMode = naturalSize
        ? computeCropPlacementForMode({
              imageWidth: naturalSize.width,
              imageHeight: naturalSize.height,
              containerWidth: container.clientWidth,
              containerHeight: container.clientHeight,
              mode,
          })
        : null;
    if (placementFromMode) {
        return placementFromMode;
    }

    const domPlacement = readCropPlacementFromDom(container, imageTarget);
    if (domPlacement && !isDefaultCropPlacement(domPlacement)) {
        return domPlacement;
    }

    return domPlacement ?? DEFAULT_RECTANGLE_CROP_PLACEMENT;
}

function applyCropPlacementStyles(
    imageTarget: HTMLElement,
    placement: ImageFillCropPlacement,
    options: { clearTransform?: boolean } = {},
): void {
    if (options.clearTransform !== false) {
        imageTarget.style.transform = IMAGE_FILL_BASE_TRANSFORM;
    }
    imageTarget.style.left = `${placement.leftPct}%`;
    imageTarget.style.top = `${placement.topPct}%`;
    imageTarget.style.width = `${placement.widthPct}%`;
    imageTarget.style.height = `${placement.heightPct}%`;
}

function clientDeltaToContainerDelta(
    container: HTMLElement,
    clientDeltaX: number,
    clientDeltaY: number,
): { x: number; y: number } {
    const rect = container.getBoundingClientRect();
    const scaleX = rect.width > 0 ? container.clientWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? container.clientHeight / rect.height : 1;
    return {
        x: clientDeltaX * scaleX,
        y: clientDeltaY * scaleY,
    };
}

export function useImageCropMoveableHandlers(config: ImageCropHandlersConfig) {
    const {
        documentService,
        elementId,
        container,
        imageTarget,
        beginTransform,
        endTransform,
        scheduleMoveableRectUpdate,
        updateMoveableRectNow,
    } = config;
    const lastDragRef = useRef<{ translateX: number; translateY: number } | null>(null);
    const lastResizeRef = useRef<{
        width: number;
        height: number;
        translateX: number;
        translateY: number;
    } | null>(null);
    const lastPlacementRef = useRef<ImageFillCropPlacement | null>(null);
    const gestureBaseRef = useRef<ImageFillCropPlacement | null>(null);
    const autoCropSessionRef = useRef<{ elementId: string; converted: boolean } | null>(null);
    const nativeDragRef = useRef<{
        pointerId: number;
        startClientX: number;
        startClientY: number;
    } | null>(null);
    const nativeRuntimeRef = useRef<NativeCropRuntime>({
        container,
        imageTarget,
        elementId,
        beginTransform,
        endTransform,
        scheduleMoveableRectUpdate,
        updateMoveableRectNow,
    });

    const endNativeDrag = useCallback((event: PointerEvent | null, commit: boolean) => {
        const dragState = nativeDragRef.current;
        if (!dragState) {
            return;
        }
        const runtime = nativeRuntimeRef.current;
        nativeDragRef.current = null;
        const releaseTarget = runtime.imageTarget;
        if (event && releaseTarget?.hasPointerCapture?.(dragState.pointerId)) {
            releaseTarget.releasePointerCapture(dragState.pointerId);
        }
        if (commit && lastPlacementRef.current) {
            runtime.commitPlacement?.(lastPlacementRef.current);
        }
        lastDragRef.current = null;
        lastPlacementRef.current = null;
        gestureBaseRef.current = null;
        runtime.endTransform();
    }, []);

    useEffect(() => {
        if (!elementId) {
            autoCropSessionRef.current = null;
            gestureBaseRef.current = null;
            lastPlacementRef.current = null;
            return;
        }
        if (autoCropSessionRef.current?.elementId !== elementId) {
            autoCropSessionRef.current = { elementId, converted: false };
            gestureBaseRef.current = null;
            lastPlacementRef.current = null;
        }
    }, [elementId]);

    const ensureStoredCropPlacement = useCallback(() => {
        if (!container || !imageTarget || !elementId) {
            return null;
        }

        const doc = documentService.getDocument();
        const element = doc.elements[elementId];
        if (!element) {
            return null;
        }

        const renderedMode = readRenderedFillMode(imageTarget);
        const renderedAssetId = readRenderedAssetId(imageTarget);
        const prevFill = (element.props?.imageFill as ImageFill | undefined) ?? {
            mode: renderedMode ?? "cover",
            assetId: renderedAssetId,
        };
        const effectiveFill: ImageFill = {
            ...prevFill,
            mode: renderedMode ?? prevFill.mode ?? "cover",
            assetId: renderedAssetId ?? prevFill.assetId ?? null,
        };
        const autoCropSession = autoCropSessionRef.current;
        if (
            effectiveFill.mode !== "crop" &&
            autoCropSession?.elementId === elementId &&
            autoCropSession.converted
        ) {
            return null;
        }
        const placement = resolveInitialCropPlacement(container, imageTarget, effectiveFill);
        if (effectiveFill.mode === "crop" && effectiveFill.cropPlacement) {
            autoCropSessionRef.current = { elementId, converted: true };
            return placement;
        }

        const nextFill: ImageFill = {
            ...effectiveFill,
            mode: "crop",
            cropPlacement: placement,
        };
        documentService.updateElementProps(elementId, buildImageFillPropsUpdate(element, nextFill));
        autoCropSessionRef.current = { elementId, converted: true };
        applyCropPlacementStyles(imageTarget, placement, { clearTransform: false });
        scheduleMoveableRectUpdate();
        return placement;
    }, [container, documentService, elementId, imageTarget, scheduleMoveableRectUpdate]);

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
    const commitPlacement = useCallback(
        (placement: ImageFillCropPlacement): boolean => {
            if (!imageTarget || !elementId) {
                return false;
            }
            const element = documentService.getDocument().elements[elementId];
            if (!element) {
                return false;
            }
            const prevFill = (element.props?.imageFill as ImageFill | undefined) ?? {
                mode: "crop",
                assetId: null,
            };
            documentService.updateElementProps(
                elementId,
                buildImageFillPropsUpdate(element, {
                    ...prevFill,
                    mode: "crop",
                    cropPlacement: placement,
                }),
            );
            applyCropPlacementStyles(imageTarget, placement);
            scheduleMoveableRectUpdate();
            return true;
        },
        [documentService, elementId, imageTarget, scheduleMoveableRectUpdate],
    );

    const updatePlacement = useCallback(
        (override?: {
            widthPx?: number;
            heightPx?: number;
            translateX?: number;
            translateY?: number;
        }, options: { scheduleRectUpdate?: boolean } = {}): ImageFillCropPlacement | null => {
            if (!container || !imageTarget || !elementId) {
                return null;
            }

            // Local dimensions – unaffected by ancestor CSS transforms.
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;
            if (containerWidth === 0 || containerHeight === 0) {
                return null;
            }

            const doc = documentService.getDocument();
            const element = doc.elements[elementId];
            if (!element) {
                return null;
            }

            const prevFill = (element.props?.imageFill as ImageFill | undefined) ?? {
                mode: "crop",
                assetId: null,
            };
            const prev = gestureBaseRef.current ??
                resolveInitialCropPlacement(container, imageTarget, prevFill);

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

            const placement = { leftPct, topPct, widthPct, heightPct };
            applyCropPlacementStyles(imageTarget, placement);

            if (options.scheduleRectUpdate !== false) {
                scheduleMoveableRectUpdate();
            }
            return placement;
        },
        [container, documentService, elementId, imageTarget, scheduleMoveableRectUpdate],
    );

    useEffect(() => {
        return () => {
            endNativeDrag(null, false);
        };
    }, [endNativeDrag]);

    useLayoutEffect(() => {
        nativeRuntimeRef.current = {
            container,
            imageTarget,
            elementId,
            beginTransform,
            endTransform,
            scheduleMoveableRectUpdate,
            updateMoveableRectNow,
            ensureStoredCropPlacement,
            updatePlacement,
            commitPlacement,
        };
    }, [
        beginTransform,
        commitPlacement,
        container,
        elementId,
        endTransform,
        ensureStoredCropPlacement,
        imageTarget,
        scheduleMoveableRectUpdate,
        updateMoveableRectNow,
        updatePlacement,
    ]);

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const dragState = nativeDragRef.current;
            const runtime = nativeRuntimeRef.current;
            if (
                !dragState ||
                event.pointerId !== dragState.pointerId ||
                !runtime.container ||
                !runtime.updatePlacement
            ) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const delta = clientDeltaToContainerDelta(
                runtime.container,
                event.clientX - dragState.startClientX,
                event.clientY - dragState.startClientY,
            );
            lastDragRef.current = {
                translateX: delta.x,
                translateY: delta.y,
            };
            lastPlacementRef.current = runtime.updatePlacement({
                translateX: delta.x,
                translateY: delta.y,
            }, { scheduleRectUpdate: false });
            runtime.updateMoveableRectNow();
        };

        const handlePointerUp = (event: PointerEvent) => {
            if (event.pointerId !== nativeDragRef.current?.pointerId) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            endNativeDrag(event, true);
        };

        const handlePointerCancel = (event: PointerEvent) => {
            if (event.pointerId !== nativeDragRef.current?.pointerId) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            endNativeDrag(event, false);
        };

        window.addEventListener("pointermove", handlePointerMove, true);
        window.addEventListener("pointerup", handlePointerUp, true);
        window.addEventListener("pointercancel", handlePointerCancel, true);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove, true);
            window.removeEventListener("pointerup", handlePointerUp, true);
            window.removeEventListener("pointercancel", handlePointerCancel, true);
        };
    }, [endNativeDrag]);

    useEffect(() => {
        if (!container || !imageTarget || !elementId) {
            return;
        }

        const handlePointerDown = (event: PointerEvent) => {
            const runtime = nativeRuntimeRef.current;
            if (
                event.button !== 0 ||
                nativeDragRef.current ||
                !runtime.imageTarget ||
                !runtime.ensureStoredCropPlacement
            ) {
                return;
            }
            const placement = runtime.ensureStoredCropPlacement();
            if (!placement) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            nativeDragRef.current = {
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
            };
            gestureBaseRef.current = placement;
            lastPlacementRef.current = placement;
            lastDragRef.current = { translateX: 0, translateY: 0 };
            applyCropPlacementStyles(runtime.imageTarget, placement, { clearTransform: false });
            runtime.imageTarget.setPointerCapture?.(event.pointerId);
            runtime.beginTransform();
            runtime.updateMoveableRectNow();
        };

        imageTarget.addEventListener("pointerdown", handlePointerDown, true);
        return () => {
            imageTarget.removeEventListener("pointerdown", handlePointerDown, true);
        };
    }, [container, elementId, imageTarget]);

    // ── Drag ─────────────────────────────────────────────────────────────

    const handleDragStart = useCallback(
        (event: OnDragStart) => {
            if (!imageTarget) {
                return;
            }
            const placement = ensureStoredCropPlacement();
            gestureBaseRef.current = placement;
            if (placement) {
                applyCropPlacementStyles(imageTarget, placement, { clearTransform: false });
                scheduleMoveableRectUpdate();
            }
            event.set([0, 0]);
            beginTransform();
        },
        [beginTransform, ensureStoredCropPlacement, imageTarget, scheduleMoveableRectUpdate],
    );

    const handleDrag = useCallback((event: OnDrag) => {
        if (!event.target) {
            return;
        }
        lastDragRef.current = {
            translateX: event.beforeTranslate[0],
            translateY: event.beforeTranslate[1],
        };
        lastPlacementRef.current = updatePlacement({
            translateX: lastDragRef.current.translateX,
            translateY: lastDragRef.current.translateY,
        }, { scheduleRectUpdate: false });
    }, [updatePlacement]);

    const handleDragEnd = useCallback(
        (_event: OnDragEnd) => {
            if (!imageTarget || !container) {
                endTransform();
                return;
            }
            if (lastPlacementRef.current) {
                commitPlacement(lastPlacementRef.current);
            } else if (lastDragRef.current) {
                const placement = updatePlacement({
                    translateX: lastDragRef.current.translateX,
                    translateY: lastDragRef.current.translateY,
                });
                if (placement) {
                    commitPlacement(placement);
                }
            }
            lastDragRef.current = null;
            lastPlacementRef.current = null;
            gestureBaseRef.current = null;
            endTransform();
        },
        [commitPlacement, container, endTransform, imageTarget, updatePlacement],
    );

    // ── Resize ───────────────────────────────────────────────────────────

    const handleResizeStart = useCallback(
        (event: OnResizeStart) => {
            if (!imageTarget || !container) {
                return;
            }
            const placement = ensureStoredCropPlacement();
            gestureBaseRef.current = placement;
            if (placement) {
                const widthPx = (placement.widthPct / 100) * container.clientWidth;
                const heightPx = (placement.heightPct / 100) * container.clientHeight;
                event.set([widthPx, heightPx]);
                if (event.dragStart) {
                    event.dragStart.set([0, 0]);
                }
                applyCropPlacementStyles(imageTarget, placement, { clearTransform: false });
                scheduleMoveableRectUpdate();
            }
            event.setMin?.([0, 0]);
            beginTransform();
        },
        [beginTransform, container, ensureStoredCropPlacement, imageTarget, scheduleMoveableRectUpdate],
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
        lastPlacementRef.current = updatePlacement({
            widthPx: event.width,
            heightPx: event.height,
            translateX,
            translateY,
        }, { scheduleRectUpdate: false });
    }, [updatePlacement]);

    const handleResizeEnd = useCallback(
        (_event: OnResizeEnd) => {
            if (!imageTarget || !container) {
                endTransform();
                return;
            }
            if (lastPlacementRef.current) {
                commitPlacement(lastPlacementRef.current);
            } else if (lastResizeRef.current) {
                const placement = updatePlacement({
                    widthPx: lastResizeRef.current.width,
                    heightPx: lastResizeRef.current.height,
                    translateX: lastResizeRef.current.translateX,
                    translateY: lastResizeRef.current.translateY,
                });
                if (placement) {
                    commitPlacement(placement);
                }
            }
            lastResizeRef.current = null;
            lastPlacementRef.current = null;
            gestureBaseRef.current = null;
            endTransform();
        },
        [commitPlacement, container, endTransform, imageTarget, updatePlacement],
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
