import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType } from "@shared/types/ipcEvents";
import { Platform } from "@shared/types/os";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class AppInfoHandler extends IPCHandler<IPCEventType.getPlatform> {
    readonly name = IPCEventType.getPlatform;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow) {
        return this.success(Platform.getInfo(process, window.app.isPackaged()));
    }
}

export class AppPropsHandler extends IPCHandler<IPCEventType.getWindowProps> {
    readonly name = IPCEventType.getWindowProps;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow) {
        return this.success(window.getProps());
    }
}
