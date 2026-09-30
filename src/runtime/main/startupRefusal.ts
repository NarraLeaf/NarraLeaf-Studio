import { GAME_EXIT_CODES } from "./gameExitCodes";
import type { RuntimeLogSink } from "./runtimeLog";

/**
 * How a game that will not start says so.
 *
 * A launch that stops before the game runs used to quit the ordinary way, and an ordinary quit ends
 * with exit code 0 - the code of a game that ran and was closed. A shipped game also keeps its
 * console to itself unless asked (see `runtimeConsole`), so a launch refused for a switch it does not
 * accept left nothing at all: no window, empty stdout and stderr, success. The one explanation was a
 * line in the game's log file under the player's profile, and every launcher, storefront and script
 * that started the game counted the launch as a success.
 *
 * Every way a launch is refused now ends here, and all of them end the same way:
 *
 *  - the reason goes to the game's log file, as it always did - and only there, not also to the
 *    console the log sink mirrors to where one is live, which would put a second copy on stderr;
 *  - the same reason goes to standard error as one line, written straight to the file descriptor so
 *    that the silenced console does not swallow it and so that it is on its way before the process
 *    is - which, before the app is ready, is immediately;
 *  - the process exits with a code that is not 0, one per kind of refusal (see
 *    {@link STARTUP_EXIT_CODES}, and `GAME_EXIT_CODES` for every code the game ends with), so a
 *    script can tell them apart without reading anything.
 *
 * The line carries the reason and nothing else - not the tag the log sink puts on console output,
 * which names the engine. For a command line it names the arguments that were refused, which the
 * caller wrote themselves; what the game does accept is never printed.
 *
 * A player who opened the game from a shortcut sees no standard error. What they are shown, if
 * anything, is the caller's business (`tellPlayer`), and is shown after the line is out: a native box
 * waits for a click, and a script reading stderr should not have to.
 *
 * Comments in English per project convention.
 */

/**
 * The exit code of each kind of launch that did not start - the rows of `GAME_EXIT_CODES` that are
 * about a launch, which is where every code the game ends with is listed.
 *
 * Not 0 for any of them, which is the whole point. `2` for the command line follows the long
 * convention for a usage error.
 */
export const STARTUP_EXIT_CODES = {
    /** The game's own content could not be opened or read, or no window could be set up from it. */
    failed: GAME_EXIT_CODES.failedToStart,
    /** The command line carries something this build does not accept. */
    commandLine: GAME_EXIT_CODES.commandLineRefused,
    /** The game's content was written by a newer Studio than this build can read. */
    contentTooNew: GAME_EXIT_CODES.contentTooNew,
} as const;

export type StartupRefusalKind = keyof typeof STARTUP_EXIT_CODES;

export interface StartupRefusal {
    kind: StartupRefusalKind;
    /** Why, in one line: what the log states and what standard error carries. */
    reason: string;
    /** More for the log alone - a stack, say. Never written to standard error. */
    detail?: string;
    /** Put the refusal in front of the player, if this one should be. Runs after the line is out. */
    tellPlayer?: () => void;
}

/** What {@link refuseToStart} needs from the process. Structural so a test can stand in for it. */
export interface StartupRefusalHost {
    log: RuntimeLogSink;
    /** Write to the process's standard error directly, past any silencing of `console`. */
    writeStandardError(text: string): void;
    /** `app.exit(code)`: immediate before the app is ready, and without `before-quit` after. */
    exit(code: number): void;
}

/** Collapse whatever a reason turned out to hold into the single line it is promised to be. */
export function startupRefusalLine(reason: string): string {
    return reason.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/**
 * Stop the launch: log it, say it on standard error, let the caller tell the player, exit.
 *
 * Every step after the log is guarded on its own. A game started with no standard error at all (a
 * GUI launch on Windows has none), or a dialog that could not be drawn, must still end with the code
 * that says it did not start - an exit that is skipped leaves a process with no window running for
 * nobody.
 */
export function refuseToStart(host: StartupRefusalHost, refusal: StartupRefusal): void {
    const line = startupRefusalLine(refusal.reason);
    // To the file only. Where the console is live the sink would also print the line, tagged, and the
    // write below would print it again: two lines for one refusal on the stream a script reads.
    host.log("error", refusal.detail ? `${line}\n${refusal.detail}` : line, { console: false });
    try {
        host.writeStandardError(`${line}\n`);
    } catch {
        // Nothing attached to write to. The log has it.
    }
    if (refusal.tellPlayer) {
        try {
            refusal.tellPlayer();
        } catch {
            // Telling the player is a courtesy; exiting with the right code is not.
        }
    }
    host.exit(STARTUP_EXIT_CODES[refusal.kind]);
}
