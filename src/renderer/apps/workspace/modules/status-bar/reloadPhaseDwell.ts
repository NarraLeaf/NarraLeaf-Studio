import type { DevModeStatus } from "@shared/types/devMode";

/**
 * The shortest time the run cell reads "Reloading" for one hot reload.
 *
 * A reload of a small project is over in a few tens of milliseconds - a skeleton project measured
 * 38 ms from the change being noticed to the new bundle being sent. Shown for exactly that long the
 * phase is a flicker in the status bar rather than something an author can read, so the cell keeps
 * it on screen this long at the least. A reload that takes longer shows for as long as it takes.
 */
export const RELOAD_PHASE_MIN_MS = 500;

/**
 * How much longer the cell should keep reading "Reloading" now that the session has left it.
 *
 * Only a reload that ended in the running state is held: one that failed or was stopped says so at
 * once, because the cell would otherwise be reporting work on a session that is no longer there.
 */
export function reloadPhaseHoldMs(next: DevModeStatus, reloadStartedAt: number | null, now: number): number {
    if (reloadStartedAt === null || next !== "running") {
        return 0;
    }
    return Math.max(0, RELOAD_PHASE_MIN_MS - (now - reloadStartedAt));
}
