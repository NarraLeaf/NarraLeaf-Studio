import { useWindowControls } from "@/lib/app/hooks/useWindowControls";
import { Minus, Square, X } from "lucide-react";
import { ReactNode } from "react";

export interface TitleBarProps {
    title: string;
    iconSrc: string;
    className?: string;
    actionBar?: ReactNode;
    controlBar?: ReactNode;
}

/**
 * Universal window title bar with draggable region and window control buttons
 * Can be reused across different applications
 */
export function TitleBar({ title, iconSrc, className = "", actionBar, controlBar }: TitleBarProps) {
    const { isMaximized, ability, minimize, toggleMaximize, close } = useWindowControls();

    return (
        <div className={`titlebar-drag flex items-center bg-[#0b0d12] border-b border-white/10 ${className}`}>
            {/* Left side - App Icon and Action Bar */}
            <div className="no-drag flex items-center">
                {iconSrc && (
                    <div className="flex items-center px-4">
                        <img
                            src={iconSrc}
                            alt="App Icon"
                            className="w-5 h-5"
                        />
                    </div>
                )}
                {actionBar && (
                    <div className="flex items-center">
                        {actionBar}
                    </div>
                )}
            </div>

            {/* Center - Title (if exists) or spacer */}
            <div className="flex-1 flex items-center justify-center min-w-0">
                {title && (
                    <span className="text-sm text-gray-300 truncate">
                        {title}
                    </span>
                )}
            </div>

            {/* Right side - Control Bar and Window Controls */}
            <div className="no-drag flex items-center">
                {controlBar}
                <div className="flex items-center">
                    {ability.minimizable && (
                        <button
                            onClick={minimize}
                            className="h-10 w-10 grid place-items-center text-gray-300 hover:bg-white/10 rounded-sm transition-colors cursor-default"
                            aria-label="Minimize"
                            title="Minimize"
                        >
                            <Minus className="w-4 h-4" />
                        </button>
                    )}
                    {ability.maximizable && (
                        <button
                            onClick={toggleMaximize}
                            className="h-10 w-10 grid place-items-center text-gray-300 hover:bg-white/10 rounded-sm transition-colors cursor-default"
                            aria-label={isMaximized ? "Restore" : "Maximize"}
                            title={isMaximized ? "Restore" : "Maximize"}
                        >
                            <Square className="w-3 h-3" />
                        </button>
                    )}
                    {ability.closable && (
                        <button
                            onClick={close}
                            className="h-10 w-10 grid place-items-center text-gray-300 hover:bg-red-500/80 hover:text-white rounded-sm transition-colors cursor-default"
                            aria-label="Close"
                            title="Close"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
