import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { Platform } from "@shared/types/os";
import { WindowControlAbility } from "@shared/types/window";
import { app as electronApp, dialog, shell } from "electron";
import type { Dirent } from "fs";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
    composeDiagnosticsBundle,
    readMainLogTail,
    sanitizeBundleFileName,
    type DiagnosticsEnvironment,
} from "../../../logging/diagnosticsBundle";
import type { MissingRecentProject, RecentProjectMissingReason } from "@shared/types/state/appStateTypes";
import { DirEntry, findProjectConfigFileName } from "@shared/utils/nlproj";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { backgroundCacheDirectory, cacheBackgroundImage, pruneBackgroundCache } from "../../storage/backgroundCache";
import { clearCacheBuckets, measureCacheInventory } from "../../storage/cacheInventory";
import { isProtectedStateKey } from "@shared/constants/settingsScopes";
import { getMainLocale } from "../../../i18n";

export class AppPlatformInfoHandler extends IPCHandler<IPCEventType.getPlatform> {
    readonly name = IPCEventType.getPlatform;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow) {
        return this.success(Platform.getInfo(process, window.app.isPackaged()));
    }
}

export class AppPropsHandler extends IPCHandler<IPCEventType.appWindowProps> {
    readonly name = IPCEventType.appWindowProps;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow) {
        return this.success(window.getProps());
    }
}

export class AppInfoHandler extends IPCHandler<IPCEventType.appInfo> {
    readonly name = IPCEventType.appInfo;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow) {
        return this.success(window.app.getAppInfo());
    }
}

export class AppTerminateHandler extends IPCHandler<IPCEventType.appTerminate> {
    readonly name = IPCEventType.appTerminate;
    readonly type = IPCMessageType.message;

    public handle(window: AppWindow, data: IPCEvents[IPCEventType.appTerminate]["data"]) {
        if (data.err) {
            const timestamp = new Date().toISOString();
            window.app.logger.error(`The App is terminating due to an error: ${data.err}`);
            window.app.logger.error(`App Crashed at ${timestamp}`);
            window.app.crash(data.err);
        } else {
            window.app.quit();
        }
        return this.success(void 0 as never);
    }
}

/**
 * Put a renderer failure somewhere that outlives the window that saw it.
 *
 * The renderer's own record of what it printed is a ring buffer in the page, so a crash followed by
 * a reload - which is now the ordinary answer to a crash - takes the evidence with it. `main.log` is
 * the only sink that survives both the reload and the process, and it is the file the support
 * bundle reads.
 *
 * Reporting only: nothing here decides what the window does next. Errors that *should* end the
 * process still come through {@link AppTerminateHandler}.
 */
export class AppReportRendererErrorHandler extends IPCHandler<IPCEventType.appReportRendererError> {
    readonly name = IPCEventType.appReportRendererError;
    readonly type = IPCMessageType.message;

    public handle(window: AppWindow, data: IPCEvents[IPCEventType.appReportRendererError]["data"]) {
        const where = data.label ? `${data.source}: ${data.label}` : data.source;
        const lines = [
            `[Renderer] ${window.getWindowType()} error (${where}): ${data.message}`,
        ];
        if (data.stack) {
            lines.push(data.stack);
        }
        if (data.componentStack) {
            lines.push(`Component stack:${data.componentStack}`);
        }
        window.app.logger.error(lines.join("\n"));
        return this.success(void 0 as never);
    }
}

export class AppWindowControlHandler extends IPCHandler<IPCEventType.appWindowControl> {
    readonly name = IPCEventType.appWindowControl;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow, data: IPCEvents[IPCEventType.appWindowControl]["data"]) {
        switch (data.control) {
            case "minimize":
                window.minimize();
                break;
            case "maximize":
                window.maximize();
                break;
            case "unmaximize":
                window.unmaximize();
                break;
            case "close":
                window.close();
                break;
            default:
                return this.failed(`Invalid control: ${data.control}`);
        }
        return this.success(void 0);
    }
}

