import React from "react";
import { useRegistry } from "../../registry";
import { PanelPosition } from "../../registry/types";
import { SidebarPanelDropIcon } from "./SidebarPanelDropIcon";

interface LeftSidebarSelectorProps {
    visible: boolean;
    activeId: string | null;
    onToggleVisibility: () => void;
    onSelectPanel: (id: string) => void;
    /** Activate panel, show sidebar, and focus it (asset drop). */
    onActivatePanelForDrop?: (panelId: string) => void;
}

/**
 * Left sidebar panel selector
 * Displays vertically aligned icons for left sidebar panels
 */
export function LeftSidebarSelector({
    visible,
    activeId,
    onToggleVisibility,
    onSelectPanel,
    onActivatePanelForDrop,
}: LeftSidebarSelectorProps) {
    const { getPanelsByPosition } = useRegistry();
    const panels = getPanelsByPosition(PanelPosition.Left);

    const handlePanelClick = (panelId: string) => {
        if (activeId === panelId && visible) {
            // Clicking active panel toggles visibility
            onToggleVisibility();
        } else {
            // Clicking different panel switches to it and ensures visibility
            onSelectPanel(panelId);
            if (!visible) {
                onToggleVisibility();
            }
        }
    };

    return (
        <div
            data-workspace-sidebar-rail=""
            className="bg-surface-sunken border-r border-edge flex flex-col items-center py-2 px-1 gap-1"
        >
            {panels.map((panel) => (
                <SidebarPanelDropIcon
                    key={panel.id}
                    panel={panel}
                    active={activeId === panel.id}
                    sidebarVisible={visible}
                    onPanelClick={() => handlePanelClick(panel.id)}
                    onActivateForDrop={() => onActivatePanelForDrop?.(panel.id)}
                />
            ))}
        </div>
    );
}

