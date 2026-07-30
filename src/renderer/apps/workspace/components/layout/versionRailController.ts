/**
 * Module-level bridge to the mounted version rail, so surfaces outside its tree can open it.
 *
 * The status-bar cell and the top-bar widget both promise "click to open the rail", and neither is a
 * child of it - the rail is a column in the dock row, the widget is in the title bar, the cell is in
 * the status strip. Same pattern and same reasoning as {@link openKeybindingCheatSheet} and
 * `commandPaletteController`: one window-local function pointer, deliberately not a service, dead once
 * the layout unmounts.
 *
 * Nothing here holds the rail's state. The rail owns it (and persists it), which is what keeps the
 * expanded/collapsed decision in one place instead of two that can disagree.
 */

export interface VersionRailBridge {
    /** Expand the rail. Idempotent: already-expanded is a no-op, not a toggle. */
    open: () => void;
    /** Collapse it back to the 48px indicator strip. */
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