export class AppDetachedWindowControlHandler extends IPCHandler<IPCEventType.appDetachedWindowControl> {
    readonly name = IPCEventType.appDetachedWindowControl;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow, data: IPCEvents[IPCEventType.appDetachedWindowControl]["data"]) {
        const status = window.controlDetachedWindow(data.key, data.control);
        if (!status) {
            // The window is gone, or was never this one's to drive. Either way the renderer's
            // buttons are pointing at nothing, and saying so is better than a silent no-op.
            return this.failed(`No detached window "${data.key}" belongs to this window`);
        }
        return this.success({ status });
    }
}

export class AppWindowEditCommandHandler extends IPCHandler<IPCEventType.appWindowEditCommand> {
    readonly name = IPCEventType.appWindowEditCommand;
    readonly type = IPCMessageType.message;

    public handle(window: AppWindow, data: IPCEvents[IPCEventType.appWindowEditCommand]["data"]) {
        const webContents = window.getWebContents();
        switch (data.command) {
            case "copy":
                webContents.copy();
                break;
            case "cut":
                webContents.cut();
                break;
            case "paste":
                webContents.paste();
                break;
            case "delete":
                webContents.delete();
                break;
            default:
                // A message channel has no reply to fail with, so say so in the log rather than
                // dropping it silently.
                window.app.logger.warn(`[Window] Ignoring unknown edit command: ${String(data.command)}`);
                break;
        }
        return this.success(void 0 as never);
    }
}

export class AppWindowCloseHandler extends IPCHandler<IPCEventType.appWindowClose> {
    readonly name = IPCEventType.appWindowClose;
    readonly type = IPCMessageType.message;

    public handle(window: AppWindow) {
        window.close();
        return this.success(void 0 as never);
    }
}

export class AppWindowCloseWithHandler extends IPCHandler<IPCEventType.appWindowCloseWith> {
    readonly name = IPCEventType.appWindowCloseWith;
    readonly type = IPCMessageType.message;

    public handle(window: AppWindow, data: IPCEvents[IPCEventType.appWindowCloseWith]["data"]) {
        window.closeWith(data.result);
        return this.success(void 0 as never);
    }
}

export class AppWindowGetControlHandler extends IPCHandler<IPCEventType.appWindowGetControl> {
    readonly name = IPCEventType.appWindowGetControl;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow) {
        return this.success({ status: window.getControl() });
    }
}

export class AppWindowGetFullscreenHandler extends IPCHandler<IPCEventType.appWindowGetFullscreen> {
    readonly name = IPCEventType.appWindowGetFullscreen;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow) {
        return this.success({ isFullscreen: window.isFullScreen() });
    }
}

export class AppWindowReadyHandler extends IPCHandler<IPCEventType.appWindowReady> {
    readonly name = IPCEventType.appWindowReady;
    readonly type = IPCMessageType.message;

    public handle(window: AppWindow) {
        window.announceReady();

        window.app.logger.debug(`Window ready`);

        return this.success(void 0 as never);
    }
}

export class AppGlobalStateGetHandler extends IPCHandler<IPCEventType.appGlobalStateGet> {
    readonly name = IPCEventType.appGlobalStateGet;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow, data: IPCEvents[IPCEventType.appGlobalStateGet]["data"]) {
        return this.success({ value: window.app.globalState.get(data.key) });
    }
}

export class AppGlobalStateSetHandler extends IPCHandler<IPCEventType.appGlobalStateSet> {
    readonly name = IPCEventType.appGlobalStateSet;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow, data: IPCEvents[IPCEventType.appGlobalStateSet]["data"]) {
        // Persists, fans the change out to every open window so live views (e.g. the
        // i18n locale) stay in sync without a reload, and runs the per-key
        // main-process side effects.
        window.app.setGlobalStateAndBroadcast(data.key, data.value);

        return this.success(void 0);
    }
}

export class AppGlobalStateGetAllHandler extends IPCHandler<IPCEventType.appGlobalStateGetAll> {
    readonly name = IPCEventType.appGlobalStateGetAll;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow) {
        return this.success({ settings: window.app.globalState.raw() });
    }
}

/**
 * Add a project to the history.
 *
 * The next list is computed here in the main process rather than sent up by the renderer: with
 * several windows open, a renderer writing back an array it read earlier would erase every change
 * made in between. Broadcasting (and the native "Open Recent" rebuild it triggers) comes free with
 * setGlobalStateAndBroadcast, so every other window's list updates too.
 */
