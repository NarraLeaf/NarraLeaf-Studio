/**
 * Module-level bridge to the mounted Team cell in the status bar, so surfaces outside its tree can
 * open its panel.
 *
 * Same pattern and same reasoning as `versionRailController`: one window-local function pointer,
 * deliberately not a service, dead once the status bar unmounts. It exists because the panel is
 * anchored to a cell in the bottom-left corner and the things that send an author there - a rail
 * that was refused for want of a token, a command in the palette - are nowhere near it.
 *
 * Nothing here holds the panel's state. The cell owns it, which is what keeps "is it open" in one
 * place instead of two that can disagree.
 */

export interface TeamPresenceBridge {
    /** Open the panel. Idempotent: already-open is a no-op, not a toggle. */
    open: () => void;
}

let bridge: TeamPresenceBridge | null = null;

/** Called by the mounted cell; returns an unregister disposer. */
export function registerTeamPresenceBridge(next: TeamPresenceBridge): () => void {
    bridge = next;
    return () => {
        if (bridge === next) {
            bridge = null;
        }
    };
}

/**
 * Open the Team panel.
 *
 * A no-op before the status bar has mounted, and also on a project with no repository - the cell
 * registers a bridge exactly while it is drawn, so a stale caller cannot conjure a panel for a
 * project that has no destination to manage.
 */
export function openTeamPresence(): void {
    bridge?.open();
}

/** Whether there is a panel to open at all. */
export function isTeamPresenceReachable(): boolean {
    return bridge !== null;
}
