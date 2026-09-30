/**
 * When a game started, as the process that started it saw it.
 *
 * A page's performance timeline begins at the page: `performance.timeOrigin` is the moment its
 * document started loading, and every mark the game writes is measured from there. That hides the
 * part of a launch a player waits through first - Electron coming up, the shell reading its pack,
 * the window being made - because none of it happens in the page. Only the process that did it
 * knows when it happened, so it says so once, and the page puts it on its own timeline as the
 * `nl.launch` mark (see the renderer's `gameTimeline`).
 *
 * Wall-clock milliseconds since the Unix epoch throughout, because that is the only clock two
 * processes share. The page converts with `performance.timeOrigin`, which is on the same clock.
 *
 * Comments in English per project convention.
 */

/**
 * What the zero of a launch timeline is.
 *
 * - `process` - the game's own process was created. A packaged game and a preview.
 * - `devMode` - an author asked Studio to run the game. The process is Studio's and has been up for
 *   hours; the moment the run was asked for is the only zero that describes this run.
 */
export type GameLaunchOrigin = "process" | "devMode";

/**
 * A moment between the zero and the page, named by what happened then.
 *
 * - `appReady` - Electron finished starting and the shell began its own work.
 * - `windowCreated` - the window the game draws in exists and its page has been asked for.
 */
export type GameLaunchMilestoneName = "appReady" | "windowCreated";

export type GameLaunchMilestone = {
    name: GameLaunchMilestoneName;
    /** Wall-clock milliseconds since the Unix epoch. */
    at: number;
};

export type GameLaunchTiming = {
    origin: GameLaunchOrigin;
    /** The zero, in wall-clock milliseconds since the Unix epoch. */
    zero: number;
    /** In the order they happened. Never includes the page itself, which the page knows better. */
    milestones: GameLaunchMilestone[];
};

const MILESTONE_NAMES: ReadonlySet<string> = new Set<GameLaunchMilestoneName>(["appReady", "windowCreated"]);

function isEpochMs(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Take a launch timing apart from wherever it travelled, or null when it is not one.
 *
 * Strict about the zero and forgiving about the rest: a timeline with no zero has nothing to be
 * placed against, while one milestone that did not survive the trip costs only that milestone.
 */
export function normalizeGameLaunchTiming(value: unknown): GameLaunchTiming | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    const origin = record.origin === "process" || record.origin === "devMode" ? record.origin : null;
    if (!origin || !isEpochMs(record.zero)) {
        return null;
    }
    const zero = record.zero;
    const milestones: GameLaunchMilestone[] = [];
    if (Array.isArray(record.milestones)) {
        for (const item of record.milestones) {
            const entry = item as Record<string, unknown> | null;
            if (
                entry
                && typeof entry.name === "string"
                && MILESTONE_NAMES.has(entry.name)
                && isEpochMs(entry.at)
                && entry.at >= zero
            ) {
                milestones.push({ name: entry.name as GameLaunchMilestoneName, at: entry.at });
            }
        }
    }
    milestones.sort((a, b) => a.at - b.at);
    return { origin, zero, milestones };
}
