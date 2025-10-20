import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType } from "@shared/types/ipcEvents";
import { Platform } from "@shared/types/os";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

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