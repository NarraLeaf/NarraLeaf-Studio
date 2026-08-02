/**
 * The wire between Studio and a game process launched *by a test*.
 *
 * A test-owned game session is not a preview session with a flag on it, and the difference is the
 * point of this file. Preview answers one question - "is it running" - by polling, and logs
 * everything else as free text; that is enough for an author watching their own game and useless to
 * a test, which has to tell an author closing the window from the process dying, and has to see an
 * uncaught error rather than read about one in a log line. So this channel is *pushed*, structured,
 * and says how the process ended.
 *
 * These are the payload types only. The author-facing protocol that wraps them lives in
 * `src/renderer/lib/testing/types.ts`, which re-exports the shapes an author actually touches.
 */

/** Same ladder as `DevModeConsoleLogPayload`, so a line crossing from the game needs no mapping. */
export type GameTestLogLevel = "verbose" | "info" | "success" | "warning" | "error";

/**
 * How a game process ended.
 *
 * Before the test pipeline Studio could not make this distinction at all: `PreviewManager` logged
 * every exit at `verbose` and let the polled status fall back to `idle`, so a crash and a clean quit
 * looked identical. Classifying it is main-process work because only main knows whether it asked for
 * the shutdown.
 */
export type GameTestExitReason =
    /** Closed from inside the game - the window's own close, or the engine quitting itself. */
    | "closed-by-user"
    /** The host asked: an explicit stop, or the run being cancelled. */
    | "stopped-by-host"
    /** Non-zero exit code, a fatal signal, or an uncaught exception in the game's main process. */
    | "crashed"
    /** Never got far enough to run: compile failed, or the runner binary would not spawn. */
    | "failed-to-start";

export type GameTestExit = {
    reason: GameTestExitReason;
    code: number | null;
    signal: string | null;
};

/**
 * Everything a test-owned session pushes at Studio.
 *
 * One event union rather than several IPC channels: the ordering between "the game logged this" and
 * "the game then died" is load-bearing evidence, and separate channels would let the renderer see
 * them out of order.
 */
export type GameTestEvent =
    | { kind: "console"; level: GameTestLogLevel; source: string; message: string }
    /**
     * An uncaught error inside the running game - `window.onerror` / `unhandledrejection` in its
     * renderer, `uncaughtException` / `unhandledRejection` in its main process. The game runtime had
     * no such hook before this pipeline; an uncaught renderer exception was reported nowhere.
     */
    | { kind: "runtime-error"; scope: "renderer" | "main"; message: string; stack?: string }
    /** The engine reached an ending (`event:state.end`), forwarded out of the game's renderer. */
    | { kind: "game-end" }
    | { kind: "exit"; exit: GameTestExit };

export type GameTestLaunchRequest = {
    projectPath: string;
    /** Correlates the session with the run that owns it; a session outlives no run. */
    runId: string;
    /**
     * `"blocked"` starts the game with no network access. Applied to the launched process by the
     * host, so a game that reaches for the network fails where a player's would.
     */
    network?: "allow" | "blocked";
};

export type GameTestLaunchResult =
    | { ok: true; sessionId: string }
    /** A refusal Studio can explain: frozen workspace, compile failure, no runner binary. */
    | { ok: false; reason: string };

/** Pushed to the workspace window that owns the project. */
export type GameTestEventPayload = {
    sessionId: string;
    runId: string;
    timestamp: number;
    event: GameTestEvent;
};
