import crypto from "crypto";
import net from "net";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { type UtilityProcess } from "electron";
import { WebSocket } from "ws";
import type { App } from "@/app/app";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type {
    GameTestEvent,
    GameTestExit,
    GameTestLaunchRequest,
    GameTestLaunchResult,
    GameTestLogLevel,
} from "@shared/types/gameTest";
import type { GameRuntimeLaunchEntry } from "@shared/types/gameRuntime";
import { IPCEventType } from "@shared/types/ipcEvents";
import { readProjectConfigFromDir } from "../../utils/projectConfigFile";
import { findWorkspaceWindow } from "../../utils/workspaceConsole";
import { getWorkspaceFreeze, workspaceFrozenMessage } from "../../utils/workspaceFreeze";
import { compileGameRuntimeArtifactInWorker } from "../preview/compiler/compileGameRuntimeArtifactInWorker";
import {
    formatPreviewProcessOutput,
    hostSidecarPlatformKey,
    resolvePreviewRunnerBinaryForApp,
} from "../preview/PreviewManager";
import { selectRuntimePluginsForPack, type RuntimePluginPackSelection } from "../preview/selectRuntimePlugins";
import { resolvePackEncryptionKey } from "../security/packKeyService";

/**
 * Game processes owned by a *test run*, not by the author's Run button.
 *
 * The whole reason this sits next to {@link import("../preview/PreviewManager").PreviewManager}
 * rather than inside it: preview answers one question - "is it running" - by polling, and writes
 * everything else to the workspace console as free text. A test has to tell an author closing the
 * window from the process dying (the first is the *pass* condition of the no-network test, the second
 * the *fail*), and has to see an uncaught error rather than read about one in a log line. Folding
 * that onto preview would have made every preview consumer carry it.
 *
 * Three things are new here and nowhere else in main:
 *
 *  - **The control socket is held open** for the life of the session. Studio has only ever opened it
 *    for the milliseconds of a shutdown dial; a subscribed socket is what carries the game's uncaught
 *    errors and its `game-end` back.
 *  - **The exit is classified.** See {@link classifyGameTestExit}.
 *  - **A separate artifact directory** (`.nlstudio/test`, not `.nlstudio/preview`), so a test never
 *    overwrites the artifact the author's live preview is running out of.
 */

/** How long the runtime gets to acknowledge a graceful shutdown before it is killed. */
const SHUTDOWN_TIMEOUT_MS = 5000;
/** How long to wait before re-dialling a control socket that is not listening yet. */
const SHUTDOWN_RETRY_DELAY_MS = 150;
/** How long a killed process gets to die of SIGTERM before SIGKILL. */
const FORCE_KILL_GRACE_MS = 1000;
/**
 * How long to keep dialling the control socket after the spawn.
 *
 * Generous, because the runtime only starts listening once it has read (and, for a protected
 * project, decrypted) its pack - which on a large game is many seconds after the process exists.
 * Bounded, because a runtime that never listens must not leave a dial loop running for the life of
 * the game; the session still reports console output and its exit without a control channel.
 */
const CONTROL_CONNECT_TIMEOUT_MS = 30_000;
const CONTROL_CONNECT_RETRY_DELAY_MS = 150;

/** Studio -> game. `shutdown` predates the test pipeline and is unchanged. */
const CONTROL_SUBSCRIBE_COMMAND = "test:subscribe";
/** game -> Studio, unsolicited, only on a socket that has already subscribed. */
const CONTROL_EVENT_FRAME = "test:event";

/**
 * Set on the spawned game when the test asked for `network: "blocked"`.
 *
 * Read by the game runtime, not by anything here - main's whole job is to put it in the environment,
 * so that a game reaching for the network fails in the shipped code path rather than in a mock.
 */
const NETWORK_BLOCKED_ENV_VAR = "NARRALEAF_TEST_NETWORK";

