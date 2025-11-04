import React from "react";
import { X, Circle } from "lucide-react";
import { useRegistry } from "../../registry";
import { EditorGroup as EditorGroupType } from "../../registry/types";

interface EditorGroupProps {
    group: EditorGroupType;
}

/**
 * Editor group component
 * Displays tabs and active editor content
 */
export function EditorGroup({ group }: EditorGroupProps) {
    const { closeEditorTab, setActiveEditorTab } = useRegistry();

    const activeTab = group.tabs.find((tab) => tab.id === group.activeTabId);

    const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        closeEditorTab(tabId, group.id);
    };

    return (
        <div className="h-full flex flex-col">
            {/* Tab Bar */}
            {group.tabs.length > 0 && (
                <div className="flex items-center bg-[#0b0d12] border-b border-white/10 overflow-x-auto">
                    {group.tabs.map((tab) => {
                        const isActive = tab.id === group.activeTabId;
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
                                onClick={() => setActiveEditorTab(tab.id, group.id)}
                            >
                                {/* Tab Icon */}
                                {tab.icon && <span className="w-4 h-4 flex-shrink-0">{tab.icon}</span>}

                                {/* Tab Title */}
                                <span className="text-sm whitespace-nowrap">{tab.title}</span>

                                {/* Modified Indicator */}
                                {tab.modified && (
                                    <Circle className="w-2 h-2 fill-current text-blue-400" />
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

            {/* Editor Content */}
            <div className="flex-1 overflow-auto">
                {activeTab ? (
                    <activeTab.component tabId={activeTab.id} />
                ) : (
                    <div className="h-full flex items-center justify-center text-gray-500">
                        <p>No active editor</p>
                    </div>
                )}
            </div>
        </div>
    );
}

