import type { GameTestEvent } from "@shared/types/gameTest";

import type { RuntimeLogSink } from "./runtimeLog";

/**
 * Where an error nobody caught in the game's main process goes.
 *
 * Two kinds reach nothing on their own, and both were measured on Electron 38 rather than assumed
 * from Node:
 *
 *  - **An exception nobody caught.** Node's default would end the process, but Electron registers an
 *    `uncaughtException` listener of its own in the main process: it shows a box headed "A JavaScript
 *    error occurred in the main process" with the stack in it, and the process carries on. The game
 *    observes these with `uncaughtExceptionMonitor`, which adds a record and the game's own box
 *    without taking over from Electron's listener.
 *  - **A promise rejection nobody handled.** Electron runs its main process in Node's `warn` mode:
 *    the rejection is printed as a Node warning on stderr - which a shipped game has nobody reading -
 *    and is not raised as an exception, so the monitor never sees it. It used to be believed that it
 *    was (Node's own default raises it), and so these went unrecorded: no line in `game.log`, no
 *    report to a test watching the game.
 *
 * A rejection is recorded here and is not fatal. It is almost always one operation that failed -
 * a write the player's disk refused, a sidecar that did not answer, a window that closed while
 * something was being done to it - and the process it happened in has not been left half-way through
 * anything the way a synchronous throw can leave it. Ending the game over one would throw away the
 * playthrough in front of the player to report a failure they may never have noticed, which is a
 * worse outcome than the failure. Studio's own main process makes the same call for the same reason.
 * Electron makes it too, and this keeps it, only now with the record it was missing and without the
 * warning text on stderr.
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
    /** `process.on`, for the two events this listens to. */
    on(event: "uncaughtExceptionMonitor", listener: (error: unknown, origin?: string) => void): void;
    on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
    log: RuntimeLogSink;
    /** Hand a `runtime-error` to a test that is watching; does nothing when none is. */
    emitTestEvent(event: GameTestEvent): void;
    /** Tell the player the game is going down (the native box). Called for exceptions only. */
    reportFatal(headline: string): void;
}

/**
 * Put one error where it can be found: a test that is watching, and the game's log.
 *
 * The report to a test comes first, the log second, and anything shown to the player after both, so
 * the record survives even when drawing the box is what fails.
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
    // `[Crash]` for the kind that puts the fatal box up, `[Error]` for the kind the game carries on
    // through - somebody reading the log afterwards needs to know which one the player saw.
    host.log("error", `${rejection ? "[Error]" : "[Crash]"} ${headline}${described.stack ? `\n${described.stack}` : ""}`);
    return headline;
}

/**
 * Listen for both kinds, once, for the life of the process. See the file comment for what each does.
 *
 * The exception side stays a monitor: taking `uncaughtException` over would change what happens after
 * one, which is not this function's to decide. The rejection side has to be a listener - a monitor is
 * never called for one - and registering it is also what stops Node printing its warning.
 */
export function installMainProcessErrorReporting(host: MainProcessErrorHost): void {
    host.on("uncaughtExceptionMonitor", (error, origin) => {
        const headline = recordMainProcessError(
            host,
            error,
            origin === "unhandledRejection" ? "unhandledRejection" : "uncaughtException",
        );
        host.reportFatal(headline);
    });
    host.on("unhandledRejection", reason => {
        recordMainProcessError(host, reason, "unhandledRejection");
    });
}
