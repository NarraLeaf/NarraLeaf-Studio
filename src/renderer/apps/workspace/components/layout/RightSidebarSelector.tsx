import React from "react";
import { useRegistry } from "../../registry";
import { PanelPosition } from "../../registry/types";

interface RightSidebarSelectorProps {
    visible: boolean;
    activeId: string | null;
    onToggleVisibility: () => void;
    onSelectPanel: (id: string) => void;
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
}: RightSidebarSelectorProps) {
    const { getPanelsByPosition } = useRegistry();
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
        <div className="w-12 bg-[#0b0d12] border-l border-white/10 flex flex-col items-center py-2 gap-1">
            {panels.map((panel) => (
                <button
                    key={panel.id}
                    className={`
                        w-10 h-10 rounded-md flex items-center justify-center transition-colors cursor-default
                        ${
                            activeId === panel.id && visible
                                ? "bg-white/15 text-white"
                                : "text-gray-400 hover:bg-white/10 hover:text-white"
                        }
                    `}
                    onClick={() => handlePanelClick(panel.id)}
                    title={panel.title}
                    aria-label={panel.title}
                >
                    {panel.icon}
                </button>
            ))}
        </div>
    );
}

