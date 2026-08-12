import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Minus, Square, X } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { isMacPlatform } from "@/lib/app/platform";
import { useTranslation } from "@/lib/i18n";
import { useDetachedWindowKey, useHostWindow } from "./hostWindow";

/**
 * Turning an editor's own title row into a detached window's title bar.
 *
 * A detached window is frameless, like every other Studio window, so the row the editor already
 * draws has to do the work the OS frame would: be the drag handle, leave the macOS traffic lights
 * their space, and carry the buttons on the platforms where the OS draws none.
 *
 * Not a `TitleBar`. That component is the *window shell's* bar - app icon, action bar, centred
 * title, and window controls wired to "the window that sent this IPC". A detached window has no
 * shell (it is one editor, portalled in) and cannot use that wiring at all: its IPC leaves through
 * the opener, so those buttons would drive the workspace. What is shared is the geometry, kept in
 * step with `TitleBar`'s own constants.
 */

/**
 * Room to leave for the macOS traffic lights - the same expression `TitleBar` uses, and for the
 * same reason: the buttons are drawn by the OS at a fixed physical size that `ui.zoomPercent` does
 * not scale, so their share of the bar has to be divided back out by `--nl-zoom`.
 */
const MACOS_TRAFFIC_LIGHT_SAFE_AREA = "calc(66px / var(--nl-zoom, 1) + 24px)";

export type DetachedTitleBarProps = {
    /** True when this subtree is a detached window's contents; false leaves everything untouched. */
    isDetached: boolean;
    /**
     * Spread onto the row acting as the title bar. Empty when not detached, so a docked editor's
     * header keeps exactly the class list it had.
     */
    rowProps: { className?: string; style?: CSSProperties };
};

/**
 * What a title row needs to become a detached window's title bar.
 *
 * The row must also mark its interactive children `no-drag`, or they become part of the drag handle
 * and stop taking clicks - that is per-child, so it stays with the row rather than being hidden in
 * here.
 */
export function useDetachedTitleBar(): DetachedTitleBarProps {
    const isDetached = useDetachedWindowKey() !== null;
    if (!isDetached) {
        return { isDetached: false, rowProps: {} };
    }

    return {
        isDetached: true,
        rowProps: {
            className: "titlebar-drag",
            // Only macOS puts native buttons inside a frameless window; elsewhere the row starts at
            // the window edge and the buttons below sit at its end.
            style: isMacPlatform() ? { paddingLeft: MACOS_TRAFFIC_LIGHT_SAFE_AREA } : undefined,
        },
    };
}

/**
 * Minimise / maximise / close for a detached window, on the platforms whose frameless windows come
 * with none. On macOS this renders nothing: the traffic lights are real, drawn by the OS in the gap
 * `useDetachedTitleBar` reserves, and a second set beside them would be two ways to close one
 * window.
 */
export function DetachedTitleBarControls() {
    const { t } = useTranslation();
    const windowKey = useDetachedWindowKey();
    const hostWindow = useHostWindow();
    const [isMaximized, setIsMaximized] = useState(false);

    const send = useCallback(
        async (control: "status" | "minimize" | "toggleMaximize" | "close") => {
            if (!windowKey) {
                return;
            }
            const result = await getInterface().window.detachedControl(windowKey, control);
            if (result.success) {
                setIsMaximized(result.data.status === "maximized");
            }
        },
        [windowKey],
    );

    // The window can be maximised without these buttons - a double click on the drag region does it
    // on Windows - so the icon follows the window rather than the last button pressed.
    useEffect(() => {
        if (!windowKey || isMacPlatform()) {
            return;
        }
        void send("status");
        const onResize = () => { void send("status"); };
        hostWindow.addEventListener("resize", onResize);
        return () => hostWindow.removeEventListener("resize", onResize);
    }, [hostWindow, send, windowKey]);

    if (!windowKey || isMacPlatform()) {
        return null;
    }

    return (
        <div className="no-drag flex h-full items-center">
            <button
                type="button"
                onClick={() => void send("minimize")}
                className="grid h-8 w-9 cursor-default place-items-center rounded-sm text-fg-muted transition-colors hover:bg-fill"
                aria-label={t("dialogs.window.minimize")}
                title={t("dialogs.window.minimize")}
            >
                <Minus className="h-4 w-4" />
            </button>
            <button
                type="button"
                onClick={() => void send("toggleMaximize")}
                className="grid h-8 w-9 cursor-default place-items-center rounded-sm text-fg-muted transition-colors hover:bg-fill"
                aria-label={isMaximized ? t("dialogs.window.restore") : t("dialogs.window.maximize")}
                title={isMaximized ? t("dialogs.window.restore") : t("dialogs.window.maximize")}
            >
                <Square className="h-3 w-3" />
            </button>
            <button
                type="button"
                onClick={() => void send("close")}
                className="grid h-8 w-9 cursor-default place-items-center rounded-sm text-fg-muted transition-colors hover:bg-danger/80 hover:text-white"
                aria-label={t("common.close")}
                title={t("common.close")}
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
