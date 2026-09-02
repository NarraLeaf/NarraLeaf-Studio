import path from "path";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { WindowAppType } from "@shared/types/window";
import { findProjectConfigFileName } from "@shared/utils/nlproj";
import { unpatchedFsPromises as fs } from "../../../../../utils/unpatchedFs";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * The wizard reporting a project it has just written, so that it opens as Studio's own.
 *
 * This is the one route that puts a project on the trust ledger as trusted on a renderer's word,
 * and it is guarded accordingly. The wizard window is the only window answered: it opens no
 * project and loads nothing a project supplied, so nothing that runs in it came from the folder
 * being vouched for. The folder has to be one this window was granted to write - the wizard writes
 * the project through that grant, so a path outside it is a path the wizard did not create - and it
 * has to hold a project configuration by the time this is asked, which is what a finished creation
 * looks like and what an empty or arbitrary folder does not.
 *
 * Reported rather than inferred at open time because the wizard also hands over imports and
 * clones, and those must open as somebody else's. Only the create flow calls this.
 */
export class ProjectWizardCreatedHandler extends IPCHandler<IPCEventType.projectWizardCreated> {
    readonly name = IPCEventType.projectWizardCreated;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.projectWizardCreated]["data"],
    ): Promise<RequestStatus<{ recorded: boolean }>> {
        if (window.getWindowType() !== WindowAppType.ProjectWizard) {
            window.app.logger.warn(`[Trust] Refused to register a created project for a ${window.getWindowType()} window`);
            return this.failed(new Error("Only the project wizard can register a project it created."));
        }
        if (typeof projectPath !== "string" || projectPath.length === 0) {
            return this.failed(new Error("A created project needs a path."));
        }
        const resolved = path.resolve(projectPath);
        if (!await window.app.storageManager.isPathAllowed(window, resolved, "write")) {
            return this.failed(new Error(`The wizard was not granted to write the project folder: ${resolved}`));
        }
        if (!await holdsProjectConfig(resolved)) {
            return this.failed(new Error(`No project configuration was found in ${resolved}`));
        }
        const recorded = window.app.projectTrustManager.recordArrival(resolved, "created", new Date().toISOString());
        window.app.logger.info("[Trust] Studio created", resolved);
        return this.success({ recorded });
    }
}

async function holdsProjectConfig(projectRoot: string): Promise<boolean> {
    try {
        const entries = await fs.readdir(projectRoot, { withFileTypes: true });
        return findProjectConfigFileName(entries.map(entry => ({
            name: path.parse(entry.name).name,
            ext: path.extname(entry.name) || null,
            type: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other",
        }))) !== null;
    } catch {
        return false;
    }
}
