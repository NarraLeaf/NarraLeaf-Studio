import crypto from "crypto";
import fs from "fs";
import net from "net";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import chokidar, { type FSWatcher } from "chokidar";
import { type UtilityProcess } from "electron";
import { WebSocket } from "ws";
import { App } from "@/app/app";
import type { DevModeConsoleLogPayload } from "@shared/types/devMode";
import {
    currentGameBuildPlatform,
    normalizeGameBuildArch,
} from "@shared/types/gameBuild";
import type { GameRuntimeLaunchEntry, PreviewStatus } from "@shared/types/gameRuntime";
import { ATOMIC_WRITE_TEMP_PATTERN } from "@shared/utils/fs";
import { buildDependencyPlatformKey } from "../build/preflight";
import { readProjectConfigFromDir } from "../../utils/projectConfigFile";
import { emitWorkspaceConsoleLog } from "../../utils/workspaceConsole";
import { getWorkspaceFreeze, workspaceFrozenMessage } from "../../utils/workspaceFreeze";
import { type GameRuntimeArtifactCompileResult } from "./compiler/gameRuntimeArtifactCompiler";
import { compileGameRuntimeArtifactInWorker } from "./compiler/compileGameRuntimeArtifactInWorker";
import { resolvePackEncryptionKey } from "../security/packKeyService";
import { selectRuntimePluginsForPack, type RuntimePluginPackSelection } from "./selectRuntimePlugins";
import { currentDownloadRewrites } from "../downloadRewrites";

type PreviewSession = {
    id: string;
    projectPath: string;
    entry: GameRuntimeLaunchEntry;
    status: PreviewStatus;
    controlPort: number;
    controlToken: string;
    process: ChildProcess | null;
    watcher: FSWatcher | null;
    reloadTimer: ReturnType<typeof setTimeout> | null;
    artifact: GameRuntimeArtifactCompileResult | null;
};

/**
 * One queued or running call to {@link PreviewManager.launch}, and the two handles a stop needs to
 * unwind it: the flag every step checks, and the compile worker to kill.
 *
 * Separate from {@link PreviewSession} because a stop has to be able to cancel a launch that has no
 * session yet - the port allocation and the teardown of the previous session both happen before one
 * exists, and a stop that arrived in that window used to be lost.
 */
type PreviewLaunchAttempt = {
    cancelled: boolean;
    compileWorker: UtilityProcess | null;
    session: PreviewSession | null;
};

const SHUTDOWN_TIMEOUT_MS = 5000;
/** How long to wait before re-dialling a control socket that is not listening yet. */
const SHUTDOWN_RETRY_DELAY_MS = 150;

/** Outcome of a single dial to a preview runtime's control socket. Never rejects. */
type ShutdownAttempt =
    | { outcome: "done" }
    /** Nothing answered. Normal in the seconds after a launch - worth retrying. */
    | { outcome: "unreachable"; error: Error }
    /** The runtime answered and said no. Retrying would only repeat it. */
    | { outcome: "refused"; error: Error };

type PreviewRunnerResolverApp = Pick<App, "isPackaged" | "resolveResource">;

export function formatPreviewProcessOutput(chunk: Buffer): string | null {
    const text = chunk.toString("utf-8").replace(/\r\n?/g, "\n");
    if (text.trim().length === 0) {
        return null;
    }
    return text.replace(/^\n+|\n+$/g, "");
}

/**
 * The `<platform>-<arch>` key a preview's sidecars are taken from: this host's,
 * because the preview runner is this host's own Electron. A production build
 * picks the key from the target being packaged instead.
 */
export function hostSidecarPlatformKey(): string {
    const platform = currentGameBuildPlatform();
    return buildDependencyPlatformKey(platform, normalizeGameBuildArch(platform, process.arch));
}

