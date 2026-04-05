import path from "path";
import crypto from "crypto";
import chokidar, { FSWatcher } from "chokidar";
import { App } from "@/app/app";
import { AppWindow } from "../window/appWindow";
import { IPCEventType } from "@shared/types/ipcEvents";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { parseSharedBlueprintAssetJson } from "@shared/blueprint/parseSharedBlueprintAsset";
import type { SharedBlueprintAsset } from "@shared/types/blueprint/document";
import { DevModeBundle, DevModeEntry, DevModeStatus } from "@shared/types/devMode";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import { WindowAppType } from "@shared/types/window";
import { Fs } from "@shared/utils/fs";
import { INLangCompiler, NullNLangCompiler } from "./compiler/INLangCompiler";
import { compileAllBlueprintScriptsForProject } from "./compiler/blueprint/compileProjectBlueprintScripts";

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
        if (this.session) {
            await this.terminateSession(this.session);
        }
        this.session = this.createSession(projectPath, entry);
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
        await this.terminateSession(this.session);
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
        if (status === "starting" || status === "reloading") {
            session.status = "compiling";
        }
        const compileResult = await this.compiler.compile({ projectPath: session.projectPath });
        if (!compileResult.ok) {
            session.status = "error";
            this.app.logger.error("[DevMode] nlang compile failed", compileResult.errors ?? []);
            return;
        }
        const blueprintScripts = await compileAllBlueprintScriptsForProject(session.projectPath);
        if (!blueprintScripts.ok) {
            session.status = "error";
            this.app.logger.error("[DevMode] TypeScript blueprint compile failed", blueprintScripts.errors);
            return;
        }
        const bundle = await this.buildBundle(session, compileResult.artifacts, blueprintScripts.scripts);
        this.sendBundle(session, bundle);
        session.status = "running";
    }

    private async buildBundle(
        session: DevModeSession,
        compiled?: Record<string, unknown>,
        blueprintCompiledScripts?: Record<string, string>,
    ): Promise<DevModeBundle> {
        const uidocPath = path.join(session.projectPath, "editor", "ui", "uidoc.json");
        const uigraphsPath = path.join(session.projectPath, "editor", "ui", "uigraphs.json");
        const uidoc = await this.readJsonFile(uidocPath);
        const uigraphsRaw = await this.readJsonFile<UIGraphDocument>(uigraphsPath);
        const uigraphs: UIGraphDocument = {
            ...uigraphsRaw,
            blueprintDocument: migrateBlueprintDocumentToLatest(uigraphsRaw.blueprintDocument),
        };
        const localBlueprints = uigraphs.blueprintDocument;
        const sharedBlueprints = await this.loadSharedBlueprints(session.projectPath);
        session.revision += 1;
        return {
            bundleId: session.id,
            revision: session.revision,
            timestamp: new Date().toISOString(),
            ui: {
                uidoc,
                uigraphs,
                localBlueprints,
                sharedBlueprints,
            },
            compiled,
            blueprintCompiledScripts,
            blueprintScriptsCompileOk: true,
        };
    }

    /**
     * Load blueprint-type assets from metadata shard + content shards (same layout as renderer Assets pipeline).
     */
    private async loadSharedBlueprints(projectPath: string): Promise<SharedBlueprintAsset[]> {
        const shardPath = path.join(projectPath, "assets", "assets.metadata.blueprint.json");
        const shardResult = await Fs.read(shardPath, "utf-8");
        if (!shardResult.ok) {
            return [];
        }
        let record: Record<string, unknown>;
        try {
            record = JSON.parse(shardResult.data) as Record<string, unknown>;
        } catch {
            return [];
        }
        const out: SharedBlueprintAsset[] = [];
        for (const assetId of Object.keys(record)) {
            const filePath = this.resolveAssetContentPath(projectPath, assetId);
            const body = await Fs.read(filePath, "utf-8");
            if (!body.ok) {
                continue;
            }
            try {
                out.push(parseSharedBlueprintAssetJson(body.data));
            } catch {
                // Skip invalid entries so Dev Mode still runs
            }
        }
        return out;
    }

    private resolveAssetContentPath(projectPath: string, assetId: string): string {
        const [a, b, rest] = this.splitIdForAssetContent(assetId);
        return path.join(projectPath, "assets", "content", a, b, rest);
    }

    /** Mirrors `ProjectNameConvention.splitId` for main-process file reads */
    private splitIdForAssetContent(id: string): [string, string, string] {
        const cleanId = id.replace(/-/g, "");
        if (cleanId.length < 4) {
            const padded = cleanId.padEnd(4, "0");
            return [padded.slice(0, 2), padded.slice(2, 4), id];
        }
        const charsA = cleanId.slice(0, 2);
        const charsB = cleanId.slice(2, 4);
        const rest = cleanId.slice(4);
        return [charsA, charsB, rest || id];
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
        const assetsRoot = path.join(session.projectPath, "assets");
        const blueprintMetaPath = path.join(assetsRoot, "assets.metadata.blueprint.json");
        const assetsContentRoot = path.join(assetsRoot, "content");
        session.watcher = chokidar.watch(
            [uidocPath, uigraphsPath, blueprintMetaPath, assetsContentRoot],
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
