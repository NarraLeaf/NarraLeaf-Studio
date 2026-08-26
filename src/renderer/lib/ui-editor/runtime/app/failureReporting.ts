/**
 * A runtime failure on its way to whoever has to fix it, and the escapes it can take to avoid that
 * journey.
 *
 * Two halves, kept together because one exists for the other:
 *
 *  - {@link reportRuntimeFailure} is the shape of a report: the console line AND, for a host that
 *    can point into the author's story, the located issue. Both, always. The console line is what a
 *    packaged build has, and dropping it would trade one blind spot for another.
 *  - {@link watchUncaughtFailures} is how a failure that never passed a call site we wrap gets
 *    reported anyway. The engine drives a story line from inside its own `Player`: a click on the
 *    stage reaches `liveGame.next()` through a plain DOM listener, and a session's first advance
 *    through a microtask. Neither is a React render, so neither is caught by the `Player`'s error
 *    boundary — which is the thing that feeds `NlrStageLayer`'s `onError`, and therefore the only
 *    route a throw had into a report. A row that threw while it played simply froze the stage and
 *    left one `Uncaught` line in a console nobody had open.
 *
 * React- and DOM-free at the seams (the target and the events are structural) so both halves can be
 * driven by hand in a test, which is the only way to reach them: `GameApp` is not rendered anywhere.
 */

import type { GameAppRuntimeIssue } from "./GameAppHost";

/** The console line: the stack when there is one, because a console reader wants the frames. */
export function normalizeError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack ?? error.message;
    }
    return String(error);
}

/**
 * The sentence a failure states, without the stack.
 *
 * `normalizeError` prefers the stack, which is right for a console line and wrong for anything shown
 * to an author: the first thing they should read is what went wrong, not which of our frames noticed.
 * The stack still travels, next to it rather than instead of it (see {@link GameAppRuntimeIssue}).
 */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message || String(error) : String(error);
}

export function errorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack ?? undefined : undefined;
}

/**
 * The two channels a host offers a failure.
 *
 * Structurally a slice of `GameAppHost`, so the host itself is passed straight in. `reportIssue` is
 * optional there and stays optional here: a shell with no authoring surface — the packaged game —
 * really does have nowhere to show an issue, and gets the log line alone.
 */
export type FailureChannels = {
    log: (level: "error", message: string) => void;
    reportIssue?: (issue: GameAppRuntimeIssue) => void;
};

export type RuntimeFailureOptions = {
    /** Prepended to both channels, for a call site that knows what it was attempting. */
    prefix?: string;
    /**
     * The story row to blame, when one can be worked out. Absent makes the report `session`, which
     * is the honest origin for a failure with nothing running behind it — see
     * {@link GameAppRuntimeIssue}. Never guessed here: the caller owns the play head.
     */
    blockId?: string;
};

/** Log a failure AND, for a host that can point into the story, say where it came from. */
export function reportRuntimeFailure(
    channels: FailureChannels,
    error: unknown,
    options?: RuntimeFailureOptions,
): void {
    const prefix = options?.prefix ?? "";
    channels.log("error", `${prefix}${normalizeError(error)}`);
    const blockId = options?.blockId;
    const stack = errorStack(error);
    channels.reportIssue?.({
        level: "error",
        message: `${prefix}${errorMessage(error)}`,
        origin: blockId ? "playHead" : "session",
        ...(blockId ? { blockId } : {}),
        ...(stack ? { stack } : {}),
    });
}

/**
 * The half of `window` this listens on. Structural so a test needs no DOM, and narrow so it cannot
 * quietly grow into a second place that touches the page.
 */
export type UncaughtFailureTarget = {
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
};

/** The half of `ErrorEvent` a report is built from. */
type UncaughtErrorEvent = {
    error?: unknown;
    message?: string;
    filename?: string;
    lineno?: number;
    colno?: number;
};

/**
 * What actually threw.
 *
 * `event.error` is the thrown value and is what a report wants. It is null for a script error the
 * page is not allowed to see into (a cross-origin script), where `event.message` and the location
 * are the whole of what the browser will say — so an Error is built from those rather than
 * reporting the word "null" to an author.
 */
function uncaughtValue(event: UncaughtErrorEvent): unknown {
    if (event.error !== null && event.error !== undefined) {
        return event.error;
    }
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
    return new Error(`${event.message || "Uncaught error"}${where}`);
}

/**
 * Report the two failures React never sees: a throw that reached the top of the stack, and a promise
 * nobody attached a catch to. Both are escape routes out of the engine — the first is a click on the
 * stage advancing a row that throws, the second is a session's first advance, which the engine
 * schedules on a microtask with nothing attached to it.
 *
 * Purely an observer. It never calls `preventDefault`, so the browser still prints the throw with
 * its stack exactly as it did before, and it never touches the stage: a stage frozen where the
 * failure left it is the honest picture, and is where an author wants to look. Returns the teardown.
 *
 * `addEventListener`, not `window.onerror =`: the property form is a single slot, and assigning it
 * would silently unseat whatever else the window had already put there.
 */
export function watchUncaughtFailures(
    target: UncaughtFailureTarget,
    report: (error: unknown) => void,
): () => void {
    /**
     * A reporter that throws must not replace the failure it was reporting - and here it would do
     * worse than that: a throw raised inside an `error` listener is itself an uncaught error, which
     * this same listener is then handed. One bad report would become a loop.
     */
    const publish = (error: unknown): void => {
        try {
            report(error);
        } catch {
            /* Nothing left to report it to; the browser's own console line still stands. */
        }
    };
    const onError = (event: Event): void => {
        publish(uncaughtValue(event as unknown as UncaughtErrorEvent));
    };
    const onRejection = (event: Event): void => {
        publish((event as unknown as { reason?: unknown }).reason);
    };
    target.addEventListener("error", onError);
    target.addEventListener("unhandledrejection", onRejection);
    return () => {
        target.removeEventListener("error", onError);
        target.removeEventListener("unhandledrejection", onRejection);
    };
}
