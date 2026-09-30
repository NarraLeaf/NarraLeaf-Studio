import type { GameTestEvent } from "@shared/types/gameTest";

import { GAME_EXIT_CODES } from "./gameExitCodes";
import type { RuntimeLogSink } from "./runtimeLog";

/**
 * What happens to an error nobody caught in the game's main process.
 *
 * Left to itself, Electron 38 does neither of the things one would expect from Node, and both were
 * measured rather than assumed:
 *
 *  - **An exception nobody caught** does not end the process. Electron registers an
 *    `uncaughtException` listener of its own in the main process, which shows a box headed "A
 *    JavaScript error occurred in the main process" with the stack in it - the engine's internals, in
 *    front of a player - and then carries on. The game used to observe these with a monitor and show
 *    its own box first, which says the game has to close; so the player read "the game has to close",
 *    then the stack, and then went on playing a game whose main process had been interrupted
 *    half-way through something, with nothing to say what state that had left it in.
 *  - **A promise rejection nobody handled** is printed as a Node warning on stderr - which a shipped
 *    game has nobody reading - and is not raised as an exception at all, so the monitor never saw it:
 *    no line in `game.log`, no report to a test watching the game.
 *
 * Both are now taken over here.
 *
 * **An exception ends the game, as the box always said it would.** It is recorded (`[Crash]` and the
 * stack in `game.log`, a `runtime-error` to a watching test); what the player would lose is written
 * out, with a budget so that a store that cannot finish does not hold the process; the game's own box
 * is shown, once; and the process exits with `GAME_EXIT_CODES.crashed`. Taking the event over also
 * silences Electron's stack box, whose listener stands aside once another one is registered. The
 * order - write, then tell, then go - is the one Studio's own main process uses when it crashes: the
 * box waits for a click, and nothing written after it is safe from a player who kills the process
 * instead of clicking. The same ending serves a game window that will not stay up (see
 * `windowCrashHandling`), through {@link createCrashTeardown}: one way for a running game to crash.
 *
 * **A rejection is recorded and is not fatal.** It is almost always one operation that failed - a
 * write the player's disk refused, a sidecar that did not answer, a window that closed while something
 * was being done to it - and the process it happened in has not been left half-way through anything
 * the way a synchronous throw can leave it. Ending the game over one would throw away the playthrough
 * in front of the player to report a failure they may never have noticed, which is a worse outcome
 * than the failure. Studio's own main process makes the same call for the same reason.
 *
 * Comments in English per project convention.
 */

/** An error described for a log line and a test report. */
export interface DescribedMainProcessError {
    message: string;
    stack?: string;
}

/** Read whatever was thrown or rejected into a message, and a stack when there is one. */
export function describeRuntimeError(error: unknown): DescribedMainProcessError {
    if (error instanceof Error) {
        return {
            message: error.message || String(error),
            ...(error.stack ? { stack: error.stack } : {}),
        };
    }
    return { message: String(error) };
}

/** What {@link installMainProcessErrorReporting} needs. Structural so a test can stand in for it. */
export interface MainProcessErrorHost {
    /** `process.on`, for the two events this takes over. */
    on(event: "uncaughtException", listener: (error: unknown) => void): void;
    on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
    log: RuntimeLogSink;
    /** Hand a `runtime-error` to a test that is watching; does nothing when none is. */
    emitTestEvent(event: GameTestEvent): void;
    /** End the game after a crash - the function {@link createCrashTeardown} returns. */
    endAfterCrash(headline: string): void;
}

/** What {@link createCrashTeardown} needs. Structural so a test can stand in for it. */
export interface CrashTeardownHost {
    log: RuntimeLogSink;
    /**
     * Write out what the player would otherwise lose - the save and persistence stores' pending
     * writes. Settles when they are on disk or have failed; never waited on for longer than
     * {@link crashFlushBudgetMs}.
     */
    flushForCrash(): Promise<unknown>;
    /** How long a crash waits for {@link flushForCrash} before it goes without it. */
    crashFlushBudgetMs: number;
    /** Tell the player the game is going down (the native box). Returns once they have seen it. */
    reportFatal(headline: string): void;
    /** End the process with this code, at once. */
    exit(code: number): void;
    /** How the crash waits out its budget. Replaceable so a test need not sit through it. */
    wait?(ms: number): Promise<void>;
}

