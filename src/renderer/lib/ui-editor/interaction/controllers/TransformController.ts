import { useMemo } from "react";
import type { MoveableProps } from "react-moveable";
import { isUIElementFlowLayoutChild } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { IUIEditorStateService } from "@/lib/workspace/services/services";
import type { ActiveSnapGuides } from "@/lib/ui-editor/snapping/types";
import { useMoveableHandlers } from "@/lib/ui-editor/interaction/useMoveableHandlers";
import type { InteractionController } from "./types";

interface TransformControllerConfig {
    documentService: UIDocumentService;
    selectionIds: string[];
    snapExcludedElementIds?: string[];
    selectedTargets: HTMLElement[];
    isGroupSelection: boolean;
    viewportScale: number;
    scheduleMoveableRectUpdate: () => void;
    beginTransform: () => void;
    endTransform: () => void;
    /** When set, Moveable is non-interactive so inline editors (e.g. text) can receive pointer events. */
    inlineTextEditElementId: string | null;
    surfaceId: string;
    surfaceDesignSize: { width: number; height: number };
    stateService: IUIEditorStateService;
    /** e.g. Alt key held - skip snapping for this gesture. */
    snapSuspended: () => boolean;
}

export function useTransformController(config: TransformControllerConfig): InteractionController {
    const smartSnap = useMemo(
        () => ({
            surfaceId: config.surfaceId,
            designSize: config.surfaceDesignSize,
            isEnabled: () => config.stateService.getSmartSnapEnabled(),
            isSuspended: () => config.snapSuspended(),
            setGuides: (guides: ActiveSnapGuides | null) => config.stateService.setSnapGuides(guides),
            getExcludedElementIds: () => new Set(config.snapExcludedElementIds ?? config.selectionIds),
            getDetailSettings: () => config.stateService.getSmartSnapDetailSettings(),
        }),
        [
            config.selectionIds,
            config.snapExcludedElementIds,
            config.snapSuspended,
            config.stateService,
            config.surfaceDesignSize,
            config.surfaceId,
        ],
    );

    const handlers = useMoveableHandlers({
        documentService: config.documentService,
        selectionIds: config.selectionIds,
        selectedTargets: config.selectedTargets,
        isGroupSelection: config.isGroupSelection,
        viewportScale: config.viewportScale,
        scheduleMoveableRectUpdate: config.scheduleMoveableRectUpdate,
        beginTransform: config.beginTransform,
        endTransform: config.endTransform,
        smartSnap,
    });

    const selectionHasFlowLayoutChild = useMemo(() => {
        const doc = config.documentService.getDocument();
        return config.selectionIds.some(id => {
            const el = doc.elements[id];
            return el != null && isUIElementFlowLayoutChild(doc, el);
        });
    }, [config.documentService, config.selectionIds]);

    const isInlineTextEditing = Boolean(
        config.inlineTextEditElementId &&
            config.selectionIds.length === 1 &&
            config.selectionIds[0] === config.inlineTextEditElementId,
    );

    const moveableProps = useMemo<Partial<MoveableProps>>(() => ({
        draggable: !isInlineTextEditing && !selectionHasFlowLayoutChild,
        resizable: !isInlineTextEditing,
        rotatable: !isInlineTextEditing,
        // Aspect ratio is enforced in useMoveableHandlers; Moveable keepRatio fights raw clientX/Y math.
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
    }), [config.viewportScale, handlers, isInlineTextEditing, selectionHasFlowLayoutChild]);

    return {
        id: "transform",
        priority: 0,
        match: true,
        targets: config.selectedTargets,
        moveableProps,
    };
}
