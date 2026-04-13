import {
    startTransition,
    useCallback,
    useEffect,
    useMemo,
    useState,
    type MouseEvent,
} from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { closestCorners, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { UIElement } from "@shared/types/ui-editor/document";
import { isUIElementSelection } from "@services/ui/UIStore";
import { ContextMenu, type ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import type { InputDialog } from "@/lib/components/dialogs";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import {
    getOutlineVisualChildren,
    moveLogReason,
    resolveBeforeChildIdForOutlineDrop,
} from "@/lib/ui-editor/interaction/outline/outlineDropGeometry";
import {
    OutlineAppendDropZone,
    OUTLINE_ROOT_WIDGET_TYPE,
    SortableOutlineRow,
} from "@/lib/ui-editor/interaction/outline/LayerOutlineRows";
import { useLayerOutlineContextMenus } from "@/lib/ui-editor/interaction/outline/useLayerOutlineContextMenus";

export type UILayersPanelProps = {
    surfaceId: string;
    stateService: UIEditorStateService;
    documentService: UIDocumentService;
    localBlueprint: LocalBlueprintService;
    inputDialog: InputDialog | null;
};

export function UILayersPanel({
    surfaceId,
    stateService,
    documentService,
    localBlueprint,
    inputDialog,
}: UILayersPanelProps) {
    const [docVersion, setDocVersion] = useState(0);
    const [selection, setSelection] = useState(stateService.getSelection());
    const [outlineRev, setOutlineRev] = useState(0);
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
                    stateService.setSelection({ type: null, data: null });
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
            activationConstraint: { delay: 85, tolerance: 8 },
        })
    );

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
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

            if (overId.startsWith("append:")) {
                const targetParentId = overId.slice("append:".length);
                // Append zone sits at the bottom of the reversed visual list (= back-most paint order).
                // Insert before the first non-mover child so movers land at the back of childrenIds.
                const targetParent = document.elements[targetParentId];
                const moverSet = new Set(moversRaw);
                const firstNonMover = targetParent?.childrenIds.find(id => !moverSet.has(id)) ?? null;
                const result = documentService.moveElementsInSurface(surfaceId, moversRaw, targetParentId, firstNonMover);
                moveLogReason(result);
                return;
            }

            const overEl = document.elements[overId];
            if (!overEl?.parentId) {
                return;
            }
            const overParentId = overEl.parentId;
            const beforeChildId = resolveBeforeChildIdForOutlineDrop(document, overParentId, moversRaw, overId);
            if (beforeChildId === undefined) {
                return;
            }
            const result = documentService.moveElementsInSurface(surfaceId, moversRaw, overParentId, beforeChildId);
            moveLogReason(result);
        },
        [document.elements, documentService, selectedIds, surface, surfaceId]
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

    const visualRootChildren = getOutlineVisualChildren(root);

    return (
        <div className="space-y-2 px-2 py-2" onContextMenu={openBlankContextMenu}>
            <div className="text-xs uppercase tracking-wide text-gray-400">Layers</div>
            {isLinkedTree ? (
                <div className="text-[10px] leading-snug text-amber-400/90 px-0.5">
                    Linked surface — editing the linked app root tree (same as canvas).
                </div>
            ) : null}
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
                <SortableContext items={visualRootChildren} strategy={verticalListSortingStrategy}>
                    {visualRootChildren.map(childId => {
                        const child = document.elements[childId];
                        if (!child) {
                            return null;
                        }
                        return (
                            <SortableOutlineRow
                                key={child.id}
                                element={child}
                                depth={0}
                                {...rowBase}
                            />
                        );
                    })}
                </SortableContext>
                <OutlineAppendDropZone parentId={root.id} depth={0} visible />
            </DndContext>
            <ContextMenu items={menuItems} position={menuState.position} visible={menuState.visible} onClose={hideMenu} />
        </div>
    );
}
