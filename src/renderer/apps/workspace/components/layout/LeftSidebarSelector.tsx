import React from "react";
import { useWorkspace } from "../../context";
import { PanelPosition } from "../../registry/types";
import { SidebarPanelRail } from "./SidebarPanelRail";
import { useSidebarPanelContextMenu } from "./useSidebarPanelContextMenu";

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
    const { context } = useWorkspace();
    const { railPanels, commitReorder, openMenu, menu } = useSidebarPanelContextMenu(PanelPosition.Left);

    const handlePanelClick = (panelId: string) => {
        const panel = railPanels.find(entry => entry.id === panelId);
        if (panel?.railAction) {
            // A rail action leads somewhere else entirely (an editor tab, a window), so it neither
            // becomes the active panel nor disturbs the sidebar's current visibility.
            if (context) {
                panel.railAction(context);
            }
            return;
        }

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
            onContextMenu={(event) => openMenu(event)}
        >
            <SidebarPanelRail
                panels={railPanels}
                activeId={activeId}
                sidebarVisible={visible}
                onPanelClick={handlePanelClick}
                onActivateForDrop={onActivatePanelForDrop}
                onReorder={commitReorder}
                onPanelContextMenu={openMenu}
            />
            {menu}
        </div>
    );
}

