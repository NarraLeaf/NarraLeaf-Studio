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
    shouldPromoteToSurfaceRootChild,
} from "./containerDrillSelection";
import { isMoveableInteractionTarget } from "./surfaceInlineTextEditActivation";
import {
    buildLayoutPatchForNewElementFromSurfaceRect,
    resolveInsertTargetParent,
} from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import {
    collectSnapGuideLines,
    splitSnapLinesToAxes,
    snapSurfacePoint,
    surfaceThresholdFromViewportPx,
    DEFAULT_SNAP_THRESHOLD_PX,
} from "@/lib/ui-editor/snapping";

export type InsertToolDragState = {
    active: boolean;
    nodeType: string;
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
    /** When both return allow snapping, insert drag corners snap to guides. */
    insertSnapEnabled?: () => boolean;
    insertSnapSuspended?: () => boolean;
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
    insertSnapEnabled,
    insertSnapSuspended,
}: UseSurfaceInteractionEventsParams) {
    /** Pointer events often keep `detail` at 0; use timing + target to emulate double-activation for container drill. */
    const containerDrillLastPointerRef = useRef<{ elementId: string; t: number } | null>(null);

    useEffect(() => {
        if (!surfaceElement) {
            return;
        }

        const updateInsertPreview = (next: InsertPreview | null) => {
            insertPreviewRef.current = next;
            setInsertPreview(next);
        };

        const stopPan = () => {
            panStateRef.current.active = false;
        };

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
            const target = resolveInsertTargetParent(doc, surfaceId, {
                hitElementId: null,
                primaryElementId: state.primaryElementId,
            });
            if (!target) {
                return;
            }
            const layoutPatch = buildLayoutPatchForNewElementFromSurfaceRect(doc, target.parentId, {
                x,
                y,
                width,
                height,
            });
            const element = documentService.createElement(target.parentId, state.nodeType, layoutPatch);

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
                // Prefer live modifier state on the pointer event; keyup can be missed after Alt+Tab / menus.
                const suspendSnap = (insertSnapSuspended?.() ?? false) || event.altKey;
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
                updateInsertPreview({
                    startX: insertStateRef.current.startSurfaceX,
                    startY: insertStateRef.current.startSurfaceY,
                    currentX: curX,
                    currentY: curY,
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

        const handlePointerUp = () => {
            if (insertStateRef.current?.active) {
                finishInsert();
            }
            stopPan();
        };

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest?.("textarea, input, [contenteditable='true']")) {
                return;
            }
            const isInsideSurface = !!(target && surfaceElement.contains(target));
            const elementNode = target?.closest?.(SELECTABLE_TARGET) as HTMLElement | null;
            const isElementNode = !!elementNode;
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

            if (tool.kind === "insert" && event.button === 0 && isInsideSurface) {
                event.preventDefault();
                event.stopPropagation();
                const surfacePoint = clientToSurfaceCoords(event.clientX, event.clientY);
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
                stateService.setSelection({ type: null, data: null });
                return;
            }

            if (tool.kind === "select" && event.button === 0 && isElementNode) {
                const elementId = elementNode?.dataset.uiElementId;
                if (elementId) {
                    if ((event.metaKey || event.ctrlKey) && selectionData && selectionData.surfaceId === surfaceId) {
                        const cur = selectionData.elementIds;
                        const nextIds = cur.includes(elementId)
                            ? cur.filter(id => id !== elementId)
                            : [...cur, elementId];
                        if (nextIds.length === 0) {
                            stateService.setSelection({ type: null, data: null });
                        } else {
                            stateService.setUIElementSelection({
                                editor: "ui",
                                surfaceId,
                                elementIds: nextIds,
                                primaryId: elementId,
                            });
                        }
                    } else if (event.shiftKey && selectionData && selectionData.surfaceId === surfaceId) {
                        const nextIds = selectionData.elementIds.includes(elementId)
                            ? selectionData.elementIds
                            : [...selectionData.elementIds, elementId];
                        stateService.setUIElementSelection({
                            editor: "ui",
                            surfaceId,
                            elementIds: nextIds,
                            primaryId: elementId,
                        });
                    } else {
                        const doc = documentService.getDocument();
                        const hitId = elementId;
                        const drillLock = isUiContainerDrillLockHit(doc, surfaceId, selectionData, hitId);
                        const pickId = !drillLock && shouldPromoteToSurfaceRootChild(doc, selectionData, surfaceId, hitId)
                            ? promoteHitToDirectChildOfSurfaceRoot(doc, surfaceId, hitId)
                            : hitId;
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
                            elementIds: [drillLock ? hitId : pickId],
                            primaryId: drillLock ? hitId : pickId,
                        });
                    }
                }
                return;
            }

            if (isInsideSurface && !isElementNode) {
                if (isMoveableTarget) {
                    return;
                }
                stateService.setSelection({ type: null, data: null });
                containerDrillLastPointerRef.current = null;
            }
        };

        surfaceElement.addEventListener("pointerdown", handlePointerDown);
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);

        return () => {
            surfaceElement.removeEventListener("pointerdown", handlePointerDown);
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
        clientToSurfaceCoords,
        insertPreviewRef,
        insertStateRef,
        panStateRef,
        setInsertPreview,
        insertSnapEnabled,
        insertSnapSuspended,
    ]);

    useEffect(() => {
        if (!surfaceElement) {
            return;
        }

        const handleWheel = (event: WheelEvent) => {
            const isZoomInteraction = event.ctrlKey || (tool.kind === "pan" && event.deltaY !== 0);
            event.preventDefault();

            if (isZoomInteraction) {
                const rect = surfaceElement.getBoundingClientRect();
                const pointerX = event.clientX - rect.left;
                const pointerY = event.clientY - rect.top;
                const currentScale = Math.max(0.0001, viewport.scale);
                const zoomSpeed = 0.0015;
                const scaleDelta = Math.exp(-event.deltaY * zoomSpeed);
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

            const panX = -event.deltaX + (event.shiftKey ? -event.deltaY : 0);
            const panY = event.shiftKey ? 0 : -event.deltaY;
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
