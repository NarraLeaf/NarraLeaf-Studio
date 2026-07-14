import path from "path";
import { App } from "@/app/app";
import { AppWindow } from "../managers/window/appWindow";
import { WindowAppType } from "@shared/types/window";
import { IPCEventType } from "@shared/types/ipcEvents";
import type { DevModeConsoleLogPayload } from "@shared/types/devMode";

/**
 * Push a log line into the workspace console of the window that has the given
 * project open. Silently drops the line when no such window exists (build or
 * preview may outlive the window that started it).
 */
export function emitWorkspaceConsoleLog(app: App, projectPath: string, payload: DevModeConsoleLogPayload): void {
    const workspaceWindow = findWorkspaceWindow(app, projectPath);
    if (!workspaceWindow) {
        return;
    }
    workspaceWindow.sendIpcEvent(IPCEventType.workspaceDevModeConsoleLog, {
        timestamp: Date.now(),
        ...payload,
    });
}

export function findWorkspaceWindow(app: App, projectPath: string): AppWindow<WindowAppType.Workspace> | undefined {
    return app.windowManager
        .getWindows()
        .find(
            w =>
                w.getWindowType() === WindowAppType.Workspace &&
                !w.isDestroyed() &&
                !w.isClosed() &&
                path.normalize(w.getProps().projectPath) === path.normalize(projectPath),
        ) as AppWindow<WindowAppType.Workspace> | undefined;
}
