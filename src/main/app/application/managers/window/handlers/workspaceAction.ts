import fs from "fs/promises";
import path from "path";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { dialog, shell } from "electron";
import { WindowAppType } from "@shared/types/window";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/** Reduce a renderer-supplied name to a single safe filename (no separators, no leading dots). */
function sanitizeLogFileName(name: string): string {
    const base = path
        .basename(name)
        .replace(/[/\\:*?"<>|\x00-\x1f]+/g, "-")
        .replace(/\s+/g, "-")
        .replace(/^\.+/, "")
        .trim();
    return base.length > 0 ? base : "console-logs.log";
}

/** Find a non-colliding path for the export inside the chosen directory. */
async function resolveAvailableLogPath(exportDir: string, defaultFileName: string): Promise<string> {
    const safe = sanitizeLogFileName(defaultFileName);
    const ext = path.extname(safe);
    const stem = ext ? safe.slice(0, -ext.length) : safe;
    for (let index = 0; index < 1000; index += 1) {
        const suffix = index === 0 ? "" : `-${index}`;
        const candidate = path.join(exportDir, `${stem}${suffix}${ext}`);
        try {
            await fs.access(candidate);
        } catch {
            return candidate;
        }
    }
    throw new Error("Unable to choose a unique log filename in the selected folder.");
}

/**
 * Handler for opening a project in a workspace window - the launcher's recent list and folder
 * picker, and the project wizard's hand-off.
 *
 * Shares {@link App.openProject} with {@link WorkspaceOpenRecentHandler}, so a project that is
 * already open is focused rather than opened a second time whichever surface asked. Retiring the
 * opener (and everything that gates it) is decided there too.
 */
export class WorkspaceLaunchHandler extends IPCHandler<IPCEventType.workspaceLaunch> {
    readonly name = IPCEventType.workspaceLaunch;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { props, closeCurrentWindow }: IPCEvents[IPCEventType.workspaceLaunch]["data"]
    ): Promise<RequestStatus<void>> {
        await window.getApp().openProject(window, props.projectPath, {
            replaceOpener: closeCurrentWindow,
        });

        return this.success(void 0);
    }
}

/**
 * The workspace renderer reports whether its project preflight succeeded. Replace-style
 * launches gate the opener's retirement on this (see {@link WorkspaceLaunchHandler} and
 * {@link App.openRecentProject}).
 */
export class WorkspaceReportLoadResultHandler extends IPCHandler<IPCEventType.workspaceReportLoadResult> {
    readonly name = IPCEventType.workspaceReportLoadResult;
    readonly type = IPCMessageType.message;

    public handle(window: AppWindow, { ok }: IPCEvents[IPCEventType.workspaceReportLoadResult]["data"]) {
        window.reportLoadResult(ok);
        return this.success(void 0 as never);
    }
}

/**
 * Handler for opening a project from the recent list - the top-bar switcher and the "Open Recent"
 * menus. Behaviour is shared with {@link WorkspaceLaunchHandler} through {@link App.openProject}.
 */
export class WorkspaceOpenRecentHandler extends IPCHandler<IPCEventType.workspaceOpenRecent> {
    readonly name = IPCEventType.workspaceOpenRecent;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, replaceCurrentWindow }: IPCEvents[IPCEventType.workspaceOpenRecent]["data"],
    ): Promise<RequestStatus<void>> {
        await window.getApp().openProject(window, projectPath, { replaceOpener: replaceCurrentWindow });
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
 * Reopen this window as a recovery shell, or back as an ordinary workspace.
 *
 * Deliberately nothing but "rewrite the props and reload". In particular it does **not** flush
 * pending saves on the way in, and that is the whole point rather than an omission: recovery mode is
 * entered because the workspace's in-memory state is suspect - a document service that parsed a
 * damaged file, an asset map that came back empty - and flushing would write exactly that suspect
 * state over the author's files as the last act before the diagnosis begins. The renderer confirms
 * with the author first, since it is the side that knows whether anything is unsaved.
 *
 * Leaving recovery mode is the same call with `enabled: false`, and needs no such care: a recovery
 * shell holds no unsaved work by construction (project writes are frozen for its whole life).
 */
export class WorkspaceSetRecoveryModeHandler extends IPCHandler<IPCEventType.workspaceSetRecoveryMode> {
    readonly name = IPCEventType.workspaceSetRecoveryMode;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { enabled, reason }: IPCEvents[IPCEventType.workspaceSetRecoveryMode]["data"],
    ): Promise<RequestStatus<void>> {
        if (window.getWindowType() !== WindowAppType.Workspace) {
            return this.failed("Only a workspace window can enter recovery mode.");
        }

        const workspace = window as AppWindow<WindowAppType.Workspace>;
        workspace.setProps({
            ...workspace.getProps(),
            recovery: enabled,
            // Cleared on the way out rather than carried: the reason describes the trip *into*
            // recovery mode, and a stale one would head the next session's anomaly list with a
            // failure the author has already dealt with.
            recoveryReason: enabled ? reason : undefined,
        });
        workspace.reload();

        return this.success(void 0);
    }
}

