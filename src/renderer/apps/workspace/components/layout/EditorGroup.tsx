import React, { useEffect, useState } from "react";
import { X, Circle } from "lucide-react";
import { useRegistry } from "../../registry";
import { useWorkspace } from "../../context";
import { EditorGroup as EditorGroupType } from "../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui";

interface EditorGroupProps {
    group: EditorGroupType;
}

/**
 * Editor group component
 * Displays tabs and active editor content
 * Manages focus state and visual focus indicator
 */
export function EditorGroup({ group }: EditorGroupProps) {
    const { closeEditorTab, setActiveEditorTab } = useRegistry();
    const { context } = useWorkspace();
    const [isFocused, setIsFocused] = useState(false);

    const activeTab = group.tabs.find((tab) => tab.id === group.focus);

    // Set focus when active tab changes or when editor is clicked
    useEffect(() => {
        if (!context || !group.focus) return;

        const uiService = context.services.get<UIService>(Services.UI);
        
        // Subscribe to focus changes to update visual indicator
        const unsubscribe = uiService.focus.onFocusChange((focusContext) => {
            setIsFocused(
                focusContext.area === FocusArea.Editor && 
                focusContext.targetId === group.focus
            );
        });

        return unsubscribe;
    }, [context, group.focus]);

    const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        closeEditorTab(tabId, group.id);
    };

    const handleTabClick = (tabId: string) => {
        setActiveEditorTab(tabId, group.id);
        // Focus will be set by useEffect when activeTabId changes
    };

    const handleEditorClick = () => {
        if (!context || !group.focus) return;
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.focus.setFocus(FocusArea.Editor, group.focus);
    };

    return (
        <div 
            className={`h-full flex flex-col border transition-colors ${
                isFocused ? 'border-primary' : 'border-transparent border-b-white/10'
            }`}
            onClick={handleEditorClick}
            tabIndex={0}
        >
            {/* Tab Bar */}
            {group.tabs.length > 0 && (
                <div className="flex items-center bg-[#0b0d12] border-b border-white/10 overflow-x-auto">
                    {group.tabs.map((tab) => {
                        const isActive = tab.id === group.focus;
                        const closable = tab.closable !== false;

                        return (
                            <div
                                key={tab.id}
                                className={`
                                    group flex items-center gap-2 px-3 h-9 border-r border-white/10 cursor-default
                                    transition-colors
                                    ${
                                        isActive
                                            ? "bg-[#0f1115] text-white"
                                            : "bg-[#0b0d12] text-gray-400 hover:bg-[#0f1115] hover:text-white"
                                    }
                                `}
                                onClick={() => handleTabClick(tab.id)}
                            >
                                {/* Tab Icon */}
                                {tab.icon && <span className="w-4 h-4 flex-shrink-0">{tab.icon}</span>}

                                {/* Tab Title */}
                                <span className="text-sm whitespace-nowrap">{String(tab.title)}</span>

                                {/* Modified Indicator */}
                                {tab.modified && (
                                    <Circle className="w-2 h-2 fill-current text-primary" />
                                )}

                                {/* Close Button */}
                                {closable && (
                                    <button
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
            )}

            {/* Editor Content with payload support */}
            <div className="flex-1 overflow-auto">
                {activeTab ? (
                    <activeTab.component tabId={activeTab.id} payload={activeTab.payload} />
                ) : (
                    <div className="h-full flex items-center justify-center text-gray-500">
                        <p>No active editor</p>
                    </div>
                )}
            </div>
        </div>
    );
}

