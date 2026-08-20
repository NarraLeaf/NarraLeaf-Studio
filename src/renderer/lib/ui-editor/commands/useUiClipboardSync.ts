import { useEffect } from "react";
import { refreshUiClipboardFromSystem } from "./uiEditorClipboardBridge";

/**
 * Keep this window's interface clipboard level with the machine's.
 *
 * On mount and whenever the window comes forward, which between them cover every way a selection
 * copied in another project can arrive: the author copies over there, switches here, and pastes.
 * The read is what makes the "Paste" row in the canvas and outline menus tell the truth - those ask
 * a synchronous question of the in-window clipboard, and without this a window that had copied
 * nothing itself would offer a greyed row over a clipboard that does hold a selection.
 *
 * Cheap enough to run on every focus: one round trip to the main process, answered from memory.
 */
export function useUiClipboardSync(enabled: boolean): void {
    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        const refresh = () => {
            void refreshUiClipboardFromSystem();
        };
        refresh();
        window.addEventListener("focus", refresh);
        return () => window.removeEventListener("focus", refresh);
    }, [enabled]);
}
