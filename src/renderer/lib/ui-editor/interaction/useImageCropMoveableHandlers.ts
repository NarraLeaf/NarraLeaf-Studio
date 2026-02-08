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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

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
    const updatePlacement = useCallback(() => {
        const { container, imageTarget, documentService, elementId, scheduleMoveableRectUpdate } = config;
        if (!container || !imageTarget || !elementId) {
            return;
        }
        const containerRect = container.getBoundingClientRect();
        const targetRect = imageTarget.getBoundingClientRect();
        if (containerRect.width === 0 || containerRect.height === 0) {
            return;
        }
        const widthPct = (targetRect.width / containerRect.width) * 100;
        const heightPct = (targetRect.height / containerRect.height) * 100;
        const leftPct = ((targetRect.left - containerRect.left) / containerRect.width) * 100;
        const topPct = ((targetRect.top - containerRect.top) / containerRect.height) * 100;
        const clampedWidth = Math.max(100, widthPct);
        const clampedHeight = Math.max(100, heightPct);
        const clampedLeft = clamp(leftPct, -(clampedWidth - 100), 0);
        const clampedTop = clamp(topPct, -(clampedHeight - 100), 0);
        const placement = {
            leftPct: clampedLeft,
            topPct: clampedTop,
            widthPct: clampedWidth,
            heightPct: clampedHeight,
        };

        const document = documentService.getDocument();
        const element = document.elements[elementId];
        if (!element) {
            return;
        }
        const prevFill = (element.props?.imageFill as ImageFill) ?? { mode: "crop", assetId: null };
        const nextFill: ImageFill = {
            ...prevFill,
            mode: "crop",
            cropPlacement: placement,
        };
        documentService.updateElementProps(elementId, {
            ...element.props,
            imageFill: nextFill,
        });
        scheduleMoveableRectUpdate();
    }, [config]);

    const handleDragStart = useCallback((_event: OnDragStart) => {
        if (!config.imageTarget) {
            return;
        }
        config.beginTransform();
    }, [config]);

    const handleDrag = useCallback((_event: OnDrag) => {
        // Intentionally no-op; live preview handled by Moveable
    }, []);

    const handleDragEnd = useCallback((_event: OnDragEnd) => {
        if (!config.imageTarget || !config.container) {
            config.endTransform();
            return;
        }
        updatePlacement();
        config.endTransform();
    }, [config, updatePlacement]);

    const handleResizeStart = useCallback((_event: OnResizeStart) => {
        if (!config.imageTarget) {
            return;
        }
        config.beginTransform();
    }, [config]);

    const handleResize = useCallback((_event: OnResize) => {
        // no-op
    }, []);

    const handleResizeEnd = useCallback((_event: OnResizeEnd) => {
        if (!config.imageTarget || !config.container) {
            config.endTransform();
            return;
        }
        updatePlacement();
        config.endTransform();
    }, [config, updatePlacement]);

    return {
        handleDragStart,
        handleDrag,
        handleDragEnd,
        handleResizeStart,
        handleResize,
        handleResizeEnd,
    };
}