/**
 * Put one error where it can be found: a test that is watching, and the game's log.
 *
 * The report to a test comes first and the log second, and anything shown to the player after both,
 * so the record survives even when drawing the box is what fails.
 *
 * @returns the one-line headline, for whatever is shown after.
 */
export function recordMainProcessError(
    host: Pick<MainProcessErrorHost, "log" | "emitTestEvent">,
    error: unknown,
    origin: "uncaughtException" | "unhandledRejection",
): string {
    const described = describeRuntimeError(error);
    const rejection = origin === "unhandledRejection";
    const headline = rejection ? `Unhandled rejection: ${described.message}` : described.message;
    host.emitTestEvent({
        kind: "runtime-error",
        scope: "main",
        message: headline,
        ...(described.stack ? { stack: described.stack } : {}),
    });
    // `[Crash]` for the kind that ends the game, `[Error]` for the kind it carries on through -
    // somebody reading the log afterwards needs to know which one the player saw.
    host.log("error", `${rejection ? "[Error]" : "[Crash]"} ${headline}${described.stack ? `\n${described.stack}` : ""}`);
    return headline;
}

function defaultWait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Take both events over, once, for the life of the process. See the file comment for what each does.
 *
 * Every exception is recorded, and every one asks for the game to end; the ending itself happens
 * once (see {@link createCrashTeardown}), so a second exception while the first is still ending the
 * game - the flush can fail in its own way, and so can drawing the box - changes nothing else.
 */
export function installMainProcessErrorReporting(host: MainProcessErrorHost): void {
    host.on("uncaughtException", error => {
        host.endAfterCrash(recordMainProcessError(host, error, "uncaughtException"));
    });
    host.on("unhandledRejection", reason => {
        recordMainProcessError(host, reason, "unhandledRejection");
    });
}

/**
 * The one way a game that has started ends when it has crashed: write out what can be written in the
 * budget, tell the player once, exit with `GAME_EXIT_CODES.crashed`.
 *
 * Returned as a function that ends the game the first time it is called and does nothing after, from
 * whichever source: an exception in this process, a game window that keeps dying or will not load
 * again. Two of them arriving together are still one flush, one box and one exit.
 */
export function createCrashTeardown(host: CrashTeardownHost): (headline: string) => void {
    let ending = false;
    return headline => {
        if (ending) {
            return;
        }
        ending = true;
        void endAfterCrash(host, headline);
    };
}

/** Write out what can be written in the budget, tell the player, and exit with the crash code. */
async function endAfterCrash(host: CrashTeardownHost, headline: string): Promise<void> {
    const wait = host.wait ?? defaultWait;
    let outcome: "written" | "timed-out" | "failed" = "failed";
    try {
        outcome = await Promise.race([
            Promise.resolve()
                .then(() => host.flushForCrash())
                .then(() => "written" as const, () => "failed" as const),
            wait(host.crashFlushBudgetMs).then(() => "timed-out" as const),
        ]);
    } catch {
        // A flush that could not even be asked for; the log line below says so.
    }
    try {
        host.log("error", outcome === "written"
            ? `[Crash] Closing the game (exit ${GAME_EXIT_CODES.crashed}); what was waiting to be saved was written first.`
            : outcome === "timed-out"
                ? `[Crash] Closing the game (exit ${GAME_EXIT_CODES.crashed}); gave up waiting ${host.crashFlushBudgetMs}ms for what was waiting to be saved.`
                : `[Crash] Closing the game (exit ${GAME_EXIT_CODES.crashed}); what was waiting to be saved could not be written.`);
    } catch {
        // The log is the one thing that already has the error; going on without this line is fine.
    }
    try {
        host.reportFatal(headline);
    } catch {
        // Telling the player is a courtesy; closing, as the box promises, is not.
    }
    host.exit(GAME_EXIT_CODES.crashed);
}