/**
 * A test's game session runs the main app surface, which is what Run > Preview launches too.
 *
 * `GameTestLaunchRequest` deliberately carries no entry: a test asks for "this project's game", and
 * letting it name a scene would make "does this game reach an ending" a question about a starting
 * point the author never chose.
 */
const TEST_LAUNCH_ENTRY: GameRuntimeLaunchEntry = { kind: "surface", surfaceId: MAIN_APP_SURFACE_ID };

type GameTestSession = {
    id: string;
    runId: string;
    projectPath: string;
    controlPort: number;
    controlToken: string;
    process: ChildProcess | null;
    /** The subscribed control socket, once it exists. Null before and after. */
    control: WebSocket | null;
    /** Killed synchronously by {@link GameTestManager.stop}, so a stop lands during a compile. */
    compileWorker: UtilityProcess | null;
    /**
     * The host asked for this to end - an explicit stop, or the run being cancelled. The single most
     * important bit on this record: it is what separates `stopped-by-host` from `crashed`, and main
     * is the only place that knows it.
     */
    stopRequested: boolean;
    /** The process never ran: the compile failed, or the spawn errored before producing a pid. */
    startFailed: boolean;
    /** An uncaught exception in the *game's* main process was reported over the control socket. */
    sawMainRuntimeError: boolean;
    /** Guards the "exactly one exit event per session" invariant. */
    exitEmitted: boolean;
    /**
     * Why the launch could not produce a game, in the author's words.
     *
     * Per session rather than per manager: two projects can be launching at the same instant, and a
     * shared field would hand one project's failure to the other's dialog.
     */
    failureReason: string | null;
};

/**
 * Everything the classifier is allowed to look at.
 *
 * A record rather than positional arguments so the call site reads as the evidence it is, and so the
 * truth table can be tested without a process.
 */
export type GameTestExitFacts = {
    /** A stop was requested - explicitly, or by the run being cancelled. */
    stopRequested: boolean;
    /** Compile failed, the runner binary would not resolve, or the spawn never produced a process. */
    startFailed: boolean;
    /** A `runtime-error` with `scope: "main"` was seen on this session. */
    sawMainRuntimeError: boolean;
    code: number | null;
    signal: string | null;
};

/**
 * Turn what happened into one of the four reasons a test can act on.
 *
 * Before the test pipeline Studio could not make this distinction at all: `PreviewManager` logs every
 * child exit at `verbose` and lets the polled status fall back to `idle`, so "the author closed the
 * window" and "the process died" were the same event. That is the whole point of this work item.
 *
 * The order of the checks is load-bearing:
 *
 *  1. **`stopped-by-host` first, whatever the exit code.** A process we killed exits non-zero or on a
 *     signal, and reporting that as `crashed` would make every cancelled run look like a failure of
 *     the game rather than a decision of the author.
 *  2. **`failed-to-start` before `crashed`.** A spawn that never produced a process leaves no code
 *     and no signal, so the two could not both fire - but a runner binary that dies during exec
 *     could, and "it never started" is the more useful of the two answers.
 *  3. **`crashed`** covers the three independent symptoms: a non-zero code, a fatal signal, and an
 *     uncaught exception in the game's own main process (which Electron does not always turn into a
 *     non-zero code, so the code alone would miss it).
 *  4. **`closed-by-user`** is everything else. A blueprint "Quit Application" node lands here, and
 *     that is intended: from Studio's side the game decided to end, which is exactly what the author
 *     closing the window means too. A test that needs to tell those apart asks the game, not the
 *     host.
 */
export function classifyGameTestExit(facts: GameTestExitFacts): GameTestExit {
    const exit = { code: facts.code, signal: facts.signal };
    if (facts.stopRequested) {
        return { reason: "stopped-by-host", ...exit };
    }
    if (facts.startFailed) {
        return { reason: "failed-to-start", ...exit };
    }
    if (facts.sawMainRuntimeError || facts.signal !== null || (facts.code !== null && facts.code !== 0)) {
        return { reason: "crashed", ...exit };
    }
    return { reason: "closed-by-user", ...exit };
}

