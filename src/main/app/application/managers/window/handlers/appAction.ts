import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { Platform } from "@shared/types/os";
import { WindowControlAbility } from "@shared/types/window";

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

export class AppWindowCloseHandler extends IPCHandler<IPCEventType.appWindowClose> {
    readonly name = IPCEventType.appWindowClose;
    readonly type = IPCMessageType.message;

    public handle(window: AppWindow) {
        window.close();
        return this.success(void 0 as never);
    }
}

export class AppWindowCloseParentHandler extends IPCHandler<IPCEventType.appWindowCloseParent> {
    readonly name = IPCEventType.appWindowCloseParent;
    readonly type = IPCMessageType.message;

    public handle(window: AppWindow) {
        window.closeParent();
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
        window.app.logger.debug(`Getting global state key: ${data.key}, raw: ${JSON.stringify(window.app.globalState.raw())}`);
        return this.success({ value: window.app.globalState.get(data.key, true) });
    }
}

export class AppGlobalStateSetHandler extends IPCHandler<IPCEventType.appGlobalStateSet> {
    readonly name = IPCEventType.appGlobalStateSet;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow, data: IPCEvents[IPCEventType.appGlobalStateSet]["data"]) {
        window.app.globalState.set(data.key, data.value);
        return this.success(void 0);
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
