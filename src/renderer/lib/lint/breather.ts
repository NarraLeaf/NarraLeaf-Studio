/**
 * A pause a long rule takes now and then, so the window it runs in keeps answering.
 *
 * The engine yields between rules, which is enough for nearly all of them: most take a millisecond
 * or two even on a large project. A few walk the story the way the game would, and one of those ran
 * for a second and a half in one piece on a measured 20,000-row project - while the project checks
 * run in the background after every pause in editing, so that was a window frozen for a second and a
 * half each time the author stopped typing. A rule like that takes a breather between steps: when
 * more than {@link LINT_SLICE_MS} has passed since the last one, it gives the event loop a turn.
 *
 * The turn is a message-channel task rather than a timer, for the reason `engine.ts` gives: a timer
 * in a window that is not in front is throttled to once a second, and to once a minute after five
 * minutes, which would stretch a background sweep from seconds to hours.
 */

/** How long a rule may run before it gives the event loop a turn. About two frames. */
export const LINT_SLICE_MS = 30;

export interface LintBreather {
    /** Resolves at once while the slice lasts, and after a turn of the event loop once it has run out. */
    breathe(): Promise<void>;
}

export function createLintBreather(sliceMs: number = LINT_SLICE_MS): LintBreather {
    let sliceStartedAt = now();
    return {
        async breathe() {
            if (now() - sliceStartedAt < sliceMs) {
                return;
            }
            await yieldToEventLoop();
            sliceStartedAt = now();
        },
    };
}

function now(): number {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

/** One turn of the event loop, without a timer. See the note at the top of this file. */
export function yieldToEventLoop(): Promise<void> {
    if (typeof MessageChannel !== "function") {
        return new Promise(resolve => setTimeout(resolve, 0));
    }
    return new Promise(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            resolve();
        };
        channel.port2.postMessage(undefined);
    });
}
