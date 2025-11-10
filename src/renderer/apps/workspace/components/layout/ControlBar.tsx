import React from "react";
import { Settings, PanelLeft, PanelRight, PanelBottom } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { WindowAppType } from "@shared/types/window";

interface ControlBarProps {
    leftSidebarVisible: boolean;
    rightSidebarVisible: boolean;
    bottomPanelVisible: boolean;
    onToggleLeftSidebar: () => void;
    onToggleRightSidebar: () => void;
    onToggleBottomPanel: () => void;
}

/**
 * Control bar component
 * Displays sidebar toggles and settings button in the top-right area
 */
export function ControlBar({
    leftSidebarVisible,
    rightSidebarVisible,
    bottomPanelVisible,
    onToggleLeftSidebar,
    onToggleRightSidebar,
    onToggleBottomPanel,
}: ControlBarProps) {
    const handleOpenSettings = async () => {
        await getInterface().launchSettings({});
    };

    return (
        <div className="flex items-center gap-1">
            {/* Left Sidebar Toggle */}
            <button
                onClick={onToggleLeftSidebar}
                className={`
                    w-8 h-8 rounded flex items-center justify-center transition-colors cursor-default
                    ${leftSidebarVisible
                        ? "bg-white/15 text-white"
                        : "text-gray-400 hover:bg-white/10 hover:text-white"
                    }
                `}
                title="Toggle Left Sidebar"
                aria-label="Toggle Left Sidebar"
            >
                <PanelLeft className="w-4 h-4" />
            </button>

            {/* Bottom Panel Toggle */}
            <button
                onClick={onToggleBottomPanel}
                className={`
                    w-8 h-8 rounded flex items-center justify-center transition-colors cursor-default
                    ${bottomPanelVisible
                        ? "bg-white/15 text-white"
                        : "text-gray-400 hover:bg-white/10 hover:text-white"
                    }
                `}
                title="Toggle Bottom Panel"
                aria-label="Toggle Bottom Panel"
            >
                <PanelBottom className="w-4 h-4" />
            </button>

            {/* Right Sidebar Toggle */}
            <button
                onClick={onToggleRightSidebar}
                className={`
                    w-8 h-8 rounded flex items-center justify-center transition-colors cursor-default
                    ${rightSidebarVisible
                        ? "bg-white/15 text-white"
                        : "text-gray-400 hover:bg-white/10 hover:text-white"
                    }
                `}
                title="Toggle Right Sidebar"
                aria-label="Toggle Right Sidebar"
            >
                <PanelRight className="w-4 h-4" />
            </button>

            {/* Settings Button */}
            <button
                onClick={handleOpenSettings}
                className="w-8 h-8 rounded flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-colors cursor-default"
                title="Open Settings"
                aria-label="Open Settings"
            >
                <Settings className="w-4 h-4" />
            </button>
        </div>
    );
}

