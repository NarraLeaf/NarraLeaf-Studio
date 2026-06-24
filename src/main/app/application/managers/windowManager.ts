import { EventEmitter } from "events";
import { BaseApp } from "../baseApp";
import { AppWindow } from "./window/appWindow";
import { AppGlobalStateGetAllHandler, AppGlobalStateGetHandler, AppGlobalStateSetHandler, AppAddRecentProjectHandler, AppInfoHandler, AppPlatformInfoHandler, AppTerminateHandler, AppWindowControlHandler, AppWindowCloseHandler, AppWindowCloseWithHandler, AppWindowGetControlHandler, AppWindowReadyHandler, AppWindowControlAbilityHandler, AppPropsHandler, AppSystemPathHandler } from "./window/handlers/appAction";
import { AppSettingsWindowLaunchHandler } from "./window/handlers/settingAction";
import {
    FsStatHandler, FsListHandler, FsDetailsHandler, FsRequestReadHandler, FsRequestWriteHandler,
    FsCreateDirHandler, FsEnsureRegularFileHandler, FsWriteFileNoFollowHandler, FsRecoverCorruptedJsonFileHandler, FsDeleteFileHandler, FsDeleteDirHandler, FsRenameHandler,
    FsCopyFileHandler, FsCopyDirHandler, FsMoveFileHandler, FsMoveDirHandler,
    FsFileExistsHandler, FsDirExistsHandler, FsIsFileHandler, FsIsDirHandler,
    FsSelectFileHandler, FsSelectDirectoryHandler, FsHashHandler,
} from "./window/handlers/fsAction";
import { IPCHost } from "./window/ipcHost";
import { ProjectWizardLaunchHandler, ProjectWizardSelectDirectoryHandler, ProjectWizardGetDefaultDirectoryHandler } from "./window/handlers/projectWizardAction";
import { WorkspaceLaunchHandler, WorkspaceSelectFolderHandler, WorkspaceCloseHandler } from "./window/handlers/workspaceAction";
import {
    DevModeGetStatusHandler,
    DevModeLaunchHandler,
    DevModeOpenBlueprintInWorkspaceHandler,
    DevModeReloadHandler,
    DevModeStopHandler,
    DevModeResolveImageAssetUrlHandler,
} from "./window/handlers/devModeAction";
import { PluginPermissionGrantHandler, PluginPermissionPromptLaunchHandler } from "./window/handlers/pluginPermissionAction";
import {
    BlueprintPersistenceGetAllHandler,
    BlueprintPersistenceGetValueHandler,
    BlueprintPersistenceRemoveValueHandler,
    BlueprintPersistenceSetValueHandler,
} from "./window/handlers/blueprintPersistenceAction";
import {
    PrivilegedBashExecuteHandler,
    PrivilegedFsCallHandler,
    PrivilegedPermissionRevokePluginHandler,
    PrivilegedPermissionRequestHandler,
} from "./window/handlers/privilegedAction";

type WindowManagerEvents = {
    "window-created": [window: AppWindow];
    "window-ready": [window: AppWindow];
    "window-closed": [window: AppWindow];
}

export class WindowManager {
    private windows: AppWindow[] = [];

    public events: EventEmitter<WindowManagerEvents>;

    constructor(
        private app: BaseApp,
    ) {
        this.events = new EventEmitter();
    }

    public initialize(): void {
    }

    public registerWindow(win: AppWindow): void {
        this.windows.push(win);
    }

    public unregisterWindow(win: AppWindow): void {
        this.app.storageManager.revokeWindowFileSystemAccess(win);
        this.windows = this.windows.filter(w => w !== win);
    }

    public emitWindowClosed(win: AppWindow): void {
        this.events.emit("window-closed", win);
    }

    public getWindows(): AppWindow[] {
        return this.windows;
    }

    public hasWindows(): boolean {
        return this.windows.length > 0;
    }

