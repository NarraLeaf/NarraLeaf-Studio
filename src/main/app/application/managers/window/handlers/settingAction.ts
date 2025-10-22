import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { IPCMessageType } from "@shared/types/ipc";

export class AppSettingsWindowLaunchHandler extends IPCHandler<IPCEventType.appLaunchSettings> {
    readonly name = IPCEventType.appLaunchSettings;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { props }: IPCEvents[IPCEventType.appLaunchSettings]["data"]): Promise<RequestStatus<void>> {
        await window.getApp().launchSettings(window, props, {
            modal: true,
            parent: window.win,
            minWidth: 800,
            minHeight: 500,
            width: 800,
            height: 500,
        });

        return this.success(void 0);
    }
}