/**
 * Show this window's project folder in the OS file manager.
 *
 * The path comes from the window's own props and never from the message, so this cannot be pointed
 * at somebody's home directory by a renderer that has been talked into asking.
 */
export class WorkspaceOpenProjectFolderHandler extends IPCHandler<IPCEventType.workspaceOpenProjectFolder> {
    readonly name = IPCEventType.workspaceOpenProjectFolder;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<void>> {
        if (window.getWindowType() !== WindowAppType.Workspace) {
            return this.failed("Only a workspace window has a project folder to open.");
        }

        const projectPath = (window as AppWindow<WindowAppType.Workspace>).getProps().projectPath;
        if (!projectPath) {
            return this.failed("This window has no project folder.");
        }

        // openPath answers with a message rather than throwing, and an empty string means it worked.
        const failure = await shell.openPath(path.resolve(projectPath));
        if (failure) {
            return this.failed(failure);
        }
        return this.success(void 0);
    }
}

/**
 * Handler for closing workspace window.
 *
 * Returning to the launcher is the workspace window's own close behaviour (see the close guard
 * installed in App.launchWorkspace), so this only has to request the close - the native close
 * box takes the exact same path.
 */
export class WorkspaceCloseHandler extends IPCHandler<IPCEventType.workspaceClose> {
    readonly name = IPCEventType.workspaceClose;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<void>> {
        window.close();

        return this.success(void 0);
    }
}

/**
 * Receives the workspace's current menu model and hands it to the menu manager, which mirrors it
 * onto the native menu bar while this window is focused.
 */
export class WorkspaceMenuSyncHandler extends IPCHandler<IPCEventType.workspaceMenuSync> {
    readonly name = IPCEventType.workspaceMenuSync;
    readonly type = IPCMessageType.message;

    public handle(window: AppWindow, { model }: IPCEvents[IPCEventType.workspaceMenuSync]["data"]) {
        window.app.menuManager.syncWindowMenu(window, model);
        return this.success(void 0 as never);
    }
}

/**
 * Handler for exporting a console channel's buffered logs to a user-chosen folder.
 * The renderer supplies the already-formatted log text and a suggested filename; the file is
 * written directly here in the trusted main process, so no renderer write grant is required.
 */
export class WorkspaceExportConsoleLogsHandler extends IPCHandler<IPCEventType.workspaceExportConsoleLogs> {
    readonly name = IPCEventType.workspaceExportConsoleLogs;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { defaultFileName, content }: IPCEvents[IPCEventType.workspaceExportConsoleLogs]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.workspaceExportConsoleLogs]["response"]>> {
        try {
            const selection = await dialog.showOpenDialog(window.win, {
                title: "Select Export Folder",
                buttonLabel: "Export Here",
                properties: ["openDirectory", "createDirectory"],
                securityScopedBookmarks: true,
            });

            if (selection.canceled || selection.filePaths.length === 0) {
                return this.success({ canceled: true });
            }

            const exportDir = path.resolve(selection.filePaths[0]);
            if (await window.app.storageManager.isPathProtected(exportDir)) {
                return this.failed("Selected export folder is inside protected Studio storage.");
            }
            window.app.storageManager.grantFileSystemAccess(
                window,
                exportDir,
                "readwrite",
                true,
                selection.bookmarks?.[0],
                "session",
            );
            if (!await window.app.storageManager.isPathAllowed(window, exportDir, "write")) {
                return this.failed(`File system access is not allowed for export folder: ${exportDir}`);
            }

            const filePath = await resolveAvailableLogPath(exportDir, defaultFileName);
            await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });

            return this.success({
                canceled: false,
                filePath,
                byteLength: Buffer.byteLength(content, "utf8"),
            });
        } catch (error) {
            return this.failed(error);
        }
    }
}
