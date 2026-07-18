import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { WindowAppType } from "@shared/types/window";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { IPCMessageType } from "@shared/types/ipc";

/**
 * Counts open workspace windows. The Settings window gates workspace-bound actions on this
 * (e.g. "Customize keyboard shortcuts" needs a workspace to open its tab in).
 */
export class AppCountWorkspaceWindowsHandler extends IPCHandler<IPCEventType.appCountWorkspaceWindows> {
    readonly name = IPCEventType.appCountWorkspaceWindows;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ count: number }>> {
        const count = window
            .getApp()
            .windowManager.getWindows()
            .filter(candidate => candidate.getWindowType() === WindowAppType.Workspace).length;
        return this.success({ count });
    }
}

export class AppSettingsWindowLaunchHandler extends IPCHandler<IPCEventType.appLaunchSettings> {
    readonly name = IPCEventType.appLaunchSettings;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { props }: IPCEvents[IPCEventType.appLaunchSettings]["data"]): Promise<RequestStatus<void>> {
        await window.getApp().launchSettings(window, props, {
            parent: window.win,
            minWidth: 800,
            minHeight: 500,
            width: 1200,
            height: 800,
            center: true,
            x: undefined,
            y: undefined,
        });

        return this.success(void 0);
    }
}
