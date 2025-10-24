import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { IPCMessageType } from "@shared/types/ipc";
import { dialog, app } from "electron";
import path from "path";

export class ProjectWizardLaunchHandler extends IPCHandler<IPCEventType.projectWizardLaunch> {
    readonly name = IPCEventType.projectWizardLaunch;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<void>> {
        await window.getApp().launchProjectWizard(window, {}, {
            modal: true,
            parent: window.win,
            resizable: false,
            width: 600,
            height: 800,
            center: true,
            x: undefined,
            y: undefined,
        });

        return this.success(void 0);
    }
}

export class ProjectWizardSelectDirectoryHandler extends IPCHandler<IPCEventType.projectWizardSelectDirectory> {
    readonly name = IPCEventType.projectWizardSelectDirectory;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<string | null>> {
        const result = await dialog.showOpenDialog(window.win, {
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select Project Directory',
        });

        if (result.canceled || result.filePaths.length === 0) {
            return this.success(null);
        }

        return this.success(result.filePaths[0]);
    }
}

/**
 * Handler for getting the default project directory based on the user's platform
 * This replaces the hard-coded "C:\Projects" path with platform-appropriate directories
 */
export class ProjectWizardGetDefaultDirectoryHandler extends IPCHandler<IPCEventType.projectWizardGetDefaultDirectory> {
    readonly name = IPCEventType.projectWizardGetDefaultDirectory;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<string>> {
        // Get platform-specific default directory using Electron's app.getPath()
        const platform = process.platform;
        let defaultDir: string;

        switch (platform) {
            case 'win32':
                // Windows: Use Documents/Projects instead of hard-coded C:\Projects
                // This puts projects in the user's personal Documents folder
                defaultDir = path.join(app.getPath('documents'), 'Projects');
                break;
            case 'darwin':
                // macOS: Use ~/Projects (user's home directory)
                defaultDir = path.join(app.getPath('home'), 'Projects');
                break;
            case 'linux':
                // Linux: Use ~/Projects (user's home directory)
                defaultDir = path.join(app.getPath('home'), 'Projects');
                break;
            default:
                // Fallback to home directory for unknown platforms
                defaultDir = path.join(app.getPath('home'), 'Projects');
                break;
        }

        return this.success(defaultDir);
    }
}
