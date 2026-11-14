/**
 * How a surface outside the layout opens a team project's history.
 *
 * The history's folded state is owned by `WorkspaceLayout`, whose dock account includes its width,
 * so the title bar's account menu cannot set it directly. The layout registers how to open it while
 * a team project is followed, and the menu asks through here.
 */
export interface TeamHistoryBridge {
    /** Unfold the history. Already open is a no-op. */
    open: () => void;
}

let bridge: TeamHistoryBridge | null = null;

export function registerTeamHistoryBridge(next: TeamHistoryBridge): () => void {
    bridge = next;
    return () => {
        if (bridge === next) {
            bridge = null;
        }
    };
}

export function openTeamHistory(): void {
    bridge?.open();
}

export function isTeamHistoryReachable(): boolean {
    return bridge !== null;
}
