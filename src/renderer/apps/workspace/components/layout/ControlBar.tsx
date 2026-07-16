import React from "react";
import { Settings, PanelLeft, PanelRight, PanelBottom } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { WindowAppType } from "@shared/types/window";
import { useTranslation } from "@/lib/i18n";

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
    const { t } = useTranslation();
    const handleOpenSettings = async () => {
        await getInterface().app.launchSettings({});
    };

    return (
        <div className="flex items-center gap-1">
            {/* Left Sidebar Toggle */}
            <button
                onClick={onToggleLeftSidebar}
                className={`
                    w-8 h-8 rounded flex items-center justify-center transition-colors cursor-default
                    ${leftSidebarVisible
                        ? "bg-fill-strong text-fg"
                        : "text-fg-muted hover:bg-fill hover:text-fg"
                    }
                `}
                title={t("workspace.shell.toggleLeftSidebar")}
                aria-label={t("workspace.shell.toggleLeftSidebar")}
            >
                <PanelLeft className="w-4 h-4" />
            </button>

            {/* Bottom Panel Toggle */}
            <button
                onClick={onToggleBottomPanel}
                className={`
                    w-8 h-8 rounded flex items-center justify-center transition-colors cursor-default
                    ${bottomPanelVisible
                        ? "bg-fill-strong text-fg"
                        : "text-fg-muted hover:bg-fill hover:text-fg"
                    }
                `}
                title={t("workspace.shell.toggleBottomPanel")}
                aria-label={t("workspace.shell.toggleBottomPanel")}
            >
                <PanelBottom className="w-4 h-4" />
            </button>

            {/* Right Sidebar Toggle */}
            <button
                onClick={onToggleRightSidebar}
                className={`
                    w-8 h-8 rounded flex items-center justify-center transition-colors cursor-default
                    ${rightSidebarVisible
                        ? "bg-fill-strong text-fg"
                        : "text-fg-muted hover:bg-fill hover:text-fg"
                    }
                `}
                title={t("workspace.shell.toggleRightSidebar")}
                aria-label={t("workspace.shell.toggleRightSidebar")}
            >
                <PanelRight className="w-4 h-4" />
            </button>

            {/* Settings Button */}
            <button
                onClick={handleOpenSettings}
                className="w-8 h-8 rounded flex items-center justify-center text-fg-muted hover:bg-fill hover:text-fg transition-colors cursor-default"
                title={t("workspace.shell.openSettings")}
                aria-label={t("workspace.shell.openSettings")}
            >
                <Settings className="w-4 h-4" />
            </button>
        </div>
    );
}

