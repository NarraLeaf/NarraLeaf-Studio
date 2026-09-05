import type { Stats } from "fs";

/**
 * Telling a file that was edited from a file that was only read, for the watchers that relaunch a
 * running game when the project changes.
 *
 * A directory watch reports a last-access-time update as a change, and NTFS updates access times by
 * default, so *reading* a file looks exactly like editing one at the event level. The running game
 * reads every asset it preloads, a preview copies every asset it ships, and the Assets panel reads
 * whatever it draws a thumbnail for - so a session that was doing nothing but running kept
 * scheduling reloads of itself, each one costing about nine seconds on a medium project. The reload
 * then re-read the files, which produced the next round of events.
 *
 * What decides instead is the pair an author can actually change: an edit moves the modification
 * time or the size, and reading a file moves neither. Both watchers need `alwaysStat` for it, and
 * both keep the identity of every file they have accepted an event for.
 *
 * Comments in English per project convention.
 */

/** What a watched file looks like right now, or null when the watcher reported no stats. */
export function watchedFileIdentity(stats?: Pick<Stats, "mtimeMs" | "size">): string | null {
    return stats && typeof stats.mtimeMs === "number" && typeof stats.size === "number"
        ? `${stats.mtimeMs}:${stats.size}`
        : null;
}

/**
 * Record what a file looks like without treating it as a change.
 *
 * For the `add` events a watcher reports: the reload they schedule is already decided, and what
 * this leaves behind is the baseline the next `change` event on that file is measured against.
 */
export function rememberWatchedFile(
    identities: Map<string, string>,
    file: string,
    stats?: Pick<Stats, "mtimeMs" | "size">,
): void {
    const identity = watchedFileIdentity(stats);
    if (identity) {
        identities.set(file, identity);
    }
}

/**
 * Whether a `change` event is about the file's contents rather than about when it was last read.
 *
 * A file whose identity is unknown - no stats, or one this watch has not seen before - counts as
 * changed. Missing a real edit leaves the author running a game that is not their script, while an
 * extra reload only costs time.
 */
export function watchedFileChanged(
    identities: Map<string, string>,
    file: string,
    stats?: Pick<Stats, "mtimeMs" | "size">,
): boolean {
    const identity = watchedFileIdentity(stats);
    if (!identity) {
        return true;
    }
    const previous = identities.get(file);
    identities.set(file, identity);
    return previous !== identity;
}