export function resolvePreviewRunnerBinaryForApp(
    app: PreviewRunnerResolverApp,
    currentExecutable = process.execPath,
): string {
    if (!app.isPackaged()) {
        if (typeof currentExecutable !== "string" || currentExecutable.length === 0) {
            throw new Error("Current Electron executable path is not available");
        }
        return currentExecutable;
    }
    const runnerDist = app.resolveResource(path.join("preview-runner", "dist"));
    const binary = process.platform === "darwin"
        ? path.join(runnerDist, "Electron.app", "Contents", "MacOS", "Electron")
        : process.platform === "win32"
          ? path.join(runnerDist, "electron.exe")
          : path.join(runnerDist, "electron");
    if (!fs.existsSync(binary)) {
        throw new Error(`Embedded preview runner not found: ${binary}`);
    }
    return binary;
}

export class PreviewManager {
    private readonly sessions = new Map<string, PreviewSession>();
    private readonly operations = new Map<string, Promise<PreviewStatus>>();
    /**
     * Launches queued or in flight, per project. `stop` cancels every one of them - see the note
     * there for why it cannot wait its turn in {@link operations} to do it.
     */
    private readonly launchAttempts = new Map<string, Set<PreviewLaunchAttempt>>();

    constructor(private readonly app: App) {}

    public getStatus(projectPath?: string): PreviewStatus {
        if (projectPath) {
            return this.sessions.get(this.projectKey(projectPath))?.status ?? "idle";
        }
        return [...this.sessions.values()].find(session => session.status !== "idle")?.status ?? "idle";
    }

    /**
     * Start (or restart) the preview runtime for a project.
     *
     * Refuses while the workspace is frozen. `RunControl` already disables Preview there, but a
     * launch is IPC straight into this method - a keybinding, a plugin, a stale renderer or a second
     * window can still ask, and this is the only place that can say no.
     * Dev Mode stays allowed, which is the decision in §1, and nothing here touches it.
     *
     * The guard sits on this entry rather than inside `launchNow` so it also covers the one launch
     * nobody clicks: {@link scheduleRelaunch}, the file-watcher's debounced relaunch. Refusing there
     * leaves the already-running preview alone rather than tearing it down - the previous session is
     * only stopped once `launchNow` starts.
     *
     * Rejects rather than answering "idle": a caller that is not the UI has to be told why, and the
     * console line below is what the author reads (a failed launch IPC reaches the renderer as a
     * status change with the message dropped).
     */
    public launch(projectPath: string, entry: GameRuntimeLaunchEntry): Promise<PreviewStatus> {
        const frozen = getWorkspaceFreeze(projectPath);
        if (frozen) {
            const message = workspaceFrozenMessage(frozen, "preview");
            emitWorkspaceConsoleLog(this.app, projectPath, { level: "error", source: "Preview", message });
            return Promise.reject(new Error(message));
        }
        const key = this.projectKey(projectPath);
        const attempt: PreviewLaunchAttempt = { cancelled: false, compileWorker: null, session: null };
        const attempts = this.launchAttempts.get(key) ?? new Set<PreviewLaunchAttempt>();
        attempts.add(attempt);
        this.launchAttempts.set(key, attempts);

        const running = this.enqueue(key, () => this.launchNow(projectPath, entry, attempt));
        const forget = () => {
            attempts.delete(attempt);
            if (attempts.size === 0 && this.launchAttempts.get(key) === attempts) {
                this.launchAttempts.delete(key);
            }
        };
        running.then(forget, forget);
        return running;
    }

    /**
     * Stop the preview, whatever stage it is at - including one that is still compiling.
     *
     * The cancel happens here, synchronously, rather than inside the queued operation below. A launch
     * holds the per-project queue for the whole artifact compile, which is ~20s on a project with
     * asset protection on, and a stop that only did its work when its turn came did nothing at all
     * while the author watched, then landed *after* the runtime had been spawned and killed the
     * window seconds after it appeared. Cancelling up front is what makes Stop mean something during
     * a compile - and what stops a launch the author already abandoned from opening a window at all.
     *
     * The queued half still runs, and is what tears down a preview that did reach `running`.
     */
    public stop(projectPath: string): Promise<PreviewStatus> {
        const key = this.projectKey(projectPath);
        this.cancelLaunches(key);
        return this.enqueue(key, async () => {
            const session = this.sessions.get(key);
            if (!session) {
                return "idle";
            }
            await this.stopSession(session);
            return "idle";
        });
    }

