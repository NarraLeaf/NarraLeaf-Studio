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
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { PREVIEW_AS_SHIPPED_SETTINGS_KEY } from "../../utils/previewAsShipped";
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
// The key itself comes from a native binding and from secrets on disk. What these cases are about is
// which launches ask for one at all, so a fixed answer says more than a real derivation would.
vi.mock("../security/packKeyService", () => ({
    resolvePackEncryptionKey: async () => "pack-key-for-this-machine",
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
        // A trusting ledger: these cases are about what the manager does once it is allowed to
        // start, not about who may start it. The refusal has its own tests.
        projectTrustManager: { isTrusted: () => true },
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

    it("launches during a live session, the one freeze that is not about consistency", async () => {
        // The session's content is on the working tree, which is what a preview runs, so the guard
        // has nothing to protect the author from here.
        reportWorkspaceFreeze(projectPath, "live-session");

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
        // A trusting ledger: these cases are about what the manager does once it is allowed to
        // start, not about who may start it. The refusal has its own tests.
        projectTrustManager: { isTrusted: () => true },
        pluginManager: {
            listPlugins: async () => [],
            listRuntimePluginPackSources: async () => [],
        },
        getDistDir: () => path.join(os.tmpdir(), "dist"),
        getUserDataDir: () => path.join(os.tmpdir(), "userdata"),
        getCacheRootDir: () => path.join(os.tmpdir(), "userdata", "nl-cache"),
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

    // Windows only, and reported as skipped elsewhere rather than passing vacuously: case is part
    // of a project's identity there and nowhere else.
    it.runIf(process.platform === "win32")("stops a session started under a differently-cased path", async () => {
        // The session table is keyed by project identity, not by the spelling the caller used -
        // the same rule the window lookup follows. A workspace closing hands over whatever path it
        // was opened with, and a session it could not find is one that keeps running with nothing
        // left to stop it.
        const compile = stallingCompile();
        const manager = makeManager();
        const launch = manager.launch(projectPath, entry);
        await compile.started;

        await expect(manager.stop(projectPath.toUpperCase())).resolves.toBe("idle");
        expect(compile.worker.kill).toHaveBeenCalled();
        await expect(launch).resolves.toBe("idle");
    });

    it("stopAll reaches every project, not just the first", async () => {
        // What the quit teardown relies on: a preview is a separate process, and on macOS and Linux
        // nothing else would ever end it.
        const compile = stallingCompile();
        const manager = makeManager();
        const second = path.join(os.tmpdir(), "nls-preview-cancel-project-2");
        const launches = [manager.launch(projectPath, entry), manager.launch(second, entry)];
        await compile.started;

        await manager.stopAll();

        expect(manager.getStatus(projectPath)).toBe("idle");
        expect(manager.getStatus(second)).toBe("idle");
        await Promise.all(launches.map(launch => expect(launch).resolves.toBe("idle")));
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
        // A trusting ledger: these cases are about what the manager does once it is allowed to
        // start, not about who may start it. The refusal has its own tests.
        projectTrustManager: { isTrusted: () => true },
        isPackaged: () => false,
        pluginManager: {
            listPlugins: async () => [],
            listRuntimePluginPackSources: async () => [],
        },
        getDistDir: () => path.join(os.tmpdir(), "dist"),
        getUserDataDir: () => path.join(os.tmpdir(), "userdata"),
        getCacheRootDir: () => path.join(os.tmpdir(), "userdata", "nl-cache"),
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

describe("PreviewManager.resetPlayerData", () => {
    const entry = { kind: "surface", surfaceId: "main" } as GameRuntimeLaunchEntry;
    const makeManager = () => new PreviewManager({
        logger: { error: () => undefined },
        pluginManager: {
            listPlugins: async () => [],
            listRuntimePluginPackSources: async () => [],
        },
        getDistDir: () => path.join(os.tmpdir(), "dist"),
        getUserDataDir: () => path.join(os.tmpdir(), "userdata"),
        getCacheRootDir: () => path.join(os.tmpdir(), "userdata", "nl-cache"),
        getGlobalState: () => ({ get: () => undefined }),
        getAppInfo: () => ({ version: "0.0.0-test" }),
        // A launch asks whether the project may run at all, and the gate refuses when it cannot
        // find out - absence of a ledger is not permission. These cases reach `launch` only to put
        // a session into the state they are really about, so the answer here is simply yes.
        projectTrustManager: { isTrusted: () => true },
    } as unknown as ConstructorParameters<typeof PreviewManager>[0]);

    /** A compile that never resolves on its own, so its session stays in "compiling" until stopped. */
    function stallingCompile() {
        const worker = { kill: vi.fn() };
        const started = new Promise<void>(resolve => {
            vi.mocked(compileGameRuntimeArtifactInWorker).mockImplementation((_app, _input, hooks) => {
                hooks?.onStart?.(worker as never);
                resolve();
                // The real worker turns kill() into an exit the helper reports as a rejection; mirror
                // that so a stop actually unwinds this launch.
                return new Promise((_res, rej) => {
                    worker.kill.mockImplementation(() => rej(new Error("Build cancelled")));
                });
            });
        });
        return { started };
    }

    let projectDir = "";
    let userDataDir = "";

    beforeEach(async () => {
        vi.mocked(spawn).mockReset();
        vi.mocked(compileGameRuntimeArtifactInWorker).mockReset();
        projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-preview-reset-"));
        userDataDir = path.join(projectDir, ".nlstudio", "preview", "userData");
        await fs.mkdir(path.join(userDataDir, "saves"), { recursive: true });
        await fs.writeFile(path.join(userDataDir, "saves", "slot.json"), "{}", "utf-8");
        await fs.writeFile(path.join(userDataDir, "persistence.json"), "{}", "utf-8");
        // A file that is neither a save nor persistence stands in for the Chromium profile, to prove
        // the reset leaves it alone.
        await fs.writeFile(path.join(userDataDir, "geometry.json"), "{}", "utf-8");
    });

    afterEach(async () => {
        await fs.rm(projectDir, { recursive: true, force: true });
    });

    it("removes the saves and persistence but nothing else, and is a no-op when they are gone", async () => {
        const manager = makeManager();

        await manager.resetPlayerData(projectDir);

        await expect(fs.access(path.join(userDataDir, "saves"))).rejects.toThrow();
        await expect(fs.access(path.join(userDataDir, "persistence.json"))).rejects.toThrow();
        // The rest of the runtime profile survives - it is a cache the next launch rebuilds, not the
        // author's game state.
        await expect(fs.access(path.join(userDataDir, "geometry.json"))).resolves.toBeUndefined();

        // Clearing an already-clear project is success, not an error: nothing was there to remove.
        await expect(manager.resetPlayerData(projectDir)).resolves.toBeUndefined();
    });

    it("clears even after a failed launch left an errored session - that session writes nothing", async () => {
        const manager = makeManager();
        // The compile mock resolves undefined, so launchNow throws reaching for the artifact and the
        // session lands in "error". The reset is exactly what an author reaches for at that point.
        await expect(manager.launch(projectDir, entry)).resolves.toBe("error");

        await expect(manager.resetPlayerData(projectDir)).resolves.toBeUndefined();
        await expect(fs.access(path.join(userDataDir, "persistence.json"))).rejects.toThrow();
    });

    it("refuses while a preview for the project is genuinely running", async () => {
        const manager = makeManager();
        const compile = stallingCompile();
        const launch = manager.launch(projectDir, entry);
        await compile.started;

        // The session is stuck in "compiling" - a live launch with a process on the way.
        await expect(manager.resetPlayerData(projectDir)).rejects.toThrow(/Stop the preview/);
        // The refusal touched nothing.
        await expect(fs.access(path.join(userDataDir, "persistence.json"))).resolves.toBeUndefined();

        await manager.stop(projectDir);
        await expect(launch).resolves.toBe("idle");
    });
});
/**
 * Whether a preview holds its content as loose files or in the sealed store a protected build ships.
 *
 * Sealing costs several seconds on every launch, because the store is written whole and a story edit
 * changes the pack - so an everyday preview of a protected project runs loose files, and rehearsing
 * the shipped form is something this machine asks for. What the two must not become is two different
 * compiles: the sealed one has to be the artifact a protected build produces, or rehearsing it proves
 * nothing. That is the assertion below - one field apart, the compiler is handed the same thing.
 */
describe("PreviewManager and the shipped form of a protected project", () => {
    const entry = { kind: "surface", surfaceId: "main" } as GameRuntimeLaunchEntry;
    let projectDir = "";
    let globalState: Record<string, unknown> = {};

    const makeManager = () => new PreviewManager({
        logger: { error: () => undefined },
        projectTrustManager: { isTrusted: () => true },
        isPackaged: () => false,
        pluginManager: {
            listPlugins: async () => [],
            listRuntimePluginPackSources: async () => [],
        },
        getDistDir: () => path.join(os.tmpdir(), "dist"),
        getUserDataDir: () => path.join(os.tmpdir(), "userdata"),
        getCacheRootDir: () => path.join(os.tmpdir(), "userdata", "nl-cache"),
        getGlobalState: () => ({ get: (key: string) => globalState[key] }),
        getAppInfo: () => ({ version: "0.0.0-test" }),
    } as unknown as ConstructorParameters<typeof PreviewManager>[0]);

    /** Stands in for the spawned Electron, alive and doing nothing. */
    function fakeChild() {
        const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
        child.exitCode = null;
        child.signalCode = null;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn(() => true);
        return child;
    }

    async function writeProjectConfig(encryptAssets: boolean): Promise<void> {
        await fs.writeFile(
            path.join(projectDir, "Tiny Shadows.nlproj"),
            encodeProjectConfig({
                name: "Tiny Shadows",
                app: { security: { encryptAssets } },
            } as never),
        );
    }

    /**
     * Launch once and hand back what the compiler was asked to build.
     *
     * Never stopped: the stand-in process below answers no control socket, so a stop would spend the
     * shutdown deadline before killing something that was never alive.
     */
    async function compileInputOfOneLaunch(): Promise<Record<string, unknown>> {
        await makeManager().launch(projectDir, entry);
        const call = vi.mocked(compileGameRuntimeArtifactInWorker).mock.calls.at(-1);
        expect(call).toBeDefined();
        return call![1] as unknown as Record<string, unknown>;
    }

    beforeEach(async () => {
        globalState = {};
        projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-preview-shipped-"));
        await writeProjectConfig(true);
        vi.mocked(spawn).mockReset();
        vi.mocked(spawn).mockImplementation(() => fakeChild() as never);
        vi.mocked(compileGameRuntimeArtifactInWorker).mockReset();
        vi.mocked(compileGameRuntimeArtifactInWorker).mockResolvedValue({
            appDir: path.join(projectDir, ".nlstudio", "preview", "app"),
            copiedAssetCount: 0,
        } as never);
    });

    afterEach(async () => {
        await fs.rm(projectDir, { recursive: true, force: true });
    });

    it("runs loose files by default, protected project or not", async () => {
        // The everyday preview. Sealing the store on every launch would be paid on every story edit,
        // for an artifact nobody receives.
        expect((await compileInputOfOneLaunch()).encryptionKey).toBeUndefined();
    });

    it("seals once this machine asks for it, and changes nothing else about the compile", async () => {
        const loose = await compileInputOfOneLaunch();
        globalState[PREVIEW_AS_SHIPPED_SETTINGS_KEY] = { [normalizeProjectPath(projectDir)]: true };
        const sealed = await compileInputOfOneLaunch();

        expect(sealed.encryptionKey).toBe("pack-key-for-this-machine");
        // Everything else is what it was, because "as shipped" has to mean the artifact a protected
        // build produces rather than a third kind of artifact only preview can make. The control
        // channel is exempt: a port and a token are minted per launch.
        expect(withoutPerLaunchFields(sealed)).toEqual(withoutPerLaunchFields(loose));
    });

    it("has nothing to seal where the project does not protect its assets", async () => {
        await writeProjectConfig(false);
        globalState[PREVIEW_AS_SHIPPED_SETTINGS_KEY] = { [normalizeProjectPath(projectDir)]: true };

        expect((await compileInputOfOneLaunch()).encryptionKey).toBeUndefined();
    });

    it("belongs to one project, not to the machine", async () => {
        globalState[PREVIEW_AS_SHIPPED_SETTINGS_KEY] = {
            [normalizeProjectPath(path.join(os.tmpdir(), "some-other-project"))]: true,
        };

        expect((await compileInputOfOneLaunch()).encryptionKey).toBeUndefined();
    });

    function withoutPerLaunchFields(input: Record<string, unknown>): Record<string, unknown> {
        const rest = { ...input };
        delete rest.encryptionKey;
        delete rest.preview;
        return rest;
    }
});
