const MS_PER_SECOND = 1000;

/**
 * Story timings persist as milliseconds, but every author-facing surface — inspector fields,
 * slash commands, row summaries, the motion timeline — speaks seconds. These are the only
 * sanctioned crossings of that boundary; converting inline invites float noise and drift.
 */

/** Author-entered seconds → the millisecond value stored in the document. */
export function storySecondsToMs(seconds: number): number {
    return Math.round(seconds * MS_PER_SECOND);
}

/** Stored milliseconds → the seconds number shown to the author. */
export function storyMsToSeconds(ms: number): number {
    // Round first: 1ms is the finest value the store holds, and plain division
    // surfaces float noise (0.1 * 1000 === 100.00000000000001).
    return Math.round(ms) / MS_PER_SECOND;
}

/** Stored milliseconds → a bare seconds string for an input's committed display. Empty for absent values. */
export function formatStorySecondsValue(ms: number | undefined | null): string {
    if (ms === undefined || ms === null || !Number.isFinite(ms)) {
        return "";
    }
    return String(storyMsToSeconds(ms));
}

/** Stored milliseconds → a unit-suffixed seconds label for summaries and row subtitles, e.g. `0.5s`. */
export function formatStorySecondsLabel(ms: number | undefined | null): string {
    const value = formatStorySecondsValue(ms);
    return `${value === "" ? "0" : value}s`;
}
