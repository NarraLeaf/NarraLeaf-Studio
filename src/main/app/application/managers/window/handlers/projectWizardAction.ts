import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { IPCMessageType } from "@shared/types/ipc";

export class ProjectWizardLaunchHandler extends IPCHandler<IPCEventType.projectWizardLaunch> {
    readonly name = IPCEventType.projectWizardLaunch;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<void>> {
        await window.getApp().launchProjectWizard(window, {}, {
            modal: true,
            parent: window.win,
            resizable: false,
            width: 600,
            height: 800,
            center: true,
            x: undefined,
            y: undefined,
        });

        return this.success(void 0);
    }
}