export class AppAddRecentProjectHandler extends IPCHandler<IPCEventType.appAddRecentProject> {
    readonly name = IPCEventType.appAddRecentProject;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow, data: IPCEvents[IPCEventType.appAddRecentProject]["data"]) {
        const next = window.app.globalState.recentlyOpened.withProject({
            name: data.name,
            path: data.path,
            icon: undefined,
            openedAt: Date.now(),
            securityScopedBookmark: window.app.storageManager.getSecurityScopedBookmarkForPath(data.path),
        });
        window.app.setGlobalStateAndBroadcast("app.recentProjects", next);
        return this.success(void 0);
    }
}

/**
 * Whether a remembered project is still openable, or why it is not.
 *
 * Only *absence* answers "missing". A folder we were not allowed to read (macOS TCC, a network
 * mount without permission) or one on a volume that is offline is still perfectly good work, and
 * reporting it as gone would put the user in front of a dialog offering to forget a real project.
 * So ENOENT/ENOTDIR are the only failures that count; everything else reads as present and the
 * user finds out the usual way - by opening it.
 */
async function findRecentProjectMissingReason(projectPath: string): Promise<RecentProjectMissingReason | null> {
    let entries: Dirent[];
    try {
        const stats = await fs.stat(projectPath);
        if (!stats.isDirectory()) {
            // Something is there, but a project is a folder - a file at that path is not one.
            return "not-a-project";
        }
        entries = await fs.readdir(projectPath, { withFileTypes: true });
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code === "ENOENT" || code === "ENOTDIR" ? "folder-missing" : null;
    }

    const dirEntries = entries.map<DirEntry>(entry => ({
        name: path.parse(entry.name).name,
        ext: path.extname(entry.name) || null,
        type: entry.isDirectory() ? "directory" : "file",
    }));

    return findProjectConfigFileName(dirEntries) ? null : "not-a-project";
}

/**
 * Report which remembered projects are no longer on disk.
 *
 * Read-only on purpose: nothing is dropped from the history here. Forgetting a project is the
 * user's call - a folder can be missing because an external drive is unplugged or a checkout is on
 * another branch, and silently pruning the list would lose the path they need to get back to it.
 * The renderer prompts with this and calls Remove for whatever the user agrees to.
 */
export class AppCheckRecentProjectsHandler extends IPCHandler<IPCEventType.appCheckRecentProjects> {
    readonly name = IPCEventType.appCheckRecentProjects;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ missing: MissingRecentProject[] }>> {
        const projects = window.app.globalState.recentlyOpened.list();
        const checked = await Promise.all(projects.map(async project => ({
            project,
            reason: await findRecentProjectMissingReason(project.path),
        })));

        return this.success({
            missing: checked
                .filter((entry): entry is typeof entry & { reason: RecentProjectMissingReason } => entry.reason !== null)
                .map(({ project, reason }) => ({ name: project.name, path: project.path, reason })),
        });
    }
}

/** Remove one project from the history. Atomic for the same reason as its Add counterpart. */
export class AppRemoveRecentProjectHandler extends IPCHandler<IPCEventType.appRemoveRecentProject> {
    readonly name = IPCEventType.appRemoveRecentProject;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow, data: IPCEvents[IPCEventType.appRemoveRecentProject]["data"]) {
        const next = window.app.globalState.recentlyOpened.without(data.path);
        window.app.setGlobalStateAndBroadcast("app.recentProjects", next);
        return this.success(void 0);
    }
}

/**
 * Show one remembered project's folder in the OS file manager.
 *
 * The path is checked against the history before anything is opened. Its workspace counterpart
 * (`WorkspaceOpenProjectFolderHandler`) can read the folder off the window's own props and so never
 * has to trust the message at all; the launcher has no project of its own, so the guard is the
 * history itself - a renderer that has been talked into asking cannot point this at a home
 * directory, only at a folder the user already opened as a project.
 *
 * Comparison goes through `normalizeProjectPath` for the reason every other project-path comparison
 * does: the same folder reaches us spelled several ways, and a plain string match would refuse the
 * entry the user just clicked.
 */
