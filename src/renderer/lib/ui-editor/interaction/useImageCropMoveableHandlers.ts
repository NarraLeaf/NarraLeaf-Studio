import { useCallback, useRef } from "react";
import type {
    OnDrag,
    OnDragEnd,
    OnDragStart,
    OnResize,
    OnResizeEnd,
    OnResizeStart,
} from "react-moveable";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";

const MIN_SIZE_PCT = 5;

interface ImageCropHandlersConfig {
    documentService: UIDocumentService;
    elementId: string;
    container: HTMLElement | null;
    imageTarget: HTMLElement | null;
    beginTransform: () => void;
    endTransform: () => void;
    scheduleMoveableRectUpdate: () => void;
}

export function useImageCropMoveableHandlers(config: ImageCropHandlersConfig) {
    const lastDragRef = useRef<{ translateX: number; translateY: number } | null>(null);
    const lastResizeRef = useRef<{
        width: number;
        height: number;
        translateX: number;
        translateY: number;
    } | null>(null);

    const resetLiveStyles = useCallback(() => {
        if (!config.imageTarget) {
            return;
        }
        config.imageTarget.style.transform = "";
        config.imageTarget.style.width = "";
        config.imageTarget.style.height = "";
    }, [config]);

    /**
     * Persist the crop placement from tracked pixel deltas.
     *
     * Uses container.clientWidth / clientHeight (the padding-box in local CSS
     * coordinates) instead of getBoundingClientRect (screen-space AABB).
     *
     * This is critical because:
     *   - CSS percentage left/top/width/height resolve against the containing
     *     block's LOCAL dimensions.
     *   - Moveable's beforeTranslate and resize values are in the target's
     *     local coordinate space.
     *   - getBoundingClientRect returns the axis-aligned bounding box which is
     *     WRONG when the element is rotated (it becomes larger than the actual
     *     element dimensions).
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

            // Local dimensions – unaffected by ancestor CSS transforms (rotation,
            // viewport zoom / pan).  These match the coordinate space that CSS
            // percentage values and Moveable deltas operate in.
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
            const prev = prevFill.cropPlacement ?? {
                leftPct: 0,
                topPct: 0,
                widthPct: 100,
                heightPct: 100,
            };

            // Convert stored percentages → local pixels
            const baseWidthPx = (prev.widthPct / 100) * containerWidth;
            const baseHeightPx = (prev.heightPct / 100) * containerHeight;
            const baseLeftPx = (prev.leftPct / 100) * containerWidth;
            const baseTopPx = (prev.topPct / 100) * containerHeight;

            // Apply overrides (resize gives new pixel size, drag gives a translate delta)
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

            const nextFill: ImageFill = {
                ...prevFill,
                mode: "crop",
                cropPlacement: { leftPct, topPct, widthPct, heightPct },
            };
            documentService.updateElementProps(elementId, {
                ...element.props,
                imageFill: nextFill,
            });
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
            config.beginTransform();
        },
        [config],
    );

    const handleDrag = useCallback((event: OnDrag) => {
        if (!event.target) {
            return;
        }
        lastDragRef.current = {
            translateX: event.beforeTranslate[0],
            translateY: event.beforeTranslate[1],
        };
        // Apply Moveable's computed transform for live visual feedback.
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
            resetLiveStyles();
            lastDragRef.current = null;
            config.endTransform();
        },
        [config, resetLiveStyles, updatePlacement],
    );

    // ── Resize ───────────────────────────────────────────────────────────

    const handleResizeStart = useCallback(
        (_event: OnResizeStart) => {
            if (!config.imageTarget) {
                return;
            }
            config.beginTransform();
        },
        [config],
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
        // Apply Moveable's computed size / transform for live visual feedback.
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
            resetLiveStyles();
            lastResizeRef.current = null;
            config.endTransform();
        },
        [config, resetLiveStyles, updatePlacement],
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
