import { describe, expect, it, vi } from "vitest";
import { createStoryAwaitedAction, runAwaited, type StoryAwaitedActionInput } from "./storyAwaitedAction";

/**
 * The awaited story action, driven through the engine's own action rather than a stand-in: what is
 * under test is that NarraLeaf-React waits on it, and only the engine can say that.
 *
 * A row is "waited on" when executing its action hands the stack an unsettled awaitable that settles
 * once `run` does. The fixture game state carries only what `Script.getCtx` reads.
 */

type EngineAwaitable = {
    isSettled(): boolean;
    abort(): void;
    then(callback: (value: unknown) => void): unknown;
};

const fakeGameState = {
    game: {
        getLiveGame: () => ({
            getStorable: () => ({ getNamespace: () => ({}) }),
        }),
    },
    logger: { warn: () => undefined },
    // A run waiting on its handler listens for the player skipping.
    events: { on: () => ({ cancel: () => undefined }) },
};

function execute(input: StoryAwaitedActionInput): EngineAwaitable {
    const chain = createStoryAwaitedAction(input) as unknown as { getActions(): Array<{ executeAction(...args: unknown[]): unknown }> };
    const [action] = chain.getActions();
    return action.executeAction(fakeGameState, {}) as EngineAwaitable;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>(r => {
        resolve = r;
    });
    return { promise, resolve };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe("awaited story action", () => {
    it("is handled by an async function, which is how the engine decides to wait", () => {
        // `isAsyncFunction` reads the constructor. A build target that downlevels async functions
        // would turn every awaited row back into one the story runs past.
        expect(runAwaited.constructor.name).toBe("AsyncFunction");
    });

    it("holds the story until run settles", async () => {
        const gate = deferred();
        const awaitable = execute({ run: () => gate.promise });
        expect(typeof awaitable?.isSettled).toBe("function");
        await flush();
        expect(awaitable.isSettled()).toBe(false);

        gate.resolve();
        await flush();
        expect(awaitable.isSettled()).toBe(true);
    });

    it("aborts the signal when the engine cancels the row", async () => {
        let seen: AbortSignal | null = null;
        const awaitable = execute({
            run: (_ctx, signal) => {
                seen = signal;
                return new Promise<void>(() => undefined);
            },
        });
        await flush();
        expect(seen!.aborted).toBe(false);

        // What rollback and load do to the action the stack is waiting on.
        awaitable.abort();
        expect(seen!.aborted).toBe(true);
    });

    it("lets the story continue past a run that throws, and reports it", async () => {
        const onError = vi.fn();
        const awaitable = execute({
            run: async () => {
                throw new Error("boom");
            },
            onError,
        });
        await flush();
        expect(awaitable.isSettled()).toBe(true);
        expect(onError).toHaveBeenCalledTimes(1);
        expect((onError.mock.calls[0][0] as Error).message).toBe("boom");
    });

    it("does not report the rejection a cancelled run ends in", async () => {
        const onError = vi.fn();
        const awaitable = execute({
            run: (_ctx, signal) => new Promise<void>((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(new Error("cancelled")));
            }),
            onError,
        });
        await flush();
        awaitable.abort();
        await flush();
        expect(onError).not.toHaveBeenCalled();
    });
});
