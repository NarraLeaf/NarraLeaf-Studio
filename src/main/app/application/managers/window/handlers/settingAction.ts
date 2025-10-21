import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { IPCMessageType } from "@shared/types/ipc";

export class AppSettingsWindowLaunchHandler extends IPCHandler<IPCEventType.appLaunchSettings> {
    readonly name = IPCEventType.appLaunchSettings;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { props }: IPCEvents[IPCEventType.appLaunchSettings]["data"]): Promise<RequestStatus<void>> {
        const settingsWindow = await window.getApp().launchSettings(window, props);
        window.addChild(settingsWindow);

        settingsWindow.onReady(() => {
            settingsWindow.show();
        });

        return this.success(void 0);
    }

}
