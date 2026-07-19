import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class PreviewLaunchHandler extends IPCHandler<IPCEventType.previewLaunch> {
    readonly name = IPCEventType.previewLaunch;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, entry }: IPCEvents[IPCEventType.previewLaunch]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.previewLaunch]["response"]>> {
        return this.tryUse(async () => {
            const status = await window.getApp().getPreviewManager().launch(projectPath, entry);
            return { status };
        });
    }
}

export class PreviewStopHandler extends IPCHandler<IPCEventType.previewStop> {
    readonly name = IPCEventType.previewStop;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.previewStop]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.previewStop]["response"]>> {
        return this.tryUse(async () => {
            const status = await window.getApp().getPreviewManager().stop(projectPath);
            return { status };
        });
    }
}

export class PreviewGetStatusHandler extends IPCHandler<IPCEventType.previewGetStatus> {
    readonly name = IPCEventType.previewGetStatus;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.previewGetStatus]["data"],
    ): RequestStatus<IPCEvents[IPCEventType.previewGetStatus]["response"]> {
        const status = window.getApp().getPreviewManager().getStatus(projectPath);
        return this.success({ status });
    }
}
