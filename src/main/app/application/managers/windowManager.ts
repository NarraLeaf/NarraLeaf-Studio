import { EventEmitter } from "events";
import { BaseApp } from "../baseApp";
import { AppWindow } from "./window/appWindow";
import { AppGlobalStateGetHandler, AppGlobalStateSetHandler, AppInfoHandler, AppPlatformInfoHandler, AppTerminateHandler, AppWindowControlHandler, AppWindowGetControlHandler, AppWindowReadyHandler, AppWindowControlAbilityHandler } from "./window/handlers/appAction";
import { AppSettingsWindowLaunchHandler } from "./window/handlers/settingAction";
import {
    FsStatHandler, FsListHandler, FsDetailsHandler, FsRequestReadHandler, FsRequestWriteHandler,
    FsCreateDirHandler, FsDeleteFileHandler, FsDeleteDirHandler, FsRenameHandler,
    FsCopyFileHandler, FsCopyDirHandler, FsMoveFileHandler, FsMoveDirHandler,
    FsFileExistsHandler, FsDirExistsHandler, FsIsFileHandler, FsIsDirHandler,
} from "./window/handlers/fsAction";
import { IPCHost } from "./window/ipcHost";
import { ProjectWizardLaunchHandler, ProjectWizardSelectDirectoryHandler, ProjectWizardGetDefaultDirectoryHandler } from "./window/handlers/projectWizardAction";

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
        win.registerIPCHandler(new AppWindowControlHandler());
        win.registerIPCHandler(new AppWindowGetControlHandler());
        win.registerIPCHandler(new AppWindowControlAbilityHandler());
        win.registerIPCHandler(new AppWindowReadyHandler());
        win.registerIPCHandler(new AppTerminateHandler());
        win.registerIPCHandler(new AppGlobalStateGetHandler());
        win.registerIPCHandler(new AppGlobalStateSetHandler());

        win.registerIPCHandler(new AppSettingsWindowLaunchHandler());

        // Register project wizard handlers
        win.registerIPCHandler(new ProjectWizardLaunchHandler());
        win.registerIPCHandler(new ProjectWizardSelectDirectoryHandler());
        win.registerIPCHandler(new ProjectWizardGetDefaultDirectoryHandler());

        // Register file system handlers
        win.registerIPCHandler(new FsStatHandler());
        win.registerIPCHandler(new FsListHandler());
        win.registerIPCHandler(new FsDetailsHandler());
        win.registerIPCHandler(new FsRequestReadHandler());
        win.registerIPCHandler(new FsRequestWriteHandler());
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
    }

    public unregisterIPCHandlers(win: AppWindow): void {
        IPCHost.unregisterWindow(win);
    }
}