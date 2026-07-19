import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { X, Circle } from "lucide-react";
import { useRegistry } from "../../registry";
import { useWorkspace } from "../../context";
import { EditorGroup as EditorGroupType } from "../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui";
import type { FocusContext } from "@/lib/workspace/services/ui/types";
import { useKeybinding, contextual, whenEditorTabsFocused, useMaxActiveEditors } from "../../hooks";
import { ContextMenu, useContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { hasClosedTabs, reopenLastClosedTab } from "../../session/workspaceClosedTabsStore";
import { useEditorGroupDrop } from "./useEditorGroupDrop";
import { EditorGroupDropOverlay } from "./EditorGroupDropOverlay";
import {
    EDITOR_TAB_DRAG_MIME,
    beginEditorTabDrag,
    encodeEditorTabDragPayload,
    endEditorTabDrag,
} from "@/apps/workspace/dnd/editorTabDragContract";
import { WorkspacePanelErrorBoundary } from "../WorkspacePanelErrorBoundary";
import { useTranslation } from "@/lib/i18n";

interface EditorGroupProps {
    group: EditorGroupType;
}

/**
 * Editor group component
 * Displays tabs and active editor content
 * Manages focus state and visual focus indicator
 */
export function EditorGroup({ group }: EditorGroupProps) {
    const { t } = useTranslation();
    const { closeEditorTab, closeEditorTabs, setActiveEditorTab, editorLayout } = useRegistry();
    const { context } = useWorkspace();
    // True when THIS group owns the active editor focus — either the editor body (a tab is
    // focused) or its tab strip. Drives the accent edge on this group's active tab so the whole
    // workspace shows exactly one "globally active" tab.
    const [isEditorGroupActive, setIsEditorGroupActive] = useState(false);
    const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(() => new Set());
    // The tab currently being dragged out of this strip, ghosted so its old slot reads as vacated
    // while the caret shows where it would land.
    const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
    const rangeAnchorTabIdRef = useRef<string | null>(null);
    const { dropTargetProps, stripRef, zone: dropZone, insertion } = useEditorGroupDrop(group);

    const activeTab = group.tabs.find((tab) => tab.id === group.focus);

    const maxActiveEditors = useMaxActiveEditors();

    // Keep-alive: keep up to `maxActiveEditors` most-recently-active tabs mounted (hidden with
    // display:none) so their DOM scroll position, focus, and in-memory state survive a tab switch
    // instead of being reconstructed on a cold remount. The active tab is always mounted; the
    // least-recently-active tabs beyond the cap are unmounted and cold-restore when reopened.
    const [mru, setMru] = useState<string[]>(() => (group.focus ? [group.focus] : []));

    useEffect(() => {
        setMru((prev) => {
            const existing = new Set(group.tabs.map((t) => t.id));
            const ordered: string[] = [];
            const seen = new Set<string>();
            for (const id of [group.focus, ...prev]) {
                if (id && existing.has(id) && !seen.has(id)) {
                    seen.add(id);
                    ordered.push(id);
                }
            }
            if (ordered.length === prev.length && ordered.every((id, i) => id === prev[i])) {
                return prev;
            }
            return ordered;
        });
    }, [group.focus, group.tabs]);

    const mountedTabIds = useMemo(() => {
        const set = new Set<string>();
        if (group.focus) {
            set.add(group.focus);
        }
        for (const id of mru) {
            if (set.size >= maxActiveEditors) {
                break;
            }
            set.add(id);
        }
        return set;
    }, [group.focus, mru, maxActiveEditors]);

    const tabIds = useMemo(() => new Set(group.tabs.map((t) => t.id)), [group.tabs]);
    const closeTabShortcut = "mod+w";

    // Drop stale selection entries when tabs change
    useEffect(() => {
        setSelectedTabIds((prev) => {
            const next = new Set([...prev].filter((id) => tabIds.has(id)));
            return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next;
        });
        if (rangeAnchorTabIdRef.current && !tabIds.has(rangeAnchorTabIdRef.current)) {
            rangeAnchorTabIdRef.current = group.focus;
        }
    }, [group.tabs, group.focus, tabIds]);

    useEffect(() => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);

        const sync = (focusContext: FocusContext) => {
            const bodyFocused =
                focusContext.area === FocusArea.Editor &&
                focusContext.targetId !== undefined &&
                tabIds.has(focusContext.targetId);
            const tabStripFocused =
                focusContext.area === FocusArea.EditorTabs &&
                focusContext.targetId === group.id;
            setIsEditorGroupActive(bodyFocused || tabStripFocused);
        };

        sync(uiService.focus.getFocus());

        return uiService.focus.onFocusChange(sync);
    }, [context, group.id, tabIds]);

    const focusTabStrip = useCallback(() => {
        if (!context) return;
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.focus.setFocus(FocusArea.EditorTabs, group.id);
    }, [context, group.id]);

    const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        closeEditorTab(tabId, group.id);
    };

    // ---- Tab context menu (close others / to the right / all, reopen closed) ----

    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuTabId, setMenuTabId] = useState<string | null>(null);

    const handleTabContextMenu = (tabId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setMenuTabId(tabId);
        showMenu(e);
    };

    // Split actions on the clicked tab (the palette commands act on the focused one instead).
    const splitGroup = useCallback(
        (direction: "horizontal" | "vertical", tabId: string) => {
            if (!context) return;
            context.services.get<UIService>(Services.UI).getStore().splitEditorGroup(group.id, direction, tabId);
        },
        [context, group.id],
    );
    const closeOtherGroups = useCallback(() => {
        if (!context) return;
        context.services.get<UIService>(Services.UI).getStore().closeOtherEditorGroups(group.id);
    }, [context, group.id]);
    const hasSplit = !("tabs" in editorLayout);

    const tabMenuItems = useMemo<ContextMenuDef>(() => {
        const tabs = group.tabs;
        const targetIndex = tabs.findIndex((tab) => tab.id === menuTabId);
        if (targetIndex < 0) {
            return [];
        }
        const target = tabs[targetIndex];
        const closableIds = (list: typeof tabs) => list.filter((tab) => tab.closable !== false).map((tab) => tab.id);
        const others = closableIds(tabs.filter((_, index) => index !== targetIndex));
        const toRight = closableIds(tabs.slice(targetIndex + 1));
        const all = closableIds(tabs);

        return [
            {
                id: "close",
                label: t("workspace.shell.tabMenu.close"),
                disabled: target.closable === false,
                onClick: () => closeEditorTab(target.id, group.id),
            },
            {
                id: "close-others",
                label: t("workspace.shell.tabMenu.closeOthers"),
                disabled: others.length === 0,
                onClick: () => closeEditorTabs(others, group.id),
            },
            {
                id: "close-right",
                label: t("workspace.shell.tabMenu.closeToRight"),
                disabled: toRight.length === 0,
                onClick: () => closeEditorTabs(toRight, group.id),
            },
            {
                id: "close-all",
                label: t("workspace.shell.tabMenu.closeAll"),
                disabled: all.length === 0,
                onClick: () => closeEditorTabs(all, group.id),
            },
            { separator: true, id: "sep-split" },
            {
                id: "split-right",
                label: t("workspace.shell.tabMenu.splitRight"),
                // Splitting moves this tab out of its group; with only one tab that would leave
                // an empty pane behind, so the group needs a second tab to stay behind.
                disabled: !context || tabs.length < 2,
                onClick: () => splitGroup("horizontal", target.id),
            },
            {
                id: "split-down",
                label: t("workspace.shell.tabMenu.splitDown"),
                disabled: !context || tabs.length < 2,
                onClick: () => splitGroup("vertical", target.id),
            },
            {
                id: "close-split",
                label: t("workspace.shell.tabMenu.closeSplit"),
                disabled: !context || !hasSplit,
                onClick: () => closeOtherGroups(),
            },
            { separator: true, id: "sep-reopen" },
            {
                id: "reopen-closed",
                label: t("workspace.shell.tabMenu.reopenClosed"),
                disabled: !hasClosedTabs() || !context,
                onClick: () => {
                    if (!context) {
                        return;
                    }
                    reopenLastClosedTab(context, context.services.get<UIService>(Services.UI));
                },
            },
        ];
    }, [
        closeEditorTab,
        closeEditorTabs,
        context,
        group.id,
        group.tabs,
        menuTabId,
        t,
        splitGroup,
        closeOtherGroups,
        hasSplit,
    ]);

    const activateTabFromStrip = useCallback((tabId: string) => {
        setActiveEditorTab(tabId, group.id);
        focusTabStrip();
    }, [focusTabStrip, group.id, setActiveEditorTab]);

    const handleTabClick = (tabId: string, e: React.MouseEvent) => {
        e.stopPropagation();

        const idx = group.tabs.findIndex((t) => t.id === tabId);
        if (idx < 0) {
            return;
        }

        if (e.shiftKey && rangeAnchorTabIdRef.current != null) {
            const a = group.tabs.findIndex((t) => t.id === rangeAnchorTabIdRef.current);
            const from = Math.min(a, idx);
            const to = Math.max(a, idx);
            const range = new Set(group.tabs.slice(from, to + 1).map((t) => t.id));
            setSelectedTabIds(range);
            activateTabFromStrip(tabId);
            return;
        }

        if (e.ctrlKey || e.metaKey) {
            setSelectedTabIds((prev) => {
                const next = new Set(prev);
                if (next.has(tabId)) {
                    next.delete(tabId);
                } else {
                    next.add(tabId);
                }
                return next;
            });
            activateTabFromStrip(tabId);
            rangeAnchorTabIdRef.current = tabId;
            return;
        }

        setSelectedTabIds(new Set([tabId]));
        rangeAnchorTabIdRef.current = tabId;
        activateTabFromStrip(tabId);
    };

    const handleEditorBodyClick = () => {
        if (!context || !group.focus) return;
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.focus.setFocus(FocusArea.Editor, group.focus);
    };

    const handleCloseActiveTab = useCallback(() => {
        if (group.focus) {
            const tab = group.tabs.find((t) => t.id === group.focus);
            if (tab && tab.closable !== false) {
                closeEditorTab(group.focus, group.id);
            }
        }
    }, [group.focus, group.tabs, group.id, closeEditorTab]);

    const handleCloseTabStripSelection = useCallback(() => {
        const closableSelected = [...selectedTabIds].filter((id) => {
            const t = group.tabs.find((x) => x.id === id);
            return t && t.closable !== false;
        });
        if (closableSelected.length > 0) {
            closeEditorTabs(closableSelected, group.id);
            setSelectedTabIds(new Set());
            return;
        }
        if (group.focus) {
            const t = group.tabs.find((x) => x.id === group.focus);
            if (t && t.closable !== false) {
                closeEditorTab(group.focus, group.id);
            }
        }
    }, [selectedTabIds, group.tabs, group.focus, group.id, closeEditorTabs, closeEditorTab]);

    const whenGroupEditorBodyFocused = useMemo(
        () =>
            contextual(
                (ctx) =>
                    ctx.area === FocusArea.Editor &&
                    ctx.targetId !== undefined &&
                    tabIds.has(ctx.targetId)
            ),
        [tabIds]
    );

    // Close shortcut: tab strip closes multi-selection (or active if none selected)
    useKeybinding({
        id: `editor-group-${group.id}-close-tabs-strip`,
        key: closeTabShortcut,
        description: "Close selected editor tabs",
        handler: handleCloseTabStripSelection,
        when: whenEditorTabsFocused(group.id),
        enabled: group.tabs.length > 0,
    });

    // Close shortcut: editor body closes active tab only
    useKeybinding({
        id: `editor-group-${group.id}-close-tab-editor-body`,
        key: closeTabShortcut,
        description: "Close active editor tab",
        handler: handleCloseActiveTab,
        when: whenGroupEditorBodyFocused,
        enabled: group.tabs.length > 0,
    });

    // The accent edge now lives on the single globally-active TAB, not on the whole group chrome,
    // so the group frame stays neutral.
    return (
        <div
            {...dropTargetProps}
            className="relative h-full flex flex-col border border-transparent border-b-edge transition-colors"
        >
            {/* Tab Bar */}
            {group.tabs.length > 0 && (
                <div
                    ref={stripRef}
                    className="relative bg-surface-sunken border-b border-edge overflow-x-auto outline-none"
                    tabIndex={0}
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        focusTabStrip();
                    }}
                    onFocus={() => focusTabStrip()}
                    onWheel={(e) => {
                        e.preventDefault();
                        e.currentTarget.scrollLeft += e.deltaY;
                    }}
                >
                    <div className="relative flex items-stretch">
                        {insertion && (
                            <span
                                className="pointer-events-none absolute top-0 bottom-0 z-[2] w-0.5 -translate-x-1/2 bg-primary"
                                style={{ left: insertion.offset }}
                                aria-hidden
                            />
                        )}
                        {group.tabs.map((tab) => {
                            const isActive = tab.id === group.focus;
                            const isSelected = selectedTabIds.has(tab.id);
                            // The single globally-active tab: this group's current tab AND this
                            // group owns editor focus. It gets the accent edge; every group's
                            // current tab gets the low-contrast themed fill.
                            const isGloballyActive = isActive && isEditorGroupActive;
                            const closable = tab.closable !== false;

                            return (
                                <div
                                    key={tab.id}
                                    data-editor-tab-id={tab.id}
                                    draggable
                                    onDragStart={(e) => {
                                        e.stopPropagation();
                                        e.dataTransfer.effectAllowed = "move";
                                        e.dataTransfer.setData(
                                            EDITOR_TAB_DRAG_MIME,
                                            encodeEditorTabDragPayload(tab.id, group.id),
                                        );
                                        e.dataTransfer.setData("text/plain", String(tab.title));
                                        beginEditorTabDrag({ tabId: tab.id, groupId: group.id });
                                        setDraggingTabId(tab.id);
                                    }}
                                    onDragEnd={() => {
                                        endEditorTabDrag();
                                        setDraggingTabId(null);
                                    }}
                                    className={`
                                        group relative flex items-center gap-2 px-3 h-9 border-r border-edge cursor-default
                                        transition-colors
                                        ${draggingTabId === tab.id ? "opacity-40" : ""}
                                        ${
                                            isGloballyActive
                                                ? "bg-primary/[0.15] text-fg"
                                                : isActive
                                                  ? "bg-primary/[0.08] text-fg"
                                                  : isSelected
                                                    ? "bg-fill text-fg"
                                                    : "bg-surface-sunken text-fg-muted hover:bg-surface hover:text-fg"
                                        }
                                    `}
                                    onClick={(e) => handleTabClick(tab.id, e)}
                                    onContextMenu={(e) => handleTabContextMenu(tab.id, e)}
                                    onAuxClick={(e) => {
                                        // Middle click closes, the muscle memory every browser/IDE trains.
                                        if (e.button === 1 && closable) {
                                            handleCloseTab(tab.id, e);
                                        }
                                    }}
                                >
                                    {isGloballyActive && (
                                        <span
                                            className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-0.5 bg-primary"
                                            aria-hidden
                                        />
                                    )}
                                    {tab.icon && <span className="w-4 h-4 flex-shrink-0">{tab.icon}</span>}

                                    <span className="text-sm whitespace-nowrap">{String(tab.title)}</span>

                                    {tab.modified && (
                                        <Circle className="w-2 h-2 fill-current text-primary" />
                                    )}

                                    {closable && (
                                        <button
                                            type="button"
                                            onClick={(e) => handleCloseTab(tab.id, e)}
                                            className={`
                                                w-4 h-4 rounded flex items-center justify-center transition-colors
                                                ${
                                                    isActive
                                                        ? "hover:bg-fill-strong"
                                                        : "opacity-0 group-hover:opacity-100 hover:bg-fill"
                                                }
                                            `}
                                            aria-label={t("workspace.shell.closeTab", { name: String(tab.title) })}
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <ContextMenu
                        items={tabMenuItems}
                        position={menuState.position}
                        visible={menuState.visible}
                        onClose={hideMenu}
                    />
                </div>
            )}

            {/* Editor Content with payload support */}
            <div
                className="flex-1 min-h-0 overflow-auto outline-none"
                tabIndex={-1}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={handleEditorBodyClick}
            >
                {group.tabs.map((tab) => {
                    if (!mountedTabIds.has(tab.id)) {
                        return null;
                    }
                    const isActive = tab.id === group.focus;
                    return (
                        <div
                            key={tab.id}
                            className="h-full w-full"
                            style={{ display: isActive ? undefined : "none" }}
                            aria-hidden={isActive ? undefined : true}
                        >
                            <WorkspacePanelErrorBoundary
                                regionLabel={String(tab.title)}
                                isolationKey={tab.id}
                            >
                                <tab.component tabId={tab.id} payload={tab.payload} active={isActive} />
                            </WorkspacePanelErrorBoundary>
                        </div>
                    );
                })}
                {!activeTab && (
                    <div className="h-full flex items-center justify-center text-fg-subtle">
                        <p>{t("workspace.shell.noActiveEditor")}</p>
                    </div>
                )}
            </div>

            <EditorGroupDropOverlay zone={dropZone} />
        </div>
    );
}