export class AppRevealRecentProjectHandler extends IPCHandler<IPCEventType.appRevealRecentProject> {
    readonly name = IPCEventType.appRevealRecentProject;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.appRevealRecentProject]["data"],
    ): Promise<RequestStatus<void>> {
        const wanted = normalizeProjectPath(data.path);
        const known = window.app.globalState.recentlyOpened.list()
            .find(project => normalizeProjectPath(project.path) === wanted);
        if (!wanted || !known) {
            return this.failed(new Error("Refusing to reveal a folder that is not a remembered project."));
        }

        // openPath answers with a message rather than throwing, and an empty string means it worked.
        const failure = await shell.openPath(path.resolve(known.path));
        if (failure) {
            return this.failed(new Error(failure));
        }
        return this.success(void 0);
    }
}

/**
 * Picks a background image via the native dialog and caches it under userData/backgrounds. Only
 * the cache file name travels back - renderers never hand us arbitrary paths to copy from later.
 */
export class AppPickBackgroundImageHandler extends IPCHandler<IPCEventType.appPickBackgroundImage> {
    readonly name = IPCEventType.appPickBackgroundImage;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ file: string | null }>> {
        const result = await dialog.showOpenDialog(window.win, {
            title: "Choose Background Image",
            properties: ["openFile"],
            filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
        });
        const source = result.filePaths[0];
        if (result.canceled || !source) {
            return this.success({ file: null });
        }
        const directory = backgroundCacheDirectory(electronApp.getPath("userData"));
        const fileName = await cacheBackgroundImage(
            directory,
            await fs.readFile(source),
            path.extname(source).toLowerCase() || ".png",
        );
        // A cache that failed to shrink is not worth failing the pick over.
        await pruneBackgroundCache(directory, fileName).catch(error => {
            window.app.logger.warn(`[Background] Failed to prune the background cache: ${String(error)}`);
        });
        return this.success({ file: fileName });
    }
}

/**
 * Reads a cached background image (basename-only lookup inside userData/backgrounds - path
 * separators are rejected so this can never be steered at arbitrary files).
 */
export class AppReadBackgroundImageHandler extends IPCHandler<IPCEventType.appReadBackgroundImage> {
    readonly name = IPCEventType.appReadBackgroundImage;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { file }: IPCEvents[IPCEventType.appReadBackgroundImage]["data"]): Promise<RequestStatus<{ data: Uint8Array | null }>> {
        if (!file || file !== path.basename(file)) {
            return this.failed(new Error("Invalid background image name"));
        }
        try {
            const data = await fs.readFile(path.join(backgroundCacheDirectory(electronApp.getPath("userData")), file));
            return this.success({ data: new Uint8Array(data) });
        } catch {
            return this.success({ data: null });
        }
    }
}

/**
 * Opens a URL in the system browser. Restricted to http(s): a renderer must never be able to
 * hand arbitrary schemes (file:, app protocols) to the OS.
 */
export class AppOpenExternalHandler extends IPCHandler<IPCEventType.appOpenExternal> {
    readonly name = IPCEventType.appOpenExternal;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { url }: IPCEvents[IPCEventType.appOpenExternal]["data"]): Promise<RequestStatus<void>> {
        if (!/^https?:\/\//i.test(url)) {
            return this.failed(new Error(`Refusing to open non-http(s) URL: ${url}`));
        }
        await shell.openExternal(url);
        return this.success(void 0);
    }
}

export class AppSystemPathHandler extends IPCHandler<IPCEventType.appSystemPath> {
    readonly name = IPCEventType.appSystemPath;
    readonly type = IPCMessageType.request;

    public handle(
        _window: AppWindow,
        data: IPCEvents[IPCEventType.appSystemPath]["data"],
    ): RequestStatus<{ path: string }> {
        return this.success({ path: electronApp.getPath(data.name) });
    }
}

/**
 * Write a support bundle to a file the user picks.
 *
 * Deliberately reachable from any window, including one whose workspace never finished starting:
 * that window has no services, so it cannot route this through the workspace surface, and it is
 * exactly the window whose user most needs a log to hand over. Nothing here touches the project,
 * so there is no grant to check - the only path involved is the one the save dialog returned.
 */
