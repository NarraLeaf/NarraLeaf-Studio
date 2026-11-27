import {
    startTransition,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
    type MouseEvent,
    type Ref,
} from "react";
import { createPortal } from "react-dom";
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { uiElementTypeAcceptsUserChildren, type UIElement } from "@shared/types/ui-editor/document";
import { isComponentEditorVirtualRootId } from "@/lib/ui-editor/componentEditorRoot";
import { isUIElementSelection } from "@services/ui/UIStore";
import { type ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { ShortcutContextMenu } from "@/apps/workspace/components/ui/ShortcutContextMenu";
import { UI_EDITOR_MENU_SHORTCUTS } from "@/lib/ui-editor/context-menu/menuShortcutBindings";
import type { InputDialog } from "@/lib/components/dialogs";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import {
    listVisibleOutlineRows,
    moveLogReason,
    planOutlineDrop,
    resolveBeforeChildIdForOutlineGap,
    resolveOutlineDropZone,
    type OutlineDropTarget,
} from "@/lib/ui-editor/interaction/outline/outlineDropGeometry";
import {
    OUTLINE_ROOT_WIDGET_TYPE,
    OutlineDragPreview,
    OutlineSubtree,
} from "@/lib/ui-editor/interaction/outline/LayerOutlineRows";
import { computeOutlineSignature } from "@/lib/ui-editor/interaction/outline/outlineSignature";
import { useLayerOutlineContextMenus } from "@/lib/ui-editor/interaction/outline/useLayerOutlineContextMenus";
import { selectSurfaceForProperties } from "@/lib/ui-editor/commands/uiEditorSelection";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { useTranslation } from "@/lib/i18n";
import {
    isSurfaceGestureEnabled,
    UI_EDITOR_WRITABLE,
    type UIEditorReadOnly,
} from "@/lib/ui-editor/interaction/readOnlyInteraction";
// The freeze guard's menu walker, reused rather than re-implemented: these rows are assembled by
// `buildOutlineContextMenu` and extended by widget modules at runtime, so there is nothing to spread
// `menuRow()` onto. Same import direction as `useUIEditorKeybindings`, which reaches for the
// workspace's keybinding hooks.
import { freezeContextMenuRows } from "@/apps/workspace/components/ui/freezeGuard";
import { DEVELOPER_MENU_ROW_IDS } from "@/lib/developer";

export type UILayersPanelProps = {
    surfaceId: string;
    stateService: UIEditorStateService;
    documentService: UIDocumentService;
    uiService?: UIService | null;
    localBlueprint: LocalBlueprintService;
    inputDialog: InputDialog | null;
    allowAddSelectionToComponentLibrary?: boolean;
    /** Reorder, rename, visibility and every editing menu row go inert. Selection stays. */
    readOnly?: UIEditorReadOnly;
    /**
     * For the panel framing the outline, whose own chrome (its title row) belongs to the outline
     * too: a right click there opens the menu a right click on the outline's empty space opens.
     */
    ref?: Ref<UILayersPanelHandle>;
};

export type UILayersPanelHandle = {
    /** Open the outline's own menu - the one with no row under it - at the event's pointer. */
    openPanelMenu: (event: MouseEvent<HTMLElement>) => void;
};

/**
 * The outline menu rows a read-only surface keeps: the ones that only read.
 *
 * Copy fills the clipboard, the developer section copies identifiers into it, Select All / Expand All
 * / Collapse All move selection and editor state. Everything else - insert, paste, cut, duplicate,
 * rename, delete, visibility, group, add-to-library, and whatever a widget module contributes under
 * `sep-widget` - edits the document, so it is not named here and is therefore disabled.
 */
const READ_ONLY_OUTLINE_MENU_IDS: ReadonlySet<string> = new Set([
    "copy",
    ...DEVELOPER_MENU_ROW_IDS,
    "select-all",
    "expand-all",
    "collapse-all",
]);

/** A parent the outline lets a drop land in: one that takes the author's children, and not a component's frame holder. */
function outlineAcceptsChildren(parent: UIElement): boolean {
    return uiElementTypeAcceptsUserChildren(parent.type) && !isComponentEditorVirtualRootId(parent.id);
}

/** How long a drag held over a collapsed layer waits before opening it. */
const OUTLINE_AUTO_EXPAND_MS = 600;

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
    allowAddSelectionToComponentLibrary = true,
    readOnly = UI_EDITOR_WRITABLE,
    ref,
}: UILayersPanelProps) {
    const { t } = useTranslation();
    const [docVersion, setDocVersion] = useState(0);
    const [selection, setSelection] = useState(stateService.getSelection());
    const [outlineRev, setOutlineRev] = useState(0);
    const [activeDragId, setActiveDragId] = useState<string | null>(null);
    const [activeDragPoint, setActiveDragPoint] = useState<{ x: number; y: number } | null>(null);
    const initialDragPointRef = useRef<{ x: number; y: number } | null>(null);
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);

    // Redraw for the changes the outline can show, and ignore the rest. See `computeOutlineSignature`
    // for why: a row is not a cheap `<li>`, it is a dnd-kit draggable, and there are one per layer.
    const outlineSignatureRef = useRef<string | null>(null);
    useEffect(() => {
        outlineSignatureRef.current = computeOutlineSignature(documentService.getDocument(), surfaceId);
        return documentService.onDocumentChanged(() => {
            const next = computeOutlineSignature(documentService.getDocument(), surfaceId);
            if (next === outlineSignatureRef.current) {
                return;
            }
            outlineSignatureRef.current = next;
            startTransition(() => {
                setDocVersion(v => v + 1);
            });
        });
    }, [documentService, surfaceId]);

    useEffect(() => {
        return stateService.on("selectionChanged", selectionNext => {
            startTransition(() => {
                setSelection(selectionNext);
            });
        });
    }, [stateService]);

    useEffect(() => {
        const offExpansion = stateService.on("outlineExpansionChanged", () => {
            setOutlineRev(v => v + 1);
        });
        const offFlags = stateService.on("editorLayerFlagsChanged", () => {
            setOutlineRev(v => v + 1);
        });
        return () => {
            offExpansion();
            offFlags();
        };
    }, [stateService]);

    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<OutlineDropTarget | null>(null);
    const dropTargetRef = useRef<OutlineDropTarget | null>(null);
    const autoExpandRef = useRef<{ rowId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    void docVersion;

    const document = documentService.getDocument();
    const surface = document.surfaces.find(surf => surf.id === surfaceId);
    const effectiveRootId = surface ? resolveSurfaceRootElementId(document, surfaceId) : null;
    const root = effectiveRootId ? document.elements[effectiveRootId] : undefined;
    // A component's frame is the first row, like any layer: it is selected to size the component.
    const outlineRoot = root;
    const outlineEffectiveRootId = outlineRoot?.id ?? effectiveRootId;

    const isLinkedTree =
        surface != null && effectiveRootId != null && effectiveRootId !== surface.rootElementId;

    const selectionData = isUIElementSelection(selection) ? selection.data : null;
    const selectedIds = useMemo(() => new Set(selectionData?.elementIds ?? []), [selectionData]);
    const primaryId = selectionData?.primaryId ?? selectionData?.elementIds?.[selectionData.elementIds.length - 1];

    /** Every row the outline shows, top to bottom, the root's own row left out. */
    const visibleRowIds = useCallback(
        () => (outlineRoot ? listVisibleOutlineRows(document, outlineRoot.id, id => stateService.isOutlineBranchCollapsed(id)).slice(1) : []),
        [document, outlineRoot, stateService],
    );

    const selectRows = useCallback(
        (ids: string[], primary: string) => {
            if (ids.length === 0) {
                selectSurfaceForProperties(stateService, surfaceId, uiService);
                return;
            }
            stateService.setUIElementSelection({ editor: "ui", surfaceId, elementIds: ids, primaryId: primary });
        },
        [stateService, surfaceId, uiService],
    );

    const handleSelect = useCallback(
        (id: string, event: MouseEvent<HTMLElement>) => {
            const sameSurface = selectionData?.surfaceId === surfaceId;
            // Shift selects the range of rows from the last one picked to this one, as every tree
            // view does; it used to add this one row, so ten siblings took ten clicks. Cmd/Ctrl adds
            // or takes away one row.
            if (event.shiftKey && sameSurface && primaryId) {
                const rows = visibleRowIds();
                const from = rows.indexOf(primaryId);
                const to = rows.indexOf(id);
                if (from >= 0 && to >= 0) {
                    const range = rows.slice(Math.min(from, to), Math.max(from, to) + 1);
                    const extra = event.metaKey || event.ctrlKey ? Array.from(selectedIds).filter(existing => !range.includes(existing)) : [];
                    // Keep the anchor where it was, so a second Shift-click re-ranges from it.
                    stateService.setUIElementSelection({ editor: "ui", surfaceId, elementIds: [...extra, ...range], primaryId });
                    return;
                }
            }
            if (event.metaKey || event.ctrlKey) {
                const nextIds = selectedIds.has(id)
                    ? Array.from(selectedIds).filter(existing => existing !== id)
                    : [...selectedIds, id];
                selectRows(nextIds, id);
                return;
            }
            selectRows([id], id);
        },
        [primaryId, selectRows, selectedIds, selectionData?.surfaceId, stateService, surfaceId, visibleRowIds]
    );

    // A selection made on the canvas inside a collapsed branch opens the branch and brings its row
    // into view; without that, what was just picked could not be found in the outline at all.
    useEffect(() => {
        if (!primaryId || selectionData?.surfaceId !== surfaceId) {
            return;
        }
        let cur = document.elements[primaryId]?.parentId ?? null;
        for (let guard = 0; cur && guard < 256; guard++) {
            if (stateService.isOutlineBranchCollapsed(cur)) {
                stateService.setOutlineBranchCollapsed(cur, false);
            }
            cur = document.elements[cur]?.parentId ?? null;
        }
        const frame = requestAnimationFrame(() => {
            const row = containerRef.current?.querySelector(`[data-outline-row-id="${primaryId}"] [data-outline-row-bar]`);
            if (row instanceof HTMLElement) {
                row.scrollIntoView({ block: "nearest" });
            }
        });
        return () => cancelAnimationFrame(frame);
        // Deliberately not on every document change: only a new selection moves the outline.
    }, [primaryId, selectionData?.surfaceId, surfaceId]);

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

    // The eye and the lock are the editor's, not the game's: hiding a layer to work on what is under
    // it no longer changes what players see, and is never shipped by being forgotten. The game's own
    // visibility is in the properties panel.
    const onToggleHiddenInEditor = useCallback(
        (element: UIElement, event: MouseEvent) => {
            event.stopPropagation();
            if (element.type === OUTLINE_ROOT_WIDGET_TYPE) {
                return;
            }
            stateService.setElementHiddenInEditor(element.id, !stateService.isElementHiddenInEditor(element.id));
        },
        [stateService]
    );
    const onToggleLocked = useCallback(
        (element: UIElement, event: MouseEvent) => {
            event.stopPropagation();
            if (element.type === OUTLINE_ROOT_WIDGET_TYPE) {
                return;
            }
            stateService.setElementLocked(element.id, !stateService.isElementLocked(element.id));
        },
        [stateService]
    );
    const isHiddenInEditor = useCallback(
        (elementId: string) => {
            void outlineRev;
            return stateService.isElementHiddenInEditor(elementId);
        },
        [outlineRev, stateService]
    );
    const isLocked = useCallback(
        (elementId: string) => {
            void outlineRev;
            return stateService.isElementLocked(elementId);
        },
        [outlineRev, stateService]
    );

    // Renaming happens in the row itself: the name turns into a field, Enter or leaving it keeps
    // the name, Escape does not. It used to open a dialog with the text not even selected.
    const onStartRename = useCallback(
        (element: UIElement) => {
            if (!isSurfaceGestureEnabled("outlineRename", readOnly) || element.type === OUTLINE_ROOT_WIDGET_TYPE) {
                return;
            }
            setRenamingId(element.id);
        },
        [readOnly]
    );
    const onFinishRename = useCallback(
        (element: UIElement, name: string | null) => {
            setRenamingId(null);
            if (name) {
                documentService.renameElement(element.id, name);
            }
            containerRef.current?.focus();
        },
        [documentService]
    );
    void inputDialog;

    const onHover = useCallback(
        (elementId: string | null) => {
            stateService.setOutlineHover(elementId);
        },
        [stateService]
    );
    useEffect(() => () => stateService.setOutlineHover(null), [stateService]);

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

    const setReadOnlyAwareMenuItems = useCallback(
        (items: ContextMenuDef) => {
            setMenuItems(freezeContextMenuRows(items, readOnly.active, READ_ONLY_OUTLINE_MENU_IDS, readOnly.reason));
        },
        [readOnly.active, readOnly.reason],
    );

    const { openRowContextMenu, openBlankContextMenu } = useLayerOutlineContextMenus({
        surfaceId,
        documentService,
        stateService,
        uiService,
        localBlueprint,
        inputDialog,
        effectiveRootId: outlineEffectiveRootId,
        document,
        collectBranchIdsWithChildren,
        showMenu,
        hideMenu,
        setMenuItems: setReadOnlyAwareMenuItems,
        allowAddSelectionToComponentLibrary,
    });

    useImperativeHandle(ref, () => ({ openPanelMenu: openBlankContextMenu }), [openBlankContextMenu]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 4 },
        })
    );

    const draggedIds = useCallback(
        (activeId: string) => (selectedIds.has(activeId) ? Array.from(selectedIds) : [activeId]),
        [selectedIds]
    );

    const clearAutoExpand = useCallback(() => {
        if (autoExpandRef.current) {
            clearTimeout(autoExpandRef.current.timer);
            autoExpandRef.current = null;
        }
    }, []);

    /** The row under the pointer and where on it - or nothing, where a drop would be refused. */
    const updateDropTarget = useCallback(
        (point: { x: number; y: number } | null, activeId: string) => {
            let next: OutlineDropTarget | null = null;
            const doc = globalThis.document;
            if (point && typeof doc?.elementsFromPoint === "function") {
                for (const hit of doc.elementsFromPoint(point.x, point.y)) {
                    const bar = hit.closest("[data-outline-row-bar]") as HTMLElement | null;
                    const rowId = (bar?.closest("[data-outline-row-id]") as HTMLElement | null)?.dataset.outlineRowId;
                    const row = rowId ? document.elements[rowId] : null;
                    if (!bar || !row || !containerRef.current?.contains(bar)) {
                        continue;
                    }
                    const rect = bar.getBoundingClientRect();
                    const candidate: OutlineDropTarget = {
                        rowId: row.id,
                        zone: resolveOutlineDropZone(rect.top, rect.height, point.y, outlineAcceptsChildren(row)),
                    };
                    next = planOutlineDrop(document, draggedIds(activeId), candidate, outlineAcceptsChildren) ? candidate : null;
                    break;
                }
            }
            const prev = dropTargetRef.current;
            if (prev?.rowId === next?.rowId && prev?.zone === next?.zone) {
                return;
            }
            dropTargetRef.current = next;
            setDropTarget(next);
            // Held over a collapsed layer, the drag opens it after a moment, so its children can be
            // dropped between - a collapsed container used to take nothing until the drag was abandoned.
            clearAutoExpand();
            if (next?.zone === "inside" && stateService.isOutlineBranchCollapsed(next.rowId)) {
                const rowId = next.rowId;
                autoExpandRef.current = {
                    rowId,
                    timer: setTimeout(() => {
                        autoExpandRef.current = null;
                        stateService.setOutlineBranchCollapsed(rowId, false);
                    }, OUTLINE_AUTO_EXPAND_MS),
                };
            }
        },
        [clearAutoExpand, document, draggedIds, stateService]
    );

    const handleDragStart = useCallback((event: DragStartEvent) => {
        const point = getActivatorClientPoint(event.activatorEvent);
        initialDragPointRef.current = point;
        setActiveDragPoint(point);
        setActiveDragId(String(event.active.id));
        setRenamingId(null);
    }, []);

    const handleDragMove = useCallback((event: DragMoveEvent) => {
        const initialPoint = initialDragPointRef.current;
        if (!initialPoint) {
            return;
        }
        const point = { x: initialPoint.x + event.delta.x, y: initialPoint.y + event.delta.y };
        setActiveDragPoint(point);
        updateDropTarget(point, String(event.active.id));
    }, [updateDropTarget]);

    const endDrag = useCallback(() => {
        initialDragPointRef.current = null;
        setActiveDragPoint(null);
        setActiveDragId(null);
        dropTargetRef.current = null;
        setDropTarget(null);
        clearAutoExpand();
    }, [clearAutoExpand]);

    const handleDragCancel = endDrag;

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const target = dropTargetRef.current;
            endDrag();
            if (!surface || !target || !isSurfaceGestureEnabled("outlineReorder", readOnly)) {
                return;
            }
            const movers = draggedIds(String(event.active.id));
            const plan = planOutlineDrop(document, movers, target, outlineAcceptsChildren);
            if (!plan) {
                return;
            }
            const beforeChildId = resolveBeforeChildIdForOutlineGap(document, plan.parentId, movers, plan.visualIndex);
            if (beforeChildId === undefined) {
                return;
            }
            const result = documentService.moveElementsInSurface(surfaceId, movers, plan.parentId, beforeChildId);
            moveLogReason(result);
            if (!result.ok) {
                // Every refusal used to be a console line: the author saw the drop land nowhere.
                uiService?.showNotification(t("widgetChrome.outline.cannotMoveHere"), "warning");
            }
        },
        [document, documentService, draggedIds, endDrag, readOnly, surface, surfaceId, t, uiService]
    );

    // The arrow keys walk the outline rather than nudging the selected element on the canvas: Up and
    // Down move between rows, Left closes a branch or goes to its parent, Right opens one or goes into
    // it. F2 and Enter rename. Handled here and stopped, so the canvas's own bindings never see them.
    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (renamingId || (event.target instanceof HTMLElement && event.target.closest("input, textarea"))) {
                return;
            }
            const rows = visibleRowIds();
            const current = primaryId && rows.includes(primaryId) ? primaryId : null;
            const element = current ? document.elements[current] : null;
            const select = (id: string | undefined) => {
                if (id) {
                    event.preventDefault();
                    event.stopPropagation();
                    selectRows([id], id);
                }
            };
            switch (event.key) {
                case "ArrowDown":
                    select(current ? rows[rows.indexOf(current) + 1] : rows[0]);
                    break;
                case "ArrowUp":
                    select(current ? rows[rows.indexOf(current) - 1] : rows[rows.length - 1]);
                    break;
                case "ArrowLeft":
                    if (element && element.childrenIds.length > 0 && !stateService.isOutlineBranchCollapsed(element.id)) {
                        event.preventDefault();
                        event.stopPropagation();
                        stateService.setOutlineBranchCollapsed(element.id, true);
                    } else if (element?.parentId && rows.includes(element.parentId)) {
                        select(element.parentId);
                    }
                    break;
                case "ArrowRight":
                    if (element && element.childrenIds.length > 0) {
                        if (stateService.isOutlineBranchCollapsed(element.id)) {
                            event.preventDefault();
                            event.stopPropagation();
                            stateService.setOutlineBranchCollapsed(element.id, false);
                        } else {
                            select(rows[rows.indexOf(element.id) + 1]);
                        }
                    }
                    break;
                case "Enter":
                case "F2":
                    if (element) {
                        event.preventDefault();
                        event.stopPropagation();
                        onStartRename(element);
                    }
                    break;
                default:
                    break;
            }
        },
        [document, onStartRename, primaryId, renamingId, selectRows, stateService, visibleRowIds]
    );

    const draggingIds = useMemo(
        () => new Set(activeDragId ? draggedIds(activeDragId) : []),
        [activeDragId, draggedIds]
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
            onToggleHiddenInEditor,
            isHiddenInEditor,
            onToggleLocked,
            isLocked,
            onStartRename,
            renamingId,
            onFinishRename,
            dropTarget,
            draggingIds,
            onHover,
            readOnly,
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
            onToggleHiddenInEditor,
            isHiddenInEditor,
            onToggleLocked,
            isLocked,
            onStartRename,
            renamingId,
            onFinishRename,
            dropTarget,
            draggingIds,
            onHover,
            readOnly,
        ]
    );

    if (!surface || !root || !outlineRoot || !outlineEffectiveRootId) {
        return <div className="p-4 text-xs text-fg-subtle">{t("widgetChrome.outline.noSurface")}</div>;
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
                      <OutlineDragPreview element={activeDragElement} count={draggingIds.size} />
                  </div>,
                  globalThis.document.body,
              )
            : null;

    return (
        // `min-h-full`: the empty space under the last row is the outline's too, and a right click
        // there is answered with the outline's menu rather than falling through to the canvas.
        // No heading of its own: the pane it sits in is already titled (UI Outline), and a second
        // "Layers" line under it was one more level saying the same thing.
        <div
            ref={containerRef}
            className="min-h-full space-y-2 px-2 py-2 outline-none"
            role="tree"
            tabIndex={-1}
            onContextMenu={openBlankContextMenu}
            onKeyDown={handleKeyDown}
            onClick={event => {
                // A click on the empty space under the rows clears the selection, as on the canvas.
                if (!(event.target as HTMLElement).closest("[data-outline-row]")) {
                    selectSurfaceForProperties(stateService, surfaceId, uiService);
                }
            }}
        >
            {isLinkedTree ? (
                <div className="text-2xs leading-snug text-warning px-0.5">
                    {t("widgetChrome.outline.linkedSurfaceHint")}
                </div>
            ) : null}
            <DndContext
                sensors={sensors}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragCancel={handleDragCancel}
                onDragEnd={handleDragEnd}
            >
                <OutlineSubtree parentId={outlineRoot.id} depth={0} {...rowBase} />
            </DndContext>
            {dragPreview}
            <ShortcutContextMenu
                shortcuts={UI_EDITOR_MENU_SHORTCUTS}
                items={menuItems}
                position={menuState.position}
                visible={menuState.visible}
                onClose={hideMenu}
            />
        </div>
    );
}