/**
 * What a single dial to the control socket produced.
 *
 * Three outcomes rather than two because "nobody is listening yet" is the *normal* state for the
 * first seconds after a spawn and must be retried, while "it answered and said no" will only repeat.
 */
export type ControlDialOutcome =
    | { outcome: "subscribed" }
    | { outcome: "unreachable"; error: Error }
    | { outcome: "refused"; error: Error };

/**
 * Accept a frame the game pushed, or reject it.
 *
 * The game is a process Studio spawned, so this is not a trust boundary in the security sense; it is
 * a *version* boundary. A runtime older or newer than this host can push a frame this host does not
 * understand, and the pipeline has to degrade rather than crash on it.
 *
 * `exit` is refused on purpose even though it is a valid `GameTestEvent`: only the host may declare
 * how a session ended - it is the one classification the game genuinely cannot make (it does not know
 * whether the host asked) - and a game that could push one would break the "exactly one exit per
 * session" invariant every consumer relies on.
 */
export function normalizeGameTestFrameEvent(raw: unknown): GameTestEvent | null {
    if (typeof raw !== "object" || raw === null) {
        return null;
    }
    const event = raw as Record<string, unknown>;
    switch (event.kind) {
        case "console": {
            if (typeof event.message !== "string") {
                return null;
            }
            return {
                kind: "console",
                level: normalizeLogLevel(event.level),
                source: typeof event.source === "string" && event.source.length > 0 ? event.source : "Game",
                message: event.message,
            };
        }
        case "runtime-error": {
            if (typeof event.message !== "string") {
                return null;
            }
            return {
                kind: "runtime-error",
                // Unknown scopes fall to "renderer": it is the half a game has more of, and the
                // consequence of guessing wrong is a crash *not* being reported, never a false one.
                scope: event.scope === "main" ? "main" : "renderer",
                message: event.message,
                ...(typeof event.stack === "string" ? { stack: event.stack } : {}),
            };
        }
        case "game-end":
            return { kind: "game-end" };
        default:
            return null;
    }
}

const LOG_LEVELS: readonly GameTestLogLevel[] = ["verbose", "info", "success", "warning", "error"];

function normalizeLogLevel(value: unknown): GameTestLogLevel {
    return LOG_LEVELS.includes(value as GameTestLogLevel) ? (value as GameTestLogLevel) : "info";
}

export class GameTestManager {
    /** At most one session per project - see the refusal in {@link launch}. */
    private readonly sessions = new Map<string, GameTestSession>();
    private readonly operations = new Map<string, Promise<void>>();

    constructor(private readonly app: App) {}

    /**
     * Start a game process on behalf of a test run.
     *
     * Refuses - with a reason the author can read - in the two cases that are not errors:
     *
     *  - **A frozen workspace.** Same gate Preview applies (`PreviewManager.launch`), for the same
     *    reason and deliberately not a weaker one: a test must not become the way around it.
     *  - **A session already exists for this project.** Two game processes would contend for the
     *    same compiled artifact directory and the second would silently win. R7 in the plan: one run
     *    at a time, per project.
     *
     * The session is registered *synchronously*, before the first `await`, so the second of two
     * launches that arrive in the same tick is refused rather than racing the first.
     */
    public launch(request: GameTestLaunchRequest): Promise<GameTestLaunchResult> {
        const projectPath = path.resolve(request.projectPath);
        const key = this.projectKey(projectPath);

        const frozen = getWorkspaceFreeze(projectPath);
        if (frozen) {
            // Named "preview" because a test's game session *is* a preview process - same runner,
            // same pack, same reason the refusal exists (what it ran would not be what the author is
            // looking at). The remedy sentence is the part the author needs.
            return Promise.resolve({ ok: false, reason: workspaceFrozenMessage(frozen, "preview") });
        }
        if (this.sessions.has(key)) {
            return Promise.resolve({
                ok: false,
                reason: "A test is already running a game for this project. Stop it before starting another.",
            });
        }

        const session: GameTestSession = {
            id: crypto.randomUUID(),
            runId: request.runId,
            projectPath,
            controlPort: 0,
            controlToken: crypto.randomBytes(32).toString("hex"),
            process: null,
            control: null,
            compileWorker: null,
            stopRequested: false,
            startFailed: false,
            sawMainRuntimeError: false,
            exitEmitted: false,
            failureReason: null,
        };
        this.sessions.set(key, session);

        return this.enqueue(key, () => this.launchNow(session, request)).then(() =>
            session.failureReason === null
                ? { ok: true as const, sessionId: session.id }
                : { ok: false as const, reason: session.failureReason },
        );
    }

