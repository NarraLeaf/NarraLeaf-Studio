import path from "path";
import crypto from "crypto";
import chokidar, { FSWatcher } from "chokidar";
import { App } from "@/app/app";
import { AppWindow } from "../window/appWindow";
import { IPCEventType } from "@shared/types/ipcEvents";
import { DevModeBundle, DevModeEntry, DevModeStatus } from "@shared/types/devMode";
import { WindowAppType } from "@shared/types/window";
import { INLangCompiler, NullNLangCompiler } from "./compiler/INLangCompiler";
import { compileAllBlueprintScriptsForProject } from "./compiler/blueprint/compileProjectBlueprintScripts";
import { devModeDiskBundleSource } from "./pipeline/bundleAssembler";
import type { DevModeBundleSource } from "./pipeline/types";

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
    pendingError: string | null;
    reloadTimer: ReturnType<typeof setTimeout> | null;
};

export class DevModeManager {
    private session: DevModeSession | null = null;
    private readonly compiler: INLangCompiler;
    private readonly bundleSource: DevModeBundleSource;

    constructor(private readonly app: App, compiler?: INLangCompiler, bundleSource?: DevModeBundleSource) {
        this.compiler = compiler ?? new NullNLangCompiler();
        this.bundleSource = bundleSource ?? devModeDiskBundleSource;
    }

    public getStatus(): DevModeStatus {
        return this.session?.status ?? "idle";
    }

    public async launch(projectPath: string, entry: DevModeEntry): Promise<DevModeStatus> {
        try {
            if (this.session) {
                await this.terminateSession(this.session);
            }
            this.session = this.createSession(projectPath, entry);
            const session = this.session;
            await this.startOrFocusWindow(session);
            await this.compileAndSendBundle(session, "starting");
            this.watchProjectFiles(session);
            return session.status;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.app.logger.error("[DevMode] launch failed", err);
            const session = this.session;
            if (session) {
                session.status = "error";
                this.queueSessionError(session, message);
            }
            return "error";
        }
    }

    public async stop(): Promise<DevModeStatus> {
        if (!this.session) {
            return "idle";
        }
        await this.terminateSession(this.session);
        return "idle";
    }

    public async reload(): Promise<DevModeStatus> {
        if (!this.session) {
            return "idle";
        }
        try {
            await this.compileAndSendBundle(this.session, "reloading");
            return this.session.status;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.app.logger.error("[DevMode] reload failed", err);
            this.session.status = "error";
            this.queueSessionError(this.session, message);
            return "error";
        }
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
            pendingError: null,
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
            this.tryFlushPendingToDevWindow(session);
        });
    }

    private async compileAndSendBundle(session: DevModeSession, status: DevModeStatus): Promise<void> {
        session.status = status;
        if (status === "starting" || status === "reloading") {
            session.status = "compiling";
        }

        try {
            const compileResult = await this.compiler.compile({ projectPath: session.projectPath });
            if (!compileResult.ok) {
                const detail = (compileResult.errors ?? []).join("\n") || "nlang compile failed";
                session.status = "error";
                this.app.logger.error("[DevMode] nlang compile failed", compileResult.errors ?? []);
                this.queueSessionError(session, `nlang compile failed:\n${detail}`);
                return;
            }

            const blueprintScripts = await compileAllBlueprintScriptsForProject(session.projectPath);
            if (!blueprintScripts.ok) {
                const detail = blueprintScripts.errors.join("\n") || "TypeScript blueprint compile failed";
                session.status = "error";
                this.app.logger.error("[DevMode] TypeScript blueprint compile failed", blueprintScripts.errors);
                this.queueSessionError(session, `Blueprint script compile failed:\n${detail}`);
                return;
            }

            session.revision += 1;
            const bundle = await this.bundleSource.load({
                projectPath: session.projectPath,
                bundleId: session.id,
                revision: session.revision,
                compiled: compileResult.artifacts,
                blueprintCompiledScripts: blueprintScripts.scripts,
                blueprintScriptsCompileOk: true,
            });
            this.sendBundle(session, bundle);
            session.status = "running";
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            session.status = "error";
            this.app.logger.error("[DevMode] bundle assembly failed", err);
            this.queueSessionError(session, `Dev Mode bundle failed:\n${message}`);
        }
    }

    private queueSessionError(session: DevModeSession, message: string): void {
        session.pendingBundle = null;
        session.pendingError = message;
        this.tryFlushPendingToDevWindow(session);
    }

    private sendBundle(session: DevModeSession, bundle: DevModeBundle): void {
        session.pendingError = null;
        session.pendingBundle = bundle;
        this.tryFlushPendingToDevWindow(session);
    }

    private tryFlushPendingToDevWindow(session: DevModeSession): void {
        const window = session.window;
        if (!window || window.isClosed() || !session.windowReady) {
            return;
        }
        if (session.pendingError) {
            window.sendIpcEvent(IPCEventType.devModeControlError, { message: session.pendingError });
            session.pendingError = null;
        }
        if (session.pendingBundle) {
            window.sendIpcEvent(IPCEventType.devModePayloadUpdate, { bundle: session.pendingBundle });
            window.sendIpcEvent(IPCEventType.devModeControlReload, { revision: session.pendingBundle.revision });
            session.pendingBundle = null;
        }
    }

    private watchProjectFiles(session: DevModeSession): void {
        if (session.watcher) {
            return;
        }
        const uidocPath = path.join(session.projectPath, "editor", "ui", "uidoc.json");
        const uigraphsPath = path.join(session.projectPath, "editor", "ui", "uigraphs.json");
        const storyRoot = path.join(session.projectPath, "editor", "story");
        const characterStorePath = path.join(session.projectPath, "editor", "services", "character.json");
        const assetsRoot = path.join(session.projectPath, "assets");
        const blueprintMetaPath = path.join(assetsRoot, "assets.metadata.blueprint.json");
        const assetsContentRoot = path.join(assetsRoot, "content");
        session.watcher = chokidar.watch(
            [uidocPath, uigraphsPath, storyRoot, characterStorePath, blueprintMetaPath, assetsContentRoot],
            { ignoreInitial: true },
        );
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

    private async terminateSession(session: DevModeSession): Promise<void> {
        session.status = "stopping";
        this.disposeWatcher(session);
        this.clearReloadTimer(session);
        if (session.window && !session.window.isClosed()) {
            session.window.close();
        }
        if (this.session === session) {
            this.session = null;
        }
    }

    private disposeWatcher(session: DevModeSession): void {
        if (!session.watcher) {
            return;
        }
        void session.watcher.close();
        session.watcher = null;
    }
}
