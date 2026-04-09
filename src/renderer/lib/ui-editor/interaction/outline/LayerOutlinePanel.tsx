import {
    startTransition,
    useCallback,
    useEffect,
    useMemo,
    useState,
    type CSSProperties,
    type MouseEvent,
} from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { closestCorners, DndContext, PointerSensor, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Lock } from "lucide-react";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { DEFAULT_UI_ROOT_NAME } from "@shared/constants/ui-editor";
import { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import { isUIElementSelection } from "@services/ui/UIStore";
import { useWorkspace } from "@/apps/workspace/context";
import { ContextMenu, type ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { createInputDialog } from "@/lib/components/dialogs";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { Services } from "@/lib/workspace/services/services";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import type { MoveUiElementsResult } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { listInsertPaletteModules } from "@/lib/ui-editor/widget-modules/insertPalette";
import {
    defaultLayoutPatchForOutlineInsert,
    resolveNearestInsertParentInSurface,
} from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import { buildOutlineContextMenu } from "@/lib/ui-editor/context-menu/buildOutlineContextMenu";
import {
    resolveCanvasContextSelection,
    shouldApplyCanvasContextRetarget,
} from "@/lib/ui-editor/context-menu/resolveCanvasContextSelection";
import { hasUiEditorClipboard } from "@/lib/ui-editor/commands/uiEditorClipboard";
import {
    uiEditorCopySelection,
    uiEditorCutSelection,
    uiEditorDeleteSelection,
    uiEditorDuplicateSelection,
    uiEditorGroupIntoLeaderContainer,
    uiEditorPaste,
    uiEditorPasteIntoParent,
    uiEditorSelectAllInSurface,
} from "@/lib/ui-editor/commands/uiEditorCommands";
import {
    canAddRestToLeaderContainer,
    getMoversToGroupIntoLeaderContainer,
} from "@/lib/ui-editor/commands/uiEditorSelection";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";

type UILayersPanelProps = {
    surfaceId: string;
};

const ROOT_WIDGET_TYPE = "nl.root";

function moveLogReason(result: MoveUiElementsResult): void {
    if (!result.ok) {
        console.warn("[UILayersPanel] moveElementsInSurface rejected:", result.reason);
    }
}

type OutlineRowBase = {
    document: UIDocument;
    surfaceId: string;
    selectedIds: Set<string>;
    primaryId: string | undefined;
    onSelect: (id: string, event: MouseEvent<HTMLElement>) => void;
    isCollapsed: (elementId: string) => boolean;
    toggleCollapsed: (elementId: string) => void;
    onRowContextMenu: (element: UIElement, event: MouseEvent<HTMLElement>) => void;
    onToggleVisible: (element: UIElement, event: MouseEvent) => void;
    onStartRename: (element: UIElement) => void;
};

function SortableOutlineRow({
    element,
    depth,
    document,
    surfaceId,
    selectedIds,
    primaryId,
    onSelect,
    isCollapsed,
    toggleCollapsed,
    onRowContextMenu,
    onToggleVisible,
    onStartRename,
}: OutlineRowBase & { element: UIElement; depth: number }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: element.id,
    });
    const style: CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : undefined,
    };

    const hasChildren = element.childrenIds.length > 0;
    const expanded = !isCollapsed(element.id);
    const visible = element.layout.visible !== false;
    const isDimmed = !visible;
    const label = element.type === ROOT_WIDGET_TYPE ? DEFAULT_UI_ROOT_NAME : element.name ?? element.type ?? element.id;
    const isPrimary = primaryId === element.id;

    return (
        <div ref={setNodeRef} style={style} className="select-none" data-outline-row>
            <div
                className={`group flex items-center gap-1 rounded-md text-xs min-h-[28px] pr-1 ${
                    selectedIds.has(element.id)
                        ? isPrimary
                            ? "bg-primary/30 ring-1 ring-primary/50 text-white"
                            : "bg-primary/15 text-white"
                        : "text-gray-300 hover:bg-white/5"
                } ${isDimmed ? "opacity-60" : ""}`}
                style={{ paddingLeft: 6 + depth * 12 }}
                onContextMenu={e => onRowContextMenu(element, e)}
            >
                <button
                    type="button"
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-white disabled:opacity-30"
                    disabled={!hasChildren}
                    aria-label={expanded ? "Collapse" : "Expand"}
                    onClick={e => {
                        e.stopPropagation();
                        if (!hasChildren) {
                            return;
                        }
                        toggleCollapsed(element.id);
                    }}
                >
                    {hasChildren ? (
                        expanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                        )
                    ) : (
                        <span className="w-3.5 h-3.5 inline-block" />
                    )}
                </button>
                <button
                    type="button"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white cursor-grab active:cursor-grabbing touch-none"
                    aria-label="Drag to reorder"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="w-3.5 h-3.5" />
                </button>
                {element.type === ROOT_WIDGET_TYPE ? (
                    <Lock className="w-3 h-3 shrink-0 text-gray-500" aria-hidden />
                ) : (
                    <span className="w-3 shrink-0" />
                )}
                <button
                    type="button"
                    className={`flex-1 text-left truncate py-0.5 ${isPrimary ? "font-medium" : ""}`}
                    onClick={e => onSelect(element.id, e)}
                    onDoubleClick={e => {
                        e.stopPropagation();
                        if (element.type !== ROOT_WIDGET_TYPE) {
                            onStartRename(element);
                        }
                    }}
                >
                    {label}
                </button>
                <button
                    type="button"
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-gray-500 hover:text-white"
                    aria-label={visible ? "Hide" : "Show"}
                    disabled={element.type === ROOT_WIDGET_TYPE}
                    onClick={e => onToggleVisible(element, e)}
                >
                    {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
            </div>
            {hasChildren && expanded ? (
                <OutlineSubtree
                    parentId={element.id}
                    depth={depth + 1}
                    document={document}
                    surfaceId={surfaceId}
                    selectedIds={selectedIds}
                    primaryId={primaryId}
                    onSelect={onSelect}
                    isCollapsed={isCollapsed}
                    toggleCollapsed={toggleCollapsed}
                    onRowContextMenu={onRowContextMenu}
                    onToggleVisible={onToggleVisible}
                    onStartRename={onStartRename}
                />
            ) : null}
            <OutlineAppendDropZone
                parentId={element.id}
                depth={depth + 1}
                visible={element.childrenIds.length === 0 || expanded}
            />
        </div>
    );
}

