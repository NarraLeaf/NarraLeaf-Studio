import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { WindowAppType } from "@shared/types/window";
import { dialog } from "electron";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

function normalizeProjectPath(projectPath: string): string {
    return projectPath.replace(/[\\/]+$/, "");
}

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
        const recentProject = window.getApp().globalState.recentlyOpened.list().find(project =>
            normalizeProjectPath(project.path) === normalizeProjectPath(props.projectPath)
        );
        if (recentProject?.securityScopedBookmark) {
            window.app.storageManager.grantFileSystemAccess(
                window,
                props.projectPath,
                "readwrite",
                true,
                recentProject.securityScopedBookmark,
                "session",
            );
        }

        const workspaceWindow = await window.getApp().launchWorkspace(window, props, {
            minWidth: 800,
            minHeight: 600,
            width: 1400,
            height: 900,
            backgroundColor: "#0f1115",
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
            securityScopedBookmarks: true,
        });

        if (result.canceled || result.filePaths.length === 0) {
            return this.success({ path: null });
        }

        const selectedPath = result.filePaths[0];
        window.app.storageManager.grantFileSystemAccess(window, selectedPath, "readwrite", true, result.bookmarks?.[0], "session");

        return this.success({ path: selectedPath });
    }
}

/**
 * Handler for closing workspace window
 */
export class WorkspaceCloseHandler extends IPCHandler<IPCEventType.workspaceClose> {
    readonly name = IPCEventType.workspaceClose;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<void>> {
        // Check if there are any alive launcher windows
        const windows = window.getApp().windowManager.getWindows();
        const hasAliveLauncher = windows.some(w =>
            !w.isClosed() && w.getWindowType() === WindowAppType.Launcher
        );

        // If no launcher window is alive, launch one
        if (!hasAliveLauncher) {
            try {
                const launcher = await window.getApp().launchLauncher({
                    backgroundColor: '#0f1115',
                });
                launcher.onKeyUp("F12", () => {
                    launcher.toggleDevTools();
                });
            } catch (error) {
                // Log error but continue with closing workspace
                window.getApp().logger.error("Failed to launch launcher window:", error);
            }
        }

        // Close the current workspace window
        window.close();

        return this.success(void 0);
    }
}
