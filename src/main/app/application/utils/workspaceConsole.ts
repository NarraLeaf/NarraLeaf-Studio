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

/**
 * The workspace window a project is open in, if any.
 *
 * Delegates rather than comparing paths itself: `App.findWorkspaceForProject` is the lookup the
 * one-project-one-window rule is built on, and a second opinion about what "the same project" is
 * eventually disagrees with it. This used to compare `path.normalize`d paths, which agrees about
 * separators and not about case - so on Windows a project reached under a differently-cased path
 * silently had no console at all.
 */
export function findWorkspaceWindow(app: App, projectPath: string): AppWindow<WindowAppType.Workspace> | undefined {
    return app.findWorkspaceForProject(projectPath);
}