function OutlineAppendDropZone({
    parentId,
    depth,
    visible,
}: {
    parentId: string;
    depth: number;
    visible: boolean;
}) {
    const { setNodeRef, isOver } = useDroppable({
        id: `append:${parentId}`,
        data: { kind: "outline-append", parentId },
    });
    if (!visible) {
        return null;
    }
    return (
        <div
            ref={setNodeRef}
            className={`rounded border border-dashed transition-colors ${
                isOver ? "border-primary/40 bg-primary/10" : "border-white/5"
            }`}
            style={{ marginLeft: 6 + depth * 12, minHeight: 8, marginTop: 2, marginBottom: 2 }}
            title="Drop to append inside this node"
        />
    );
}

function OutlineSubtree(props: OutlineRowBase & { parentId: string; depth: number }) {
    const parent = props.document.elements[props.parentId];
    if (!parent) {
        return null;
    }
    return (
        <SortableContext items={parent.childrenIds} strategy={verticalListSortingStrategy}>
            {parent.childrenIds.map(childId => {
                const child = props.document.elements[childId];
                if (!child) {
                    return null;
                }
                return (
                    <SortableOutlineRow
                        key={child.id}
                        element={child}
                        depth={props.depth}
                        document={props.document}
                        surfaceId={props.surfaceId}
                        selectedIds={props.selectedIds}
                        primaryId={props.primaryId}
                        onSelect={props.onSelect}
                        isCollapsed={props.isCollapsed}
                        toggleCollapsed={props.toggleCollapsed}
                        onRowContextMenu={props.onRowContextMenu}
                        onToggleVisible={props.onToggleVisible}
                        onStartRename={props.onStartRename}
                    />
                );
            })}
        </SortableContext>
    );
}

