import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { WindowAppType } from "@shared/types/window";

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

export class DevModeResolveImageAssetUrlHandler extends IPCHandler<IPCEventType.devModeResolveImageAssetUrl> {
    readonly name = IPCEventType.devModeResolveImageAssetUrl;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow<WindowAppType.DevMode>,
        { assetId }: IPCEvents[IPCEventType.devModeResolveImageAssetUrl]["data"],
    ): Promise<RequestStatus<{ url: string }>> {
        const props = window.getProps();
        const workspaceWindow = window.getApp().windowManager
            .getWindows()
            .find(
                w =>
                    w.getWindowType() === WindowAppType.Workspace &&
                    !w.isDestroyed() &&
                    w.getProps().projectPath === props.projectPath,
            ) as AppWindow<WindowAppType.Workspace> | undefined;

        if (!workspaceWindow) {
            return this.failed("Workspace window not available");
        }

        try {
            const workspaceResult = await workspaceWindow.invokeIpcRequest(
                IPCEventType.workspaceResolveImageAssetUrl,
                { assetId },
            );
            if (!workspaceResult.success) {
                return this.failed(workspaceResult.error ?? "Failed to resolve image asset");
            }
            return this.success(workspaceResult.data);
        } catch (error) {
            return this.failed(error);
        }
    }
}
