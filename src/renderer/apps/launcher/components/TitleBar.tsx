import { useWindowControls } from "@/lib/app/hooks/useWindowControls";
import { Minus, Square, X } from "lucide-react";

type TitleBarProps = {
    title: string;
    iconSrc: string;
};

/**
 * Window title bar with draggable region and window control buttons.
 */
export function TitleBar({ title, iconSrc }: TitleBarProps) {
    const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();

    return (
        <div className="titlebar-drag h-10 flex items-center justify-between bg-[#0b0d12] border-b border-white/10 select-none">
            <div className="flex items-center gap-2 min-w-0 px-3">
                <img src={iconSrc} alt="app" className="w-4 h-4 rounded-sm" />
                <div className="text-sm text-gray-200 truncate">{title}</div>
            </div>
            <div className="no-drag flex items-center">
                <button
                    onClick={minimize}
                    className="h-10 w-12 grid place-items-center text-gray-300 hover:bg-white/10 rounded-sm transition-colors"
                    aria-label="Minimize"
                    title="Minimize"
                >
                    <Minus className="w-4 h-4" />
                </button>
                <button
                    onClick={toggleMaximize}
                    className="h-10 w-12 grid place-items-center text-gray-300 hover:bg-white/10 rounded-sm transition-colors"
                    aria-label={isMaximized ? "Restore" : "Maximize"}
                    title={isMaximized ? "Restore" : "Maximize"}
                >
                    <Square className="w-3 h-3" />
                </button>
                <button
                    onClick={close}
                    className="h-10 w-12 grid place-items-center text-gray-300 hover:bg-red-500/80 hover:text-white rounded-sm transition-colors"
                    aria-label="Close"
                    title="Close"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}


