import {
    startTransition,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Collision, CollisionDetection, DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import { DndContext, MeasuringStrategy, PointerSensor, pointerWithin, useSensor, useSensors } from "@dnd-kit/core";
import type { UIElement } from "@shared/types/ui-editor/document";
import { isUIElementSelection } from "@services/ui/UIStore";
import { ContextMenu, type ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import type { InputDialog } from "@/lib/components/dialogs";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import {
    moveLogReason,
    resolveBeforeChildIdForOutlineGap,
} from "@/lib/ui-editor/interaction/outline/outlineDropGeometry";
import {
    isOutlineGapDropData,
    type OutlineGapDropData,
    OUTLINE_ROOT_WIDGET_TYPE,
    OutlineDragPreview,
    OutlineSubtree,
} from "@/lib/ui-editor/interaction/outline/LayerOutlineRows";
import { useLayerOutlineContextMenus } from "@/lib/ui-editor/interaction/outline/useLayerOutlineContextMenus";
import { selectSurfaceForProperties } from "@/lib/ui-editor/commands/uiEditorSelection";
import type { UIService } from "@/lib/workspace/services/core/UIService";

export type UILayersPanelProps = {
    surfaceId: string;
    stateService: UIEditorStateService;
    documentService: UIDocumentService;
    uiService?: UIService | null;
    localBlueprint: LocalBlueprintService;
    inputDialog: InputDialog | null;
};

function collisionHasOutlineGapData(collision: Collision): boolean {
    return isOutlineGapDropData(collision.data?.droppableContainer.data.current);
}

const OUTLINE_DND_MEASURING = {
    droppable: {
        strategy: MeasuringStrategy.Always,
    },
};

function getOutlineGapCollisionAtPointer(args: Parameters<CollisionDetection>[0]): Collision[] | null {
    const { pointerCoordinates } = args;
    const doc = globalThis.document;
    if (!pointerCoordinates || typeof doc?.elementsFromPoint !== "function") {
        return null;
    }

    const elements = doc.elementsFromPoint(pointerCoordinates.x, pointerCoordinates.y);
    for (const element of elements) {
        const gapElement = element.closest("[data-outline-gap-id]") as HTMLElement | null;
        const gapId = gapElement?.dataset.outlineGapId;
        if (!gapId) {
            continue;
        }
        const droppableContainer = args.droppableContainers.find(container => String(container.id) === gapId);
        if (!droppableContainer || !isOutlineGapDropData(droppableContainer.data.current)) {
            continue;
        }
        return [
            {
                id: droppableContainer.id,
                data: {
                    droppableContainer,
                    value: 0,
                },
            },
        ];
    }
    return [];
}

function getActivatorClientPoint(event: Event | null): { x: number; y: number } | null {
    if (!event) {
        return null;
    }
    const eventRecord = event as unknown as Record<string, unknown>;
    const clientX = eventRecord.clientX;
    const clientY = eventRecord.clientY;
    if (typeof clientX === "number" && typeof clientY === "number") {
        return { x: clientX, y: clientY };
    }

    const touches = eventRecord.touches;
    const firstTouch = getFirstTouchPoint(touches);
    if (firstTouch) {
        return firstTouch;
    }

    const changedTouches = eventRecord.changedTouches;
    return getFirstTouchPoint(changedTouches);
}

function getFirstTouchPoint(value: unknown): { x: number; y: number } | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const touchList = value as { length?: unknown; item?: (index: number) => unknown; 0?: unknown };
    const length = typeof touchList.length === "number" ? touchList.length : 0;
    if (length <= 0) {
        return null;
    }
    const first = typeof touchList.item === "function" ? touchList.item(0) : touchList[0];
    if (!first || typeof first !== "object") {
        return null;
    }
    const touch = first as Record<string, unknown>;
    return typeof touch.clientX === "number" && typeof touch.clientY === "number"
        ? { x: touch.clientX, y: touch.clientY }
        : null;
}

export function UILayersPanel({
    surfaceId,
    stateService,
    documentService,
    uiService,
    localBlueprint,
    inputDialog,
}: UILayersPanelProps) {
    const [docVersion, setDocVersion] = useState(0);
    const [selection, setSelection] = useState(stateService.getSelection());
    const [outlineRev, setOutlineRev] = useState(0);
    const [activeDragId, setActiveDragId] = useState<string | null>(null);
    const [activeDragPoint, setActiveDragPoint] = useState<{ x: number; y: number } | null>(null);
    const initialDragPointRef = useRef<{ x: number; y: number } | null>(null);
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);

    useEffect(() => {
        return documentService.onDocumentChanged(() => {
            startTransition(() => {
                setDocVersion(v => v + 1);
            });
        });
    }, [documentService]);

    useEffect(() => {
        return stateService.on("selectionChanged", selectionNext => {
            startTransition(() => {
                setSelection(selectionNext);
            });
        });
    }, [stateService]);

    useEffect(() => {
        return stateService.on("outlineExpansionChanged", () => {
            setOutlineRev(v => v + 1);
        });
    }, [stateService]);

    void docVersion;

    const document = documentService.getDocument();
    const surface = document.surfaces.find(surf => surf.id === surfaceId);
    const effectiveRootId = surface ? resolveSurfaceRootElementId(document, surfaceId) : null;
    const root = effectiveRootId ? document.elements[effectiveRootId] : undefined;

    const isLinkedTree =
        surface != null && effectiveRootId != null && effectiveRootId !== surface.rootElementId;

    const selectionData = isUIElementSelection(selection) ? selection.data : null;
    const selectedIds = useMemo(() => new Set(selectionData?.elementIds ?? []), [selectionData]);
    const primaryId = selectionData?.primaryId ?? selectionData?.elementIds?.[selectionData.elementIds.length - 1];

    const handleSelect = useCallback(
        (id: string, event: MouseEvent<HTMLElement>) => {
            let nextIds: string[] = [];

            // Align with canvas: Shift adds to selection; Ctrl/Meta toggles membership.
            if (event.shiftKey && selectionData?.surfaceId === surfaceId) {
                if (selectedIds.has(id)) {
                    nextIds = Array.from(selectedIds);
                } else {
                    nextIds = [...selectedIds, id];
                }
            } else if (event.metaKey || event.ctrlKey) {
                if (selectedIds.has(id)) {
                    nextIds = Array.from(selectedIds).filter(existing => existing !== id);
                } else {
                    nextIds = [...selectedIds, id];
                }
                if (nextIds.length === 0) {
                    selectSurfaceForProperties(stateService, surfaceId, uiService);
                    return;
                }
            } else {
                nextIds = [id];
            }

            stateService.setUIElementSelection({
                editor: "ui",
                surfaceId,
                elementIds: nextIds,
                primaryId: id,
            });
        },
        [selectedIds, selectionData?.surfaceId, stateService, surfaceId]
    );

    const isCollapsed = useCallback(
        (elementId: string) => {
            void outlineRev;
            return stateService.isOutlineBranchCollapsed(elementId);
        },
        [outlineRev, stateService]
    );

    const toggleCollapsed = useCallback(
        (elementId: string) => {
            const next = !stateService.isOutlineBranchCollapsed(elementId);
            stateService.setOutlineBranchCollapsed(elementId, next);
        },
        [stateService]
    );

    const onToggleVisible = useCallback(
        (element: UIElement, event: MouseEvent) => {
            event.stopPropagation();
            if (element.type === OUTLINE_ROOT_WIDGET_TYPE) {
                return;
            }
            const isHidden = element.layout.visible === false;
            documentService.updateElementLayout(element.id, { visible: isHidden ? true : false });
        },
        [documentService]
    );

    const onStartRename = useCallback(
        (element: UIElement) => {
            if (!inputDialog || element.type === OUTLINE_ROOT_WIDGET_TYPE) {
                return;
            }
            void inputDialog
                .showRenameDialog(element.name ?? element.type ?? "Layer", "layer")
                .then(name => {
                    if (name) {
                        documentService.renameElement(element.id, name);
                    }
                });
        },
        [documentService, inputDialog]
    );

    const collectBranchIdsWithChildren = useCallback(
        (rootId: string) => {
            const ids: string[] = [];
            const walk = (eid: string) => {
                const el = document.elements[eid];
                if (!el) {
                    return;
                }
                if (el.childrenIds.length > 0) {
                    ids.push(eid);
                    el.childrenIds.forEach(walk);
                }
            };
            walk(rootId);
            return ids;
        },
        [document.elements]
    );

    const { openRowContextMenu, openBlankContextMenu } = useLayerOutlineContextMenus({
        surfaceId,
        documentService,
        stateService,
        uiService,
        localBlueprint,
        inputDialog,
        effectiveRootId,
        document,
        collectBranchIdsWithChildren,
        showMenu,
        hideMenu,
        setMenuItems,
    });

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 4 },
        })
    );

    const collisionDetection = useCallback<CollisionDetection>((args) => {
        const gapCollision = getOutlineGapCollisionAtPointer(args);
        if (gapCollision) {
            if (gapCollision.length > 0) {
                return gapCollision;
            }
            return pointerWithin(args).filter(collision => !collisionHasOutlineGapData(collision));
        }

        const collisions = pointerWithin(args);
        const gapCollisions = collisions.filter(collisionHasOutlineGapData);

        if (gapCollisions.length > 0) {
            return gapCollisions;
        }

        return collisions;
    }, []);

    const handleDragStart = useCallback((event: DragStartEvent) => {
        const point = getActivatorClientPoint(event.activatorEvent);
        initialDragPointRef.current = point;
        setActiveDragPoint(point);
        setActiveDragId(String(event.active.id));
    }, []);

    const handleDragMove = useCallback((event: DragMoveEvent) => {
        const initialPoint = initialDragPointRef.current;
        if (!initialPoint) {
            return;
        }
        setActiveDragPoint({
            x: initialPoint.x + event.delta.x,
            y: initialPoint.y + event.delta.y,
        });
    }, []);

    const handleDragCancel = useCallback(() => {
        initialDragPointRef.current = null;
        setActiveDragPoint(null);
        setActiveDragId(null);
    }, []);

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            initialDragPointRef.current = null;
            setActiveDragPoint(null);
            setActiveDragId(null);
            if (!surface) {
                return;
            }
            const { active, over } = event;
            if (!over) {
                return;
            }
            const activeId = String(active.id);
            const overId = String(over.id);
            if (activeId === overId) {
                return;
            }

            const moversRaw = selectedIds.has(activeId) ? Array.from(selectedIds) : [activeId];

            const gapData = isOutlineGapDropData(over.data.current) ? over.data.current : null;
            if (gapData) {
                const beforeChildId = resolveBeforeChildIdForOutlineGap(
                    document,
                    gapData.parentId,
                    moversRaw,
                    gapData.visualIndex,
                );
                if (beforeChildId === undefined) {
                    return;
                }
                const result = documentService.moveElementsInSurface(surfaceId, moversRaw, gapData.parentId, beforeChildId);
                moveLogReason(result);
                return;
            }

        },
        [document, documentService, selectedIds, surface, surfaceId]
    );

    const rowBase = useMemo(
        () => ({
            document,
            surfaceId,
            selectedIds,
            primaryId,
            onSelect: handleSelect,
            isCollapsed,
            toggleCollapsed,
            onRowContextMenu: openRowContextMenu,
            onToggleVisible,
            onStartRename,
        }),
        [
            document,
            surfaceId,
            selectedIds,
            primaryId,
            handleSelect,
            isCollapsed,
            toggleCollapsed,
            openRowContextMenu,
            onToggleVisible,
            onStartRename,
        ]
    );

    if (!surface || !root || !effectiveRootId) {
        return <div className="p-4 text-xs text-gray-500">No surface available</div>;
    }

    const activeDragElement = activeDragId ? document.elements[activeDragId] : undefined;
    const dragPreview =
        activeDragElement && activeDragPoint && globalThis.document?.body
            ? createPortal(
                  <div
                      className="pointer-events-none fixed z-[10000]"
                      style={{
                          left: activeDragPoint.x,
                          top: activeDragPoint.y,
                          transform: "translate(12px, 12px)",
                      }}
                  >
                      <OutlineDragPreview element={activeDragElement} />
                  </div>,
                  globalThis.document.body,
              )
            : null;

    return (
        <div className="space-y-2 px-2 py-2" onContextMenu={openBlankContextMenu}>
            <div className="text-xs uppercase tracking-wide text-gray-400">Layers</div>
            {isLinkedTree ? (
                <div className="text-[10px] leading-snug text-amber-400/90 px-0.5">
                    Linked surface — editing the linked app root tree (same as canvas).
                </div>
            ) : null}
            <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                measuring={OUTLINE_DND_MEASURING}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragCancel={handleDragCancel}
                onDragEnd={handleDragEnd}
            >
                <OutlineSubtree parentId={root.id} depth={0} {...rowBase} />
            </DndContext>
            {dragPreview}
            <ContextMenu items={menuItems} position={menuState.position} visible={menuState.visible} onClose={hideMenu} />
        </div>
    );
}
