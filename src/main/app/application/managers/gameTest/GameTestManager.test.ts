import { EventEmitter } from "events";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameTestEventPayload } from "@shared/types/gameTest";
import { IPCEventType } from "@shared/types/ipcEvents";
import { forgetWorkspaceFreeze, reportWorkspaceFreeze } from "../../utils/workspaceFreeze";
import { findWorkspaceWindow } from "../../utils/workspaceConsole";
import { compileGameRuntimeArtifactInWorker } from "../preview/compiler/compileGameRuntimeArtifactInWorker";
import {
    classifyGameTestExit,
    GameTestManager,
    normalizeGameTestFrameEvent,
} from "./GameTestManager";

// The window lookup is the only thing that reaches the real window layer; a fake lets every emitted
// event be read back as data. `emitWorkspaceConsoleLog` comes from the same module (PreviewManager
// pulls it in transitively) and has to be stubbed with it.
vi.mock("../../utils/workspaceConsole", () => ({
    findWorkspaceWindow: vi.fn(),
    emitWorkspaceConsoleLog: () => undefined,
}));
vi.mock("../preview/compiler/compileGameRuntimeArtifactInWorker", () => ({
    compileGameRuntimeArtifactInWorker: vi.fn(),
}));
// Partial: the preflight module PreviewManager pulls in transitively still needs the real execFile.
vi.mock("child_process", async importOriginal => ({
    ...(await importOriginal<typeof import("child_process")>()),
    spawn: vi.fn(),
}));
vi.mock("chokidar", () => ({
    default: { watch: () => ({ on: () => undefined, close: () => Promise.resolve() }) },
}));

/**
 * The four reasons, one case each.
 *
 * This is the point of the whole work item. Before it, `PreviewManager` logged every child exit at
 * `verbose` and let the polled status fall back to `idle`, so "the author closed the window" and
 * "the process died" were the same event to Studio - and those two are the *pass* and the *fail*
 * condition of the same test.
 */
describe("classifyGameTestExit", () => {
    const facts = (over: Partial<Parameters<typeof classifyGameTestExit>[0]> = {}) => ({
        stopRequested: false,
        startFailed: false,
        sawMainRuntimeError: false,
        code: null,
        signal: null,
        ...over,
    });

    it("calls a killed process stopped-by-host, not crashed", () => {
        // The author pressed Stop, the graceful shutdown timed out, and we SIGTERMed it. Reporting
        // that as `crashed` would make every cancelled run look like the game's fault.
        expect(classifyGameTestExit(facts({ stopRequested: true, signal: "SIGTERM" })).reason)
            .toBe("stopped-by-host");
    });

    it("keeps stopped-by-host even when the exit code says failure", () => {
        // Electron often exits non-zero when told to quit mid-scene. The host asked, so the host's
        // knowledge wins over the code - "whatever the exit code" is the rule.
        expect(classifyGameTestExit(facts({ stopRequested: true, code: 1 })).reason)
            .toBe("stopped-by-host");
    });

    it("keeps stopped-by-host for a run cancelled before the process ever started", () => {
        // Cancel during the ~20s artifact compile: no process, so `startFailed` is set too. It is
        // still the host's decision, not a failure of the game to start.
        expect(classifyGameTestExit(facts({ stopRequested: true, startFailed: true })).reason)
            .toBe("stopped-by-host");
    });

    it("calls a non-zero exit crashed", () => {
        // The game threw during startup and Electron exited 1 on its own. Nobody asked.
        expect(classifyGameTestExit(facts({ code: 1 })).reason).toBe("crashed");
    });

    it("calls a fatal signal crashed", () => {
        // The OS killed it - out of memory, or a segfault in a native puppet backend. No code.
        expect(classifyGameTestExit(facts({ signal: "SIGSEGV" })).reason).toBe("crashed");
    });

    it("calls a clean exit crashed when the game's main process reported an uncaught error", () => {
        // The case an exit code alone would miss: Electron does not reliably turn an
        // `uncaughtException` in the game's main process into a non-zero code, so the only evidence
        // is the `runtime-error` frame that arrived over the control socket while it was alive.
        expect(classifyGameTestExit(facts({ code: 0, sawMainRuntimeError: true })).reason)
            .toBe("crashed");
    });

    it("calls a compile that never produced a process failed-to-start", () => {
        // The artifact compile threw (a blueprint that will not compile, a missing runner binary).
        // No code and no signal, because there was never a process to have one.
        expect(classifyGameTestExit(facts({ startFailed: true })).reason).toBe("failed-to-start");
    });

    it("calls a clean exit nobody asked for closed-by-user", () => {
        // The author closed the game window. This is the *pass* condition of the no-network test.
        expect(classifyGameTestExit(facts({ code: 0 })).reason).toBe("closed-by-user");
    });

    it("puts a blueprint Quit Application node in closed-by-user too, on purpose", () => {
        // A game that quits itself exits 0 with nothing else to distinguish it from a window close,
        // and that is the intended answer: from Studio's side the *game* decided to end. A test that
        // needs to tell the two apart asks the game, not the host.
        expect(classifyGameTestExit(facts({ code: 0 })).reason).toBe("closed-by-user");
    });

    it("carries the code and the signal through unchanged", () => {
        // The reason is Studio's judgement; the code and signal are the raw fact a report shows.
        expect(classifyGameTestExit(facts({ code: 3, signal: null })))
            .toEqual({ reason: "crashed", code: 3, signal: null });
    });
});

