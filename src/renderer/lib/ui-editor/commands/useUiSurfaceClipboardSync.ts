import { useEffect, useSyncExternalStore } from "react";
import { getUiSurfaceClipboard, subscribeUiSurfaceClipboard } from "./uiSurfaceClipboard";
import { refreshUiSurfaceClipboardFromSystem } from "./uiSurfaceCommands";

/**
 * Whether there is an interface to paste, kept level with the machine's clipboard.
 *
 * Read on mount and whenever the window comes forward, which between them cover every way an
 * interface copied in another project can arrive: the author copies over there, switches here, and
 * pastes. The store subscription covers the other direction - a copy made in this window - so the
 * control appears the moment the menu row is used rather than at the next focus.
 *
 * The panel's Paste is absent rather than greyed while this is false, so the answer has to be
 * synchronous once the read has landed; that is what the in-window mirror is for.
 */
export function useUiSurfaceClipboardPresence(enabled: boolean): boolean {
    const payload = useSyncExternalStore(subscribeUiSurfaceClipboard, getUiSurfaceClipboard, getUiSurfaceClipboard);

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        const refresh = () => {
            void refreshUiSurfaceClipboardFromSystem();
        };
        refresh();
        window.addEventListener("focus", refresh);
        return () => window.removeEventListener("focus", refresh);
    }, [enabled]);

    return enabled && payload != null;
}
