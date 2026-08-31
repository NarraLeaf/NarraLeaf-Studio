import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { WindowAppType, WindowCloseResults } from "@shared/types/window";
import { app } from "electron";
import fs from "fs";
import path from "path";
import { resolveDefaultProjectDirectory } from "../../../defaultProjectDirectory";
import { dialogTranslator, showOpenDialog } from "../fileDialog";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class ProjectWizardLaunchHandler extends IPCHandler<IPCEventType.projectWizardLaunch> {
    readonly name = IPCEventType.projectWizardLaunch;
    readonly type = IPCMessageType.request;

    /**
     * The props are carried through rather than replaced with an empty object.
     *
     * They are how a caller opens the wizard on a question already answered - a package
     * chosen outside Studio, a repository picked off a server's list - and dropping them
     * here is what made `packagePath` reachable only from inside the main process.
     */
    public async handle(
        window: AppWindow,
        props: IPCEvents[IPCEventType.projectWizardLaunch]["data"],
    ): Promise<RequestStatus<WindowCloseResults[WindowAppType.ProjectWizard]>> {
        const wizardWindow = await window.getApp().launchProjectWizard(window, props ?? {}, {
            parent: window.win,
            resizable: false,
            // Wider than it is tall, unlike the 600x800 this used to be. The first page is now two
            // columns - the three origins beside the template list - and the pages that follow are
            // a step rail beside a form; both are horizontal shapes, and the tall window spent its
            // extra height on a progress header that no longer exists.
            width: 760,
            height: 620,
            center: true,
            x: undefined,
            y: undefined,
        });

        // Independent, not dependent: the wizard is work the author is doing, not a question they
        // are answering, and the window that opened it may well retire while it is up - the
        // launcher does exactly that the moment a project opens. It is detached instead of
        // destroyed, and whatever has been typed into it survives.
        window.addChild(wizardWindow, "independent");

        // Wait for the wizard window to close and get the result
        return new Promise<RequestStatus<WindowCloseResults[WindowAppType.ProjectWizard]>>((resolve) => {
            // Set up resolver that will be called when window closes
            // This handles both cases: closeWith was called or window was closed directly
            wizardWindow.setCloseResultResolver((result: WindowCloseResults[WindowAppType.ProjectWizard]) => {
                // **Handed on whole, not rebuilt field by field.** It used to be copied into a
                // fresh `{ created, projectPath }`, which silently dropped everything else the
                // wizard reported - and a field added at both ends then arrives as `undefined`
                // with nothing anywhere to say why. The two fields below are still checked,
                // because they are what tells a wizard that finished from one that was closed.
                const answered = result !== null
                    && typeof result === "object"
                    && "created" in result
                    && "projectPath" in result;
                resolve(this.success(answered ? result : null));
            });
        });
    }
}

export class ProjectWizardSelectDirectoryHandler extends IPCHandler<IPCEventType.projectWizardSelectDirectory> {
    readonly name = IPCEventType.projectWizardSelectDirectory;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ dest: string | null }>> {
        const { t } = dialogTranslator(window);
        const result = await showOpenDialog(window, {
            properties: ['openDirectory', 'createDirectory'],
            title: t("dialogs.file.title.selectProjectLocation"),
            securityScopedBookmarks: true,
        });

        if (result.canceled || result.filePaths.length === 0) {
            return this.success({ dest: null });
        }

        const selectedPath = result.filePaths[0] || null;
        if (selectedPath) {
            window.app.storageManager.grantFileSystemAccess(window, selectedPath, "readwrite", true, result.bookmarks?.[0], "session");
        }

        return this.success({ dest: selectedPath });
    }
}

/**
 * Handler for getting the default project directory based on the user's platform
 * This replaces the hard-coded "C:\Projects" path with platform-appropriate directories
 */
export class ProjectWizardGetDefaultDirectoryHandler extends IPCHandler<IPCEventType.projectWizardGetDefaultDirectory> {
    readonly name = IPCEventType.projectWizardGetDefaultDirectory;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ dir: string }>> {
        // The whole decision lives in `resolveDefaultProjectDirectory`, which is pure so the
        // Windows case - a Documents folder OneDrive has moved into its sync root - can be tested
        // without a machine set up that way.
        const defaultDir = resolveDefaultProjectDirectory({
            platform: process.platform,
            documents: app.getPath("documents"),
            downloads: app.getPath("downloads"),
            home: app.getPath("home"),
            env: process.env,
            directoryExists: candidate => {
                try {
                    return fs.statSync(candidate).isDirectory();
                } catch {
                    return false;
                }
            },
        });

        window.app.storageManager.grantFileSystemAccess(window, defaultDir);

        return this.success({ dir: defaultDir });
    }
}
