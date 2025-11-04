import React from "react";
import { useRegistry } from "../../registry";
import { PanelPosition } from "../../registry/types";

interface BottomPanelSelectorProps {
    visible: boolean;
    activeId: string | null;
    onToggleVisibility: () => void;
    onSelectPanel: (id: string) => void;
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

