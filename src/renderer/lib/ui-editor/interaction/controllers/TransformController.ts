import { useMemo } from "react";
import type { MoveableProps } from "react-moveable";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { useMoveableHandlers } from "@/lib/ui-editor/interaction/useMoveableHandlers";
import type { InteractionController } from "./types";

interface TransformControllerConfig {
    documentService: UIDocumentService;
    selectionIds: string[];
    selectedTargets: HTMLElement[];
    isGroupSelection: boolean;
    viewportScale: number;
    scheduleMoveableRectUpdate: () => void;
    beginTransform: () => void;
    endTransform: () => void;
}

export function useTransformController(config: TransformControllerConfig): InteractionController {
    const handlers = useMoveableHandlers({
        documentService: config.documentService,
        selectionIds: config.selectionIds,
        selectedTargets: config.selectedTargets,
        isGroupSelection: config.isGroupSelection,
        viewportScale: config.viewportScale,
        scheduleMoveableRectUpdate: config.scheduleMoveableRectUpdate,
        beginTransform: config.beginTransform,
        endTransform: config.endTransform,
    });

    const moveableProps = useMemo<Partial<MoveableProps>>(() => ({
        draggable: true,
        resizable: true,
        rotatable: true,
        keepRatio: false,
        origin: true,
        zoom: config.viewportScale,
        throttleDrag: 0,
        throttleResize: 0,
        onDragStart: handlers.handleDragStart,
        onDrag: handlers.handleDrag,
        onDragEnd: handlers.handleDragEnd,
        onDragGroupStart: handlers.handleDragGroupStart,
        onDragGroup: handlers.handleDragGroup,
        onDragGroupEnd: handlers.handleDragGroupEnd,
        onResizeStart: handlers.handleResizeStart,
        onResize: handlers.handleResize,
        onResizeEnd: handlers.handleResizeEnd,
        onResizeGroupStart: handlers.handleResizeGroupStart,
        onResizeGroup: handlers.handleResizeGroup,
        onResizeGroupEnd: handlers.handleResizeGroupEnd,
        onRotateStart: handlers.handleRotateStart,
        onRotate: handlers.handleRotate,
        onRotateEnd: handlers.handleRotateEnd,
        onRotateGroupStart: handlers.handleRotateGroupStart,
        onRotateGroup: handlers.handleRotateGroup,
        onRotateGroupEnd: handlers.handleRotateGroupEnd,
    }), [config.viewportScale, handlers]);

    return {
        id: "transform",
        priority: 0,
        match: true,
        targets: config.selectedTargets,
        moveableProps,
    };
}
