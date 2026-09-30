import path from "path";

/** The file itself, directly under the profile. Exported so a test names it the way Studio does. */
export const SESSION_MARKER_FILE = "session.running";

/** Everything marking a session does to the world, so a test can stand in for all of it. */
export interface SessionMarkerHost {
    exists(file: string): boolean;
    /** Creates the containing folder if it is not there. Throws on failure. */
    write(file: string, text: string): void;
    remove(file: string): void;
    warn(message: string, error?: unknown): void;
    /** Electron's `will-quit`. Not `before-quit`; see below. */
    onWillQuit(handler: () => void): void;
    now(): Date;
}

export interface SessionMarkerFacts {
    userDataDir: string;
    /**
     * Whether this launch leaves a marker at all - false for a command-line run. See
     * `startupExtras.ts` for why a run neither writes one nor reads the one it finds.
     */
    wanted: boolean;
}

/**
 * Leave a file behind for as long as this session is running, and find out whether the last one
 * managed to remove its own.
 *
 * The failures worth knowing about are the ones that write nothing: a process killed by the system,
 * a native fault below JavaScript, a machine that lost power. All of them leave a log that simply
 * stops, which reads the same as a clean quit. This is the one line that tells the two apart, and it
 * is in the log every support bundle carries.
 *
 * Best-effort throughout. A profile directory that cannot be written is a problem for other reasons,
 * and none of them are made better by refusing to start.
 *
 * Returns the marker's path when one was left, for a caller that wants to say so; null otherwise.
 */
export function markSessionRunning(facts: SessionMarkerFacts, host: SessionMarkerHost): string | null {
    if (!facts.wanted) {
        return null;
    }
    const marker = path.join(facts.userDataDir, SESSION_MARKER_FILE);
    try {
        if (host.exists(marker)) {
            host.warn(
                "[Crash] The previous session did not shut down cleanly."
                + " Anything it had not written to disk was lost.",
            );
        }
        host.write(marker, host.now().toISOString());
    } catch (error) {
        host.warn("[Crash] Could not record the session marker:", error);
        return null;
    }

    // `will-quit` rather than `before-quit`: the latter fires on quits that are still cancellable,
    // and removing the marker there would call a cancelled quit a clean exit.
    host.onWillQuit(() => {
        try {
            host.remove(marker);
        } catch (error) {
            host.warn("[Crash] Could not clear the session marker:", error);
        }
    });
    return marker;
}
