import React from "react";
import { useRegistry } from "../../registry";
import { PanelPosition } from "../../registry/types";
import { SidebarPanelRail } from "./SidebarPanelRail";

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
    const { getPanelsByPosition, reorderPanels } = useRegistry();
    const panels = getPanelsByPosition(PanelPosition.Bottom);

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

    if (panels.length === 0) {
        return null;
    }

    return (
        <div className="bg-surface-sunken border-t border-edge flex flex-col items-center py-2 px-1 gap-1">
            <SidebarPanelRail
                panels={panels}
                activeId={activeId}
                sidebarVisible={visible}
                onPanelClick={handlePanelClick}
                onActivateForDrop={onActivatePanelForDrop}
                onReorder={(orderedIds) => reorderPanels(PanelPosition.Bottom, orderedIds)}
            />
        </div>
    );
}

