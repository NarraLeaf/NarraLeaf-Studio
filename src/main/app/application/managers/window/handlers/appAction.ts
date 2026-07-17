import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { Platform } from "@shared/types/os";
import { WindowControlAbility } from "@shared/types/window";
import { app as electronApp } from "electron";

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

export class AppAddRecentProjectHandler extends IPCHandler<IPCEventType.appAddRecentProject> {
    readonly name = IPCEventType.appAddRecentProject;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow, data: IPCEvents[IPCEventType.appAddRecentProject]["data"]) {
        window.app.globalState.recentlyOpened.addProject({
            name: data.name,
            path: data.path,
            icon: undefined,
            openedAt: Date.now(),
            securityScopedBookmark: window.app.storageManager.getSecurityScopedBookmarkForPath(data.path),
        });
        // Keep the native "Open Recent" submenu in step with the history it renders. No-op off
        // macOS, where the application menu is empty.
        window.app.menuManager.updateMenu();
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
