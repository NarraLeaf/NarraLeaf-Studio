import { useWindowControls } from "@/lib/app/hooks/useWindowControls";
import { ErrorBoundary } from "@/lib/app/errorHandling/ErrorBoundary";
import { isMacPlatform } from "@/lib/app/platform";
import { Minus, Square, X } from "lucide-react";
import { ReactNode } from "react";
import { WindowControlPolicy, type WindowControlAbility } from "@shared/types/window";
import { cn } from "../../utils/cn";

const MACOS_TRAFFIC_LIGHT_SAFE_AREA = 90;
const TITLEBAR_EDGE_GAP = 5;

export interface TitleBarProps {
    title: string;
    iconSrc: string;
    className?: string;
    actionBar?: ReactNode;
    controlBar?: ReactNode;
    initialControlAbility?: WindowControlAbility;
    windowControlPolicy?: WindowControlPolicy;
}

/**
 * Universal window title bar with draggable region and window control buttons
 * Can be reused across different applications
 */
export function TitleBar({
    title,
    iconSrc,
    className = "",
    actionBar,
    controlBar,
    initialControlAbility,
    windowControlPolicy = WindowControlPolicy.Standard,
}: TitleBarProps) {
    const isMac = isMacPlatform();
    const usesInlineMacControls = isMac && windowControlPolicy === WindowControlPolicy.Standard;
    const hasWindowControls = windowControlPolicy !== WindowControlPolicy.None;
    const shouldRenderCustomControls = hasWindowControls && !isMac;
    const leftInset = usesInlineMacControls ? MACOS_TRAFFIC_LIGHT_SAFE_AREA : 0;
    const rightInset = usesInlineMacControls
        ? (controlBar || iconSrc ? TITLEBAR_EDGE_GAP : MACOS_TRAFFIC_LIGHT_SAFE_AREA)
        : 0;
    const leftSafeAreaStyle = leftInset ? { paddingLeft: leftInset } : undefined;
    const rightSafeAreaStyle = rightInset ? { paddingRight: rightInset } : undefined;
    const titleSafeAreaStyle = leftInset || rightInset
        ? { paddingLeft: leftInset, paddingRight: rightInset }
        : undefined;

    return (
        <div className={cn("titlebar-drag relative z-[20000] flex h-10 min-h-10 shrink-0 items-center bg-surface-sunken border-b border-edge", className)}>
            {/* Left side - App Icon and Action Bar */}
            <div className="no-drag flex h-full min-w-0 items-center" style={leftSafeAreaStyle}>
                {!usesInlineMacControls && iconSrc && (
                    <div className="flex h-full shrink-0 items-center px-4">
                        <img
                            src={iconSrc}
                            alt="App Icon"
                            className="w-5 h-5"
                        />
                    </div>
                )}
                {actionBar && (
                    <ErrorBoundary fallback={() => null}>
                        <div className="flex items-center">{actionBar}</div>
                    </ErrorBoundary>
                )}
            </div>

            {/* Center - Title (if exists) or spacer */}
            <div
                className="pointer-events-none absolute inset-y-0 left-0 right-0 flex min-w-0 items-center justify-center px-2"
                style={titleSafeAreaStyle}
            >
                {title && (
                    <span className="text-sm text-fg-muted truncate">
                        {title}
                    </span>
                )}
            </div>

            {/* Right side - Control Bar and Window Controls */}
            <div className="no-drag ml-auto flex h-full shrink-0 items-center" style={rightSafeAreaStyle}>
                {controlBar ? (
                    <ErrorBoundary fallback={() => null}>
                        <>{controlBar}</>
                    </ErrorBoundary>
                ) : null}
                {usesInlineMacControls && iconSrc && (
                    <div className="flex h-full shrink-0 items-center px-4">
                        <img
                            src={iconSrc}
                            alt="App Icon"
                            className="w-5 h-5"
                        />
                    </div>
                )}
                {shouldRenderCustomControls && (
                    <CustomWindowControls initialAbility={initialControlAbility} />
                )}
            </div>
        </div>
    );
}

interface CustomWindowControlsProps {
    initialAbility?: WindowControlAbility;
}

function CustomWindowControls({ initialAbility }: CustomWindowControlsProps) {
    const { isMaximized, ability, minimize, toggleMaximize, close } = useWindowControls(initialAbility);

    return (
        <div className="flex h-full items-center">
            {ability.minimizable && (
                <button
                    onClick={minimize}
                    className="h-10 w-10 grid place-items-center text-fg-muted hover:bg-fill rounded-sm transition-colors cursor-default"
                    aria-label="Minimize"
                    title="Minimize"
                >
                    <Minus className="w-4 h-4" />
                </button>
            )}
            {ability.maximizable && (
                <button
                    onClick={toggleMaximize}
                    className="h-10 w-10 grid place-items-center text-fg-muted hover:bg-fill rounded-sm transition-colors cursor-default"
                    aria-label={isMaximized ? "Restore" : "Maximize"}
                    title={isMaximized ? "Restore" : "Maximize"}
                >
                    <Square className="w-3 h-3" />
                </button>
            )}
            {ability.closable && (
                <button
                    onClick={close}
                    className="h-10 w-10 grid place-items-center text-fg-muted hover:bg-danger/80 hover:text-white rounded-sm transition-colors cursor-default"
                    aria-label="Close"
                    title="Close"
                >
                    <X className="w-4 h-4" />
                </button>
            )}
        </div>
    );
}
