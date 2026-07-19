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

/**
 * Reveals a workspace-owned surface (the keybinding table, the background dialog) on behalf of the
 * Settings window, which cannot open it itself: both surfaces need the workspace's live state.
 *
 * Addressed to exactly one window - the focused workspace if there is one, else the first - and
 * focused so the user lands on what they asked for. Deliberately not a broadcast: with two
 * workspaces open, every one of them would pop the same tab.
 */
export class AppRequestWorkspaceViewHandler extends IPCHandler<IPCEventType.appRequestWorkspaceView> {
    readonly name = IPCEventType.appRequestWorkspaceView;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { view }: IPCEvents[IPCEventType.appRequestWorkspaceView]["data"],
    ): Promise<RequestStatus<{ delivered: boolean }>> {
        const workspaces = window
            .getApp()
            .windowManager.getWindows()
            .filter(candidate => candidate.getWindowType() === WindowAppType.Workspace);
        const target = workspaces.find(candidate => candidate.win.isFocused()) ?? workspaces[0];
        if (!target) {
            return this.success({ delivered: false });
        }
        target.sendIpcEvent(IPCEventType.workspaceOpenView, { view });
        target.focus();
        return this.success({ delivered: true });
    }
}

/**
 * Opens the Settings window - or focuses the one already open.
 *
 * Reuse matters because openers now address a specific setting (`props.highlight`): launching
 * unconditionally would leave the user with two Settings windows disagreeing about what is
 * selected. An open window is focused and told where to go instead.
 */
export class AppSettingsWindowLaunchHandler extends IPCHandler<IPCEventType.appLaunchSettings> {
    readonly name = IPCEventType.appLaunchSettings;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { props }: IPCEvents[IPCEventType.appLaunchSettings]["data"]): Promise<RequestStatus<void>> {
        const existing = window
            .getApp()
            .windowManager.getWindows()
            .find(candidate => candidate.getWindowType() === WindowAppType.Settings);
        if (existing) {
            if (props?.highlight) {
                existing.sendIpcEvent(IPCEventType.settingsHighlight, { highlight: props.highlight });
            }
            existing.focus();
            return this.success(void 0);
        }

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
