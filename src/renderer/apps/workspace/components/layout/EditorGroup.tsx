import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { X, Circle } from "lucide-react";
import { useRegistry } from "../../registry";
import { useWorkspace } from "../../context";
import { EditorGroup as EditorGroupType } from "../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui";
import type { FocusContext } from "@/lib/workspace/services/ui/types";
import { useKeybinding, contextual, whenEditorTabsFocused } from "../../hooks";
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
    const [isEditorBodyFocused, setIsEditorBodyFocused] = useState(false);
    const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(() => new Set());
    const rangeAnchorTabIdRef = useRef<string | null>(null);
    const { dropTargetProps, overlayClassName } = useEditorGroupAssetDrop(group.id);

    const activeTab = group.tabs.find((tab) => tab.id === group.focus);

    const tabIds = useMemo(() => new Set(group.tabs.map((t) => t.id)), [group.tabs]);

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
            setIsEditorBodyFocused(
                focusContext.area === FocusArea.Editor &&
                    focusContext.targetId !== undefined &&
                    tabIds.has(focusContext.targetId)
            );
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

    // Ctrl+W: tab strip closes multi-selection (or active if none selected)
    useKeybinding({
        id: `editor-group-${group.id}-close-tabs-strip`,
        key: "ctrl+w",
        description: "Close selected editor tabs",
        handler: handleCloseTabStripSelection,
        when: whenEditorTabsFocused(group.id),
        enabled: group.tabs.length > 0,
    });

    // Ctrl+W: editor body closes active tab only
    useKeybinding({
        id: `editor-group-${group.id}-close-tab-editor-body`,
        key: "ctrl+w",
        description: "Close active editor tab",
        handler: handleCloseActiveTab,
        when: whenGroupEditorBodyFocused,
        enabled: group.tabs.length > 0,
    });

    // Outer chrome border only when editor content has logical focus; tab strip focus is invisible.
    const isGroupChromeFocused = isEditorBodyFocused;

    return (
        <div
            {...dropTargetProps}
            className={`h-full flex flex-col border transition-colors ${
                isGroupChromeFocused ? "border-primary" : "border-transparent border-b-white/10"
            } ${overlayClassName}`}
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
                            const closable = tab.closable !== false;

                            return (
                                <div
                                    key={tab.id}
                                    className={`
                                        group relative flex items-center gap-2 px-3 h-9 border-r border-white/10 cursor-default
                                        transition-colors
                                        ${
                                            isActive
                                                ? "bg-[#12151c] text-white"
                                                : isSelected
                                                  ? "bg-[#10141b] text-gray-100"
                                                  : "bg-[#0b0d12] text-gray-400 hover:bg-[#0f1115] hover:text-white"
                                        }
                                    `}
                                    onClick={(e) => handleTabClick(tab.id, e)}
                                >
                                    {isSelected && (
                                        <span
                                            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-0.5 bg-primary/70"
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
                {activeTab ? (
                    <WorkspacePanelErrorBoundary
                        regionLabel={String(activeTab.title)}
                        isolationKey={activeTab.id}
                    >
                        <activeTab.component tabId={activeTab.id} payload={activeTab.payload} />
                    </WorkspacePanelErrorBoundary>
                ) : (
                    <div className="h-full flex items-center justify-center text-gray-500">
                        <p>No active editor</p>
                    </div>
                )}
            </div>
        </div>
    );
}
