/**
 * A story action the story waits for: the engine action a row compiles to when what it runs is
 * asynchronous and the next row must not start until it has finished.
 *
 * # Why a Service and not a Script
 *
 * NarraLeaf-React's `Script` handler is synchronous - it may return a cleaner, never a promise - so a
 * row compiled to one starts its work and the story moves on at once. The engine's `Service` is the
 * one primitive whose handler may be `async`: `ServiceSkeleton.triggerAction` turns an async handler
 * into an `Awaitable` the stack waits on, exactly as it waits on a line of dialogue. Three properties
 * of that path are what make it the right one rather than merely a working one:
 *
 *  - **A save taken while it waits replays it.** The stack serializes the action it is waiting on
 *    (`waitingAction`), never the awaitable, so loading that save runs the row again from the start
 *    instead of resuming past it with nothing on screen.
 *  - **Rollback and load cancel it.** Undoing past the row aborts the stack top, and a load resets
 *    the stack, which aborts every pending awaitable. Both reach the handler through `onAbort`, which
 *    is where the {@link AbortSignal} handed to `run` is aborted.
 *  - **Skipping does not pass it.** A skip is a broadcast that dialogue and transitions honour; a
 *    service awaitable does not listen to it, so a held skip key stops at the row the way it stops at
 *    a choice. That is the right reading of a row that is waiting for the player.
 *
 * # The handler must be an `async` function
 *
 * The engine tells an async handler from a sync one by its constructor (`isAsyncFunction`), not by
 * what it returns. A plain function returning a promise would be run and then not waited for - the
 * very behaviour this module exists to remove. The handler below is written `async` for that reason,
 * and a test pins it, so a change of build target that downlevels async functions fails loudly.
 *
 * # Errors
 *
 * `run` never rejects into the engine. The engine chains only `.then` onto the handler's promise, so
 * a rejection would leave the awaitable unsettled and the story stopped for good on a row that has
 * already failed. A failure is reported through `onError` and the story carries on.
 *
 * Under `@/lib/ui-editor/` so the standalone game runtime bundle includes it (see
 * `project/build/build-runtime.js` allowedPrefixes).
 */

import { Service, type ScriptCtx, type ServiceHandlerCtx } from "narraleaf-react";

/** The asynchronous body of an awaited row. Resolving it lets the story continue. */
export type StoryAwaitedRun = (ctx: ScriptCtx, signal: AbortSignal) => Promise<void>;

export type StoryAwaitedActionInput = {
    run: StoryAwaitedRun;
    /** Called with what `run` threw, unless it threw because `signal` was aborted. */
    onError?: (error: unknown) => void;
};

type StoryAwaitContent = {
    run: [input: StoryAwaitedActionInput];
};

/**
 * The service an awaited row triggers. It holds no state of its own, so there is nothing for a save
 * to serialize and it is never registered with the story: a trigger only needs the instance as its
 * callee.
 */
class StoryAwaitService extends Service<StoryAwaitContent, null> {
    constructor() {
        super();
        this.on("run", runAwaited);
    }

    serialize(): null {
        return null;
    }

    deserialize(): void {
        // Nothing was saved.
    }
}

/**
 * The handler behind every awaited row. `async` on purpose: see the header.
 *
 * Exported for the test that pins that property; nothing else should call it.
 */
export async function runAwaited(ctx: ServiceHandlerCtx, input: StoryAwaitedActionInput): Promise<void> {
    const abort = new AbortController();
    ctx.onAbort(() => abort.abort());
    try {
        await input.run(ctx, abort.signal);
    } catch (error) {
        if (!abort.signal.aborted) {
            input.onError?.(error);
        }
    }
}

/**
 * Build the engine action for one awaited row.
 *
 * One service per row: the instance is a stateless callee, and keeping it per row means no compile
 * shares an engine element with another (a Dev Mode recompile, a second preview).
 */
export function createStoryAwaitedAction(input: StoryAwaitedActionInput): unknown {
    // `unknown`, as every compiled statement is to the story compiler: the engine's chain types are
    // not part of what this module promises.
    return new StoryAwaitService().trigger("run", input);
}
