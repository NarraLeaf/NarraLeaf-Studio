import { Terminal } from "lucide-react";
import { PanelComponentProps } from "../types";

/**
 * Console panel component
 * Shows console output and logs
 */
export function ConsolePanel({ panelId, payload }: PanelComponentProps) {
    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                <span className="text-xs text-gray-400">Console</span>
            </div>

            {/* Content */}
            <div className="flex-1 p-4">
                <div className="text-center text-gray-500 py-8">
                    <Terminal className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">Console</p>
                    <p className="text-xs mt-1">Application logs and output will appear here</p>
                </div>
            </div>
        </div>
    );
}

