import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { UITool } from "@/lib/ui-editor/editor/types";
import type { ViewportTransform } from "../geometry";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { SELECTABLE_TARGET } from "./constants";
import {
    isUiContainerDrillLockHit,
    markSuppressNextCanvasWidgetDoubleClick,
    promoteHitToDirectChildOfSurfaceRoot,
    resolveSelectionLevelHit,
    resolveUiContainerDrillTarget,
    shouldPromoteToSurfaceRootChild,
} from "./containerDrillSelection";
import { isMoveableInteractionTarget } from "./surfaceInlineTextEditActivation";
import { buildLayoutPatchForNewElementFromSurfaceRect } from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import { insertToolCanPlace, resolveNewElementParent } from "@/lib/ui-editor/tree/resolveAddTarget";
import {
    collectSnapGuideLines,
    splitSnapLinesToAxes,
    snapSurfacePoint,
    surfaceThresholdFromViewportPx,
    DEFAULT_SNAP_THRESHOLD_PX,
} from "@/lib/ui-editor/snapping";
import { selectSurfaceForProperties } from "@/lib/ui-editor/commands/uiEditorSelection";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import {
    clampSurfaceWheelDelta,
    normalizeSurfaceWheelDelta,
    resolveSurfaceWheelPageDelta,
    SURFACE_PINCH_ZOOM_DELTA_LIMIT_PX,
    SURFACE_WHEEL_PAN_DELTA_LIMIT_PX,
    SURFACE_WHEEL_ZOOM_DELTA_LIMIT_PX,
} from "./surfaceWheelInput";
import {
    constrainPointToAspectRatio,
    resolveAspectRatio,
    type SurfacePoint,
} from "./insertAspectRatio";
import { isSurfaceGestureEnabled, UI_EDITOR_WRITABLE, type UIEditorReadOnly } from "./readOnlyInteraction";
import { GESTURE_DEADZONE_PX } from "./gestureDeadzone";

const WHEEL_ZOOM_SPEED = 0.003;
const PINCH_ZOOM_SPEED = 0.006;

export type InsertToolDragState = {
    active: boolean;
    nodeType: string;
    componentId?: string;
    aspectRatio?: number | null;
    startClientX: number;
    startClientY: number;
    startSurfaceX: number;
    startSurfaceY: number;
    primaryElementId: string | null;
};

type PanState = {
    active: boolean;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
};

type UseSurfaceInteractionEventsParams = {
    surfaceElement: HTMLElement | null;
    surfaceId: string;
    surface: UISurface;
    tool: UITool;
    viewport: ViewportTransform;
    selectionData: UIElementSelection | null;
    clientToSurfaceCoords: (clientX: number, clientY: number) => { x: number; y: number };
    setInsertPreview: (preview: InsertPreview | null) => void;
    insertPreviewRef: MutableRefObject<InsertPreview | null>;
    insertStateRef: MutableRefObject<InsertToolDragState | null>;
    panStateRef: MutableRefObject<PanState>;
    documentService: UIDocumentService;
    stateService: UIEditorStateService;
    uiService?: UIService | null;
    /** When both return allow snapping, insert drag corners snap to guides. */
    insertSnapEnabled?: () => boolean;
    insertSnapSuspended?: () => boolean;
    /** While active, the insert draw gesture never starts. Selection, drill, pan and zoom are untouched. */
    readOnly?: UIEditorReadOnly;
    /**
     * True for a press the selection's drag takes although it hit something else - its frame, where
     * a clipping container hides the element or a sibling covers it (`pressLandsInSelectionFrame`).
     * Such a press leaves the selection alone, so that the drag starting from it has something to
     * move; released without moving, it selects what it hit after all, as the same click anywhere
     * else does.
     */
    pressDragsSelectionFrame?: (event: PointerEvent) => boolean;
    /**
     * Hands a press `pressDragsSelectionFrame` took to the selection's drag. Called with the
     * `mousedown` that follows the press: Moveable's drag reads mouse events, and a pointer event
     * handed to it starts nothing.
     */
    startSelectionFrameDrag?: (event: MouseEvent) => void;
    /** The overlay Moveable draws its frame, handles and group drag area in (not inside `surfaceElement`). */
    overlayElement?: HTMLElement | null;
};

