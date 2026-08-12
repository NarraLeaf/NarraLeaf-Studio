/**
 * When a window that keeps dying stops being offered a reload.
 *
 * Shared between Studio and the game runtime rather than written twice: both make the same offer
 * for the same reason, and two copies of "three times in a minute" would drift into two different
 * answers to the same question.
 */

/** Crashes further apart than this are separate incidents, not one loop. */
export const CRASH_LOOP_WINDOW_MS = 60_000;

/** How many crashes inside that window before reloading stops being offered. */
export const CRASH_LOOP_LIMIT = 3;

/**
 * Add a crash to a window's history and drop the ones that have aged out.
 *
 * Returns a new array rather than mutating: the caller keeps one per window, and a shared array
 * quietly counting another window's crashes is exactly how a working window would stop offering
 * to reload.
 */
export function recordCrash(history: readonly number[], now: number): number[] {
    return [...history, now].filter(at => now - at < CRASH_LOOP_WINDOW_MS);
}

/**
 * Whether reloading has stopped being worth offering.
 *
 * A window that has died three times in a minute is not going to survive a fourth reload, and each
 * offer costs another dialog. Below the limit the answer is always to offer it: most renderer
 * deaths are a single page running out of memory, and it comes back fine.
 */
export function isCrashLooping(history: readonly number[]): boolean {
    return history.length >= CRASH_LOOP_LIMIT;
}
