import { useMemo } from "react";
import type { MoveableProps } from "react-moveable";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { useImageCropMoveableHandlers } from "@/lib/ui-editor/interaction/useImageCropMoveableHandlers";
import type { InteractionController } from "./types";

interface ImageCropControllerConfig {
    documentService: UIDocumentService;
    stateService: UIEditorStateService | null;
    selectedTargets: HTMLElement[];
    viewportScale: number;
    scheduleMoveableRectUpdate: () => void;
    updateMoveableRectNow: () => void;
    beginTransform: () => void;
    endTransform: () => void;
    surfaceId: string;
}

export function useImageCropController(config: ImageCropControllerConfig): InteractionController {
    const override = config.stateService?.getInteractionOverride();
    const isCropOverride = override?.kind === "imageCrop";
    const primaryTarget =
        config.selectedTargets.length === 1 ? config.selectedTargets[0] : null;
    const imageTarget = primaryTarget?.querySelector('[data-ui-image-fill="true"]') as HTMLElement | null;
    const match =
        Boolean(
            isCropOverride &&
                override?.surfaceId === config.surfaceId &&
                override?.elementId &&
                imageTarget &&
                primaryTarget &&
                primaryTarget.dataset.uiElementId === override?.elementId,
        ) && config.selectedTargets.length === 1;

    const handlers = useImageCropMoveableHandlers({
        documentService: config.documentService,
        elementId: match ? override?.elementId ?? "" : "",
        container: primaryTarget,
        imageTarget,
        beginTransform: config.beginTransform,
        endTransform: config.endTransform,
        scheduleMoveableRectUpdate: config.scheduleMoveableRectUpdate,
        updateMoveableRectNow: config.updateMoveableRectNow,
    });

    const moveableProps = useMemo<Partial<MoveableProps>>(() => ({
        draggable: true,
        resizable: true,
        rotatable: false,
        keepRatio: false,
        origin: false,
        zoom: config.viewportScale,
        throttleDrag: 0,
        throttleResize: 0,
        onDragStart: handlers.handleDragStart,
        onDrag: handlers.handleDrag,
        onDragEnd: handlers.handleDragEnd,
        onResizeStart: handlers.handleResizeStart,
        onResize: handlers.handleResize,
        onResizeEnd: handlers.handleResizeEnd,
    }), [config.viewportScale, handlers]);

    const targets = match && imageTarget ? [imageTarget] : [];

    return {
        id: "imageCrop",
        priority: 1,
        match,
        targets,
        moveableProps,
    };
}
