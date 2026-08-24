/**
 * Keeping the browser's Back out of a running playthrough.
 *
 * A game served as a page occupies one history entry, and the player's Back - a browser's back
 * button, a swipe from the edge of a phone screen, a mouse's fourth button - leaves it. Nothing
 * about that is recoverable: the page is gone, and with it every line since the last save. It is
 * the one navigation a page can reliably catch, unlike the tab being closed (see
 * `capabilities.closeRequested`, which says out loud that the shell cannot answer for that one).
 *
 * Which host it actually reaches: the web target. The iOS shell has no back gesture to catch, and
 * the Android shell's activity never asks the WebView about its history - its own Back finishes the
 * app outright, so a page cannot see it at all, let alone refuse it. That is the shell template's
 * to fix, not this file's; here the guard simply costs those two hosts nothing.
 *
 * The guard is an extra history entry this page owns. Back consumes it, the pop puts the entry
 * straight back, and the player stays where they were. What it costs is Back as a way out of the
 * game: leaving is closing the tab, or the browser's own history list, which a long press still
 * opens. That is the same trade the desktop shell makes by asking before it closes.
 *
 * A separate module rather than a few lines inside `web.ts`, which installs itself on `window` at
 * import and so cannot be brought into a test.
 *
 * Comments in English per project convention.
 */

/** Marks the entry this page pushed, so a reload does not stack a second one. */
export const HISTORY_GUARD_STATE_KEY = "nlsGameHistoryGuard";

export interface HistoryGuardHost {
    /** `history.state` - what this page last put on the current entry, if anything. */
    readState(): unknown;
    /** `history.pushState(state, "")`, leaving the URL alone. */
    pushState(state: unknown): void;
    onPopState(listener: () => void): void;
    /** Said once, for the author reading a console and wondering why Back does nothing. */
    log(message: string): void;
}

function isGuardState(state: unknown): boolean {
    return typeof state === "object"
        && state !== null
        && (state as Record<string, unknown>)[HISTORY_GUARD_STATE_KEY] === true;
}

export function installHistoryGuard(host: HistoryGuardHost): void {
    const push = (): void => host.pushState({ [HISTORY_GUARD_STATE_KEY]: true });
    // A reload lands back on the entry this pushed, state and all, so asking first is what keeps a
    // player who reloads ten times from having to press Back ten times.
    if (!isGuardState(host.readState())) {
        push();
    }
    let reported = false;
    host.onPopState(() => {
        push();
        if (!reported) {
            reported = true;
            host.log("Back was ignored: it would leave the running game. Close the tab to exit.");
        }
    });
}
