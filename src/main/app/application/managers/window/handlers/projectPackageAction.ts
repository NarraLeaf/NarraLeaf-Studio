import path from "path";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { PROJECT_PACKAGE_EXTENSION } from "@shared/utils/projectPackage";
import {
    decodeProjectConfig,
    findProjectConfigFileName,
    sanitizeProjectFileName,
} from "@shared/utils/nlproj";
import { readProjectPackageInto, writeProjectPackage } from "../../../utils/projectPackageFile";
import { directoryHoldsNothing } from "../../../utils/directoryHoldsNothing";
import type { ProjectTrustManager } from "../../projectTrustManager";
import { unpatchedFsPromises as fs } from "@/utils/unpatchedFs";
import { dialogTranslator, showOpenDialog } from "../fileDialog";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

type ProjectMetadata = {
    name: string;
    identifier?: string;
};

export class WorkspaceExportProjectPackageHandler extends IPCHandler<IPCEventType.workspaceExportProjectPackage> {
    readonly name = IPCEventType.workspaceExportProjectPackage;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.workspaceExportProjectPackage]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.workspaceExportProjectPackage]["response"]>> {
        try {
            const projectRoot = path.resolve(projectPath);
            if (!await window.app.storageManager.isPathAllowed(window, projectRoot, "read")) {
                return this.failed(`File system access is not allowed for project: ${projectRoot}`);
            }

            const project = await readProjectMetadata(projectRoot);
            const { t } = dialogTranslator(window);
            const selection = await showOpenDialog(window, {
                title: t("dialogs.file.title.exportProjectPackage"),
                buttonLabel: t("dialogs.file.button.exportHere"),
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

            const packagePath = await resolveAvailablePackagePath(exportDir, project.name);
            const written = await writeProjectPackage({
                projectRoot,
                packagePath,
                projectName: project.name,
                projectIdentifier: project.identifier,
                createdAt: new Date().toISOString(),
            });

            return this.success({
                canceled: false,
                packagePath,
                fileCount: written.fileCount,
                byteLength: written.byteLength,
                skippedCount: written.skippedCount,
            });
        } catch (error) {
            return this.failed(error);
        }
    }
}

/**
 * Unpack a package the caller already chose, into a folder the caller already chose.
 *
 * **It puts up no dialogs.** It used to put up two, back to back, which meant the wizard page in
 * front of them could not say what had been picked, could not check the folder was empty before
 * committing to it, and could not let the author change one of the two answers without starting
 * over. The picking now happens on that page, one button each.
 *
 * Neither path is granted here. Both pickers grant on the way out, so a path this window was never
 * handed fails the checks below - which is what keeps a renderer-supplied path from being a way to
 * read anywhere on the disk.
 */
export class WorkspaceImportProjectPackageHandler extends IPCHandler<IPCEventType.workspaceImportProjectPackage> {
    readonly name = IPCEventType.workspaceImportProjectPackage;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { packagePath, targetDir }: IPCEvents[IPCEventType.workspaceImportProjectPackage]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.workspaceImportProjectPackage]["response"]>> {
        try {
            const resolvedPackage = path.resolve(packagePath);
            if (!await window.app.storageManager.isPathAllowed(window, resolvedPackage, "read")) {
                return this.failed(`File system access is not allowed for package: ${resolvedPackage}`);
            }

            const resolvedTarget = path.resolve(targetDir);
            if (await window.app.storageManager.isPathProtected(resolvedTarget)) {
                return this.failed("Selected import folder is inside protected Studio storage.");
            }
            if (!await window.app.storageManager.isPathAllowed(window, resolvedTarget, "write")) {
                return this.failed(`File system access is not allowed for import folder: ${resolvedTarget}`);
            }

            const result = await unpackAsArrival(window.app.projectTrustManager, resolvedPackage, resolvedTarget);
            return this.success({
                projectPath: resolvedTarget,
                projectName: result.projectName,
                fileCount: result.fileCount,
                byteLength: result.byteLength,
            });
        } catch (error) {
            return this.failed(error);
        }
    }
}

/**
 * The `.nlspkg` file picker, and the grant that makes the path it returns usable.
 *
 * Lives with the wizard's directory picker rather than with the import handler, because it is the
 * same kind of thing: a native dialog whose only job is to turn a click into a path this window is
 * allowed to touch.
 */
