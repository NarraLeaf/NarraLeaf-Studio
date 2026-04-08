import React from "react";
import { useRegistry } from "../../registry";
import { PanelPosition } from "../../registry/types";
import { SidebarPanelDropIcon } from "./SidebarPanelDropIcon";

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
    const { getPanelsByPosition } = useRegistry();
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
        <div className="bg-[#0b0d12] border-t border-white/10 flex flex-col items-center py-2 px-1 gap-1">
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

