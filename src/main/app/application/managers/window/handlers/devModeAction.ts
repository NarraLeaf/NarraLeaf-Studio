import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class DevModeLaunchHandler extends IPCHandler<IPCEventType.devModeLaunch> {
    readonly name = IPCEventType.devModeLaunch;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, entry }: IPCEvents[IPCEventType.devModeLaunch]["data"],
    ): Promise<RequestStatus<{ status: IPCEvents[IPCEventType.devModeLaunch]["response"]["status"] }>> {
        const status = await window.getApp().getDevModeManager().launch(projectPath, entry);
        return this.success({ status });
    }
}

export class DevModeStopHandler extends IPCHandler<IPCEventType.devModeStop> {
    readonly name = IPCEventType.devModeStop;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ status: IPCEvents[IPCEventType.devModeStop]["response"]["status"] }>> {
        const status = await window.getApp().getDevModeManager().stop();
        return this.success({ status });
    }
}

export class DevModeReloadHandler extends IPCHandler<IPCEventType.devModeReload> {
    readonly name = IPCEventType.devModeReload;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ status: IPCEvents[IPCEventType.devModeReload]["response"]["status"] }>> {
        const status = await window.getApp().getDevModeManager().reload();
        return this.success({ status });
    }
}

export class DevModeGetStatusHandler extends IPCHandler<IPCEventType.devModeGetStatus> {
    readonly name = IPCEventType.devModeGetStatus;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow): RequestStatus<{ status: IPCEvents[IPCEventType.devModeGetStatus]["response"]["status"] }> {
        const status = window.getApp().getDevModeManager().getStatus();
        return this.success({ status });
    }
}
