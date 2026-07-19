import React from "react";
import { PanelPosition } from "../../registry/types";
import { SidebarPanelRail } from "./SidebarPanelRail";
import { useSidebarPanelContextMenu } from "./useSidebarPanelContextMenu";

interface BottomPanelSelectorProps {
    visible: boolean;
    activeId: string | null;
    onToggleVisibility: () => void;
    onSelectPanel: (id: string) => void;
    onActivatePanelForDrop?: (panelId: string) => void;
}

/**
 * Bottom panel selector
 * Displays horizontally aligned icons at the bottom-left
 */
export function BottomPanelSelector({
    visible,
    activeId,
    onToggleVisibility,
    onSelectPanel,
    onActivatePanelForDrop,
}: BottomPanelSelectorProps) {
    const { railPanels, hasPanels, commitReorder, openMenu, menu } = useSidebarPanelContextMenu(PanelPosition.Bottom);

    const handlePanelClick = (panelId: string) => {
        if (activeId === panelId && visible) {
            onToggleVisibility();
        } else {
            onSelectPanel(panelId);
            if (!visible) {
                onToggleVisibility();
            }
        }
    };

    if (!hasPanels) {
        return null;
    }

    return (
        <div
            data-workspace-sidebar-rail=""
            className="bg-surface-sunken border-t border-edge flex flex-col items-center py-2 px-1 gap-1"
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