export class ProjectWizardSelectPackageHandler extends IPCHandler<IPCEventType.projectWizardSelectPackage> {
    readonly name = IPCEventType.projectWizardSelectPackage;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ dest: string | null }>> {
        const { t } = dialogTranslator(window);
        const selection = await showOpenDialog(window, {
            title: t("dialogs.file.title.selectProjectPackage"),
            buttonLabel: t("dialogs.file.button.select"),
            properties: ["openFile"],
            filters: [
                { name: t("dialogs.file.filter.projectPackage"), extensions: [PROJECT_PACKAGE_EXTENSION.slice(1)] },
                { name: t("dialogs.file.filter.all"), extensions: ["*"] },
            ],
            securityScopedBookmarks: true,
        });

        if (selection.canceled || selection.filePaths.length === 0) {
            return this.success({ dest: null });
        }

        const packagePath = path.resolve(selection.filePaths[0]);
        // Read, not readwrite, and not recursive: this is one file that gets copied out of.
        window.app.storageManager.grantFileSystemAccess(
            window,
            packagePath,
            "read",
            false,
            selection.bookmarks?.[0],
            "session",
        );
        return this.success({ dest: packagePath });
    }
}

/**
 * Unpack a package into a folder, with the folder on the trust ledger before a byte of it lands.
 *
 * The order is the point. A project unpacked from somebody else's file ships executable code - a
 * puppet backend is `import()`ed the moment anything shows a model - and the row is what says it
 * is somebody else's. Recording after the copy left a window in which the copy was on disk and
 * the row was not; a copy that finished unrecorded would be met later as a mere folder rather
 * than as an import. Recording first closes that: whatever else fails, the folder is known for
 * what it is from before it has contents.
 *
 * Two consequences are handled here. The folder has to be empty for the unpack to start, so the
 * row is only written when it is - recording first must never mark something the author already
 * had at that path. And an unpack that fails before writing anything takes its row with it, so the
 * settings list does not show a project waiting for a decision that no folder exists to receive;
 * one that fails part-way keeps it, because a half-written tree is still somebody else's tree.
 */
async function unpackAsArrival(
    trust: ProjectTrustManager,
    packagePath: string,
    targetDir: string,
): ReturnType<typeof readProjectPackageInto> {
    const recorded = await directoryHoldsNothing(targetDir);
    if (recorded) {
        trust.recordArrival(targetDir, "package", new Date().toISOString());
    }
    try {
        return await readProjectPackageInto(packagePath, targetDir);
    } catch (error) {
        if (recorded && await directoryHoldsNothing(targetDir)) {
            trust.forgetArrival(targetDir);
        }
        throw error;
    }
}

async function readProjectMetadata(projectRoot: string): Promise<ProjectMetadata> {
    const entries = await fs.readdir(projectRoot, { withFileTypes: true });
    const configFileName = findProjectConfigFileName(entries.map(entry => ({
        name: path.parse(entry.name).name,
        ext: path.extname(entry.name) || null,
        type: entry.isDirectory() ? "directory" : "file",
    })));

    if (!configFileName) {
        return { name: path.basename(projectRoot) || "project" };
    }

    const configPath = path.join(projectRoot, configFileName);
    if (configFileName.endsWith(".nlproj")) {
        const config = decodeProjectConfig(await fs.readFile(configPath));
        return {
            name: config.name || path.basename(projectRoot) || "project",
            identifier: typeof config.identifier === "string" ? config.identifier : undefined,
        };
    }

    const raw = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as { name?: string; identifier?: string };
    return {
        name: config.name || path.basename(projectRoot) || "project",
        identifier: typeof config.identifier === "string" ? config.identifier : undefined,
    };
}

async function resolveAvailablePackagePath(exportDir: string, projectName: string): Promise<string> {
    const baseName = sanitizeProjectFileName(projectName);
    for (let index = 0; index < 1000; index += 1) {
        const suffix = index === 0 ? "" : `-${index}`;
        const candidate = path.join(exportDir, `${baseName}${suffix}${PROJECT_PACKAGE_EXTENSION}`);
        try {
            await fs.access(candidate);
        } catch {
            return candidate;
        }
    }
    throw new Error("Unable to choose a unique package filename in the selected folder.");
}