    /**
     * Stop a session, whatever stage it is at - including one that is still compiling.
     *
     * The cancel happens here, **synchronously, outside the queue**. A launch holds the per-project
     * queue for the whole artifact compile (~20s on a project with asset protection on), and a stop
     * that only did its work when its turn came did nothing at all while the author watched, then
     * landed *after* the runtime had been spawned - killing a window seconds after it appeared. That
     * bug has two symptoms and one cause, and this is the cause. Marking the session and killing the
     * compile worker up front is what makes Stop mean something during a compile.
     *
     * The queued half still runs, and is what tears down a session that did reach a live process.
     */
    public stop(projectPath: string, sessionId: string): Promise<void> {
        const key = this.projectKey(projectPath);
        const session = this.sessions.get(key);
        if (!session || session.id !== sessionId) {
            // Already gone. A test that stops a session which exited on its own is the normal case,
            // not an error - it cannot know the difference without racing its own exit event.
            return Promise.resolve();
        }
        session.stopRequested = true;
        // Turns the in-flight compile's own exit into a rejection within milliseconds, instead of at
        // the end of a compile the author has already abandoned.
        session.compileWorker?.kill();
        session.compileWorker = null;
        return this.enqueue(key, () => this.teardown(session));
    }

    private async launchNow(session: GameTestSession, request: GameTestLaunchRequest): Promise<void> {
        try {
            session.controlPort = await allocateLocalPort();
            this.ensureNotCancelled(session);
            this.emitConsole(session, "verbose", "artifact compile started");

            const pluginSelection = await this.selectRuntimePlugins(session.projectPath);
            if (pluginSelection.errors.length > 0) {
                throw new Error(`Plugin validation failed:\n${pluginSelection.errors.join("\n")}`);
            }
            const encryptionKey = await this.resolveEncryptionKey(session.projectPath);
            this.ensureNotCancelled(session);

            const artifact = await compileGameRuntimeArtifactInWorker(this.app, {
                projectPath: session.projectPath,
                entry: TEST_LAUNCH_ENTRY,
                runtimeDistDir: path.join(this.app.getDistDir(), "runtime"),
                runtimeVersion: this.readRuntimeVersion(),
                // Its own root, not `.nlstudio/preview`. A test that reused the preview's directory
                // would overwrite the artifact the author's live preview is running out of - and the
                // author would see their own game restart because a test ran.
                outputRoot: path.join(session.projectPath, ".nlstudio", "test"),
                preview: {
                    controlPort: session.controlPort,
                    controlToken: session.controlToken,
                },
                runtimePlugins: pluginSelection.selected,
                // "preview" and not "production": a test needs the control server, which a shipped
                // pack deliberately does not have.
                mode: "preview",
                encryptionKey,
                sidecarPlatformKey: hostSidecarPlatformKey(),
                hostUserDataDir: this.app.getUserDataDir(),
            }, {
                onStart: worker => { session.compileWorker = worker; },
                cancelled: () => session.stopRequested,
            });
            session.compileWorker = null;
            this.ensureNotCancelled(session);
            this.emitConsole(session, "verbose", `artifact compile finished: ${artifact.copiedAssetCount} asset(s)`);

            const binary = resolvePreviewRunnerBinaryForApp(this.app);
            // The last point at which a cancel is free: everything from here to the end of this
            // block is synchronous, so a stop that arrives after it goes through the queued teardown
            // instead of leaving a spawned process nobody owns.
            this.ensureNotCancelled(session);
            const child = spawn(binary, [artifact.appDir], {
                cwd: artifact.appDir,
                stdio: ["ignore", "pipe", "pipe"],
                env: {
                    ...process.env,
                    NARRALEAF_STUDIO_PREVIEW: "1",
                    // Honoured by the game runtime, not here. Setting it is main's entire share of
                    // the no-network test: the game must fail the way a player's would.
                    ...(request.network === "blocked" ? { [NETWORK_BLOCKED_ENV_VAR]: "blocked" } : {}),
                },
            });
            session.process = child;
            this.attachProcessLogging(session, child);
            // Not awaited: the socket only starts answering seconds later, and a test's `launch()`
            // must resolve as soon as the process exists. Events that arrive before the renderer has
            // a listener are the renderer's problem to replay (see `TestGameSession.onEvent`).
            void this.holdControlChannel(session);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (session.stopRequested) {
                // A cancel is the author getting what they asked for, not a failure - but it is
                // still not a session, so the launch call has to be told it got nothing.
                session.failureReason = "The test's game launch was cancelled.";
                this.emitConsole(session, "warning", "launch cancelled");
            } else {
                session.startFailed = true;
                session.failureReason = message;
                this.app.logger.error("[GameTest] launch failed", error);
                this.emitConsole(session, "error", `launch failed: ${message}`);
            }
            // The launch answers `{ok:false, reason}` as well, so this event is not the only way the
            // caller hears about it. It is emitted anyway because the invariant every consumer codes
            // against is "exactly one exit per session, always" - a `waitForExit()` that never
            // settles hangs a run forever, while an exit for a session the caller never learned the
            // id of is inert.
            this.finishSession(session, { code: null, signal: null });
            this.forgetSession(session);
        }
    }