    public registerDefaultIPCHandlers(win: AppWindow): void {
        win.registerIPCHandler(new AppPlatformInfoHandler());
        win.registerIPCHandler(new AppInfoHandler());

        win.registerIPCHandler(new AppPropsHandler());
        win.registerIPCHandler(new AppWindowControlHandler());
        win.registerIPCHandler(new AppWindowCloseHandler());
        win.registerIPCHandler(new AppWindowCloseWithHandler());
        win.registerIPCHandler(new AppWindowGetControlHandler());
        win.registerIPCHandler(new AppWindowControlAbilityHandler());
        win.registerIPCHandler(new AppWindowReadyHandler());
        win.registerIPCHandler(new AppTerminateHandler());
        win.registerIPCHandler(new AppGlobalStateGetHandler());
        win.registerIPCHandler(new AppGlobalStateSetHandler());
        win.registerIPCHandler(new AppGlobalStateGetAllHandler());
        win.registerIPCHandler(new AppAddRecentProjectHandler());
        win.registerIPCHandler(new AppSystemPathHandler());

        win.registerIPCHandler(new AppSettingsWindowLaunchHandler());

        // Register project wizard handlers
        win.registerIPCHandler(new ProjectWizardLaunchHandler());
        win.registerIPCHandler(new ProjectWizardSelectDirectoryHandler());
        win.registerIPCHandler(new ProjectWizardGetDefaultDirectoryHandler());

        // Register workspace handlers
        win.registerIPCHandler(new WorkspaceLaunchHandler());
        win.registerIPCHandler(new WorkspaceSelectFolderHandler());
        win.registerIPCHandler(new WorkspaceCloseHandler());

        // Register dev mode handlers
        win.registerIPCHandler(new DevModeLaunchHandler());
        win.registerIPCHandler(new DevModeStopHandler());
        win.registerIPCHandler(new DevModeReloadHandler());
        win.registerIPCHandler(new DevModeGetStatusHandler());
        win.registerIPCHandler(new DevModeOpenBlueprintInWorkspaceHandler());
        win.registerIPCHandler(new DevModeResolveImageAssetUrlHandler());

        // Register blueprint persistent variable storage handlers
        win.registerIPCHandler(new BlueprintPersistenceGetAllHandler());
        win.registerIPCHandler(new BlueprintPersistenceGetValueHandler());
        win.registerIPCHandler(new BlueprintPersistenceSetValueHandler());
        win.registerIPCHandler(new BlueprintPersistenceRemoveValueHandler());

        // Register plugin permission handlers
        win.registerIPCHandler(new PluginPermissionPromptLaunchHandler());
        win.registerIPCHandler(new PluginPermissionGrantHandler());

        // Register actor-aware privileged facade handlers
        win.registerIPCHandler(new PrivilegedFsCallHandler());
        win.registerIPCHandler(new PrivilegedPermissionRequestHandler());
        win.registerIPCHandler(new PrivilegedPermissionRevokePluginHandler());
        win.registerIPCHandler(new PrivilegedBashExecuteHandler());

        // Register file system handlers
        win.registerIPCHandler(new FsStatHandler());
        win.registerIPCHandler(new FsListHandler());
        win.registerIPCHandler(new FsDetailsHandler());
        win.registerIPCHandler(new FsRequestReadHandler());
        win.registerIPCHandler(new FsRequestWriteHandler());
        win.registerIPCHandler(new FsEnsureRegularFileHandler());
        win.registerIPCHandler(new FsWriteFileNoFollowHandler());
        win.registerIPCHandler(new FsRecoverCorruptedJsonFileHandler());
        win.registerIPCHandler(new FsCreateDirHandler());
        win.registerIPCHandler(new FsDeleteFileHandler());
        win.registerIPCHandler(new FsDeleteDirHandler());
        win.registerIPCHandler(new FsRenameHandler());
        win.registerIPCHandler(new FsCopyFileHandler());
        win.registerIPCHandler(new FsCopyDirHandler());
        win.registerIPCHandler(new FsMoveFileHandler());
        win.registerIPCHandler(new FsMoveDirHandler());
        win.registerIPCHandler(new FsFileExistsHandler());
        win.registerIPCHandler(new FsDirExistsHandler());
        win.registerIPCHandler(new FsIsFileHandler());
        win.registerIPCHandler(new FsIsDirHandler());
        win.registerIPCHandler(new FsSelectFileHandler());
        win.registerIPCHandler(new FsSelectDirectoryHandler());
        win.registerIPCHandler(new FsHashHandler());
    }

    public unregisterIPCHandlers(win: AppWindow): void {
        IPCHost.unregisterWindow(win);
    }
}
