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

/** The inline style properties a crop preview or gesture writes on the image, and so has to give back. */
const CROP_PREVIEW_STYLE_KEYS = ["left", "top", "width", "height", "maxWidth", "maxHeight", "transform"] as const;
type CropPreviewStyleKey = (typeof CROP_PREVIEW_STYLE_KEYS)[number];

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
    resolveGestureBase?: () => ImageFillCropPlacement | null;
    updatePlacement?: (
        override?: {
            widthPx?: number;
            heightPx?: number;
            translateX?: number;
            translateY?: number;
        },
        options?: { scheduleRectUpdate?: boolean },
    ) => ImageFillCropPlacement | null;
    finishGesture?: (placement: ImageFillCropPlacement | null) => void;
}

function samePlacement(a: ImageFillCropPlacement, b: ImageFillCropPlacement): boolean {
    return (
        Math.abs(a.leftPct - b.leftPct) < CROP_PLACEMENT_EPSILON &&
        Math.abs(a.topPct - b.topPct) < CROP_PLACEMENT_EPSILON &&
        Math.abs(a.widthPct - b.widthPct) < CROP_PLACEMENT_EPSILON &&
        Math.abs(a.heightPct - b.heightPct) < CROP_PLACEMENT_EPSILON
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

/**
 * Where the picture is drawn right now, as a crop placement: the box a crop gesture starts from.
 *
 * A crop fill draws its stored placement, or the whole box when it has none - the same fallback the
 * renderer takes. Every other mode is turned into the placement that draws the same picture, which
 * needs the image's natural size; until the image has loaded there is no answer.
 */
function resolveDrawnCropPlacement(
    container: HTMLElement,
    imageTarget: HTMLElement,
    fill: ImageFill,
): ImageFillCropPlacement | null {
    const mode = readRenderedFillMode(imageTarget) ?? fill.mode ?? "cover";
    if (mode === "crop") {
        return fill.cropPlacement ?? DEFAULT_RECTANGLE_CROP_PLACEMENT;
    }
    const naturalSize = getNaturalImageSize(imageTarget);
    if (!naturalSize) {
        return null;
    }
    return computeCropPlacementForMode({
        imageWidth: naturalSize.width,
        imageHeight: naturalSize.height,
        containerWidth: container.clientWidth,
        containerHeight: container.clientHeight,
        mode,
    });
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

/**
 * Crop editing of one image fill: the drag and resize gestures, and nothing written before them.
 *
 * Entering crop editing changes nothing in the document. A fill in any other mode is shown at the
 * placement that draws the same picture - the box grows to the whole image so the part outside the
 * frame can be seen and dragged - but that preview lives in the image's inline style only, and is
 * handed back when editing ends without a gesture. The fill becomes a crop, with that placement, at
 * the end of a drag or resize that actually moved the picture; a click, or a drag back to where it
 * started, writes nothing.
 */
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

    /**
     * The fill as it is drawn: the element's own `imageFill`, with the mode and picture the image
     * reports laid over it. The two differ when an appearance row supplies the fill, and the drawn
     * one is what a crop has to keep showing.
     */
    const resolveEffectiveFill = useCallback((): ImageFill | null => {
        if (!imageTarget || !elementId) {
            return null;
        }
        const element = documentService.getDocument().elements[elementId];
        if (!element) {
            return null;
        }
        const renderedMode = readRenderedFillMode(imageTarget);
        const renderedAssetId = readRenderedAssetId(imageTarget);
        const prevFill = (element.props?.imageFill as ImageFill | undefined) ?? {
            mode: renderedMode ?? "cover",
            assetId: renderedAssetId,
        };
        return {
            ...prevFill,
            mode: renderedMode ?? prevFill.mode ?? "cover",
            assetId: renderedAssetId ?? prevFill.assetId ?? null,
        };
    }, [documentService, elementId, imageTarget]);

    const resolveGestureBase = useCallback((): ImageFillCropPlacement | null => {
        if (!container || !imageTarget) {
            return null;
        }
        const fill = resolveEffectiveFill();
        return fill ? resolveDrawnCropPlacement(container, imageTarget, fill) : null;
    }, [container, imageTarget, resolveEffectiveFill]);

    /**
     * Show a fill that is not a crop at the placement that draws the same picture, for as long as
     * crop editing lasts, and give the image its own inline style back afterwards unless a gesture
     * made the fill a crop in the meantime (then the renderer draws the crop and owns the style).
     */
    useLayoutEffect(() => {
        if (!container || !imageTarget || !elementId) {
            return;
        }
        const fill = resolveEffectiveFill();
        if (!fill || fill.mode === "crop") {
            return;
        }
        const saved = {} as Record<CropPreviewStyleKey, string>;
        for (const key of CROP_PREVIEW_STYLE_KEYS) {
            saved[key] = imageTarget.style[key];
        }
        let previewing = false;
        const showPreview = () => {
            const placement = resolveDrawnCropPlacement(container, imageTarget, fill);
            if (!placement) {
                return;
            }
            // `max-width: 100%` from the base stylesheet would hold the box to the frame.
            imageTarget.style.maxWidth = "none";
            imageTarget.style.maxHeight = "none";
            applyCropPlacementStyles(imageTarget, placement, { clearTransform: false });
            previewing = true;
            scheduleMoveableRectUpdate();
        };
        showPreview();
        if (!previewing) {
            imageTarget.addEventListener("load", showPreview, { once: true });
        }
        return () => {
            imageTarget.removeEventListener("load", showPreview);
            const now = documentService.getDocument().elements[elementId]?.props?.imageFill as ImageFill | undefined;
            if (now?.mode === "crop") {
                return;
            }
            for (const key of CROP_PREVIEW_STYLE_KEYS) {
                imageTarget.style[key] = saved[key];
            }
        };
        // The fill is read once per editing session: a change of mode while editing ends the session
        // (see `ImageFillField` and the image's docker bar), which runs this again.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [container, elementId, imageTarget]);

    /**
     * Persist the crop placement and directly apply the resulting CSS to the image target so the
     * visual state is immediately correct.
     *
     * We MUST write the styles ourselves instead of relying on React's reconciliation because:
     *   1. Moveable manipulates inline styles directly (transform, width, height).
     *   2. When we clear those overrides React still considers its previous
     *      render values "current" and only patches properties that CHANGED
     *      between renders.  For a pure drag (no size change) React would
     *      skip re-applying width/height, leaving them blank after the clear.
     *   3. Writing the authoritative values here avoids the gap entirely.
     *
     * The fill written is the drawn one (see `resolveEffectiveFill`), so the first crop of a fill
     * that came from an appearance row keeps its picture.
     */
    const commitPlacement = useCallback(
        (placement: ImageFillCropPlacement): boolean => {
            if (!imageTarget || !elementId) {
                return false;
            }
            const element = documentService.getDocument().elements[elementId];
            const fill = resolveEffectiveFill();
            if (!element || !fill) {
                return false;
            }
            documentService.updateElementProps(
                elementId,
                buildImageFillPropsUpdate(element, {
                    ...fill,
                    mode: "crop",
                    cropPlacement: placement,
                }),
            );
            applyCropPlacementStyles(imageTarget, placement);
            scheduleMoveableRectUpdate();
            return true;
        },
        [documentService, elementId, imageTarget, resolveEffectiveFill, scheduleMoveableRectUpdate],
    );

    /**
     * The end of a drag or resize. Only a gesture that moved the picture is written; one that did
     * not puts the picture back where it started, which is also where the preview drew it.
     */
    const finishGesture = useCallback(
        (placement: ImageFillCropPlacement | null) => {
            const base = gestureBaseRef.current;
            if (placement && (!base || !samePlacement(placement, base))) {
                commitPlacement(placement);
            } else if (base && imageTarget) {
                applyCropPlacementStyles(imageTarget, base, { clearTransform: false });
                scheduleMoveableRectUpdate();
            }
        },
        [commitPlacement, imageTarget, scheduleMoveableRectUpdate],
    );

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
        runtime.finishGesture?.(commit ? lastPlacementRef.current : null);
        lastDragRef.current = null;
        lastPlacementRef.current = null;
        gestureBaseRef.current = null;
        runtime.endTransform();
    }, []);

    useEffect(() => {
        gestureBaseRef.current = null;
        lastPlacementRef.current = null;
    }, [elementId]);

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

            const prev = gestureBaseRef.current ?? resolveGestureBase();
            if (!prev) {
                return null;
            }

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
        [container, elementId, imageTarget, resolveGestureBase, scheduleMoveableRectUpdate],
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
            resolveGestureBase,
            updatePlacement,
            finishGesture,
        };
    }, [
        beginTransform,
        container,
        elementId,
        endTransform,
        finishGesture,
        imageTarget,
        resolveGestureBase,
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
                !runtime.resolveGestureBase
            ) {
                return;
            }
            const placement = runtime.resolveGestureBase();
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
            const placement = resolveGestureBase();
            gestureBaseRef.current = placement;
            lastPlacementRef.current = null;
            if (placement) {
                applyCropPlacementStyles(imageTarget, placement, { clearTransform: false });
                scheduleMoveableRectUpdate();
            }
            event.set([0, 0]);
            beginTransform();
        },
        [beginTransform, imageTarget, resolveGestureBase, scheduleMoveableRectUpdate],
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
            let placement = lastPlacementRef.current;
            if (!placement && lastDragRef.current) {
                placement = updatePlacement({
                    translateX: lastDragRef.current.translateX,
                    translateY: lastDragRef.current.translateY,
                });
            }
            finishGesture(placement);
            lastDragRef.current = null;
            lastPlacementRef.current = null;
            gestureBaseRef.current = null;
            endTransform();
        },
        [container, endTransform, finishGesture, imageTarget, updatePlacement],
    );

    // ── Resize ───────────────────────────────────────────────────────────

    const handleResizeStart = useCallback(
        (event: OnResizeStart) => {
            if (!imageTarget || !container) {
                return;
            }
            const placement = resolveGestureBase();
            gestureBaseRef.current = placement;
            lastPlacementRef.current = null;
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
        [beginTransform, container, imageTarget, resolveGestureBase, scheduleMoveableRectUpdate],
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
            let placement = lastPlacementRef.current;
            if (!placement && lastResizeRef.current) {
                placement = updatePlacement({
                    widthPx: lastResizeRef.current.width,
                    heightPx: lastResizeRef.current.height,
                    translateX: lastResizeRef.current.translateX,
                    translateY: lastResizeRef.current.translateY,
                });
            }
            finishGesture(placement);
            lastResizeRef.current = null;
            lastPlacementRef.current = null;
            gestureBaseRef.current = null;
            endTransform();
        },
        [container, endTransform, finishGesture, imageTarget, updatePlacement],
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
