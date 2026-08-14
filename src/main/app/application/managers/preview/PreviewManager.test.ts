import { EventEmitter } from "events";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameRuntimeLaunchEntry } from "@shared/types/gameRuntime";
import { forgetWorkspaceFreeze, reportWorkspaceFreeze } from "../../utils/workspaceFreeze";
import { formatPreviewProcessOutput, PreviewManager, resolvePreviewRunnerBinaryForApp } from "./PreviewManager";
import { compileGameRuntimeArtifactInWorker } from "./compiler/compileGameRuntimeArtifactInWorker";
import { spawn } from "child_process";

// The freeze refusal reports itself on the workspace console; keep it away from the window plumbing.
vi.mock("../../utils/workspaceConsole", () => ({
    emitWorkspaceConsoleLog: () => undefined,
}));
vi.mock("./compiler/compileGameRuntimeArtifactInWorker", () => ({
    compileGameRuntimeArtifactInWorker: vi.fn(),
}));
// Partial: the preflight module this file pulls in transitively still needs the real execFile.
vi.mock("child_process", async importOriginal => ({
    ...(await importOriginal<typeof import("child_process")>()),
    spawn: vi.fn(),
}));
vi.mock("chokidar", () => ({
    default: { watch: () => ({ on: () => undefined, close: () => Promise.resolve() }) },
}));

let tempDir = "";

describe("resolvePreviewRunnerBinaryForApp", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-preview-runner-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("uses the current Electron executable in development instead of require(\"electron\")", () => {
        const app = {
            isPackaged: () => false,
            resolveResource: (relativePath: string) => path.join(tempDir, relativePath),
        };

        expect(resolvePreviewRunnerBinaryForApp(app, "/Applications/Electron.app/Contents/MacOS/Electron"))
            .toBe("/Applications/Electron.app/Contents/MacOS/Electron");
    });

    it("resolves the embedded preview runner in packaged builds", async () => {
        const runnerDist = path.join(tempDir, "preview-runner", "dist");
        const binary = process.platform === "darwin"
            ? path.join(runnerDist, "Electron.app", "Contents", "MacOS", "Electron")
            : process.platform === "win32"
              ? path.join(runnerDist, "electron.exe")
              : path.join(runnerDist, "electron");
        await fs.mkdir(path.dirname(binary), { recursive: true });
        await fs.writeFile(binary, "", "utf-8");
        const app = {
            isPackaged: () => true,
            resolveResource: (relativePath: string) => path.join(tempDir, relativePath),
        };

        expect(resolvePreviewRunnerBinaryForApp(app)).toBe(binary);
    });
});

describe("formatPreviewProcessOutput", () => {
    it("preserves multiline output as a single message", () => {
        expect(formatPreviewProcessOutput(Buffer.from("first\nsecond\nthird\n")))
            .toBe("first\nsecond\nthird");
    });

    it("normalizes CRLF output while preserving indentation and blank lines", () => {
        expect(formatPreviewProcessOutput(Buffer.from("\r\nError:\r\n  at file.ts:1\r\n\r\n  at file.ts:2\r\n")))
            .toBe("Error:\n  at file.ts:1\n\n  at file.ts:2");
    });

    it("skips whitespace-only output", () => {
        expect(formatPreviewProcessOutput(Buffer.from("\n  \r\n"))).toBeNull();
    });
});

describe("PreviewManager.launch while the workspace is frozen", () => {
    // Enough app for the guard and for launchNow to fail on its own terms; see below.
    const makeManager = () => new PreviewManager({
        logger: { error: () => undefined },
    } as unknown as ConstructorParameters<typeof PreviewManager>[0]);
    const entry = { kind: "surface", surfaceId: "main" } as GameRuntimeLaunchEntry;
    const projectPath = path.join("/nonexistent", "frozen-preview-project");

    afterEach(() => {
        forgetWorkspaceFreeze(projectPath);
    });

    it("refuses, telling the author how to get out of the freeze", async () => {
        // RunControl already disables Preview while frozen; this is the same refusal for the callers
        // a disabled button does not reach. Rejects rather than answering a status, so a plugin or a
        // keybinding is told why.
        reportWorkspaceFreeze(projectPath, "revision");

        await expect(makeManager().launch(projectPath, entry)).rejects.toThrow(/Leave the revision/);
    });

    it("refuses a hand-frozen workspace with the remedy that fits it", async () => {
        reportWorkspaceFreeze(projectPath, "manual");

        await expect(makeManager().launch(projectPath, entry)).rejects.toThrow(/Unfreeze the workspace/);
    });

    it("launches again once the workspace is thawed", async () => {
        reportWorkspaceFreeze(projectPath, "revision");
        reportWorkspaceFreeze(projectPath, null);

        // Past the guard, launchNow runs and then fails on this test double's missing plugin
        // manager - which it reports as a status rather than a rejection. That difference is the
        // assertion: refused rejects, allowed resolves.
        await expect(makeManager().launch(projectPath, entry)).resolves.toBe("error");
    });
});