    /**
     * Connect to the game's control socket, subscribe, and keep the socket for the life of the
     * session.
     *
     * This is what Studio has never done before. The control server only starts listening once the
     * runtime has read its pack, so **the first dials will be refused, and a refusal is not an
     * answer** - the same lesson `PreviewManager.requestRuntimeShutdown` learned when a single dial
     * made every "stop a preview you just started" take five seconds and end in a kill.
     *
     * Gives up quietly at the deadline: a session with no control channel still reports the game's
     * stdout and its exit, which is most of what a test needs.
     */
    private async holdControlChannel(session: GameTestSession): Promise<void> {
        const deadline = Date.now() + CONTROL_CONNECT_TIMEOUT_MS;
        for (;;) {
            if (session.stopRequested || !session.process || !isChildRunning(session.process)) {
                return;
            }
            const attempt = await this.dialControlSocket(session, deadline);
            if (attempt.outcome === "subscribed") {
                this.emitConsole(session, "verbose", "control channel subscribed");
                return;
            }
            // A runtime that answered and refused will refuse again; only silence is worth retrying.
            if (attempt.outcome === "refused") {
                this.emitConsole(session, "warning", `control channel refused: ${attempt.error.message}`);
                return;
            }
            if (Date.now() + CONTROL_CONNECT_RETRY_DELAY_MS >= deadline) {
                this.emitConsole(
                    session,
                    "warning",
                    "the game never opened its control channel; runtime errors will not be observed",
                );
                return;
            }
            await delay(CONTROL_CONNECT_RETRY_DELAY_MS);
        }
    }