/**
 * The game and this host are two separately-versioned halves. A frame this host does not understand
 * has to degrade, not throw inside a socket callback.
 */
describe("normalizeGameTestFrameEvent", () => {
    it("refuses an exit frame pushed by the game", () => {
        // Only the host may declare how a session ended - it is the one classification the game
        // genuinely cannot make, because it does not know whether the host asked. Accepting one
        // would also break the "exactly one exit per session" invariant every consumer relies on.
        expect(normalizeGameTestFrameEvent({ kind: "exit", exit: { reason: "crashed", code: 1, signal: null } }))
            .toBeNull();
    });

    it("accepts an uncaught error from the game's main process", () => {
        expect(normalizeGameTestFrameEvent({ kind: "runtime-error", scope: "main", message: "boom", stack: "at x" }))
            .toEqual({ kind: "runtime-error", scope: "main", message: "boom", stack: "at x" });
    });

    it("falls back to the renderer scope rather than dropping an unknown one", () => {
        // Guessing wrong here costs a crash being attributed to the wrong half; dropping the frame
        // would cost the crash being reported at all.
        expect(normalizeGameTestFrameEvent({ kind: "runtime-error", scope: "worker", message: "boom" }))
            .toEqual({ kind: "runtime-error", scope: "renderer", message: "boom" });
    });

    it("accepts game-end, which is the whole of the ending-reachability signal", () => {
        expect(normalizeGameTestFrameEvent({ kind: "game-end" })).toEqual({ kind: "game-end" });
    });

    it("normalizes a console line with a level this host does not know", () => {
        expect(normalizeGameTestFrameEvent({ kind: "console", level: "trace", message: "hello" }))
            .toEqual({ kind: "console", level: "info", source: "Game", message: "hello" });
    });

    it("drops a frame with no kind at all", () => {
        expect(normalizeGameTestFrameEvent({ message: "hello" })).toBeNull();
        expect(normalizeGameTestFrameEvent(null)).toBeNull();
    });
});

/** Collects everything the manager pushes at the workspace window. */
function captureEvents() {
    const payloads: GameTestEventPayload[] = [];
    vi.mocked(findWorkspaceWindow).mockReturnValue({
        sendIpcEvent: (event: IPCEventType, data: unknown) => {
            if (event === IPCEventType.workspaceGameTestEvent) {
                payloads.push(data as GameTestEventPayload);
            }
        },
    } as never);
    return payloads;
}

const makeManager = () => new GameTestManager({
    logger: { error: () => undefined },
    isPackaged: () => false,
    pluginManager: {
        listPlugins: async () => [],
        listRuntimePluginPackSources: async () => [],
    },
    getDistDir: () => path.join(os.tmpdir(), "dist"),
    getUserDataDir: () => path.join(os.tmpdir(), "userdata"),
    getAppInfo: () => ({ version: "0.0.0-test" }),
} as unknown as ConstructorParameters<typeof GameTestManager>[0]);

