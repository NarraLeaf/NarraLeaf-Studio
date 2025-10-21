import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class FsStatHandler extends IPCHandler<IPCEventType.fsStat> {
    readonly name = IPCEventType.fsStat;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow) {
        return this.success(window.getProps());
    }
}