export class AppExportDiagnosticsHandler extends IPCHandler<IPCEventType.appExportDiagnostics> {
    readonly name = IPCEventType.appExportDiagnostics;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { defaultFileName, report }: IPCEvents[IPCEventType.appExportDiagnostics]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.appExportDiagnostics]["response"]>> {
        try {
            const logsDir = electronApp.getPath("logs");
            const environment: DiagnosticsEnvironment = {
                appVersion: window.app.getAppInfo().version,
                electronVersion: process.versions.electron ?? "unknown",
                chromeVersion: process.versions.chrome ?? "unknown",
                nodeVersion: process.versions.node ?? "unknown",
                platform: process.platform,
                osRelease: os.release(),
                arch: process.arch,
                packaged: window.app.isPackaged(),
                // The locale in force, not the raw key: with none stored the key is absent, and a
                // report that said "unknown" about a Studio the author is plainly reading in
                // Chinese would answer the wrong question.
                locale: getMainLocale(window.app),
                userDataDir: window.app.getUserDataDir(),
                logsDir,
                generatedAt: new Date().toISOString(),
            };
            const content = composeDiagnosticsBundle(environment, report, await readMainLogTail(logsDir));

            const selection = await dialog.showSaveDialog(window.win, {
                title: "Export Studio Logs",
                defaultPath: sanitizeBundleFileName(defaultFileName, "narraleaf-studio-diagnostics.log"),
                filters: [
                    { name: "Log", extensions: ["log"] },
                    { name: "Text", extensions: ["txt"] },
                ],
            });
            if (selection.canceled || !selection.filePath) {
                return this.success({ canceled: true });
            }

            await fs.writeFile(selection.filePath, content, { encoding: "utf8" });
            return this.success({
                canceled: false,
                filePath: selection.filePath,
                byteLength: Buffer.byteLength(content, "utf8"),
            });
        } catch (error) {
            return this.failed(error);
        }
    }
}

/**
 * Reachability of one mirror address, for the Network settings panel.
 *
 * A HEAD, with the same 5 s budget `probePluginBuildDependency` uses, and the same reading of the
 * result: any HTTP response proves the host is there. A CDN answering 403 or 405 to a HEAD says
 * nothing about whether the bytes exist, so the status is handed back rather than judged - the
 * panel says "answered with 403", which is a thing an author can act on, instead of "unreachable",
 * which would be a lie.
 *
 * Refuses anything that is not https, matching what a rewrite is allowed to produce: a Test button
 * that succeeds against `http://` for a rule the resolver will refuse is worse than no button.
 */
export class AppProbeDownloadSourceHandler extends IPCHandler<IPCEventType.appProbeDownloadSource> {
    readonly name = IPCEventType.appProbeDownloadSource;
    readonly type = IPCMessageType.request;

    /** Long enough for a slow mirror, short enough that the panel is not left hanging. */
    private static readonly TIMEOUT_MS = 5000;