/**
 * A preview launch spends almost all of its wall clock inside the artifact compile - ~20s on a
 * project with asset protection on. `stop` used to take its turn in the same per-project queue as
 * the launch, so for that whole stretch it did nothing at all, and then landed *after* the runtime
 * had been spawned: the author pressed Stop, watched nothing happen, and then watched the window
 * open and get killed a few seconds later. Both halves of that are asserted here.
 */
describe("PreviewManager.stop while the artifact is still compiling", () => {
    const entry = { kind: "surface", surfaceId: "main" } as GameRuntimeLaunchEntry;
    const projectPath = path.join(os.tmpdir(), "nls-preview-cancel-project");

    /** A compile that never finishes on its own, so the only way out is the cancel under test. */
    function stallingCompile() {
        const worker = { kill: vi.fn() };
        let rejectCompile: (error: Error) => void = () => undefined;
        const started = new Promise<void>(resolve => {
            vi.mocked(compileGameRuntimeArtifactInWorker).mockImplementation((_app, _input, hooks) => {
                hooks?.onStart?.(worker as never);
                resolve();
                return new Promise((_res, rej) => {
                    // The real worker turns `kill()` into an exit, which the helper reports as a
                    // rejection. Mirror that, so the cancel path is exercised as it really runs.
                    rejectCompile = rej;
                    worker.kill.mockImplementation(() => rej(new Error("Build cancelled")));
                });
            });
        });
        return { worker, started, rejectCompile: () => rejectCompile(new Error("Build cancelled")) };
    }

    const makeManager = () => new PreviewManager({
        logger: { error: () => undefined },
        pluginManager: {
            listPlugins: async () => [],
            listRuntimePluginPackSources: async () => [],
        },
        getDistDir: () => path.join(os.tmpdir(), "dist"),
        getUserDataDir: () => path.join(os.tmpdir(), "userdata"),
        // Every host resolves which edition it is running as; this profile picked none.
        getGlobalState: () => ({ get: () => undefined }),
        getAppInfo: () => ({ version: "0.0.0-test" }),
    } as unknown as ConstructorParameters<typeof PreviewManager>[0]);

    beforeEach(() => {
        vi.mocked(spawn).mockReset();
        vi.mocked(compileGameRuntimeArtifactInWorker).mockReset();
    });

    it("kills the compile instead of waiting it out", async () => {
        const compile = stallingCompile();
        const manager = makeManager();
        const launch = manager.launch(projectPath, entry);
        await compile.started;

        const stop = manager.stop(projectPath);

        // The point of the fix: the worker dies when the author asks, not when the compile ends.
        expect(compile.worker.kill).toHaveBeenCalled();
        await expect(stop).resolves.toBe("idle");
        await expect(launch).resolves.toBe("idle");
    });

    it("never spawns the runtime it was told to abandon", async () => {
        const compile = stallingCompile();
        const manager = makeManager();
        const launch = manager.launch(projectPath, entry);
        await compile.started;

        await manager.stop(projectPath);
        await launch;

        // The window that used to open and then die two seconds later never opens at all.
        expect(spawn).not.toHaveBeenCalled();
    });

    it("reports a cancelled launch as idle rather than an error", async () => {
        const compile = stallingCompile();
        const manager = makeManager();
        const launch = manager.launch(projectPath, entry);
        await compile.started;

        await manager.stop(projectPath);

        // "error" would leave the toolbar showing a failure the author caused deliberately, and
        // would leave a session behind for the next stop to trip over.
        await expect(launch).resolves.toBe("idle");
        expect(manager.getStatus(projectPath)).toBe("idle");
        expect(manager.getStatus()).toBe("idle");
    });

    it("lets the next launch through once the cancelled one has unwound", async () => {
        const first = stallingCompile();
        const manager = makeManager();
        const cancelled = manager.launch(projectPath, entry);
        await first.started;
        await manager.stop(projectPath);
        await cancelled;

        const second = stallingCompile();
        const relaunch = manager.launch(projectPath, entry);
        await second.started;

        expect(manager.getStatus(projectPath)).toBe("compiling");
        await manager.stop(projectPath);
        await relaunch;
    });
});