    /**
     * Tell every queued or in-flight launch for this project to give up, and kill the compile that
     * one of them is probably sitting in. Killing the worker is what makes the cancel immediate:
     * `compileGameRuntimeArtifactInWorker` turns its exit into a rejection, so the launch unwinds
     * within milliseconds instead of at the end of the compile.
     */
    private cancelLaunches(key: string): void {
        for (const attempt of this.launchAttempts.get(key) ?? []) {
            attempt.cancelled = true;
            // So the toolbar reads "stopping" for the moment it takes to unwind, rather than
            // sitting on "compiling" for a compile that is already being abandoned.
            if (attempt.session) {
                attempt.session.status = "stopping";
            }
            attempt.compileWorker?.kill();
            attempt.compileWorker = null;
        }
    }

    /**
     * Bail out of a launch the author has stopped. What catches this reads `attempt.cancelled`
     * rather than the error, because the compile worker's own rejection arrives as a plain Error
     * and has to unwind down exactly the same path.
     */
    private ensureNotCancelled(attempt: PreviewLaunchAttempt): void {
        if (attempt.cancelled) {
            throw new Error("Preview launch cancelled");
        }
    }

    private async launchNow(
        projectPath: string,
        entry: GameRuntimeLaunchEntry,
        attempt: PreviewLaunchAttempt,
    ): Promise<PreviewStatus> {
        const normalizedProjectPath = path.resolve(projectPath);
        const key = this.projectKey(normalizedProjectPath);
        const previous = this.sessions.get(key);
        if (previous) {
            await this.stopSession(previous);
        }
        // A stop that arrived while the previous session was still being torn down was asking for
        // this launch not to happen either. Nothing exists yet, so there is nothing to unwind.
        if (attempt.cancelled) {
            return "idle";
        }

        const session: PreviewSession = {
            id: crypto.randomUUID(),
            projectPath: normalizedProjectPath,
            entry,
            status: "preparing",
            controlPort: await allocateLocalPort(),
            controlToken: crypto.randomBytes(32).toString("hex"),
            process: null,
            watcher: null,
            reloadTimer: null,
            artifact: null,
        };
        attempt.session = session;
        this.sessions.set(key, session);

        try {
            // The port allocation above was awaited, so a stop could have landed against a session
            // that was not yet reachable from `sessions`. It is now.
            this.ensureNotCancelled(attempt);
            this.emitVerbose(session, `launch requested: ${this.describeEntry(entry)}`);
            session.status = "compiling";
            this.emitVerbose(session, "artifact compile started");
            const pluginSelection = await this.selectRuntimePlugins(normalizedProjectPath);
            if (pluginSelection.errors.length > 0) {
                throw new Error(`Plugin validation failed:\n${pluginSelection.errors.join("\n")}`);
            }
            if (pluginSelection.fallbackAll && pluginSelection.selected.length > 0) {
                this.emitVerbose(session, "project has no plugin dependency table; packaging every enabled runtime plugin");
            }
            if (pluginSelection.skippedPluginIds.length > 0) {
                this.emitVerbose(session, `runtime plugins not packaged (unused by this project): ${pluginSelection.skippedPluginIds.join(", ")}`);
            }
            if (pluginSelection.selected.length > 0) {
                this.emitVerbose(session, `packaging runtime plugin(s): ${pluginSelection.selected.map(source => source.manifest.id).join(", ")}`);
            }
            const encryptionKey = await this.resolveEncryptionKey(normalizedProjectPath);
            if (encryptionKey) {
                this.emitVerbose(session, "asset protection enabled; encrypting pack");
            }
            this.ensureNotCancelled(attempt);
            // Compiled in a forked utility process, not on the main thread:
            // sealing a protected pack drives the native codec through many
            // seconds of synchronous CPU that would otherwise freeze Studio.
            const artifact = await compileGameRuntimeArtifactInWorker(this.app, {
                projectPath: normalizedProjectPath,
                entry,
                runtimeDistDir: this.getRuntimeDistDir(),
                runtimeVersion: this.readRuntimeVersion(),
                outputRoot: path.join(normalizedProjectPath, ".nlstudio", "preview"),
                preview: {
                    controlPort: session.controlPort,
                    controlToken: session.controlToken,
                },
                runtimePlugins: pluginSelection.selected,
                mode: "preview",
                encryptionKey,
                // A preview runs on this machine, so it ships this machine's
                // sidecars. Without this the preview would be the one shell that
                // silently lacks them, and testing a sidecar would mean a full
                // production build every time - which is exactly the loop a
                // preview exists to avoid.
                sidecarPlatformKey: hostSidecarPlatformKey(),
                // `dep:` sidecar includes resolve through the build dependency
                // cache, so the compile needs its root even in preview.
                hostUserDataDir: this.app.getUserDataDir(),
                downloadRewrites: currentDownloadRewrites(),
            }, {
                // Tracked so `cancelLaunches` can kill the compile mid-flight; without this a stop
                // could only ever be honoured once the compile had run to completion.
                onStart: worker => { attempt.compileWorker = worker; },
                cancelled: () => attempt.cancelled,
            });
            attempt.compileWorker = null;
            this.ensureNotCancelled(attempt);
            session.artifact = artifact;
            this.emitVerbose(
                session,
                `artifact compile finished: ${path.relative(normalizedProjectPath, artifact.appDir)} (${artifact.copiedAssetCount} asset(s))`,
            );

            session.status = "launching";
            // The last point at which a cancel is free. Everything from the spawn below to
            // `return session.status` is synchronous, so nothing can land in between; a stop that
            // arrives after this one goes through the queued teardown instead.
            this.ensureNotCancelled(attempt);
            const electronBinary = this.resolvePreviewRunnerBinary();
            session.process = spawn(electronBinary, [artifact.appDir], {
                cwd: artifact.appDir,
                stdio: ["ignore", "pipe", "pipe"],
                env: {
                    ...process.env,
                    NARRALEAF_STUDIO_PREVIEW: "1",
                },
            });
            this.attachProcessLogging(session);
            const child = session.process;
            child.once("exit", (code, signal) => {
                this.emitVerbose(session, `runtime exited: code=${code ?? "null"} signal=${signal ?? "null"}`);
                this.disposeWatcher(session);
                this.clearReloadTimer(session);
                session.process = null;
                if (this.sessions.get(key) === session) {
                    this.sessions.delete(key);
                }
            });
            session.status = "running";
            this.watchProjectFiles(session);
            this.emitWorkspaceConsoleLog(session, {
                level: "success",
                source: "Preview",
                message: "Preview runtime launched",
            });
            return session.status;
        } catch (error) {
            // A cancel is the author getting what they asked for, not a failure: leave no session
            // behind (so the queued stop finds nothing to tear down) and report plain "idle", so
            // the toolbar goes back to Run rather than showing an error the author caused.
            if (attempt.cancelled) {
                this.discardSession(key, session);
                this.emitWorkspaceConsoleLog(session, {
                    level: "warning",
                    source: "Preview",
                    message: "launch cancelled",
                });
                return "idle";
            }
            const message = error instanceof Error ? error.message : String(error);
            session.status = "error";
            this.app.logger.error("[Preview] launch failed", error);
            this.emitWorkspaceConsoleLog(session, {
                level: "error",
                source: "Preview",
                message: `launch failed: ${message}`,
            });
            return "error";
        }
    }

