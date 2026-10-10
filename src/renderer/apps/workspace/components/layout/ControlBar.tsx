import React from "react";
import { Settings, PanelLeft, PanelRight, PanelBottom } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { WindowAppType } from "@shared/types/window";
import { useTranslation } from "@/lib/i18n";
import { TooltipGroup } from "@/lib/tooltip";
import { WorkspaceMenuAction } from "@shared/types/menu";
import { useShortcutLabels } from "../../hooks/useShortcutLabels";

interface ControlBarProps {
    leftSidebarVisible: boolean;
    rightSidebarVisible: boolean;
    bottomPanelVisible: boolean;
    onToggleLeftSidebar: () => void;
    onToggleRightSidebar: () => void;
    onToggleBottomPanel: () => void;
}

/**
 * The dock toggles and the settings button at the right of the title bar.
 *
 * Each button's tooltip carries its key. These are the controls an author reaches for when they want
 * a dock out of the way, so this is where the faster way to do it is found; the chord is the one that
 * fires, rebinding included.
 *
 * Each dock button is named by the `menu.window.*` entry the command palette, the shortcut cheat sheet
 * and the macOS Window menu also use, so the one action reads the same wherever it is found.
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
    const shortcuts = useShortcutLabels();
    const handleOpenSettings = async () => {
        await getInterface().app.launchSettings({});
    };

    return (
        <TooltipGroup className="flex items-center gap-1">
            {/* Left Sidebar Toggle */}
            <button
                onClick={onToggleLeftSidebar}
                className={`
                    w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-default
                    ${leftSidebarVisible
                        ? "bg-fill-strong text-fg"
                        : "text-fg-muted hover:bg-fill hover:text-fg"
                    }
                `}
                data-tip={t("menu.window.leftSidebar")}
                data-tip-shortcut={shortcuts.forBinding(WorkspaceMenuAction.ToggleLeftSidebar)}
                aria-label={t("menu.window.leftSidebar")}
            >
                <PanelLeft className="w-4 h-4" />
            </button>

            {/* Bottom Panel Toggle */}
            <button
                onClick={onToggleBottomPanel}
                className={`
                    w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-default
                    ${bottomPanelVisible
                        ? "bg-fill-strong text-fg"
                        : "text-fg-muted hover:bg-fill hover:text-fg"
                    }
                `}
                data-tip={t("menu.window.bottomPanel")}
                data-tip-shortcut={shortcuts.forBinding(WorkspaceMenuAction.ToggleBottomPanel)}
                aria-label={t("menu.window.bottomPanel")}
            >
                <PanelBottom className="w-4 h-4" />
            </button>

            {/* Right Sidebar Toggle */}
            <button
                onClick={onToggleRightSidebar}
                className={`
                    w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-default
                    ${rightSidebarVisible
                        ? "bg-fill-strong text-fg"
                        : "text-fg-muted hover:bg-fill hover:text-fg"
                    }
                `}
                data-tip={t("menu.window.rightSidebar")}
                data-tip-shortcut={shortcuts.forBinding(WorkspaceMenuAction.ToggleRightSidebar)}
                aria-label={t("menu.window.rightSidebar")}
            >
                <PanelRight className="w-4 h-4" />
            </button>

            {/* Settings Button */}
            <button
                onClick={handleOpenSettings}
                className="w-8 h-8 rounded-md flex items-center justify-center text-fg-muted hover:bg-fill hover:text-fg transition-colors cursor-default"
                data-tip={t("workspace.shell.openSettings")}
                data-tip-shortcut={shortcuts.forBinding("workspace:open-settings")}
                aria-label={t("workspace.shell.openSettings")}
            >
                <Settings className="w-4 h-4" />
            </button>
        </TooltipGroup>
    );
}