export type InsertPreview = {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
};

export function useSurfaceInteractionEvents({
    surfaceElement,
    surfaceId,
    surface,
    tool,
    viewport,
    selectionData,
    clientToSurfaceCoords,
    setInsertPreview,
    insertPreviewRef,
    insertStateRef,
    panStateRef,
    documentService,
    stateService,
    uiService,
    insertSnapEnabled,
    insertSnapSuspended,
    readOnly = UI_EDITOR_WRITABLE,
    pressDragsSelectionFrame,
    startSelectionFrameDrag,
    overlayElement = null,
}: UseSurfaceInteractionEventsParams) {
    /** Pointer events often keep `detail` at 0; use timing + target to emulate double-activation for container drill. */
    const containerDrillLastPointerRef = useRef<{ elementId: string; t: number } | null>(null);
    /**
     * A press whose effect on the selection waits for the pointer to come up: it may still become a
     * drag of the selection, and only released where it went down is it the click it would have been.
     * `target` is what the click counts as hitting when that is not the event's own target - the
     * element under a multiple selection's drag area.
     */
    const heldFramePressRef = useRef<{ event: PointerEvent; target: Element | null } | null>(null);
    const insertDrawEnabled = isSurfaceGestureEnabled("insertDraw", readOnly);

    useEffect(() => {
        if (!surfaceElement) {
            return;
        }

        const updateInsertPreview = (next: InsertPreview | null) => {
            insertPreviewRef.current = next;
            setInsertPreview(next);
        };

        const constrainInsertPoint = (state: InsertToolDragState, current: SurfacePoint): SurfacePoint => {
            return constrainPointToAspectRatio(
                { x: state.startSurfaceX, y: state.startSurfaceY },
                current,
                state.aspectRatio ?? null,
            );
        };

        const stopPan = () => {
            panStateRef.current.active = false;
        };

        const cancelInsert = () => {
            if (!insertStateRef.current?.active) {
                return;
            }
            insertStateRef.current = null;
            stateService.setSnapGuides(null);
            updateInsertPreview(null);
        };

        if (!insertDrawEnabled || tool.kind !== "insert") {
            cancelInsert();
        }

        const finishInsert = () => {
            if (!insertStateRef.current?.active) {
                return;
            }

            stateService.setSnapGuides(null);

            const state = insertStateRef.current;
            insertStateRef.current = null;

            const preview = insertPreviewRef.current;
            if (!preview) {
                return;
            }

            const x = Math.min(preview.startX, preview.currentX);
            const y = Math.min(preview.startY, preview.currentY);
            const width = Math.abs(preview.currentX - preview.startX);
            const height = Math.abs(preview.currentY - preview.startY);

            const MIN_SIZE = 10;
            if (width < MIN_SIZE && height < MIN_SIZE) {
                updateInsertPreview(null);
                return;
            }

            updateInsertPreview(null);

            const doc = documentService.getDocument();
            const parentId = resolveNewElementParent(doc, surfaceId, state.primaryElementId);
            if (!parentId) {
                return;
            }
            const layoutPatch = buildLayoutPatchForNewElementFromSurfaceRect(doc, parentId, {
                x,
                y,
                width,
                height,
            });
            const element = state.componentId
                ? documentService.createComponentInstance(parentId, state.componentId, layoutPatch)
                : documentService.createElement(parentId, state.nodeType, layoutPatch);

            stateService.setUIElementSelection({
                editor: "ui",
                surfaceId,
                elementIds: [element.id],
                primaryId: element.id,
            });
            stateService.setTool({ kind: "select" });
        };

        const handlePointerMove = (event: PointerEvent) => {
            if (insertStateRef.current?.active) {
                event.preventDefault();
                const surfacePoint = clientToSurfaceCoords(event.clientX, event.clientY);
                let curX = surfacePoint.x;
                let curY = surfacePoint.y;
                // Prefer live modifier state on the pointer event; keyup can be missed after Cmd+Tab / menus.
                const suspendSnap = (insertSnapSuspended?.() ?? false) || event.metaKey || event.ctrlKey;
                if (insertSnapEnabled?.() && !suspendSnap) {
                    const doc = documentService.getDocument();
                    const lines = collectSnapGuideLines(
                        doc,
                        surfaceId,
                        new Set(),
                        surface.designSize,
                        stateService.getSmartSnapDetailSettings(),
                    );
                    const { vertical, horizontal } = splitSnapLinesToAxes(lines);
                    const th = surfaceThresholdFromViewportPx(viewport.scale, DEFAULT_SNAP_THRESHOLD_PX);
                    const snapped = snapSurfacePoint({
                        x: curX,
                        y: curY,
                        verticalLines: vertical,
                        horizontalLines: horizontal,
                        thresholdSurface: th,
                        surfaceId,
                    });
                    curX = snapped.x;
                    curY = snapped.y;
                    stateService.setSnapGuides(
                        snapped.activeGuides.vertical.length > 0 || snapped.activeGuides.horizontal.length > 0
                            ? snapped.activeGuides
                            : null,
                    );
                } else {
                    stateService.setSnapGuides(null);
                }
                const current = constrainInsertPoint(insertStateRef.current, { x: curX, y: curY });
                updateInsertPreview({
                    startX: insertStateRef.current.startSurfaceX,
                    startY: insertStateRef.current.startSurfaceY,
                    currentX: current.x,
                    currentY: current.y,
                });
                return;
            }

            if (!panStateRef.current.active) {
                return;
            }
            event.preventDefault();
            const dx = event.clientX - panStateRef.current.startX;
            const dy = event.clientY - panStateRef.current.startY;
            stateService.updateViewport({
                offsetX: panStateRef.current.startOffsetX + dx,
                offsetY: panStateRef.current.startOffsetY + dy,
            });
        };

        let pendingFrameDragStart: ((event: MouseEvent) => void) | null = null;
        const clearPendingFrameDragStart = () => {
            if (pendingFrameDragStart) {
                surfaceElement.removeEventListener("mousedown", pendingFrameDragStart, true);
                pendingFrameDragStart = null;
            }
        };

        const handlePointerUp = (event: PointerEvent) => {
            clearPendingFrameDragStart();
            const held = heldFramePressRef.current;
            heldFramePressRef.current = null;
            if (
                held &&
                event.type === "pointerup" &&
                Math.hypot(event.clientX - held.event.clientX, event.clientY - held.event.clientY) < GESTURE_DEADZONE_PX
            ) {
                // After the mouseup that ends Moveable's drag, which comes after this event: changing
                // the selection now would swap its targets in the middle of the gesture.
                window.setTimeout(() => applySelectionPress(held.event, held.target), 0);
            }
            if (insertStateRef.current?.active) {
                if (event.type === "pointercancel") {
                    cancelInsert();
                } else {
                    finishInsert();
                }
            }
            stopPan();
        };

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest?.("textarea, input, [contenteditable='true']")) {
                return;
            }
            const isInsideSurface = !!(target && surfaceElement.contains(target));
            const isMoveableTarget = isMoveableInteractionTarget(target);

            const isPanTool = tool.kind === "pan" && event.button === 0;
            const isMiddleMouse = event.button === 1;
            if ((isPanTool || isMiddleMouse) && isInsideSurface) {
                event.preventDefault();
                event.stopPropagation();
                panStateRef.current.active = true;
                panStateRef.current.startX = event.clientX;
                panStateRef.current.startY = event.clientY;
                panStateRef.current.startOffsetX = viewport.offsetX;
                panStateRef.current.startOffsetY = viewport.offsetY;
                return;
            }

            // Read-only: the gesture never starts, so there is no drag to abandon later. The insert
            // tool cannot be armed from the docker bar either, so this is belt to that brace.
            if (tool.kind === "insert" && insertDrawEnabled && event.button === 0 && isInsideSurface) {
                event.preventDefault();
                event.stopPropagation();
                // Armed in another editor with something this one cannot take - a component, on a
                // component's own canvas. The tab disarms it when it is shown (`UISurfaceEditorTab`);
                // this is the press on an editor in a second group, which was shown all along.
                if (!insertToolCanPlace(documentService.getDocument(), surfaceId, tool)) {
                    stateService.setTool({ kind: "select" });
                    return;
                }
                const surfacePoint = clientToSurfaceCoords(event.clientX, event.clientY);
                const component = tool.componentId ? documentService.getComponent(tool.componentId) : null;
                const componentRoot = component ? component.elements[component.rootElementId] : null;
                const aspectRatio = component
                    ? resolveAspectRatio(
                          component.previewMeta?.width ?? componentRoot?.layout.width,
                          component.previewMeta?.height ?? componentRoot?.layout.height,
                      )
                    : null;
                let primaryElementId: string | null = null;
                if (selectionData?.surfaceId === surfaceId) {
                    primaryElementId =
                        selectionData.primaryId ??
                        selectionData.elementIds[selectionData.elementIds.length - 1] ??
                        null;
                }
                insertStateRef.current = {
                    active: true,
                    nodeType: tool.nodeType,
                    componentId: tool.componentId,
                    aspectRatio,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    startSurfaceX: surfacePoint.x,
                    startSurfaceY: surfacePoint.y,
                    primaryElementId,
                };
                updateInsertPreview({
                    startX: surfacePoint.x,
                    startY: surfacePoint.y,
                    currentX: surfacePoint.x,
                    currentY: surfacePoint.y,
                });
                selectSurfaceForProperties(stateService, surfaceId, uiService);
                return;
            }

            // Shift on something already selected takes it away - but only as a click. Pressed and
            // dragged, it is the selection moving along one axis, and the selection has to still be
            // there for it to move.
            if (tool.kind === "select" && event.button === 0 && shiftPressTakesFromSelection(event, target)) {
                heldFramePressRef.current = { event, target };
                return;
            }

            if (tool.kind === "select" && !isMoveableTarget && pressDragsSelectionFrame?.(event)) {
                // Held until the pointer comes up: dragged, it moved the selection; released where it
                // was pressed, it is the click it would have been anywhere else.
                heldFramePressRef.current = { event, target: null };
                clearPendingFrameDragStart();
                if (startSelectionFrameDrag) {
                    const start = (mouse: MouseEvent) => {
                        pendingFrameDragStart = null;
                        startSelectionFrameDrag(mouse);
                    };
                    pendingFrameDragStart = start;
                    surfaceElement.addEventListener("mousedown", start, { capture: true, once: true });
                }
                return;
            }

            applySelectionPress(event);
        };

        /**
         * A press on Moveable's drag area. A multiple selection is moved by that area, drawn over the
         * whole group in the overlay - outside `surfaceElement`, so `handlePointerDown` never hears
         * it - and every press inside the group's box lands there rather than on an element. Read the
         * element under it instead: a plain press still drags the group and, released without moving,
         * selects that one element; Shift and Cmd/Ctrl act on it as they do anywhere else.
         */
        const handleOverlayPointerDown = (event: PointerEvent) => {
            if (tool.kind !== "select" || event.button !== 0) {
                return;
            }
            const beneath = elementBeneathMoveableArea(event);
            if (!beneath) {
                return;
            }
            if ((!event.shiftKey && !event.metaKey && !event.ctrlKey) || shiftPressTakesFromSelection(event, beneath)) {
                heldFramePressRef.current = { event, target: beneath };
                return;
            }
            applySelectionPress(event, beneath);
        };

        /** The selectable element under a press that landed on Moveable's drag area, or null. */
        const elementBeneathMoveableArea = (event: PointerEvent): Element | null => {
            const target = event.target as Element | null;
            if (!target?.closest?.(".moveable-area")) {
                return null;
            }
            const ownerDocument = surfaceElement.ownerDocument;
            if (typeof ownerDocument.elementsFromPoint !== "function") {
                return null;
            }
            for (const hit of ownerDocument.elementsFromPoint(event.clientX, event.clientY)) {
                const node = hit.closest(SELECTABLE_TARGET);
                if (node && surfaceElement.contains(node)) {
                    return hit;
                }
            }
            return null;
        };

        /** Whether a Shift press on `target` would take an element out of the selection. */
        const shiftPressTakesFromSelection = (event: PointerEvent, target: Element | null): boolean => {
            if (!event.shiftKey || !selectionData || selectionData.surfaceId !== surfaceId || selectionData.elementIds.length === 0) {
                return false;
            }
            const node = target?.closest?.(SELECTABLE_TARGET) as HTMLElement | null;
            const elementId = node?.dataset.uiElementId;
            const doc = documentService.getDocument();
            if (!elementId || !doc.elements[elementId]) {
                return false;
            }
            const toggledId = event.metaKey || event.ctrlKey
                ? elementId
                : resolveSelectionLevelHit(doc, surfaceId, selectionData, elementId);
            return selectionData.elementIds.includes(toggledId);
        };

        /**
         * What a press does to the selection: select what it hit, or the surface when it hit nothing.
         * `targetOverride` is what it counts as hitting when that is not the event's own target.
         */
        const applySelectionPress = (event: PointerEvent, targetOverride: Element | null = null) => {
            const target = (targetOverride ?? event.target) as HTMLElement | null;
            const isInsideSurface = !!(target && surfaceElement.contains(target));
            const elementNode = target?.closest?.(SELECTABLE_TARGET) as HTMLElement | null;
            const isElementNode = !!elementNode;
            const isMoveableTarget = isMoveableInteractionTarget(target);

            if (tool.kind === "select" && event.button === 0 && isElementNode) {
                const elementId = elementNode?.dataset.uiElementId;
                if (elementId) {
                    const doc = documentService.getDocument();
                    const hitElement = doc.elements[elementId];
                    if (!hitElement || hitElement.type === "nl.root") {
                        selectSurfaceForProperties(stateService, surfaceId, uiService);
                        containerDrillLastPointerRef.current = null;
                        return;
                    }
                    // Cmd/Ctrl reaches the deepest element under the pointer in one press, past the
                    // outermost-frame pick and the one-level-per-double-click drill. Shift adds to or
                    // takes from the selection, at the selection's own level unless Cmd/Ctrl is held too.
                    const deep = event.metaKey || event.ctrlKey;
                    if (event.shiftKey && selectionData && selectionData.surfaceId === surfaceId && selectionData.elementIds.length > 0) {
                        containerDrillLastPointerRef.current = null;
                        const toggledId = deep
                            ? elementId
                            : resolveSelectionLevelHit(doc, surfaceId, selectionData, elementId);
                        const cur = selectionData.elementIds;
                        const nextIds = cur.includes(toggledId)
                            ? cur.filter(id => id !== toggledId)
                            : [...cur, toggledId];
                        if (nextIds.length === 0) {
                            selectSurfaceForProperties(stateService, surfaceId, uiService);
                        } else {
                            stateService.setUIElementSelection({
                                editor: "ui",
                                surfaceId,
                                elementIds: nextIds,
                                primaryId: nextIds.includes(toggledId) ? toggledId : nextIds[nextIds.length - 1],
                            });
                        }
                    } else if (deep) {
                        containerDrillLastPointerRef.current = null;
                        stateService.setUIElementSelection({
                            editor: "ui",
                            surfaceId,
                            elementIds: [elementId],
                            primaryId: elementId,
                        });
                    } else {
                        const hitId = elementId;
                        const drillLock = isUiContainerDrillLockHit(doc, surfaceId, selectionData, hitId);
                        const pickId = !drillLock && shouldPromoteToSurfaceRootChild(doc, selectionData, surfaceId, hitId)
                            ? promoteHitToDirectChildOfSurfaceRoot(doc, surfaceId, hitId)
                            : hitId;
                        const drillTargetId = drillLock
                            ? resolveUiContainerDrillTarget(doc, surfaceId, selectionData, hitId) ?? hitId
                            : pickId;
                        if (!drillLock) {
                            containerDrillLastPointerRef.current = null;
                        } else {
                            const now = performance.now();
                            const last = containerDrillLastPointerRef.current;
                            const rapidSameTarget =
                                last != null && last.elementId === hitId && now - last.t < 400;
                            if (rapidSameTarget) {
                                containerDrillLastPointerRef.current = null;
                            } else {
                                containerDrillLastPointerRef.current = { elementId: hitId, t: now };
                            }
                            const detail = typeof event.detail === "number" ? event.detail : 0;
                            const allowDrillIntoChild = detail >= 2 || rapidSameTarget;
                            if (!allowDrillIntoChild) {
                                return;
                            }
                            markSuppressNextCanvasWidgetDoubleClick();
                        }
                        stateService.setUIElementSelection({
                            editor: "ui",
                            surfaceId,
                            elementIds: [drillTargetId],
                            primaryId: drillTargetId,
                        });
                    }
                }
                return;
            }

            if (isInsideSurface && !isElementNode) {
                if (isMoveableTarget) {
                    return;
                }
                selectSurfaceForProperties(stateService, surfaceId, uiService);
                containerDrillLastPointerRef.current = null;
            }
        };

        surfaceElement.addEventListener("pointerdown", handlePointerDown);
        overlayElement?.addEventListener("pointerdown", handleOverlayPointerDown);
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);

        return () => {
            clearPendingFrameDragStart();
            surfaceElement.removeEventListener("pointerdown", handlePointerDown);
            overlayElement?.removeEventListener("pointerdown", handleOverlayPointerDown);
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
        };
    }, [
        surfaceElement,
        stateService,
        tool,
        viewport,
        surfaceId,
        documentService,
        selectionData,
        surface,
        uiService,
        clientToSurfaceCoords,
        insertPreviewRef,
        insertStateRef,
        panStateRef,
        setInsertPreview,
        insertSnapEnabled,
        insertSnapSuspended,
        insertDrawEnabled,
        pressDragsSelectionFrame,
        startSelectionFrameDrag,
        overlayElement,
    ]);

    // Space held over the canvas turns a drag into a pan, whatever tool is chosen - the way every
    // design tool pans without a middle button or a trip to the Hand tool. Its own capture-phase
    // listener, so the press never reaches selection, Selecto or Moveable.
    useEffect(() => {
        if (!surfaceElement) {
            return undefined;
        }
        const view = surfaceElement.ownerDocument.defaultView;
        if (!view) {
            return undefined;
        }
        let pointerInside = false;
        let spaceHeld = false;
        let panning = false;
        let previousCursor: string | null = null;

        const setCursor = (cursor: string | null) => {
            if (cursor === null) {
                if (previousCursor !== null) {
                    surfaceElement.style.cursor = previousCursor;
                    previousCursor = null;
                }
                return;
            }
            if (previousCursor === null) {
                previousCursor = surfaceElement.style.cursor;
            }
            surfaceElement.style.cursor = cursor;
        };
        const isTyping = (target: EventTarget | null) =>
            target instanceof Element && Boolean(target.closest("textarea, input, select, [contenteditable='true']"));

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space" || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) {
                return;
            }
            if (!pointerInside && !spaceHeld) {
                return;
            }
            // Not a page scroll, and not a click on whatever button has focus.
            event.preventDefault();
            if (!spaceHeld) {
                spaceHeld = true;
                setCursor(panning ? "grabbing" : "grab");
            }
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.code !== "Space" || !spaceHeld) {
                return;
            }
            event.preventDefault();
            spaceHeld = false;
            if (!panning) {
                setCursor(null);
            }
        };
        const onPointerDown = (event: PointerEvent) => {
            if (!spaceHeld || event.button !== 0) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            panning = true;
            setCursor("grabbing");
            panStateRef.current.active = true;
            panStateRef.current.startX = event.clientX;
            panStateRef.current.startY = event.clientY;
            const current = stateService.getViewportTransform();
            panStateRef.current.startOffsetX = current.offsetX;
            panStateRef.current.startOffsetY = current.offsetY;
            // Released outside the window, the pan still ends.
            try {
                surfaceElement.setPointerCapture(event.pointerId);
            } catch {
                // An element that can no longer capture: the window-level pointerup still ends it.
            }
        };
        const onPointerUp = () => {
            if (!panning) {
                return;
            }
            panning = false;
            setCursor(spaceHeld ? "grab" : null);
        };
        const onEnter = () => {
            pointerInside = true;
        };
        const onLeave = () => {
            pointerInside = false;
        };
        const onBlur = () => {
            spaceHeld = false;
            if (!panning) {
                setCursor(null);
            }
        };

        surfaceElement.addEventListener("pointerdown", onPointerDown, true);
        surfaceElement.addEventListener("pointerenter", onEnter);
        surfaceElement.addEventListener("pointerleave", onLeave);
        view.addEventListener("keydown", onKeyDown, true);
        view.addEventListener("keyup", onKeyUp, true);
        view.addEventListener("pointerup", onPointerUp, true);
        view.addEventListener("pointercancel", onPointerUp, true);
        view.addEventListener("blur", onBlur);
        return () => {
            surfaceElement.removeEventListener("pointerdown", onPointerDown, true);
            surfaceElement.removeEventListener("pointerenter", onEnter);
            surfaceElement.removeEventListener("pointerleave", onLeave);
            view.removeEventListener("keydown", onKeyDown, true);
            view.removeEventListener("keyup", onKeyUp, true);
            view.removeEventListener("pointerup", onPointerUp, true);
            view.removeEventListener("pointercancel", onPointerUp, true);
            view.removeEventListener("blur", onBlur);
            setCursor(null);
        };
    }, [panStateRef, stateService, surfaceElement]);

    useEffect(() => {
        if (!surfaceElement) {
            return;
        }

        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = surfaceElement.getBoundingClientRect();
            const pageDeltaX = resolveSurfaceWheelPageDelta(rect.width || surfaceElement.clientWidth);
            const pageDeltaY = resolveSurfaceWheelPageDelta(rect.height || surfaceElement.clientHeight);
            const normalizedDeltaX = normalizeSurfaceWheelDelta(event.deltaX, event.deltaMode, pageDeltaX);
            const normalizedDeltaY = normalizeSurfaceWheelDelta(event.deltaY, event.deltaMode, pageDeltaY);
            // A trackpad pinch arrives as a wheel with Ctrl set by the browser. Cmd+wheel is how a
            // Mac mouse zooms (every design tool does it); before, it fell through to a pan.
            const isPinch = event.ctrlKey && !event.metaKey;
            const isZoomInteraction =
                event.ctrlKey || event.metaKey || (tool.kind === "pan" && normalizedDeltaY !== 0);

            if (isZoomInteraction) {
                const pointerX = event.clientX - rect.left;
                const pointerY = event.clientY - rect.top;
                const currentScale = Math.max(0.0001, viewport.scale);
                const zoomSpeed = isPinch ? PINCH_ZOOM_SPEED : WHEEL_ZOOM_SPEED;
                const zoomDeltaLimit = isPinch
                    ? SURFACE_PINCH_ZOOM_DELTA_LIMIT_PX
                    : SURFACE_WHEEL_ZOOM_DELTA_LIMIT_PX;
                const zoomDeltaY = clampSurfaceWheelDelta(normalizedDeltaY, zoomDeltaLimit);
                const scaleDelta = Math.exp(-zoomDeltaY * zoomSpeed);
                const nextScale = Math.max(0.1, Math.min(10, currentScale * scaleDelta));
                if (nextScale === currentScale) {
                    return;
                }
                const surfacePoint = clientToSurfaceCoords(event.clientX, event.clientY);
                const nextOffsetX = pointerX - surfacePoint.x * nextScale;
                const nextOffsetY = pointerY - surfacePoint.y * nextScale;
                stateService.updateViewport({
                    scale: nextScale,
                    offsetX: nextOffsetX,
                    offsetY: nextOffsetY,
                });
                return;
            }

            const panDeltaX = clampSurfaceWheelDelta(normalizedDeltaX, SURFACE_WHEEL_PAN_DELTA_LIMIT_PX);
            const panDeltaY = clampSurfaceWheelDelta(normalizedDeltaY, SURFACE_WHEEL_PAN_DELTA_LIMIT_PX);
            const panX = -panDeltaX + (event.shiftKey ? -panDeltaY : 0);
            const panY = event.shiftKey ? 0 : -panDeltaY;
            if (panX === 0 && panY === 0) {
                return;
            }
            stateService.updateViewport({
                offsetX: viewport.offsetX + panX,
                offsetY: viewport.offsetY + panY,
            });
        };

        surfaceElement.addEventListener("wheel", handleWheel, { passive: false });
        return () => surfaceElement.removeEventListener("wheel", handleWheel);
    }, [
        surfaceElement,
        stateService,
        tool.kind,
        viewport.scale,
        viewport.offsetX,
        viewport.offsetY,
        clientToSurfaceCoords,
    ]);

}
