import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { ApiCapability, PluginPermissionPromptResult } from "@shared/types/pluginPermissions";
import { WindowAppType, WindowCloseResults } from "@shared/types/window";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class PluginPermissionPromptLaunchHandler extends IPCHandler<IPCEventType.pluginPermissionPromptLaunch> {
    readonly name = IPCEventType.pluginPermissionPromptLaunch;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { props }: IPCEvents[IPCEventType.pluginPermissionPromptLaunch]["data"],
    ): Promise<RequestStatus<PluginPermissionPromptResult>> {
        const promptWindow = await window.getApp().launchPluginPermissionPrompt(window, props);
        window.addChild(promptWindow);

        return new Promise<RequestStatus<PluginPermissionPromptResult>>(resolve => {
            promptWindow.setCloseResultResolver((result: WindowCloseResults[WindowAppType.PluginPermissionPrompt]) => {
                resolve(this.success(result ?? null));
            });
        });
    }
}

export class PluginPermissionGrantHandler extends IPCHandler<IPCEventType.pluginPermissionGrant> {
    readonly name = IPCEventType.pluginPermissionGrant;
    readonly type = IPCMessageType.request;
    readonly requiredApiCapabilities = [ApiCapability.PluginPermissionGrant] as const;

    public handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.pluginPermissionGrant]["data"],
    ) {
        return this.tryUse(() => window.app.pluginPermissionManager.grantPermission(data.request, data.decision));
    }
}