    public async handle(
        _window: AppWindow,
        { url }: IPCEvents[IPCEventType.appProbeDownloadSource]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.appProbeDownloadSource]["response"]>> {
        let parsed: URL;
        try {
            parsed = new URL(url.trim());
        } catch {
            return this.success({ reachable: false, error: "not a valid URL" });
        }
        if (parsed.protocol !== "https:") {
            return this.success({ reachable: false, error: "not https" });
        }
        try {
            const response = await fetch(parsed.toString(), {
                method: "HEAD",
                redirect: "follow",
                signal: AbortSignal.timeout(AppProbeDownloadSourceHandler.TIMEOUT_MS),
            });
            return this.success({ reachable: true, status: response.status });
        } catch (error) {
            return this.success({
                reachable: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

export class AppCacheInventoryHandler extends IPCHandler<IPCEventType.appCacheInventory> {
    readonly name = IPCEventType.appCacheInventory;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow) {
        try {
            return this.success(await measureCacheInventory(window.app.getUserDataDir()));
        } catch (error) {
            return this.failed(error);
        }
    }
}

export class AppCacheClearHandler extends IPCHandler<IPCEventType.appCacheClear> {
    readonly name = IPCEventType.appCacheClear;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { ids }: IPCEvents[IPCEventType.appCacheClear]["data"]) {
        try {
            return this.success(await clearCacheBuckets(window.app.getUserDataDir(), ids));
        } catch (error) {
            return this.failed(error);
        }
    }
}

/**
 * Remove stored settings, so the next read resolves the default.
 *
 * The protected list is enforced *here* rather than trusted from the renderer: the same store
 * holds the project history and the per-project statistics, and "reset my preferences" must not
 * be one bad key list away from erasing either. A refused key is reported, not silently skipped -
 * a caller that asked for something impossible should find out.
 */
export class AppGlobalStateDeleteHandler extends IPCHandler<IPCEventType.appGlobalStateDelete> {
    readonly name = IPCEventType.appGlobalStateDelete;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow, { keys }: IPCEvents[IPCEventType.appGlobalStateDelete]["data"]) {
        const deleted: string[] = [];
        const refused: string[] = [];
        for (const key of keys) {
            if (isProtectedStateKey(key)) {
                refused.push(key);
                continue;
            }
            if (!window.app.globalState.has(key)) {
                // Nothing stored: already at its default, so the caller's intent is satisfied and
                // there is no change worth broadcasting.
                continue;
            }
            window.app.deleteGlobalStateAndBroadcast(key);
            deleted.push(key);
        }
        return this.success({ deleted, refused });
    }
}

/**
 * Write a settings document to a file the user picks.
 *
 * Shaped exactly like {@link AppExportDiagnosticsHandler}, and for the same reason: the only path
 * involved is the one the save dialog returned, so there is no grant to check.
 */
export class AppExportSettingsHandler extends IPCHandler<IPCEventType.appExportSettings> {
    readonly name = IPCEventType.appExportSettings;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { defaultFileName, content }: IPCEvents[IPCEventType.appExportSettings]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.appExportSettings]["response"]>> {
        try {
            const selection = await dialog.showSaveDialog(window.win, {
                title: "Export Studio Settings",
                defaultPath: sanitizeBundleFileName(defaultFileName, "narraleaf-studio-settings.json", [".json"]),
                filters: [{ name: "JSON", extensions: ["json"] }],
            });
            if (selection.canceled || !selection.filePath) {
                return this.success({ canceled: true });
            }
            await fs.writeFile(selection.filePath, content, { encoding: "utf8" });
            return this.success({ canceled: false, filePath: selection.filePath });
        } catch (error) {
            return this.failed(error);
        }
    }
}

/**
 * Read a settings document the user picks.
 *
 * Only reads and hands back the text: parsing and validating belong with the settings registry,
 * which lives in the renderer and is the only thing that knows what a key means. Capped because
 * a settings document is a few kilobytes and this must not become a way to pull an arbitrary
 * file into the renderer whole.
 */
export class AppImportSettingsHandler extends IPCHandler<IPCEventType.appImportSettings> {
    readonly name = IPCEventType.appImportSettings;
    readonly type = IPCMessageType.request;

    /** Generous next to a real document (~10 KB), small enough to refuse a mistake. */
    private static readonly MAX_BYTES = 4 * 1024 * 1024;

    public async handle(
        window: AppWindow,
    ): Promise<RequestStatus<IPCEvents[IPCEventType.appImportSettings]["response"]>> {
        try {
            const selection = await dialog.showOpenDialog(window.win, {
                title: "Import Studio Settings",
                properties: ["openFile"],
                filters: [{ name: "JSON", extensions: ["json"] }],
            });
            if (selection.canceled || selection.filePaths.length === 0) {
                return this.success({ canceled: true });
            }
            const filePath = selection.filePaths[0];
            const stat = await fs.stat(filePath);
            if (stat.size > AppImportSettingsHandler.MAX_BYTES) {
                return this.failed(new Error("That file is too large to be a settings document"));
            }
            return this.success({
                canceled: false,
                filePath,
                content: await fs.readFile(filePath, "utf8"),
            });
        } catch (error) {
            return this.failed(error);
        }
    }
}

export class AppWindowControlAbilityHandler extends IPCHandler<IPCEventType.appWindowControlAbility> {
    readonly name = IPCEventType.appWindowControlAbility;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow): RequestStatus<WindowControlAbility> {
        const browserWindow = window.getBrowserWindow();
        const controlAbility: WindowControlAbility = {
            minimizable: browserWindow.isMinimizable(),
            maximizable: browserWindow.isMaximizable(),
            closable: browserWindow.isClosable(),
            resizable: browserWindow.isResizable(),
            movable: browserWindow.isMovable(),
            fullscreenable: browserWindow.isFullScreenable(),
        };
        return this.success(controlAbility);
    }
}
