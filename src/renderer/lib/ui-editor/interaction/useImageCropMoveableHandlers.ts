import { useCallback } from "react";
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
    const resetLiveStyles = useCallback(() => {
        if (!config.imageTarget) {
            return;
        }
        config.imageTarget.style.transform = "";
        config.imageTarget.style.width = "";
        config.imageTarget.style.height = "";
    }, [config]);

    /**
     * Read the current rendered placement of the image target relative to the
     * container's padding-box and persist it as a percentage-based crop placement.
     *
     * Both getBoundingClientRect() calls return screen-space values, so their
     * ratios are always correct regardless of ancestor CSS transforms (viewport
     * zoom / pan).  This avoids any coordinate-space mismatch between Moveable
     * event values and the percentage model used by the crop placement.
     */
    const commitPlacement = useCallback(() => {
        const { container, imageTarget, documentService, elementId, scheduleMoveableRectUpdate } = config;
        if (!container || !imageTarget || !elementId) {
            return;
        }

        const containerRect = container.getBoundingClientRect();
        if (containerRect.width === 0 || containerRect.height === 0) {
            return;
        }

        // Derive the effective visual scale so we can locate the padding-box
        // origin inside the border-box reported by getBoundingClientRect().
        const offsetW = container.offsetWidth;
        const scale = offsetW > 0 ? containerRect.width / offsetW : 1;

        // Padding-box origin and size in screen pixels.
        // container.clientLeft / clientTop equal the border widths in CSS px.
        const paddingLeft = containerRect.left + container.clientLeft * scale;
        const paddingTop = containerRect.top + container.clientTop * scale;
        const paddingWidth = container.clientWidth * scale;
        const paddingHeight = container.clientHeight * scale;

        if (paddingWidth === 0 || paddingHeight === 0) {
            return;
        }

        const imageRect = imageTarget.getBoundingClientRect();

        const leftPct = ((imageRect.left - paddingLeft) / paddingWidth) * 100;
        const topPct = ((imageRect.top - paddingTop) / paddingHeight) * 100;
        const widthPct = Math.max(MIN_SIZE_PCT, (imageRect.width / paddingWidth) * 100);
        const heightPct = Math.max(MIN_SIZE_PCT, (imageRect.height / paddingHeight) * 100);

        const doc = documentService.getDocument();
        const element = doc.elements[elementId];
        if (!element) {
            return;
        }

        const prevFill = (element.props?.imageFill as ImageFill) ?? { mode: "crop", assetId: null };

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
    }, [config]);

    // ── Drag ─────────────────────────────────────────────────────────────

    const handleDragStart = useCallback((_event: OnDragStart) => {
        if (!config.imageTarget) {
            return;
        }
        config.beginTransform();
    }, [config]);

    const handleDrag = useCallback((event: OnDrag) => {
        if (!event.target) {
            return;
        }
        // Apply Moveable's computed transform for live visual feedback.
        event.target.style.transform = event.transform;
    }, []);

    const handleDragEnd = useCallback((_event: OnDragEnd) => {
        if (!config.imageTarget || !config.container) {
            config.endTransform();
            return;
        }
        // Commit the rendered position BEFORE clearing the live styles so
        // that getBoundingClientRect still reflects the dragged state.
        commitPlacement();
        resetLiveStyles();
        config.endTransform();
    }, [config, commitPlacement, resetLiveStyles]);

    // ── Resize ───────────────────────────────────────────────────────────

    const handleResizeStart = useCallback((_event: OnResizeStart) => {
        if (!config.imageTarget) {
            return;
        }
        config.beginTransform();
    }, [config]);

    const handleResize = useCallback((event: OnResize) => {
        if (!event.target) {
            return;
        }
        // Apply Moveable's computed size / transform for live visual feedback.
        event.target.style.width = `${event.width}px`;
        event.target.style.height = `${event.height}px`;
        if (event.drag) {
            event.target.style.transform = event.drag.transform;
        }
    }, []);

    const handleResizeEnd = useCallback((_event: OnResizeEnd) => {
        if (!config.imageTarget || !config.container) {
            config.endTransform();
            return;
        }
        commitPlacement();
        resetLiveStyles();
        config.endTransform();
    }, [config, commitPlacement, resetLiveStyles]);

    return {
        handleDragStart,
        handleDrag,
        handleDragEnd,
        handleResizeStart,
        handleResize,
        handleResizeEnd,
    };
}