describe("GameTestManager.launch refusals", () => {
    const projectPath = path.join(os.tmpdir(), "nls-game-test-refusal");

    beforeEach(() => {
        captureEvents();
        vi.mocked(spawn).mockReset();
        vi.mocked(compileGameRuntimeArtifactInWorker).mockReset();
    });

    afterEach(() => {
        forgetWorkspaceFreeze(projectPath);
    });

    it("refuses while the workspace is frozen, with the remedy that fits the freeze", async () => {
        // R9: a headless test may run on a frozen workspace, but launching a game may not - Preview
        // is already refused there and a test must not become the way around that gate.
        reportWorkspaceFreeze(projectPath, "revision");

        const result = await makeManager().launch({ projectPath, runId: "run-1" });

        expect(result).toEqual({ ok: false, reason: expect.stringMatching(/Leave the revision/) });
        // A refusal is not a session, so nothing was compiled and nothing was spawned.
        expect(compileGameRuntimeArtifactInWorker).not.toHaveBeenCalled();
    });

    it("refuses a second session for the same project rather than letting it win silently", async () => {
        // Two game processes contend for the same compiled artifact directory; the second would
        // overwrite the first's and both would misbehave. R7: one run at a time, per project.
        let rejectCompile: (error: Error) => void = () => undefined;
        const started = new Promise<void>(resolve => {
            vi.mocked(compileGameRuntimeArtifactInWorker).mockImplementation(() => {
                resolve();
                return new Promise((_resolve, reject) => { rejectCompile = reject; });
            });
        });
        const manager = makeManager();
        const first = manager.launch({ projectPath, runId: "run-1" });
        await started;

        const second = await manager.launch({ projectPath, runId: "run-2" });

        expect(second).toEqual({ ok: false, reason: expect.stringMatching(/already running/) });
        // Unwind the first launch before leaving. A launch left in flight finishes against whatever
        // the *next* test has mocked and pushes its exit into that test's captured events.
        rejectCompile(new Error("abandoned"));
        await first;
    });
});

describe("GameTestManager.launch when the artifact will not compile", () => {
    const projectPath = path.join(os.tmpdir(), "nls-game-test-compile-fail");

    beforeEach(() => {
        vi.mocked(spawn).mockReset();
        vi.mocked(compileGameRuntimeArtifactInWorker).mockReset();
    });

    it("answers with the reason and still emits exactly one exit event", async () => {
        // The reason travels in the call's own return value, so the exit event is not the only way
        // the caller hears about it. It is emitted anyway because "exactly one exit per session,
        // always" is what a `waitForExit()` is written against - a missing exit hangs a run forever,
        // while an exit for a session id the caller never learned is inert.
        const events = captureEvents();
        vi.mocked(compileGameRuntimeArtifactInWorker).mockRejectedValue(new Error("blueprint would not compile"));

        const result = await makeManager().launch({ projectPath, runId: "run-1" });

        expect(result).toEqual({ ok: false, reason: "blueprint would not compile" });
        const exits = events.filter(payload => payload.event.kind === "exit");
        expect(exits).toHaveLength(1);
        expect(exits[0].event).toEqual({
            kind: "exit",
            exit: { reason: "failed-to-start", code: null, signal: null },
        });
        expect(exits[0].runId).toBe("run-1");
    });
});

/**
 * A launch spends nearly all its wall clock inside the artifact compile. A stop that took its turn
 * in the same per-project queue did nothing at all for that whole stretch and then landed *after*
 * the runtime had been spawned - the author pressed Stop, watched nothing happen, and then watched a
 * window open and get killed a few seconds later. Both halves of that are asserted here.
 */
