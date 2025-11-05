import { Settings } from "lucide-react";
import { PanelComponentProps } from "../types";

/**
 * Properties panel component
 * Shows properties/inspector for selected items
 */
export function PropertiesPanel({ panelId, payload }: PanelComponentProps) {
    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                <span className="text-xs text-gray-400">Properties</span>
            </div>

            {/* Content */}
            <div className="flex-1 p-4">
                <div className="text-center text-gray-500 py-8">
                    <Settings className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">Properties Panel</p>
                    <p className="text-xs mt-1">Select an item to view its properties</p>
                </div>
            </div>
        </div>
    );
}

