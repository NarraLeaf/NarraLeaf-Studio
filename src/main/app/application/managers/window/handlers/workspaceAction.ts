import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { dialog } from "electron";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Handler for launching workspace window
 */
export class WorkspaceLaunchHandler extends IPCHandler<IPCEventType.workspaceLaunch> {
    readonly name = IPCEventType.workspaceLaunch;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { props, closeCurrentWindow }: IPCEvents[IPCEventType.workspaceLaunch]["data"]
    ): Promise<RequestStatus<void>> {
        const workspaceWindow = await window.getApp().launchWorkspace(window, props, {
            minWidth: 800,
            minHeight: 600,
            width: 1400,
            height: 900,
        });

        if (window.getApp().isDevMode()) {
            workspaceWindow.onKeyUp("F12", () => {
                workspaceWindow.toggleDevTools();
            });
        }

        // Wait for workspace window to be ready before closing launcher
        if (closeCurrentWindow) {
            workspaceWindow.onReady(() => {
                window.close();
            });
        }

        return this.success(void 0);
    }
}

/**
 * Handler for selecting a folder to open as workspace
 */
export class WorkspaceSelectFolderHandler extends IPCHandler<IPCEventType.workspaceSelectFolder> {
    readonly name = IPCEventType.workspaceSelectFolder;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ path: string | null }>> {
        const result = await dialog.showOpenDialog(window.win, {
            title: "Select Project Folder",
            properties: ["openDirectory", "createDirectory"],
            buttonLabel: "Open Folder",
        });

        if (result.canceled || result.filePaths.length === 0) {
            return this.success({ path: null });
        }

        return this.success({ path: result.filePaths[0] });
    }
}

