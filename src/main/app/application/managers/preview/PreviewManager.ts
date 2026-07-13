import crypto from "crypto";
import fs from "fs";
import net from "net";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import chokidar, { type FSWatcher } from "chokidar";
import { WebSocket } from "ws";
import { App } from "@/app/app";
import { AppWindow } from "../window/appWindow";
import { WindowAppType } from "@shared/types/window";
import { IPCEventType } from "@shared/types/ipcEvents";
import type { DevModeConsoleLogPayload } from "@shared/types/devMode";
import type { GameRuntimeLaunchEntry, PreviewStatus } from "@shared/types/gameRuntime";
import { readProjectConfigFromDir } from "../../utils/projectConfigFile";
import {
    compileGameRuntimePreviewArtifact,
    type GameRuntimeArtifactCompileResult,
} from "./compiler/gameRuntimeArtifactCompiler";
import { selectRuntimePluginsForPack, type RuntimePluginPackSelection } from "./selectRuntimePlugins";

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

const SHUTDOWN_TIMEOUT_MS = 5000;

type PreviewRunnerResolverApp = Pick<App, "isPackaged" | "resolveResource">;

export function formatPreviewProcessOutput(chunk: Buffer): string | null {
    const text = chunk.toString("utf-8").replace(/\r\n?/g, "\n");
    if (text.trim().length === 0) {
        return null;
    }
    return text.replace(/^\n+|\n+$/g, "");
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

    constructor(private readonly app: App) {}

    public getStatus(projectPath?: string): PreviewStatus {
        if (projectPath) {
            return this.sessions.get(this.projectKey(projectPath))?.status ?? "idle";
        }
        return [...this.sessions.values()].find(session => session.status !== "idle")?.status ?? "idle";
    }

    public launch(projectPath: string, entry: GameRuntimeLaunchEntry): Promise<PreviewStatus> {
        return this.enqueue(projectPath, () => this.launchNow(projectPath, entry));
    }

    public stop(projectPath: string): Promise<PreviewStatus> {
        return this.enqueue(projectPath, async () => {
            const session = this.sessions.get(this.projectKey(projectPath));
            if (!session) {
                return "idle";
            }
            await this.stopSession(session);
            return "idle";
        });
    }

    private async launchNow(projectPath: string, entry: GameRuntimeLaunchEntry): Promise<PreviewStatus> {
        const normalizedProjectPath = path.resolve(projectPath);
        const key = this.projectKey(normalizedProjectPath);
        const previous = this.sessions.get(key);
        if (previous) {
            await this.stopSession(previous);
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
        this.sessions.set(key, session);

        try {
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
            const artifact = await compileGameRuntimePreviewArtifact({
                projectPath: normalizedProjectPath,
                entry,
                runtimeDistDir: this.getRuntimeDistDir(),
                runtimeVersion: this.readRuntimeVersion(),
                controlPort: session.controlPort,
                controlToken: session.controlToken,
                runtimePlugins: pluginSelection.selected,
            });
            session.artifact = artifact;
            this.emitVerbose(
                session,
                `artifact compile finished: ${path.relative(normalizedProjectPath, artifact.appDir)} (${artifact.copiedAssetCount} asset(s))`,
            );

            session.status = "launching";
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

    private requestRuntimeShutdown(session: PreviewSession): Promise<void> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${session.controlPort}`);
            const timeout = setTimeout(() => {
                ws.close();
                reject(new Error("shutdown websocket timed out"));
            }, SHUTDOWN_TIMEOUT_MS);
            ws.on("open", () => {
                ws.send(JSON.stringify({
                    type: "shutdown",
                    token: session.controlToken,
                }));
            });
            ws.on("message", raw => {
                clearTimeout(timeout);
                let payload: { ok?: unknown; error?: unknown };
                try {
                    payload = JSON.parse(raw.toString()) as { ok?: unknown; error?: unknown };
                } catch {
                    ws.close();
                    reject(new Error("invalid shutdown response"));
                    return;
                }
                ws.close();
                if (payload.ok === true) {
                    resolve();
                } else {
                    reject(new Error(typeof payload.error === "string" ? payload.error : "shutdown rejected"));
                }
            });
            ws.on("error", error => {
                clearTimeout(timeout);
                reject(error);
            });
        });
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
            { ignoreInitial: true },
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
        const workspaceWindow = this.findWorkspaceWindow(session.projectPath);
        if (!workspaceWindow) {
            return;
        }
        workspaceWindow.sendIpcEvent(IPCEventType.workspaceDevModeConsoleLog, {
            timestamp: Date.now(),
            ...payload,
        });
    }

    private findWorkspaceWindow(projectPath: string): AppWindow<WindowAppType.Workspace> | undefined {
        return this.app.windowManager
            .getWindows()
            .find(
                w =>
                    w.getWindowType() === WindowAppType.Workspace &&
                    !w.isDestroyed() &&
                    !w.isClosed() &&
                    path.normalize(w.getProps().projectPath) === path.normalize(projectPath),
            ) as AppWindow<WindowAppType.Workspace> | undefined;
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
