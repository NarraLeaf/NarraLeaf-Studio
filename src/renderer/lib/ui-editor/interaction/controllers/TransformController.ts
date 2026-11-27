import { useMemo } from "react";
import type { MoveableProps } from "react-moveable";
import { isUIElementFlowLayoutChild } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { IUIEditorStateService } from "@/lib/workspace/services/services";
import type { ActiveSnapGuides } from "@/lib/ui-editor/snapping/types";
import { useMoveableHandlers } from "@/lib/ui-editor/interaction/useMoveableHandlers";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";
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
    /** e.g. Cmd/Ctrl held - skip snapping for this gesture. */
    snapSuspended: () => boolean;
    /** Places copies where an Alt-drag dropped the selection (`useMoveableHandlers`). */
    duplicateOnDrop?: (positions: Record<string, { x: number; y: number }>) => boolean;
    /** Bumps when the document changes, so what is derived from an element's layout is read again. */
    documentRevision: number;
}

/** Screen pixels outside each corner that turn the selection rather than pass through to the canvas. */
export const ROTATE_ZONE_PX = 20;

/** The resize handles that leave an element's top-left corner where it is. */
export const ORIGIN_RESIZE_DIRECTIONS = ["e", "s", "se"];

/** Just the corners, for an element too small on screen to show a handle on every edge as well. */
export const CORNER_RESIZE_DIRECTIONS = ["nw", "ne", "sw", "se"];

/** One corner, for an element so small that even four handles would cover it. */
export const SINGLE_RESIZE_DIRECTIONS = ["se"];

/** Below this many screen pixels on a side, the edge handles go and the corners stay. */
export const COMPACT_HANDLES_BELOW_PX = 32;

/** Below this many screen pixels on a side, a single corner handle is left. */
export const SINGLE_HANDLE_BELOW_PX = 16;

/**
 * Whether a selection can be dragged, and which resize handles it gets.
 *
 * - Text being edited in place takes the pointer itself.
 * - An element a stack or list places has its position decided by that parent. A left or top handle
 *   would grow it to the right or down instead - the parent puts its corner back - so it gets the
 *   handles that keep that corner, as the origin element below does.
 * - The element at the origin - a component's root, in the editor for that component - is drawn
 *   there because a placement draws it there, and the canvas is its size. A left or top handle would
 *   have to move that corner, so the edge would follow the pointer and spring back on release; it is
 *   offered the three handles that keep the corner instead.
 * - An element small on screen (`screenSize`, the selection's box at the current zoom) loses the edge
 *   handles, then all but one corner: eight handles on a 20px icon cover all of it, and a press that
 *   lands on a handle resizes it, so the icon could not be dragged at all.
 *
 * The handle list is only stated when it is narrowed: Moveable's default is every handle.
 */
export function resolveTransformGestures(selection: {
    inlineTextEditing: boolean;
    placedByParent: boolean;
    holdsOrigin: boolean;
    screenSize?: { width: number; height: number } | null;
}): { draggable: boolean; renderDirections?: string[] } {
    let directions: string[] | null = selection.holdsOrigin || selection.placedByParent ? ORIGIN_RESIZE_DIRECTIONS : null;
    const side = selection.screenSize ? Math.min(Math.abs(selection.screenSize.width), Math.abs(selection.screenSize.height)) : Infinity;
    const sizeDirections = side < SINGLE_HANDLE_BELOW_PX
        ? SINGLE_RESIZE_DIRECTIONS
        : side < COMPACT_HANDLES_BELOW_PX
          ? CORNER_RESIZE_DIRECTIONS
          : null;
    if (sizeDirections) {
        const narrowed: string[] = directions ? directions.filter(direction => sizeDirections.includes(direction)) : sizeDirections;
        directions = narrowed.length > 0 ? narrowed : SINGLE_RESIZE_DIRECTIONS;
    }
    return {
        draggable: !selection.inlineTextEditing && !selection.placedByParent && !selection.holdsOrigin,
        ...(directions ? { renderDirections: directions } : {}),
    };
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
            getGridSpacing: () =>
                config.stateService.getSmartSnapDetailSettings().snapGrid ? config.stateService.getGridSpacing() : null,
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
        duplicateOnDrop: config.duplicateOnDrop,
    });

    // Only a selection made entirely of what a stack places is held still. One such element among
    // freely placed ones used to make the whole selection undraggable; now the free ones move and the
    // stack puts its own child back.
    const selectionHasFlowLayoutChild = useMemo(() => {
        const doc = config.documentService.getDocument();
        return config.selectionIds.length > 0 && config.selectionIds.every(id => {
            const el = doc.elements[id];
            return el != null && isUIElementFlowLayoutChild(doc, el);
        });
    }, [config.documentService, config.selectionIds]);

    // A component's frame, in the editor for that component - see `isComponentEditorRootElement`.
    const selectionHasOriginElement = useMemo(() => {
        const doc = config.documentService.getDocument();
        return config.selectionIds.some(id => isComponentEditorRootElement(doc.elements[id]));
    }, [config.documentService, config.selectionIds]);

    const isInlineTextEditing = Boolean(
        config.inlineTextEditElementId &&
            config.selectionIds.length === 1 &&
            config.selectionIds[0] === config.inlineTextEditElementId,
    );

    // The selection's box on screen, for the handles a small element is offered. Read from the
    // document rather than the DOM: the box is what the author sized, and it is known before paint.
    const selectionScreenSize = useMemo(() => {
        if (config.selectionIds.length !== 1) {
            return null;
        }
        const layout = config.documentService.getDocument().elements[config.selectionIds[0]]?.layout;
        return layout ? { width: layout.width * config.viewportScale, height: layout.height * config.viewportScale } : null;
    }, [config.documentService, config.selectionIds, config.viewportScale, config.documentRevision]);

    const moveableProps = useMemo<Partial<MoveableProps>>(() => ({
        ...resolveTransformGestures({
            inlineTextEditing: isInlineTextEditing,
            placedByParent: selectionHasFlowLayoutChild,
            holdsOrigin: selectionHasOriginElement,
            screenSize: selectionScreenSize,
        }),
        resizable: !isInlineTextEditing,
        rotatable: !isInlineTextEditing,
        // Turned from just outside a corner, as in design tools, rather than from a handle on a stalk
        // above the element: the stalk sat where the floating toolbar does on a narrow element, and
        // reaching for it meant leaving the corner the hand was already at.
        rotationPosition: "none",
        rotateAroundControls: true,
        // How far out from a corner the turning zone reaches, in screen pixels. Moveable sizes the
        // zone from this, and with its default of 0 the zone is there but cannot be hit.
        controlPadding: ROTATE_ZONE_PX,
        // Aspect ratio is enforced in useMoveableHandlers; Moveable keepRatio fights raw clientX/Y math.
        keepRatio: false,
        // No transform-origin dot: nothing here moves the origin, and on a small element the dot sat
        // over the very spot a press would drag it from.
        origin: false,
        // Moveable is mounted on the unscaled viewport, not inside the zoomed canvas, so its handles
        // are drawn in screen pixels already. `zoom` would scale them with the canvas: 3px handles at
        // 25%, ones that hide the element at 400%.
        zoom: 1,
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
    }), [handlers, isInlineTextEditing, selectionHasFlowLayoutChild, selectionHasOriginElement, selectionScreenSize]);

    return {
        id: "transform",
        priority: 0,
        match: true,
        targets: config.selectedTargets,
        moveableProps,
    };
}
