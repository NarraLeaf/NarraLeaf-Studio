import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { PrivilegedCapability } from "@shared/types/privileged";
import { ApiCapability, PluginPermissionPromptResult, PluginPermissionRequest } from "@shared/types/pluginPermissions";
import { WindowAppType, WindowCloseResults } from "@shared/types/window";
import { authorizeActorCapabilityRequest } from "../actorAuthorization";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class PluginPermissionPromptLaunchHandler extends IPCHandler<IPCEventType.pluginPermissionPromptLaunch> {
    readonly name = IPCEventType.pluginPermissionPromptLaunch;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { props }: IPCEvents[IPCEventType.pluginPermissionPromptLaunch]["data"],
    ): Promise<RequestStatus<PluginPermissionPromptResult>> {
        const authorization = authorizeActorCapabilityRequest(
            window,
            { kind: "facade", id: "default" },
            getRequiredPermissionRequestCapability(props.request),
        );
        if (!authorization.allowed) {
            return this.failed(authorization.reason ?? "Permission request is not allowed");
        }

        const existingGrant = window.app.pluginPermissionManager.getExistingGrantResult(props.request);
        if (existingGrant) {
            return this.success(existingGrant);
        }

        const promptWindow = await window.getApp().launchPluginPermissionPrompt(window, props);
        window.addChild(promptWindow);

        return new Promise<RequestStatus<PluginPermissionPromptResult>>(resolve => {
            promptWindow.setCloseResultResolver((result: WindowCloseResults[WindowAppType.PluginPermissionPrompt]) => {
                resolve(this.success(result ?? null));
            });
        });
    }
}

function getRequiredPermissionRequestCapability(request: PluginPermissionRequest): PrivilegedCapability {
    if (request.kind === "install") {
        return PrivilegedCapability.PluginInstall;
    }
    return PrivilegedCapability.PluginPermissionRequest;
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
