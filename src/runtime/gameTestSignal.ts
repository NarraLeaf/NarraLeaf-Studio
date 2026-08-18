/**
 * The renderer half of test observation, and the one place its shape is written down.
 *
 * The game's renderer can witness two things nothing else in the process can - an uncaught error in
 * its own world, and the engine reaching an ending - and before this channel neither had any way
 * out. `bridge.log()` was the only path back to Studio, and the game only calls it deliberately, so
 * "did anything blow up while it played" was unanswerable.
 *
 * These are deliberately *signals*, not `GameTestEvent`s. The renderer must not be able to say
 * which `scope` an error came from (that is a fact about where the handler ran, not about the
 * payload) and must not be able to forge an `exit` - only the main process knows how the process
 * ended. {@link toGameTestEvent} is the widening, and it is the only widening.
 */

import type { GameTestEvent } from "@shared/types/gameTest";

/** Renderer -> game main process. One-way: nothing is expected back. */
export const GAME_RUNTIME_TEST_SIGNAL_CHANNEL = "runtime:test:signal" as const;

export type GameRuntimeTestSignal =
  | { kind: "runtime-error"; message: string; stack?: string }
  | { kind: "game-end" };

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
  bridge: object | null | undefined
): ((signal: GameRuntimeTestSignal) => void) | null {
  const report = (bridge as Partial<GameRuntimeTestSignalBridge> | null | undefined)
    ?.reportTestSignal;
  if (typeof report !== "function") {
    return null;
  }
  return (signal) => {
    try {
      report(signal);
    } catch {
      // Bridge torn down (window closing, context destroyed). Nothing to report to.
    }
  };
}

/**
 * Widen a renderer signal into the wire event, or `null` if it is not one.
 *
 * Validating rather than trusting: this crosses an IPC boundary, and the renderer runs the
 * author's game plus every runtime plugin it ships. `scope` is stamped here because the sender is
 * by definition the renderer - it is not something the payload gets a vote on.
 */
export function toGameTestEvent(signal: unknown): GameTestEvent | null {
  if (!signal || typeof signal !== "object") {
    return null;
  }
  const kind = (signal as { kind?: unknown }).kind;
  if (kind === "game-end") {
    return { kind: "game-end" };
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
    message:
      typeof message === "string" && message.trim() !== ""
        ? message
        : "Uncaught error in the game renderer",
    ...(typeof stack === "string" && stack !== "" ? { stack } : {})
  };
}
