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
            documentService.updateElementProps(elementId, {
                ...element.props,
                imageFill: nextFill,
            });

            // ── 2. Directly apply styles to the DOM element ─────────────────
            // This removes the Moveable-applied transform and sets the
            // authoritative percentage values so that the image is visually
            // correct even before React reconciles.
            imageTarget.style.transform = "";
            imageTarget.style.left = `${leftPct}%`;
            imageTarget.style.top = `${topPct}%`;
            imageTarget.style.width = `${widthPct}%`;
            imageTarget.style.height = `${heightPct}%`;

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