/**
 * A runtime only opens its control socket once it has read its pack, which is seconds after the
 * process starts. A stop issued in that window used to hit ECONNREFUSED, report "graceful shutdown
 * failed", and then sit out the full five-second timeout before SIGTERM - so stopping a preview you
 * had just started was always slow and always a kill.
 */
describe("PreviewManager.stop while the runtime is still booting", () => {
    const entry = { kind: "surface", surfaceId: "main" } as GameRuntimeLaunchEntry;
    const projectPath = path.join(os.tmpdir(), "nls-preview-booting-project");
    let servers: WebSocketServer[] = [];

    /** Stands in for the spawned Electron: alive until something asks it to quit. */
    function fakeChild() {
        const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
        child.exitCode = null;
        child.signalCode = null;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        // A real ChildProcess settles exitCode/signalCode as it emits, and the manager reads both
        // to decide whether the process is still around; a fake that only emits looks immortal.
        child.exit = (code: number | null, signal: string | null) => {
            child.exitCode = code;
            child.signalCode = signal;
            child.emit("exit", code, signal);
        };
        child.kill = vi.fn((signal?: string) => {
            (child.exit as (c: number | null, s: string | null) => void)(null, signal ?? "SIGTERM");
            return true;
        });
        return child;
    }

    const makeManager = () => new PreviewManager({
        logger: { error: () => undefined },
        isPackaged: () => false,
        pluginManager: {
            listPlugins: async () => [],
            listRuntimePluginPackSources: async () => [],
        },
        getDistDir: () => path.join(os.tmpdir(), "dist"),
        getUserDataDir: () => path.join(os.tmpdir(), "userdata"),
        // Every host resolves which edition it is running as; this profile picked none.
        getGlobalState: () => ({ get: () => undefined }),
        getAppInfo: () => ({ version: "0.0.0-test" }),
    } as unknown as ConstructorParameters<typeof PreviewManager>[0]);

    beforeEach(() => {
        vi.mocked(spawn).mockReset();
        vi.mocked(compileGameRuntimeArtifactInWorker).mockReset();
    });

    afterEach(async () => {
        await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
        servers = [];
    });

    it("keeps dialling until the control socket answers, and never has to kill", async () => {
        const child = fakeChild();
        vi.mocked(spawn).mockReturnValue(child as never);
        let controlPort = 0;
        vi.mocked(compileGameRuntimeArtifactInWorker).mockImplementation(async (_app, input) => {
            controlPort = input.preview?.controlPort ?? 0;
            return { appDir: path.join(os.tmpdir(), "app"), copiedAssetCount: 0 } as never;
        });

        const manager = makeManager();
        await manager.launch(projectPath, entry);
        expect(controlPort).toBeGreaterThan(0);

        // The runtime comes up 400ms late - well past the first refused dial.
        setTimeout(() => {
            const server = new WebSocketServer({ host: "127.0.0.1", port: controlPort });
            servers.push(server);
            server.on("connection", socket => socket.on("message", () => {
                socket.send(JSON.stringify({ ok: true }));
                // The real runtime acknowledges first and quits a beat later.
                setTimeout(() => (child.exit as (c: number | null, s: string | null) => void)(0, null), 20);
            }));
        }, 400);

        await expect(manager.stop(projectPath)).resolves.toBe("idle");
        // It quit on request. A kill here would mean the retry never landed.
        expect(child.kill).not.toHaveBeenCalled();
    });
});
