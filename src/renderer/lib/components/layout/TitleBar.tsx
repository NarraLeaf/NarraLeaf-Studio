import { useWindowControls } from "@/lib/app/hooks/useWindowControls";
import { useWindowFullscreen } from "@/lib/app/hooks/useWindowFullscreen";
import { useTranslation } from "@/lib/i18n";
import { ErrorBoundary } from "@/lib/app/errorHandling/ErrorBoundary";
import { isMacPlatform } from "@/lib/app/platform";
import { Minus, Square, X } from "lucide-react";
import { ReactNode } from "react";
import { WindowControlPolicy, type WindowControlAbility } from "@shared/types/window";
import { cn } from "../../utils/cn";

/**
 * Room to leave for the macOS traffic lights.
 *
 * macOS draws them at a fixed physical size that `ui.zoomPercent` does not touch,
 * so this cannot be a plain CSS length: at 50% a flat 90px would reserve only 45
 * real pixels and the action bar would sit on top of the buttons. Dividing the
 * buttons' own width by `--nl-zoom` (published by lib/zoom) keeps their share of
 * the bar constant in real pixels, while the trailing gap stays part of the UI and
 * scales with everything else. Resolves to exactly 90px at 100%.
 */
const MACOS_TRAFFIC_LIGHT_SAFE_AREA = "calc(66px / var(--nl-zoom, 1) + 24px)";
const TITLEBAR_EDGE_GAP = 5;

export interface TitleBarProps {
    title: string;
    iconSrc: string;
    className?: string;
    actionBar?: ReactNode;
    /** Interactive content for the centered slot; takes the place of `title` when provided. */
    center?: ReactNode;
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
    center,
    controlBar,
    initialControlAbility,
    windowControlPolicy = WindowControlPolicy.Standard,
}: TitleBarProps) {
    const { t } = useTranslation();
    const isMac = isMacPlatform();
    const isFullscreen = useWindowFullscreen();
    const usesInlineMacControls = isMac && windowControlPolicy === WindowControlPolicy.Standard;
    const hasWindowControls = windowControlPolicy !== WindowControlPolicy.None;
    const shouldRenderCustomControls = hasWindowControls && !isMac;
    // macOS hides the traffic lights in fullscreen, so the space reserved for them becomes dead —
    // stop reserving it and let the content sit flush against the window edge.
    const reserveMacTrafficLights = usesInlineMacControls && !isFullscreen;
    const leftInset = reserveMacTrafficLights ? MACOS_TRAFFIC_LIGHT_SAFE_AREA : 0;
    const rightInset = usesInlineMacControls
        ? (controlBar || iconSrc ? TITLEBAR_EDGE_GAP : (reserveMacTrafficLights ? MACOS_TRAFFIC_LIGHT_SAFE_AREA : 0))
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
                            alt={t("dialogs.window.appIcon")}
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

            {/* Center. An interactive slot participates in the flex row (flex-1 = it gets exactly
                the space the side clusters leave, so a w-full child can stretch without ever
                overlapping them); the plain title keeps the absolute overlay so it stays visually
                centered regardless of asymmetric sides. */}
            {center ? (
                <div className="flex h-full min-w-0 flex-1 items-center justify-center px-3">
                    <ErrorBoundary fallback={() => null}>
                        <>{center}</>
                    </ErrorBoundary>
                </div>
            ) : (
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
            )}

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
                            alt={t("dialogs.window.appIcon")}
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
    const { t } = useTranslation();
    const { isMaximized, ability, minimize, toggleMaximize, close } = useWindowControls(initialAbility);

    return (
        <div className="flex h-full items-center">
            {ability.minimizable && (
                <button
                    onClick={minimize}
                    className="h-10 w-10 grid place-items-center text-fg-muted hover:bg-fill rounded-sm transition-colors cursor-default"
                    aria-label={t("dialogs.window.minimize")}
                    title={t("dialogs.window.minimize")}
                >
                    <Minus className="w-4 h-4" />
                </button>
            )}
            {ability.maximizable && (
                <button
                    onClick={toggleMaximize}
                    className="h-10 w-10 grid place-items-center text-fg-muted hover:bg-fill rounded-sm transition-colors cursor-default"
                    aria-label={isMaximized ? t("dialogs.window.restore") : t("dialogs.window.maximize")}
                    title={isMaximized ? t("dialogs.window.restore") : t("dialogs.window.maximize")}
                >
                    <Square className="w-3 h-3" />
                </button>
            )}
            {ability.closable && (
                <button
                    onClick={close}
                    className="h-10 w-10 grid place-items-center text-fg-muted hover:bg-danger/80 hover:text-white rounded-sm transition-colors cursor-default"
                    aria-label={t("common.close")}
                    title={t("common.close")}
                >
                    <X className="w-4 h-4" />
                </button>
            )}
        </div>
    );
}
