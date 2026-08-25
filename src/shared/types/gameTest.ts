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
 * One option of a choice menu the game has just put on screen.
 *
 * `index` is the number {@link GameTestCommand} `choose` takes, and it is the compiler's index -
 * the option's position among the non-disabled `choiceOption` rows of its choice - not the row's
 * position on screen. An option a condition hides at play time is left out of the *display* without
 * shifting it, so the two readings differ exactly when a `hiddenWhen` fired.
 */
export type GameTestChoiceOption = {
    index: number;
    text: string;
    /** Offered but not selectable: the option's `disabledWhen` condition holds. */
    disabled: boolean;
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
    /**
     * An `/ending` row ran, naming the ending it declares.
     *
     * Beside `game-end` rather than replacing it: `game-end` also fires for a story that simply ran
     * out of rows, which has no ending to name. A test whose pass condition is "*this* ending" can
     * only be written against this one.
     */
    | { kind: "ending"; endingId: string; name: string }
    /**
     * A choice menu is on screen, with every option it evaluated.
     *
     * Fires each time a menu mounts, so a rollback into the same choice reports it again. The list
     * is what `choose` addresses; see {@link GameTestChoiceOption}.
     */
    | { kind: "choice"; options: GameTestChoiceOption[] }
    | { kind: "exit"; exit: GameTestExit };

/**
 * What Studio may ask a test-owned game to do.
 *
 * The direction the control socket never had. Everything here is something a player does with a
 * pointer, and each is carried out through the same path that pointer would take - `start` calls
 * the host's `game.startStory`, the one a title screen's Start button calls; `advance` clicks the
 * dialogue; `choose` goes through the choice runtime the `Select Choice` blueprint node uses. A
 * command that reached around those would be driving a game no player could play.
 *
 * A reply says the frame was understood, never that the game did it: the game is a separate process
 * whose renderer may not have a story on screen yet, and a caller that needs to know what happened
 * reads the events it pushes back.
 */
export type GameTestCommand =
    /**
     * Begin a story at a scene.
     *
     * Necessary because a test session boots to the main app surface - the title screen - and no
     * story runs until something starts one. The caller supplies the target, exactly as the
     * blueprint behind a Start button does.
     */
    | { kind: "start"; storyId: string; sceneId: string }
    /** One click on the dialogue: finish the line being typed, or move to the next. */
    | { kind: "advance" }
    /** Pick an option of the choice currently on screen, by the index the `choice` event reported. */
    | { kind: "choose"; index: number };

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