export function UILayersPanel({ surfaceId }: UILayersPanelProps) {
    const stateService = UIEditorStateService.getInstance();
    const { context } = useWorkspace();
    const documentService = useMemo<UIDocumentService | null>(() => {
        if (!context) {
            return null;
        }
        return context.services.get<UIDocumentService>(Services.UIDocument);
    }, [context]);

    const localBlueprint = useMemo(() => {
        if (!context) {
            return null;
        }
        return context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    }, [context]);

    const inputDialog = useMemo(() => {
        if (!context) {
            return null;
        }
        const ui = context.services.get<UIService>(Services.UI);
        return createInputDialog(ui);
    }, [context]);

    const [docVersion, setDocVersion] = useState(0);
    const [selection, setSelection] = useState(stateService.getSelection());
    const [outlineRev, setOutlineRev] = useState(0);
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);

    useEffect(() => {
        if (!documentService) {
            return;
        }
        return documentService.onDocumentChanged(() => {
            startTransition(() => {
                setDocVersion(v => v + 1);
            });
        });
    }, [documentService]);

    useEffect(() => {
        return stateService.on("selectionChanged", selection => {
            startTransition(() => {
                setSelection(selection);
            });
        });
    }, [stateService]);

    useEffect(() => {
        return stateService.on("outlineExpansionChanged", () => {
            setOutlineRev(v => v + 1);
        });
    }, [stateService]);

    const document = documentService?.getDocument() ?? stateService.getDocument();
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
            if (!documentService || element.type === ROOT_WIDGET_TYPE) {
                return;
            }
            const isHidden = element.layout.visible === false;
            documentService.updateElementLayout(element.id, { visible: isHidden ? true : false });
        },
        [documentService]
    );

    const onStartRename = useCallback(
        (element: UIElement) => {
            if (!inputDialog || !documentService || element.type === ROOT_WIDGET_TYPE) {
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

    const openRowContextMenu = useCallback(
        (element: UIElement, event: MouseEvent<HTMLElement>) => {
            event.preventDefault();
            event.stopPropagation();
            if (!documentService || !localBlueprint || !effectiveRootId) {
                return;
            }
            const curSel = stateService.getSelection();
            if (shouldApplyCanvasContextRetarget(surfaceId, element.id, curSel)) {
                const nextSel = resolveCanvasContextSelection(surfaceId, element.id, curSel);
                if (nextSel) {
                    stateService.setUIElementSelection(nextSel);
                }
            }
            const menuSel = resolveCanvasContextSelection(surfaceId, element.id, stateService.getSelection());
            const doc = documentService.getDocument();
            const insertParentId = resolveNearestInsertParentInSurface(doc, surfaceId, element.id);
            const canGroup =
                Boolean(menuSel) &&
                canAddRestToLeaderContainer(menuSel!, doc) &&
                getMoversToGroupIntoLeaderContainer(doc, menuSel!).length > 0;

            const insertChildInOutline = (type: string) => {
                if (!insertParentId) {
                    return;
                }
                const patch = defaultLayoutPatchForOutlineInsert(documentService.getDocument(), insertParentId);
                const created = documentService.createElement(insertParentId, type, patch);
                stateService.setUIElementSelection({
                    editor: "ui",
                    surfaceId,
                    elementIds: [created.id],
                    primaryId: created.id,
                });
                stateService.setTool({ kind: "select" });
            };

            const items = buildOutlineContextMenu({
                document: doc,
                surfaceId,
                rowElement: element,
                menuSelection: menuSel,
                hasClipboard: hasUiEditorClipboard(),
                widgetModules: listInsertPaletteModules(),
                documentService,
                insertParentIdForRow: insertParentId,
                canAddToGroup: canGroup,
                actions: {
                    hideMenu,
                    insertType: () => {},
                    insertChildInOutline,
                    paste: () => {
                        const sel = stateService.getSelection();
                        const data = sel.type === "element" ? sel.data : null;
                        const primary =
                            data?.editor === "ui" && data.surfaceId === surfaceId
                                ? (data.primaryId ?? data.elementIds[data.elementIds.length - 1] ?? null)
                                : null;
                        uiEditorPaste(documentService, localBlueprint, stateService, surfaceId, {
                            hitElementId: element.id,
                            primaryElementId: primary,
                        });
                    },
                    pasteIntoParent: parentId => {
                        uiEditorPasteIntoParent(documentService, localBlueprint, stateService, surfaceId, parentId, null);
                    },
                    copy: () => uiEditorCopySelection(documentService, localBlueprint, surfaceId, menuSel),
                    cut: () => uiEditorCutSelection(documentService, localBlueprint, stateService, surfaceId, menuSel),
                    duplicate: () =>
                        uiEditorDuplicateSelection(documentService, localBlueprint, stateService, surfaceId, menuSel),
                    delete: () => uiEditorDeleteSelection(documentService, stateService, surfaceId, menuSel),
                    selectAll: () => uiEditorSelectAllInSurface(documentService, stateService, surfaceId),
                    renamePrimary: () => {
                        if (!menuSel || !inputDialog) {
                            return;
                        }
                        const pid = menuSel.primaryId ?? menuSel.elementIds[menuSel.elementIds.length - 1];
                        const el = doc.elements[pid];
                        if (!el || el.type === ROOT_WIDGET_TYPE) {
                            return;
                        }
                        void inputDialog.showRenameDialog(el.name ?? el.type ?? "Layer", "layer").then(name => {
                            if (name) {
                                documentService.renameElement(pid, name);
                            }
                        });
                    },
                    setSelectedVisible: visible => {
                        if (!menuSel) {
                            return;
                        }
                        for (const id of menuSel.elementIds) {
                            const el = doc.elements[id];
                            if (el && el.type !== ROOT_WIDGET_TYPE) {
                                documentService.updateElementLayout(id, { visible });
                            }
                        }
                    },
                    addSelectionToLeaderGroup: () => {
                        uiEditorGroupIntoLeaderContainer(documentService, stateService, surfaceId, menuSel);
                    },
                    expandAllBranches: () => {
                        for (const id of collectBranchIdsWithChildren(effectiveRootId)) {
                            stateService.setOutlineBranchCollapsed(id, false);
                        }
                    },
                    collapseAllBranches: () => {
                        for (const id of collectBranchIdsWithChildren(effectiveRootId)) {
                            stateService.setOutlineBranchCollapsed(id, true);
                        }
                    },
                },
            });
            setMenuItems(items);
            showMenu(event);
        },
        [
            collectBranchIdsWithChildren,
            document,
            documentService,
            effectiveRootId,
            hideMenu,
            inputDialog,
            localBlueprint,
            showMenu,
            stateService,
            surfaceId,
        ]
    );

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { delay: 85, tolerance: 8 },
        })
    );

    const openBlankContextMenu = useCallback(
        (event: MouseEvent<HTMLDivElement>) => {
            if (!documentService || !localBlueprint || !effectiveRootId) {
                return;
            }
            event.preventDefault();
            const t = event.target as HTMLElement | null;
            if (t?.closest?.("[data-outline-row]")) {
                return;
            }
            const curSel = stateService.getSelection();
            const menuSel = resolveCanvasContextSelection(surfaceId, null, curSel);
            const doc = documentService.getDocument();
            const canGroup =
                Boolean(menuSel) &&
                canAddRestToLeaderContainer(menuSel!, doc) &&
                getMoversToGroupIntoLeaderContainer(doc, menuSel!).length > 0;

            const insertOutline = (type: string) => {
                const fresh = documentService.getDocument();
                const parentId = effectiveRootId;
                const patch = defaultLayoutPatchForOutlineInsert(fresh, parentId);
                const created = documentService.createElement(parentId, type, patch);
                stateService.setUIElementSelection({
                    editor: "ui",
                    surfaceId,
                    elementIds: [created.id],
                    primaryId: created.id,
                });
                stateService.setTool({ kind: "select" });
            };

            const items = buildOutlineContextMenu({
                document: doc,
                surfaceId,
                rowElement: null,
                menuSelection: menuSel,
                hasClipboard: hasUiEditorClipboard(),
                widgetModules: listInsertPaletteModules(),
                documentService,
                insertParentIdForRow: null,
                canAddToGroup: canGroup,
                actions: {
                    hideMenu,
                    insertType: () => {},
                    insertChildInOutline: insertOutline,
                    paste: () => {
                        const sel = stateService.getSelection();
                        const data = sel.type === "element" ? sel.data : null;
                        const primary =
                            data?.editor === "ui" && data.surfaceId === surfaceId
                                ? (data.primaryId ?? data.elementIds[data.elementIds.length - 1] ?? null)
                                : null;
                        uiEditorPaste(documentService, localBlueprint, stateService, surfaceId, {
                            hitElementId: null,
                            primaryElementId: primary,
                        });
                    },
                    pasteIntoParent: parentId => {
                        uiEditorPasteIntoParent(documentService, localBlueprint, stateService, surfaceId, parentId, null);
                    },
                    copy: () => uiEditorCopySelection(documentService, localBlueprint, surfaceId, menuSel),
                    cut: () => uiEditorCutSelection(documentService, localBlueprint, stateService, surfaceId, menuSel),
                    duplicate: () =>
                        uiEditorDuplicateSelection(documentService, localBlueprint, stateService, surfaceId, menuSel),
                    delete: () => uiEditorDeleteSelection(documentService, stateService, surfaceId, menuSel),
                    selectAll: () => uiEditorSelectAllInSurface(documentService, stateService, surfaceId),
                    renamePrimary: () => {
                        if (!menuSel || menuSel.elementIds.length !== 1 || !inputDialog) {
                            return;
                        }
                        const pid = menuSel.primaryId ?? menuSel.elementIds[0];
                        const el = doc.elements[pid];
                        if (!el || el.type === ROOT_WIDGET_TYPE) {
                            return;
                        }
                        void inputDialog.showRenameDialog(el.name ?? el.type ?? "Layer", "layer").then(name => {
                            if (name) {
                                documentService.renameElement(pid, name);
                            }
                        });
                    },
                    setSelectedVisible: visible => {
                        if (!menuSel) {
                            return;
                        }
                        for (const id of menuSel.elementIds) {
                            const el = doc.elements[id];
                            if (el && el.type !== ROOT_WIDGET_TYPE) {
                                documentService.updateElementLayout(id, { visible });
                            }
                        }
                    },
                    addSelectionToLeaderGroup: () => {
                        uiEditorGroupIntoLeaderContainer(documentService, stateService, surfaceId, menuSel);
                    },
                    expandAllBranches: () => {
                        for (const id of collectBranchIdsWithChildren(effectiveRootId)) {
                            stateService.setOutlineBranchCollapsed(id, false);
                        }
                    },
                    collapseAllBranches: () => {
                        for (const id of collectBranchIdsWithChildren(effectiveRootId)) {
                            stateService.setOutlineBranchCollapsed(id, true);
                        }
                    },
                },
            });
            setMenuItems(items);
            showMenu(event);
        },
        [
            collectBranchIdsWithChildren,
            documentService,
            effectiveRootId,
            hideMenu,
            inputDialog,
            localBlueprint,
            showMenu,
            stateService,
            surfaceId,
        ]
    );

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            if (!documentService || !surface) {
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
                const result = documentService.moveElementsInSurface(surfaceId, moversRaw, targetParentId, null);
                moveLogReason(result);
                return;
            }

            const overEl = document.elements[overId];
            if (!overEl?.parentId) {
                return;
            }
            const overParentId = overEl.parentId;

            const result = documentService.moveElementsInSurface(surfaceId, moversRaw, overParentId, overId);
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

    return (
        <div className="space-y-2 px-2 py-2" onContextMenu={openBlankContextMenu}>
            <div className="text-xs uppercase tracking-wide text-gray-400">Layers</div>
            {isLinkedTree ? (
                <div className="text-[10px] leading-snug text-amber-400/90 px-0.5">
                    Linked surface — editing the linked app root tree (same as canvas).
                </div>
            ) : null}
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
                <SortableContext items={root.childrenIds} strategy={verticalListSortingStrategy}>
                    {root.childrenIds.map(childId => {
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
