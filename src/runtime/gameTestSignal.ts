/**
 * The renderer half of the test channel, and the one place its shape is written down.
 *
 * The game's renderer can witness things nothing else in the process can - an uncaught error in its
 * own world, the engine reaching an ending, a choice going on screen - and before this channel none
 * of them had any way out. `bridge.log()` was the only path back to Studio, and the game only calls
 * it deliberately, so "did anything blow up while it played" was unanswerable.
 *
 * These are deliberately *signals*, not `GameTestEvent`s. The renderer must not be able to say
 * which `scope` an error came from (that is a fact about where the handler ran, not about the
 * payload) and must not be able to forge an `exit` - only the main process knows how the process
 * ended. {@link toGameTestEvent} is the widening, and it is the only widening.
 *
 * The other direction is here too: {@link GAME_RUNTIME_TEST_COMMAND_CHANNEL} carries what Studio
 * asks the game to do, main process to renderer. Both halves are absent together - the web export
 * has no main process, and a production pack's main process has no control server for anything to
 * talk to - so both are read off the bridge as optional extras rather than declared on it.
 */

import type { GameTestChoiceOption, GameTestCommand, GameTestEvent } from "@shared/types/gameTest";

/** Renderer -> game main process. One-way: nothing is expected back. */
export const GAME_RUNTIME_TEST_SIGNAL_CHANNEL = "runtime:test:signal" as const;

/** Game main process -> renderer. One-way for the same reason: the reply travels as an observation. */
export const GAME_RUNTIME_TEST_COMMAND_CHANNEL = "runtime:test:command" as const;

export type GameRuntimeTestSignal =
    | { kind: "runtime-error"; message: string; stack?: string }
    | { kind: "game-end" }
    | { kind: "ending"; endingId: string; name: string }
    | { kind: "choice"; options: GameTestChoiceOption[] };

/**
 * Added to the preload bridge by the desktop shell only.
 *
 * Deliberately not declared on `GameRuntimePreloadBridge`: the web export has no main process to
 * report to, and a production pack's main process has no control server listening, so *absence is
 * the normal case*. Reading it as an optional extra through
 * {@link readRuntimeTestSignalReporter} makes every hook that uses it inert by construction rather
 * than by remembering to check.
 */
export type GameRuntimeTestSignalBridge = {
    reportTestSignal(signal: GameRuntimeTestSignal): void;
};

/**
 * Resolve the reporter off whatever bridge this shell installed, or `null` when there is none.
 *
 * The returned function swallows its own failures: this channel is an observer, and a game must
 * never die because the test harness on the other end went away mid-run.
 */
export function readRuntimeTestSignalReporter(
    // `object`, not `GameRuntimePreloadBridge`: this half is not on that contract (see above), and
    // a parameter typed as the all-optional extension would trip TypeScript's weak-type check at
    // every call site that passes the plain bridge.
    bridge: object | null | undefined,
): ((signal: GameRuntimeTestSignal) => void) | null {
    const report = (bridge as Partial<GameRuntimeTestSignalBridge> | null | undefined)?.reportTestSignal;
    if (typeof report !== "function") {
        return null;
    }
    return signal => {
        try {
            report(signal);
        } catch {
            // Bridge torn down (window closing, context destroyed). Nothing to report to.
        }
    };
}

/**
 * Added to the preload bridge by the desktop shell only, alongside the reporter above.
 *
 * The listener is called with a command the main process has already validated. It returns an
 * unsubscribe, so a shell that re-mounts its game does not stack handlers.
 */
export type GameRuntimeTestCommandBridge = {
    onTestCommand(listener: (command: GameTestCommand) => void): () => void;
};

/**
 * Resolve the command subscription off whatever bridge this shell installed, or `null` when there
 * is none - which is every shell that is not a desktop game under a test.
 */
