import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useRegistry } from "../../registry";
import { useWorkspace } from "../../context";
import { PanelPosition } from "../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui";

interface LeftSidebarProps {
    panelId: string;
    onClose: () => void;
    width: number;
}

/**
 * Left sidebar container
 * Displays the selected panel content with payload support
 * Manages focus state and visual focus indicator
 */
export function LeftSidebar({ panelId, onClose, width }: LeftSidebarProps) {
    const { panels } = useRegistry();
    const { context } = useWorkspace();
    const panel = panels.find((p) => p.id === panelId && p.position === PanelPosition.Left);
    const [isFocused, setIsFocused] = useState(false);

    // Set focus when panel is displayed or clicked
    useEffect(() => {
        if (!context || !panelId) return;

        const uiService = context.services.get<UIService>(Services.UI);
        
        // Subscribe to focus changes to update visual indicator
        const unsubscribe = uiService.focus.onFocusChange((focusContext) => {
            setIsFocused(
                focusContext.area === FocusArea.LeftPanel && 
                focusContext.targetId === panelId
            );
        });

        // Set focus when panel mounts (after subscribing)
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId);

        return unsubscribe;
    }, [context, panelId]);

    if (!panel || !panelId) {
        return null;
    }

    const PanelComponent = panel.component;

    const handleClick = () => {
        if (!context) return;
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
    };

    return (
        <div 
            className={`bg-[#0f1115] flex flex-col border transition-colors ${
                isFocused ? 'border-primary' : 'border-transparent border-r-white/10'
            }`}
            style={{ width: `${width}px` }}
            onClick={handleClick}
            tabIndex={0}
        >
            {/* Panel Header */}
            <div className="h-12 flex items-center justify-between px-4 bg-[#0b0d12] border-b border-white/10">
                <div className="flex items-center gap-2">
                    <span className="text-gray-400">{panel.icon}</span>
                    <h2 className="text-sm font-medium text-white">{panel.title}</h2>
                </div>
                <button
                    onClick={onClose}
                    className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-colors cursor-default"
                    aria-label="Close panel"
                    title="Close panel"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Panel Content with payload */}
            <div className="flex-1 overflow-auto">
                <PanelComponent panelId={panelId} payload={panel.payload} />
            </div>
        </div>
    );
}

