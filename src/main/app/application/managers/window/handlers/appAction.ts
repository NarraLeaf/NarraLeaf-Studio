import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { Platform } from "@shared/types/os";
import { WindowControlAbility } from "@shared/types/window";
import { app as electronApp, dialog, shell } from "electron";
import { promises as fs } from "fs";
import path from "path";
import { backgroundCacheDirectory, cacheBackgroundImage, pruneBackgroundCache } from "../../storage/backgroundCache";

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