describe("GameTestManager.stop while the artifact is still compiling", () => {
    const projectPath = path.join(os.tmpdir(), "nls-game-test-cancel");

    /** A compile that never finishes on its own, so the only way out is the cancel under test. */
    function stallingCompile() {
        const worker = { kill: vi.fn() };
        const started = new Promise<void>(resolve => {
            vi.mocked(compileGameRuntimeArtifactInWorker).mockImplementation((_app, _input, hooks) => {
                hooks?.onStart?.(worker as never);
                resolve();
                return new Promise((_res, reject) => {
                    // The real worker turns `kill()` into an exit, which the helper reports as a
                    // rejection. Mirror that, so the cancel path is exercised as it really runs.
                    worker.kill.mockImplementation(() => reject(new Error("Build cancelled")));
                });
            });
        });
        return { worker, started };
    }

    beforeEach(() => {
        vi.mocked(spawn).mockReset();
        vi.mocked(compileGameRuntimeArtifactInWorker).mockReset();
    });

    it("kills the compile worker synchronously instead of waiting its turn", async () => {
        const events = captureEvents();
        const compile = stallingCompile();
        const manager = makeManager();
        const launch = manager.launch({ projectPath, runId: "run-1" });
        await compile.started;
        const sessionId = events[0]?.sessionId;
        expect(sessionId).toBeTruthy();

        const stop = manager.stop(projectPath, sessionId);

        // The assertion that matters: the kill has already happened by the time `stop` returns its
        // promise, not when the compile it is queued behind eventually ends.
        expect(compile.worker.kill).toHaveBeenCalled();
        await expect(launch).resolves.toEqual({ ok: false, reason: expect.stringMatching(/cancelled/) });
        await stop;
    });

    it("never spawns the game it was told to abandon", async () => {
        const events = captureEvents();
        const compile = stallingCompile();
        const manager = makeManager();
        const launch = manager.launch({ projectPath, runId: "run-1" });
        await compile.started;

        await manager.stop(projectPath, events[0].sessionId);
        await launch;

        // The window that used to open and then die two seconds later never opens at all.
        expect(spawn).not.toHaveBeenCalled();
    });

    it("reports the cancelled session as stopped-by-host, not failed-to-start", async () => {
        const events = captureEvents();
        const compile = stallingCompile();
        const manager = makeManager();
        const launch = manager.launch({ projectPath, runId: "run-1" });
        await compile.started;

        await manager.stop(projectPath, events[0].sessionId);
        await launch;

        const exits = events.filter(payload => payload.event.kind === "exit");
        expect(exits).toHaveLength(1);
        expect(exits[0].event).toMatchObject({ exit: { reason: "stopped-by-host" } });
    });

    it("lets the next launch through once the cancelled one has unwound", async () => {
        // The refusal in `launch` is keyed on a live session; a cancel that forgot to drop its
        // session would lock the project out of testing for the rest of the run.
        const events = captureEvents();
        const first = stallingCompile();
        const manager = makeManager();
        const cancelled = manager.launch({ projectPath, runId: "run-1" });
        await first.started;
        await manager.stop(projectPath, events[0].sessionId);
        await cancelled;

        const second = stallingCompile();
        const relaunch = manager.launch({ projectPath, runId: "run-2" });
        await second.started;

        const sessionId = events[events.length - 1].sessionId;
        await manager.stop(projectPath, sessionId);
        await expect(relaunch).resolves.toEqual({ ok: false, reason: expect.stringMatching(/cancelled/) });
    });
});

