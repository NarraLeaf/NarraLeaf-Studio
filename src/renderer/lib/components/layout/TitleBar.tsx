import { useWindowControls } from "@/lib/app/hooks/useWindowControls";
import { Minus, Square, X } from "lucide-react";

export interface TitleBarProps {
    title: string;
    iconSrc: string;
    className?: string;
}

/**
 * Universal window title bar with draggable region and window control buttons
 * Can be reused across different applications
 */
export function TitleBar({ title, iconSrc, className = "" }: TitleBarProps) {
    const { isMaximized, ability, minimize, toggleMaximize, close } = useWindowControls();

    return (
        <div className={`titlebar-drag h-10 flex items-center justify-between bg-[#0b0d12] border-b border-white/10 select-none ${className}`}>
            <div className="flex items-center gap-2 min-w-0 px-3">
                <img src={iconSrc} alt="app" className="w-4 h-4 rounded-sm" />
                <div className="text-sm text-gray-200 truncate">{title}</div>
            </div>
            <div className="no-drag flex items-center">
                {ability.minimizable && (
                    <button
                        onClick={minimize}
                        className="h-10 w-12 grid place-items-center text-gray-300 hover:bg-white/10 rounded-sm transition-colors cursor-default"
                        aria-label="Minimize"
                        title="Minimize"
                    >
                        <Minus className="w-4 h-4" />
                    </button>
                )}
                {ability.maximizable && (
                    <button
                        onClick={toggleMaximize}
                        className="h-10 w-12 grid place-items-center text-gray-300 hover:bg-white/10 rounded-sm transition-colors cursor-default"
                        aria-label={isMaximized ? "Restore" : "Maximize"}
                        title={isMaximized ? "Restore" : "Maximize"}
                    >
                        <Square className="w-3 h-3" />
                    </button>
                )}
                {ability.closable && (
                    <button
                        onClick={close}
                        className="h-10 w-12 grid place-items-center text-gray-300 hover:bg-red-500/80 hover:text-white rounded-sm transition-colors cursor-default"
                        aria-label="Close"
                        title="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    );
}
