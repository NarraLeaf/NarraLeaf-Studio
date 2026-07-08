import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { X, Circle } from "lucide-react";
import { useRegistry } from "../../registry";
import { useWorkspace } from "../../context";
import { EditorGroup as EditorGroupType } from "../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui";
import type { FocusContext } from "@/lib/workspace/services/ui/types";
import { isMacPlatform } from "@/lib/app/platform";
import { useKeybinding, contextual, whenEditorTabsFocused, useMaxActiveEditors } from "../../hooks";
import { useEditorGroupAssetDrop } from "./useEditorGroupAssetDrop";
import { WorkspacePanelErrorBoundary } from "../WorkspacePanelErrorBoundary";

interface EditorGroupProps {
    group: EditorGroupType;
}

/**
 * Editor group component
 * Displays tabs and active editor content
 * Manages focus state and visual focus indicator
 */
export function EditorGroup({ group }: EditorGroupProps) {
    const { closeEditorTab, closeEditorTabs, setActiveEditorTab } = useRegistry();
    const { context } = useWorkspace();
    // True when THIS group owns the active editor focus — either the editor body (a tab is
    // focused) or its tab strip. Drives the accent edge on this group's active tab so the whole
    // workspace shows exactly one "globally active" tab.
    const [isEditorGroupActive, setIsEditorGroupActive] = useState(false);
    const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(() => new Set());
    const rangeAnchorTabIdRef = useRef<string | null>(null);
    const { dropTargetProps, overlayClassName } = useEditorGroupAssetDrop(group.id);

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
    const closeTabShortcut = useMemo(() => isMacPlatform() ? "cmd+w" : "ctrl+w", []);

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
            className={`h-full flex flex-col border border-transparent border-b-white/10 transition-colors ${overlayClassName}`}
        >
            {/* Tab Bar */}
            {group.tabs.length > 0 && (
                <div
                    className="relative bg-[#0b0d12] border-b border-white/10 overflow-x-auto outline-none"
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
                    <div className="flex items-stretch">
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
                                    className={`
                                        group relative flex items-center gap-2 px-3 h-9 border-r border-white/10 cursor-default
                                        transition-colors
                                        ${
                                            isGloballyActive
                                                ? "bg-primary/[0.15] text-white"
                                                : isActive
                                                  ? "bg-primary/[0.08] text-gray-100"
                                                  : isSelected
                                                    ? "bg-white/[0.06] text-gray-100"
                                                    : "bg-[#0b0d12] text-gray-400 hover:bg-[#0f1115] hover:text-white"
                                        }
                                    `}
                                    onClick={(e) => handleTabClick(tab.id, e)}
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
                                                        ? "hover:bg-white/20"
                                                        : "opacity-0 group-hover:opacity-100 hover:bg-white/10"
                                                }
                                            `}
                                            aria-label={`Close ${tab.title}`}
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
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
                    <div className="h-full flex items-center justify-center text-gray-500">
                        <p>No active editor</p>
                    </div>
                )}
            </div>
        </div>
    );
}
