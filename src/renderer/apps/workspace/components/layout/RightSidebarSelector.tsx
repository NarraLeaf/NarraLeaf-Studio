import React from "react";
import { useRegistry } from "../../registry";
import { PanelPosition } from "../../registry/types";
import { SidebarPanelRail } from "./SidebarPanelRail";

interface RightSidebarSelectorProps {
    visible: boolean;
    activeId: string | null;
    onToggleVisibility: () => void;
    onSelectPanel: (id: string) => void;
    onActivatePanelForDrop?: (panelId: string) => void;
}

/**
 * Right sidebar panel selector
 * Displays vertically aligned icons for right sidebar panels
 */
export function RightSidebarSelector({
    visible,
    activeId,
    onToggleVisibility,
    onSelectPanel,
    onActivatePanelForDrop,
}: RightSidebarSelectorProps) {
    const { getPanelsByPosition, reorderPanels } = useRegistry();
    const panels = getPanelsByPosition(PanelPosition.Right);

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

    return (
        <div
            data-workspace-sidebar-rail=""
            className="w-12 bg-surface-sunken border-l border-edge flex flex-col items-center py-2 gap-1"
        >
            <SidebarPanelRail
                panels={panels}
                activeId={activeId}
                sidebarVisible={visible}
                onPanelClick={handlePanelClick}
                onActivateForDrop={onActivatePanelForDrop}
                onReorder={(orderedIds) => reorderPanels(PanelPosition.Right, orderedIds)}
            />
        </div>
    );
}

