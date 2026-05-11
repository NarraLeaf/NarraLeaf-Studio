import { type LucideIcon } from "lucide-react";

export interface WorkspacePlaceholderPanelProps {
    /** Header label */
    title: string;
    /** Short body copy */
    description: string;
    icon: LucideIcon;
}

/**
 * Shared empty state for workspace sidebar / bottom panels that are not implemented yet.
 */
export function WorkspacePlaceholderPanel({
    title,
    description,
    icon: Icon,
}: WorkspacePlaceholderPanelProps) {
    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                <span className="text-xs text-gray-400">{title}</span>
            </div>
            <div className="flex-1 p-4">
                <div className="text-center text-gray-500 py-8">
                    <Icon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">{title}</p>
                    <p className="text-xs mt-1">{description}</p>
                </div>
            </div>
        </div>
    );
}