describe("GameTestManager.launch spawn environment", () => {
    const projectPath = path.join(os.tmpdir(), "nls-game-test-env");
    let children: (EventEmitter & Record<string, unknown>)[] = [];

    /** Stands in for the spawned Electron: alive, quiet, and never asked to do anything. */
    function fakeChild() {
        const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
        // Node sets `pid` only on a spawn that produced a process, and the manager reads it to tell
        // "the runner would not start" from "the handle errored later".
        child.pid = 4242;
        child.exitCode = null;
        child.signalCode = null;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn(() => true);
        children.push(child);
        return child;
    }

    beforeEach(() => {
        captureEvents();
        children = [];
        vi.mocked(spawn).mockReset();
        vi.mocked(compileGameRuntimeArtifactInWorker).mockReset();
        vi.mocked(spawn).mockImplementation(() => fakeChild() as never);
        vi.mocked(compileGameRuntimeArtifactInWorker).mockResolvedValue(
            { appDir: path.join(os.tmpdir(), "app"), copiedAssetCount: 0 } as never,
        );
    });

    afterEach(() => {
        // A live session keeps re-dialling a control socket that will never answer, for the whole
        // 30s budget. Letting the fake process die ends the loop the way a real exit does.
        for (const child of children) {
            child.exitCode = 0;
            child.emit("exit", 0, null);
        }
    });

    it("compiles into its own directory so a test never fights the author's live preview", async () => {
        await makeManager().launch({ projectPath, runId: "run-1" });

        const input = vi.mocked(compileGameRuntimeArtifactInWorker).mock.calls[0][1];
        expect(input.outputRoot).toBe(path.join(path.resolve(projectPath), ".nlstudio", "test"));
        // The control server only exists in preview mode; a production pack deliberately has none.
        expect(input.mode).toBe("preview");
        expect(input.preview?.controlPort).toBeGreaterThan(0);
        expect(input.preview?.controlToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it("blocks the network only when the test asked for it", async () => {
        // Main's entire share of the no-network test: the runtime honours the variable, so the game
        // fails the way a player's would rather than in a mock.
        await makeManager().launch({ projectPath, runId: "run-1", network: "blocked" });
        const blockedEnv = (vi.mocked(spawn).mock.calls[0][2] as { env: Record<string, string> }).env;
        expect(blockedEnv.NARRALEAF_TEST_NETWORK).toBe("blocked");
        expect(blockedEnv.NARRALEAF_STUDIO_PREVIEW).toBe("1");

        vi.mocked(spawn).mockClear();
        await makeManager().launch({ projectPath: `${projectPath}-2`, runId: "run-2" });
        const openEnv = (vi.mocked(spawn).mock.calls[0][2] as { env: Record<string, string> }).env;
        expect(openEnv.NARRALEAF_TEST_NETWORK).toBeUndefined();
    });
});

/**
 * The part Studio has never done before.
 *
 * Until now the control socket was opened for the milliseconds of a shutdown dial and thrown away.
 * A test-owned session *holds* it, because it is the only way an uncaught error inside the running
 * game - which reaches nothing else, the game runtime having had no such hook at all - gets back
 * here. The server only starts listening once the runtime has read its pack, so the first dials are
 * refused and a refusal is not an answer.
 */
describe("GameTestManager's held control channel", () => {
    const projectPath = path.join(os.tmpdir(), "nls-game-test-control");
    let servers: WebSocketServer[] = [];

    function fakeChild() {
        const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
        child.pid = 4242;
        child.exitCode = null;
        child.signalCode = null;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn(() => true);
        child.exit = (code: number | null, signal: string | null) => {
            child.exitCode = code;
            child.signalCode = signal;
            child.emit("exit", code, signal);
        };
        return child;
    }

    beforeEach(() => {
        vi.mocked(spawn).mockReset();
        vi.mocked(compileGameRuntimeArtifactInWorker).mockReset();
    });

    afterEach(async () => {
        await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
        servers = [];
    });

    it("keeps dialling a socket that is not listening yet, then forwards what the game pushes", async () => {
        const events = captureEvents();
        const child = fakeChild();
        vi.mocked(spawn).mockReturnValue(child as never);
        let controlPort = 0;
        let controlToken = "";
        vi.mocked(compileGameRuntimeArtifactInWorker).mockImplementation(async (_app, input) => {
            controlPort = input.preview?.controlPort ?? 0;
            controlToken = input.preview?.controlToken ?? "";
            return { appDir: path.join(os.tmpdir(), "app"), copiedAssetCount: 0 } as never;
        });

        const launched = await makeManager().launch({ projectPath, runId: "run-1" });
        expect(launched).toEqual({ ok: true, sessionId: expect.any(String) });

        // The runtime comes up 300ms late - well past the first refused dial, which is the whole
        // reason a single ECONNREFUSED must not be treated as the answer.
        const subscribed = new Promise<string>(resolve => {
            setTimeout(() => {
                const server = new WebSocketServer({ host: "127.0.0.1", port: controlPort });
                servers.push(server);
                server.on("connection", socket => socket.on("message", raw => {
                    const frame = JSON.parse(raw.toString()) as { type?: string; token?: string };
                    if (frame.type !== "test:subscribe" || frame.token !== controlToken) {
                        socket.send(JSON.stringify({ ok: false, error: "Unknown command" }));
                        return;
                    }
                    socket.send(JSON.stringify({ ok: true }));
                    // Unsolicited, no token: the socket is already authenticated.
                    socket.send(JSON.stringify({
                        type: "test:event",
                        event: { kind: "runtime-error", scope: "main", message: "uncaught in game main" },
                    }));
                    socket.send(JSON.stringify({ type: "test:event", event: { kind: "game-end" } }));
                    resolve(frame.token ?? "");
                }));
            }, 300);
        });

        expect(await subscribed).toBe(controlToken);
        await vi.waitFor(() => expect(events.some(payload => payload.event.kind === "game-end")).toBe(true));

        // The exit code says the game ended cleanly. It did not: Electron does not reliably turn an
        // uncaught exception in the game's main process into a non-zero code, and the frame that
        // arrived over this socket is the only evidence there is.
        (child.exit as (code: number | null, signal: string | null) => void)(0, null);
        await vi.waitFor(() => expect(events.some(payload => payload.event.kind === "exit")).toBe(true));
        const exit = events.find(payload => payload.event.kind === "exit");
        expect(exit?.event).toEqual({ kind: "exit", exit: { reason: "crashed", code: 0, signal: null } });
    });
});
