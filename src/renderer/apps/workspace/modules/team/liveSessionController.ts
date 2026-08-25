/**
 * Module-level bridge to the mounted collaboration control, so surfaces outside its tree can open
 * the session dialog.
 *
 * Same pattern and same reasoning as `teamPresenceController` and `versionRailController`: one
 * window-local function pointer, deliberately not a service, dead once the title bar unmounts. It
 * exists because the dialog belongs to a control in the title bar while the things that send an
 * author to it are elsewhere - the collaboration panel in the right dock, and the frozen strip on
 * the far left, which is the one part of the window that is always visible during a session.
 *
 * Nothing here holds the dialog's state. The control owns it, which keeps "is it open" in one place
 * rather than two that can disagree.
 */

export interface LiveSessionDialogBridge {
    /** Open the dialog. Idempotent: already-open is a no-op, not a toggle. */
    open: () => void;
}

let bridge: LiveSessionDialogBridge | null = null;

/** Called by the mounted control; returns an unregister disposer. */
export function registerLiveSessionBridge(next: LiveSessionDialogBridge): () => void {
    bridge = next;
    return () => {
        if (bridge === next) {
            bridge = null;
        }
    };
}

/**
 * Open the live session dialog.
 *
 * A no-op before the title bar has mounted, and on a project that points at no server - the control
 * registers a bridge exactly while it is drawn, so a stale caller cannot conjure a dialog for a
 * project with no collaboration to describe.
 */
export function openLiveSessionDialog(): void {
    bridge?.open();
}
