import React from "react";
import { X } from "lucide-react";
import { useRegistry } from "../../registry";
import { PanelPosition } from "../../registry/types";

interface LeftSidebarProps {
    panelId: string;
    onClose: () => void;
    width: number;
}

/**
 * Left sidebar container
 * Displays the selected panel content
 */
export function LeftSidebar({ panelId, onClose, width }: LeftSidebarProps) {
    const { panels } = useRegistry();
    const panel = panels.find((p) => p.id === panelId && p.position === PanelPosition.Left);

    if (!panel) {
        return null;
    }

    const PanelComponent = panel.component;

    return (
        <div 
            className="bg-[#0f1115] border-r border-white/10 flex flex-col"
            style={{ width: `${width}px` }}
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

            {/* Panel Content */}
            <div className="flex-1 overflow-auto">
                <PanelComponent />
            </div>
        </div>
    );
}