    /**
     * One dial. Resolves with what happened rather than rejecting, so the caller can tell "nobody is
     * listening yet" from "it said no".
     *
     * On success the socket is *kept* - stored on the session and left with its message handler
     * installed - which is the difference between this and the shutdown dial.
     */
    private dialControlSocket(session: GameTestSession, deadline: number): Promise<ControlDialOutcome> {
        return new Promise(resolve => {
            const ws = new WebSocket(`ws://127.0.0.1:${session.controlPort}`);
            let subscribed = false;
            let settled = false;
            const settle = (attempt: ControlDialOutcome) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                if (attempt.outcome !== "subscribed") {
                    ws.close();
                }
                resolve(attempt);
            };
            const timeout = setTimeout(
                () => settle({ outcome: "unreachable", error: new Error("control socket timed out") }),
                Math.max(0, deadline - Date.now()),
            );
            ws.on("open", () => {
                ws.send(JSON.stringify({ type: CONTROL_SUBSCRIBE_COMMAND, token: session.controlToken }));
            });
            ws.on("message", raw => {
                let payload: { type?: unknown; ok?: unknown; error?: unknown; event?: unknown };
                try {
                    payload = JSON.parse(raw.toString()) as typeof payload;
                } catch {
                    // A frame we cannot parse is not a reason to drop a working channel; only the
                    // handshake treats it as fatal, because nothing else can follow it.
                    if (!subscribed) {
                        settle({ outcome: "refused", error: new Error("invalid control response") });
                    }
                    return;
                }
                if (!subscribed) {
                    if (payload.ok === true) {
                        subscribed = true;
                        session.control = ws;
                        settle({ outcome: "subscribed" });
                        return;
                    }
                    // A runtime that predates the test pipeline answers the unknown command with
                    // `{ok:false,error:"Unknown command"}` rather than closing, which is exactly the
                    // degradation the frame vocabulary was designed for.
                    settle({
                        outcome: "refused",
                        error: new Error(typeof payload.error === "string" ? payload.error : "subscribe rejected"),
                    });
                    return;
                }
                if (payload.type !== CONTROL_EVENT_FRAME) {
                    return;
                }
                const event = normalizeGameTestFrameEvent(payload.event);
                if (!event) {
                    return;
                }
                if (event.kind === "runtime-error" && event.scope === "main") {
                    // Remembered rather than acted on: Electron does not reliably turn an uncaught
                    // exception in the game's main process into a non-zero exit code, so this is the
                    // only evidence the classifier will have.
                    session.sawMainRuntimeError = true;
                }
                this.emitEvent(session, event);
            });
            ws.on("close", () => {
                if (session.control === ws) {
                    session.control = null;
                }
                // Before the handshake, a close is the runtime not being there yet.
                settle({ outcome: "unreachable", error: new Error("control socket closed") });
            });
            // ECONNREFUSED while the runtime is still booting lands here, and is the reason the
            // caller retries rather than treating the first error as the answer.
            ws.on("error", error => settle({ outcome: "unreachable", error }));
        });
    }

    /**
     * Take the process down: ask nicely over the control socket, then insist.
     *
     * The graceful half retries **within one deadline** rather than treating the first ECONNREFUSED
     * as the runtime's answer - the socket does not exist for the first seconds of the process's
     * life, and stopping a session you just started is the common case for a test, not the rare one.
     */
    private async teardown(session: GameTestSession): Promise<void> {
        const key = this.projectKey(session.projectPath);
        const child = session.process;
        if (child && isChildRunning(child)) {
            this.emitConsole(session, "verbose", "stop requested");
            await this.requestRuntimeShutdown(session).catch(error => {
                this.emitConsole(
                    session,
                    "warning",
                    `graceful shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            });
            const exited = await waitForChildExit(child, SHUTDOWN_TIMEOUT_MS);
            if (!exited && isChildRunning(child)) {
                this.emitConsole(session, "warning", "the game did not exit in time; killing it");
                child.kill("SIGTERM");
                await waitForChildExit(child, FORCE_KILL_GRACE_MS);
                if (isChildRunning(child)) {
                    child.kill("SIGKILL");
                }
            }
        }
        session.control?.close();
        session.control = null;
        session.process = null;
        // A session that never reached a process still owes its exit event: the stop is the only
        // thing that will ever happen to it.
        this.finishSession(session, { code: child?.exitCode ?? null, signal: child?.signalCode ?? null });
        if (this.sessions.get(key) === session) {
            this.sessions.delete(key);
        }
    }

    /** Copied from PreviewManager rather than shared: see the header note about not refactoring it. */
    private async requestRuntimeShutdown(session: GameTestSession): Promise<void> {
        const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
        for (;;) {
            const child = session.process;
            if (!child || !isChildRunning(child)) {
                return;
            }
            const attempt = await sendShutdownCommand(session.controlPort, session.controlToken, deadline);
            if (attempt.outcome === "done") {
                return;
            }
            if (attempt.outcome === "refused" || Date.now() + SHUTDOWN_RETRY_DELAY_MS >= deadline) {
                throw attempt.error;
            }
            await delay(SHUTDOWN_RETRY_DELAY_MS);
        }
    }

    private attachProcessLogging(session: GameTestSession, child: ChildProcess): void {
        // Same level mapping as the preview's: stdout is the game talking, stderr is the game
        // complaining. Neither is an uncaught error - those arrive structured, over the control
        // socket, which is the point of having one.
        child.stdout?.on("data", chunk => this.emitProcessOutput(session, "info", chunk));
        child.stderr?.on("data", chunk => this.emitProcessOutput(session, "warning", chunk));
        child.on("error", error => {
            this.emitConsole(session, "error", error.message);
            // Node sets `pid` only on a spawn that produced a process, and may emit `error` without
            // ever following it with `exit`. Without this, a runner binary that will not start would
            // leave the session hanging forever instead of reporting `failed-to-start`.
            if (child.pid === undefined) {
                session.startFailed = true;
            }
            this.finishSession(session, { code: child.exitCode, signal: child.signalCode });
            this.forgetSession(session);
        });
        child.once("exit", (code, signal) => {
            session.process = null;
            session.control?.close();
            session.control = null;
            this.finishSession(session, { code, signal });
            this.forgetSession(session);
        });
    }

    private emitProcessOutput(session: GameTestSession, level: GameTestLogLevel, chunk: Buffer): void {
        const message = formatPreviewProcessOutput(chunk);
        if (!message) {
            return;
        }
        this.emitEvent(session, { kind: "console", level, source: "Game", message });
    }

    /**
     * Classify and announce the end of a session - once, whatever brings it about.
     *
     * The guard is not defensive tidiness: a killed process can reach here from the kill path *and*
     * from its own `exit` handler, and a test that saw two exits would have to decide which one it
     * believed.
     */
    private finishSession(session: GameTestSession, outcome: { code: number | null; signal: string | null }): void {
        if (session.exitEmitted) {
            return;
        }
        session.exitEmitted = true;
        this.emitEvent(session, {
            kind: "exit",
            exit: classifyGameTestExit({
                stopRequested: session.stopRequested,
                startFailed: session.startFailed,
                sawMainRuntimeError: session.sawMainRuntimeError,
                code: outcome.code,
                signal: outcome.signal,
            }),
        });
    }

    private forgetSession(session: GameTestSession): void {
        const key = this.projectKey(session.projectPath);
        if (this.sessions.get(key) === session) {
            this.sessions.delete(key);
        }
    }

    private emitConsole(session: GameTestSession, level: GameTestLogLevel, message: string): void {
        this.emitEvent(session, { kind: "console", level, source: "Test", message });
    }

    /**
     * Push an event to the workspace window that owns this project.
     *
     * Same window lookup the workspace console uses, and the same silent drop when no window has the
     * project open: a session can outlive the window that started it, and a test that is no longer
     * being watched is not a reason to throw inside a child-process callback.
     */
    private emitEvent(session: GameTestSession, event: GameTestEvent): void {
        const workspaceWindow = findWorkspaceWindow(this.app, session.projectPath);
        if (!workspaceWindow) {
            return;
        }
        workspaceWindow.sendIpcEvent(IPCEventType.workspaceGameTestEvent, {
            sessionId: session.id,
            runId: session.runId,
            timestamp: Date.now(),
            event,
        });
    }

    /**
     * Bail out of a launch the test has stopped. What catches this reads `stopRequested` rather than
     * the error, because the compile worker's own rejection arrives as a plain Error and has to
     * unwind down exactly the same path.
     */
    private ensureNotCancelled(session: GameTestSession): void {
        if (session.stopRequested) {
            throw new Error("Test game launch cancelled");
        }
    }

    private async selectRuntimePlugins(projectPath: string): Promise<RuntimePluginPackSelection> {
        const projectConfig = await readProjectConfigFromDir(projectPath).catch(() => null);
        const installed = (await this.app.pluginManager.listPlugins()).map(plugin => ({
            id: plugin.pluginId,
            version: plugin.manifest.version,
            enabled: plugin.enabled,
        }));
        return selectRuntimePluginsForPack({
            dependencies: projectConfig?.dependencies,
            available: await this.app.pluginManager.listRuntimePluginPackSources(),
            installed,
        });
    }

    private async resolveEncryptionKey(projectPath: string): Promise<string | undefined> {
        const projectConfig = await readProjectConfigFromDir(projectPath).catch(() => null);
        const enabled =
            (projectConfig?.app as { security?: { encryptAssets?: unknown } } | undefined)?.security?.encryptAssets === true;
        if (!enabled) {
            return undefined;
        }
        return resolvePackEncryptionKey(this.app.getUserDataDir(), projectPath);
    }

    private readRuntimeVersion(): string {
        try {
            return this.app.getAppInfo().version;
        } catch {
            return "0.0.0";
        }
    }

    private enqueue(key: string, operation: () => Promise<void>): Promise<void> {
        const previous = this.operations.get(key) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(operation);
        const tracked = next.finally(() => {
            if (this.operations.get(key) === tracked) {
                this.operations.delete(key);
            }
        });
        this.operations.set(key, tracked);
        return next;
    }

    /** The same key `workspaceFreeze` and the other per-project managers use. They have to agree. */
    private projectKey(projectPath: string): string {
        return path.resolve(projectPath);
    }
}

/** Outcome of a single dial to a game's control socket for a shutdown. Never rejects. */
type ShutdownAttempt =
    | { outcome: "done" }
    | { outcome: "unreachable"; error: Error }
    | { outcome: "refused"; error: Error };

function sendShutdownCommand(port: number, token: string, deadline: number): Promise<ShutdownAttempt> {
    return new Promise(resolve => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        let settled = false;
        const settle = (attempt: ShutdownAttempt) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            ws.close();
            resolve(attempt);
        };
        const timeout = setTimeout(
            () => settle({ outcome: "unreachable", error: new Error("shutdown websocket timed out") }),
            Math.max(0, deadline - Date.now()),
        );
        ws.on("open", () => {
            ws.send(JSON.stringify({ type: "shutdown", token }));
        });
        ws.on("message", raw => {
            let payload: { ok?: unknown; error?: unknown };
            try {
                payload = JSON.parse(raw.toString()) as { ok?: unknown; error?: unknown };
            } catch {
                settle({ outcome: "refused", error: new Error("invalid shutdown response") });
                return;
            }
            settle(payload.ok === true
                ? { outcome: "done" }
                : { outcome: "refused", error: new Error(typeof payload.error === "string" ? payload.error : "shutdown rejected") });
        });
        ws.on("error", error => settle({ outcome: "unreachable", error }));
    });
}

function allocateLocalPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                server.close();
                reject(new Error("Failed to allocate a local control port for the test's game"));
                return;
            }
            const port = address.port;
            server.close(error => (error ? reject(error) : resolve(port)));
        });
    });
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isChildRunning(child: ChildProcess): boolean {
    return child.exitCode === null && child.signalCode === null;
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (!isChildRunning(child)) {
        return Promise.resolve(true);
    }
    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            cleanup();
            resolve(false);
        }, timeoutMs);
        const onExit = () => {
            cleanup();
            resolve(true);
        };
        const cleanup = () => {
            clearTimeout(timeout);
            child.off("exit", onExit);
        };
        child.once("exit", onExit);
    });
}