export function readRuntimeTestCommandSource(
    // `object` for the reason the reporter above takes one: this half is not on
    // `GameRuntimePreloadBridge`, and an all-optional parameter type would trip TypeScript's
    // weak-type check at every call site that passes the plain bridge.
    bridge: object | null | undefined,
): ((listener: (command: GameTestCommand) => void) => () => void) | null {
    const subscribe = (bridge as Partial<GameRuntimeTestCommandBridge> | null | undefined)?.onTestCommand;
    if (typeof subscribe !== "function") {
        return null;
    }
    return listener => {
        try {
            return subscribe(listener);
        } catch {
            // Bridge torn down. Nothing will arrive, and nothing has to be unsubscribed.
            return () => undefined;
        }
    };
}

/**
 * Read one inbound command, or `null` if it is not one.
 *
 * The one parser, run in the game's main process before the command is forwarded and reusable by
 * anything downstream that would rather not trust its input. This is a *version* boundary rather
 * than a security one - Studio spawned the process at the far end - so an unreadable command is
 * dropped and the caller degrades, exactly as an unknown frame type does.
 */
export function parseGameTestCommand(raw: unknown): GameTestCommand | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const command = raw as Record<string, unknown>;
    switch (command.kind) {
        case "start": {
            const storyId = typeof command.storyId === "string" ? command.storyId.trim() : "";
            const sceneId = typeof command.sceneId === "string" ? command.sceneId.trim() : "";
            // Both or neither: `startStory` refuses a blank target anyway, and refusing here means
            // the refusal is one the sender can see in the reply rather than a rejected promise
            // inside a game nobody is watching.
            return storyId && sceneId ? { kind: "start", storyId, sceneId } : null;
        }
        case "advance":
            return { kind: "advance" };
        case "choose": {
            const index = command.index;
            return typeof index === "number" && Number.isInteger(index) && index >= 0
                ? { kind: "choose", index }
                : null;
        }
        default:
            return null;
    }
}

/**
 * Widen a renderer signal into the wire event, or `null` if it is not one.
 *
 * Validating rather than trusting: this crosses an IPC boundary, and the renderer runs the
 * author's game plus every runtime plugin it ships. `scope` is stamped here because the sender is
 * by definition the renderer - it is not something the payload gets a vote on. `exit` has no signal
 * that produces it, and that is the point: only the main process knows how the process ended.
 */
export function toGameTestEvent(signal: unknown): GameTestEvent | null {
    if (!signal || typeof signal !== "object") {
        return null;
    }
    const kind = (signal as { kind?: unknown }).kind;
    if (kind === "game-end") {
        return { kind: "game-end" };
    }
    if (kind === "ending") {
        const { endingId, name } = signal as { endingId?: unknown; name?: unknown };
        // An ending with no id names nothing, and a test comparing it against the one the author
        // picked would match on the empty string - so it is dropped rather than reported blank.
        if (typeof endingId !== "string" || endingId === "") {
            return null;
        }
        return { kind: "ending", endingId, name: typeof name === "string" ? name : "" };
    }
    if (kind === "choice") {
        const { options } = signal as { options?: unknown };
        if (!Array.isArray(options)) {
            return null;
        }
        return { kind: "choice", options: options.flatMap(toGameTestChoiceOption) };
    }
    if (kind !== "runtime-error") {
        return null;
    }
    const { message, stack } = signal as { message?: unknown; stack?: unknown };
    return {
        kind: "runtime-error",
        scope: "renderer",
        // An error with no message still has to arrive: a test reading "one uncaught error" from an
        // empty string would report a pass on a game that threw.
        message: typeof message === "string" && message.trim() !== ""
            ? message
            : "Uncaught error in the game renderer",
        ...(typeof stack === "string" && stack !== "" ? { stack } : {}),
    };
}

/**
 * One reported option, or nothing.
 *
 * A row with no readable index is dropped rather than renumbered: the index is the handle the
 * caller picks by, and inventing one would send the game to an option nobody named.
 */
function toGameTestChoiceOption(raw: unknown): GameTestChoiceOption[] {
    if (!raw || typeof raw !== "object") {
        return [];
    }
    const option = raw as Record<string, unknown>;
    if (typeof option.index !== "number" || !Number.isInteger(option.index) || option.index < 0) {
        return [];
    }
    return [{
        index: option.index,
        text: typeof option.text === "string" ? option.text : "",
        disabled: option.disabled === true,
    }];
}
