import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";

/**
 * Whether this window is in OS fullscreen, kept live off a main-process push.
 *
 * The main process is authoritative — it owns the window's `enter/leave-full-screen` events — so
 * this reads the current state once on mount and then follows the broadcast. A renderer-side
 * `matchMedia('(display-mode: fullscreen)')` is not used: Electron does not reliably fire its
 * change event (the same quirk the theme layer works around).
 */
export function useWindowFullscreen(): boolean {
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        let cancelled = false;

        void getInterface().window.control.getFullscreen().then(result => {
            if (!cancelled && result.success) {
                setIsFullscreen(result.data.isFullscreen);
            }
        }).catch(() => {
            /* Keep the default (not fullscreen) if the query fails. */
        });

        const token = getInterface().window.control.onFullscreenChanged(({ isFullscreen: next }) => {
            setIsFullscreen(next);
        });

        return () => {
            cancelled = true;
            token.cancel();
        };
    }, []);

    return isFullscreen;
}
