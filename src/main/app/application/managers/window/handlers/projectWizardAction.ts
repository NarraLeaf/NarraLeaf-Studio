import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { IPCMessageType } from "@shared/types/ipc";
import { dialog } from "electron";

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

export class ProjectWizardSelectDirectoryHandler extends IPCHandler<IPCEventType.projectWizardSelectDirectory> {
    readonly name = IPCEventType.projectWizardSelectDirectory;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<string | null>> {
        const result = await dialog.showOpenDialog(window.win, {
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select Project Directory',
        });

        if (result.canceled || result.filePaths.length === 0) {
            return this.success(null);
        }

        return this.success(result.filePaths[0]);
    }
}
