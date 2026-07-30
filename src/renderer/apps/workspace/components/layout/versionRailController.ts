/**
 * Module-level bridge to the mounted version rail, so surfaces outside its tree can open it.
 *
 * The status-bar cell and the top-bar widget both promise "click to open the rail", and neither is a
 * child of it - the rail is a column in the dock row, the widget is in the title bar, the cell is in
 * the status strip. Same pattern and same reasoning as {@link openKeybindingCheatSheet} and
 * `commandPaletteController`: one window-local function pointer, deliberately not a service, dead once
 * the layout unmounts.
 *
 * **Load-bearing rather than convenient.** At HEAD there is no rail column at all, so these two are
 * the only ways in - and the commit form lives inside the rail's panel, on a surface that is read-only
 * by construction while a revision is being previewed. A rail reachable only from a preview would
 * leave commit with nowhere to live.
 *
 * Nothing here holds the rail's state. The rail owns it (and persists it), which is what keeps the
 * expanded/collapsed decision in one place instead of two that can disagree.
 */

export interface VersionRailBridge {
    /** Open the panel. Idempotent: already-open is a no-op, not a toggle. */
    open: () => void;
    /**
     * Close it: back to the 48px strip while the workspace is frozen, to nothing at HEAD - the rail is
     * a persistent column only while it has a temporary state to express (`resolveVersionRailPresence`).
     */
    collapse: () => void;
}

let bridge: VersionRailBridge | null = null;

/** Called by the mounted rail; returns an unregister disposer. */
export function registerVersionRailBridge(next: VersionRailBridge): () => void {
    bridge = next;
    return () => {
        if (bridge === next) {
            bridge = null;
        }
    };
}

/**
 * Open the version rail.
 *
 * A no-op before the layout has mounted, and also on a host with no version control at all - the rail
 * does not register a bridge there, so a stale caller cannot conjure a column that must not exist.
 */
export function openVersionRail(): void {
    bridge?.open();
}

export function collapseVersionRail(): void {
    bridge?.collapse();
}