    /** Drop a session that never reached a running runtime. Nothing to shut down, only to forget. */
    private discardSession(key: string, session: PreviewSession): void {
        this.disposeWatcher(session);
        this.clearReloadTimer(session);
        session.status = "idle";
        if (this.sessions.get(key) === session) {
            this.sessions.delete(key);
        }
    }

    /**
     * Resolve which plugin runtime entries ship with this project's pack: the
     * project dependency table drives selection; static blueprint-node
     * validation turns a would-be silent runtime failure into a launch error.
     */
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

    /**
     * Resolve the pack key for this project, or undefined when asset protection
     * is off. Preview runs the same path Production will.
     */
    private async resolveEncryptionKey(projectPath: string): Promise<string | undefined> {
        const projectConfig = await readProjectConfigFromDir(projectPath).catch(() => null);
        const enabled =
            (projectConfig?.app as { security?: { encryptAssets?: unknown } } | undefined)?.security?.encryptAssets === true;
        if (!enabled) {
            return undefined;
        }
        return resolvePackEncryptionKey(this.app.getUserDataDir(), projectPath);
    }

    private async stopSession(session: PreviewSession): Promise<void> {
        session.status = "stopping";
        this.emitVerbose(session, "stop requested");
        this.disposeWatcher(session);
        this.clearReloadTimer(session);

        const child = session.process;
        if (child && isChildRunning(child)) {
            await this.requestRuntimeShutdown(session).catch(error => {
                this.emitWorkspaceConsoleLog(session, {
                    level: "warning",
                    source: "Preview",
                    message: `graceful shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
                });
            });
            const exited = await waitForChildExit(child, SHUTDOWN_TIMEOUT_MS);
            if (!exited && isChildRunning(child)) {
                this.emitWorkspaceConsoleLog(session, {
                    level: "warning",
                    source: "Preview",
                    message: "runtime did not exit in time; killing process",
                });
                child.kill("SIGTERM");
                await waitForChildExit(child, 1000);
                if (isChildRunning(child)) {
                    child.kill("SIGKILL");
                }
            }
        }
        session.process = null;

        if (this.sessions.get(this.projectKey(session.projectPath)) === session) {
            this.sessions.delete(this.projectKey(session.projectPath));
        }
    }

    /**
     * Ask the runtime to quit itself over its control socket, retrying until it is listening.
     *
     * The retry is the point. The control server only starts once the runtime has read its pack, so
     * a stop issued in the first seconds after a launch always arrives before anything is listening
     * - and a single dial that gave up on that refusal reported "graceful shutdown failed", then sat
     * out the whole {@link SHUTDOWN_TIMEOUT_MS} before SIGTERM. Stopping a preview you just started
     * therefore always took five seconds and always ended in a kill.
     *
     * Bounded by the same deadline, and abandoned the moment the child exits on its own.
     */
    private async requestRuntimeShutdown(session: PreviewSession): Promise<void> {
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
            // A runtime that answered and refused will refuse again; only silence is worth retrying.
            if (attempt.outcome === "refused" || Date.now() + SHUTDOWN_RETRY_DELAY_MS >= deadline) {
                throw attempt.error;
            }
            await delay(SHUTDOWN_RETRY_DELAY_MS);
        }
    }

    private watchProjectFiles(session: PreviewSession): void {
        if (session.watcher) {
            return;
        }
        const projectPath = session.projectPath;
        const uidocPath = path.join(projectPath, "editor", "ui", "uidoc.json");
        const uigraphsPath = path.join(projectPath, "editor", "ui", "uigraphs.json");
        const storyRoot = path.join(projectPath, "editor", "story");
        const characterStorePath = path.join(projectPath, "editor", "services", "character.json");
        const assetsRoot = path.join(projectPath, "assets");
        const blueprintMetaPath = path.join(assetsRoot, "assets.metadata.blueprint.json");
        const assetsContentRoot = path.join(assetsRoot, "content");
        session.watcher = chokidar.watch(
            [
                uidocPath,
                uigraphsPath,
                storyRoot,
                characterStorePath,
                blueprintMetaPath,
                assetsContentRoot,
                assetsRoot,
            ],
            // See DevModeManager: the atomic writer's scratch siblings are not project changes.
            { ignoreInitial: true, ignored: ATOMIC_WRITE_TEMP_PATTERN },
        );
        session.watcher.on("add", file => this.scheduleRelaunch(session, "add", file));
        session.watcher.on("change", file => this.scheduleRelaunch(session, "change", file));
        session.watcher.on("unlink", file => this.scheduleRelaunch(session, "unlink", file));
    }

    private scheduleRelaunch(session: PreviewSession, event: string, file: string): void {
        this.clearReloadTimer(session);
        this.emitVerbose(session, `project file ${event}; scheduling relaunch: ${path.relative(session.projectPath, file)}`);
        session.reloadTimer = setTimeout(() => {
            session.reloadTimer = null;
            void this.launch(session.projectPath, session.entry).catch(error => {
                this.app.logger.error("[Preview] relaunch failed", error);
            });
        }, 300);
    }

    private attachProcessLogging(session: PreviewSession): void {
        const child = session.process;
        if (!child) {
            return;
        }
        child.stdout?.on("data", chunk => {
            this.emitProcessOutput(session, "info", chunk);
        });
        child.stderr?.on("data", chunk => {
            this.emitProcessOutput(session, "warning", chunk);
        });
        child.on("error", error => {
            this.emitWorkspaceConsoleLog(session, {
                level: "error",
                source: "Preview",
                message: error.message,
            });
        });
    }

    private emitProcessOutput(session: PreviewSession, level: DevModeConsoleLogPayload["level"], chunk: Buffer): void {
        const message = formatPreviewProcessOutput(chunk);
        if (!message) {
            return;
        }
        this.emitWorkspaceConsoleLog(session, {
            level,
            source: "Preview Runtime",
            message,
        });
    }

    private disposeWatcher(session: PreviewSession): void {
        if (!session.watcher) {
            return;
        }
        void session.watcher.close();
        session.watcher = null;
    }

    private clearReloadTimer(session: PreviewSession): void {
        if (!session.reloadTimer) {
            return;
        }
        clearTimeout(session.reloadTimer);
        session.reloadTimer = null;
    }

    private enqueue(projectPath: string, operation: () => Promise<PreviewStatus>): Promise<PreviewStatus> {
        const key = this.projectKey(projectPath);
        const previous = this.operations.get(key) ?? Promise.resolve("idle" as PreviewStatus);
        const next = previous
            .catch(() => "error" as PreviewStatus)
            .then(operation);
        const tracked = next.finally(() => {
            if (this.operations.get(key) === tracked) {
                this.operations.delete(key);
            }
        });
        this.operations.set(key, tracked);
        return next;
    }

    private getRuntimeDistDir(): string {
        return path.join(this.app.getDistDir(), "runtime");
    }

    private readRuntimeVersion(): string {
        try {
            return this.app.getAppInfo().version;
        } catch {
            return "0.0.0";
        }
    }

    private resolvePreviewRunnerBinary(): string {
        return resolvePreviewRunnerBinaryForApp(this.app);
    }

    private emitVerbose(session: PreviewSession, message: string): void {
        this.emitWorkspaceConsoleLog(session, {
            level: "verbose",
            source: "Preview",
            message,
        });
    }

    private emitWorkspaceConsoleLog(session: PreviewSession, payload: DevModeConsoleLogPayload): void {
        emitWorkspaceConsoleLog(this.app, session.projectPath, payload);
    }

    private describeEntry(entry: GameRuntimeLaunchEntry): string {
        if (entry.kind === "surface") {
            return `surface ${entry.surfaceId}`;
        }
        return `story ${entry.storyId}:${entry.sceneId}`;
    }

    private projectKey(projectPath: string): string {
        return path.resolve(projectPath);
    }
}

function allocateLocalPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                server.close();
                reject(new Error("Failed to allocate local preview port"));
                return;
            }
            const port = address.port;
            server.close(error => {
                if (error) {
                    reject(error);
                } else {
                    resolve(port);
                }
            });
        });
    });
}

/**
 * One dial to a preview runtime's control socket. Resolves with what happened rather than
 * rejecting, so the caller can tell "nobody is listening yet" from "it said no".
 */
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
        // Connection refused while the runtime is still booting lands here, and is the reason the
        // caller retries rather than treating the first error as the answer.
        ws.on("error", error => settle({ outcome: "unreachable", error }));
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
