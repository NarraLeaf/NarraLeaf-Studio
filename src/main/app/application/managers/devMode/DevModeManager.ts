import path from "path";
import crypto from "crypto";
import chokidar, { FSWatcher } from "chokidar";
import { App } from "@/app/app";
import { AppWindow } from "../window/appWindow";
import { IPCEventType } from "@shared/types/ipcEvents";
import { DevModeBundle, DevModeEntry, DevModeStatus } from "@shared/types/devMode";
import { WindowAppType } from "@shared/types/window";
import { Fs } from "@shared/utils/fs";
import { INLangCompiler, NullNLangCompiler } from "./compiler/INLangCompiler";

type DevModeSession = {
    id: string;
    projectPath: string;
    entry: DevModeEntry;
    status: DevModeStatus;
    window: AppWindow<WindowAppType.DevMode> | null;
    windowReady: boolean;
    revision: number;
    watcher: FSWatcher | null;
    pendingBundle: DevModeBundle | null;
    reloadTimer: ReturnType<typeof setTimeout> | null;
};

export class DevModeManager {
    private session: DevModeSession | null = null;
    private readonly compiler: INLangCompiler;

    constructor(private readonly app: App, compiler?: INLangCompiler) {
        this.compiler = compiler ?? new NullNLangCompiler();
    }

    public getStatus(): DevModeStatus {
        return this.session?.status ?? "idle";
    }

    public async launch(projectPath: string, entry: DevModeEntry): Promise<DevModeStatus> {
        if (!this.session) {
            this.session = this.createSession(projectPath, entry);
        } else {
            this.session.projectPath = projectPath;
            this.session.entry = entry;
        }
        const session = this.session;
        await this.startOrFocusWindow(session);
        await this.compileAndSendBundle(session, "starting");
        this.watchProjectFiles(session);
        return session.status;
    }

    public async stop(): Promise<DevModeStatus> {
        if (!this.session) {
            return "idle";
        }
        this.session.status = "stopping";
        this.disposeWatcher(this.session);
        this.clearReloadTimer(this.session);
        if (this.session.window && !this.session.window.isClosed()) {
            this.session.window.close();
        }
        this.session = null;
        return "idle";
    }

    public async reload(): Promise<DevModeStatus> {
        if (!this.session) {
            return "idle";
        }
        await this.compileAndSendBundle(this.session, "reloading");
        return this.session.status;
    }

    private createSession(projectPath: string, entry: DevModeEntry): DevModeSession {
        return {
            id: crypto.randomUUID(),
            projectPath,
            entry,
            status: "starting",
            window: null,
            windowReady: false,
            revision: 0,
            watcher: null,
            pendingBundle: null,
            reloadTimer: null,
        };
    }

    private async startOrFocusWindow(session: DevModeSession): Promise<void> {
        if (session.window && !session.window.isClosed()) {
            session.window.show();
            session.window.win.focus();
            return;
        }

        const window = await this.app.launchDevMode({
            projectPath: session.projectPath,
            entry: session.entry,
        });
        session.window = window;
        session.windowReady = false;
        window.onClose(() => {
            this.disposeWatcher(session);
            this.clearReloadTimer(session);
            if (this.session === session) {
                this.session = null;
            }
        });
        window.onReady(() => {
            session.windowReady = true;
            if (session.pendingBundle) {
                this.sendBundle(session, session.pendingBundle);
                session.pendingBundle = null;
            }
        });
    }

    private async compileAndSendBundle(session: DevModeSession, status: DevModeStatus): Promise<void> {
        session.status = status;
        const compileResult = await this.compiler.compile({ projectPath: session.projectPath });
        if (!compileResult.ok) {
            session.status = "error";
            this.app.logger.error("[DevMode] nlang compile failed", compileResult.errors ?? []);
            return;
        }
        const bundle = await this.buildBundle(session, compileResult.artifacts);
        this.sendBundle(session, bundle);
        session.status = "running";
    }

    private async buildBundle(session: DevModeSession, compiled?: Record<string, unknown>): Promise<DevModeBundle> {
        const uidocPath = path.join(session.projectPath, "editor", "ui", "uidoc.json");
        const uigraphsPath = path.join(session.projectPath, "editor", "ui", "uigraphs.json");
        const uidoc = await this.readJsonFile(uidocPath);
        const uigraphs = await this.readJsonFile(uigraphsPath);
        session.revision += 1;
        return {
            bundleId: session.id,
            revision: session.revision,
            timestamp: new Date().toISOString(),
            ui: {
                uidoc,
                uigraphs,
            },
            compiled,
        };
    }

    private async readJsonFile<T = any>(filePath: string): Promise<T> {
        const result = await Fs.read(filePath, "utf-8");
        if (!result.ok) {
            throw new Error(result.error?.message ?? `Failed to read ${filePath}`);
        }
        return JSON.parse(result.data) as T;
    }

    private watchProjectFiles(session: DevModeSession): void {
        if (session.watcher) {
            return;
        }
        const uidocPath = path.join(session.projectPath, "editor", "ui", "uidoc.json");
        const uigraphsPath = path.join(session.projectPath, "editor", "ui", "uigraphs.json");
        session.watcher = chokidar.watch([uidocPath, uigraphsPath], { ignoreInitial: true });
        session.watcher.on("add", () => this.scheduleReload(session));
        session.watcher.on("change", () => this.scheduleReload(session));
        session.watcher.on("unlink", () => this.scheduleReload(session));
    }

    private scheduleReload(session: DevModeSession): void {
        this.clearReloadTimer(session);
        session.reloadTimer = setTimeout(() => {
            session.reloadTimer = null;
            void this.reload().catch(err => {
                this.app.logger.error("[DevMode] reload failed", err);
            });
        }, 200);
    }

    private clearReloadTimer(session: DevModeSession): void {
        if (!session.reloadTimer) {
            return;
        }
        clearTimeout(session.reloadTimer);
        session.reloadTimer = null;
    }

    private disposeWatcher(session: DevModeSession): void {
        if (!session.watcher) {
            return;
        }
        void session.watcher.close();
        session.watcher = null;
    }

    private sendBundle(session: DevModeSession, bundle: DevModeBundle): void {
        const window = session.window;
        if (!window || window.isClosed() || !session.windowReady) {
            session.pendingBundle = bundle;
            return;
        }
        window.sendIpcEvent(IPCEventType.devModePayloadUpdate, { bundle });
        window.sendIpcEvent(IPCEventType.devModeControlReload, { revision: bundle.revision });
    }
}
