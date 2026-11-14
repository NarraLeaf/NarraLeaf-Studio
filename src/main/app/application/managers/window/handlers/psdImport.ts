import { unpatchedFsPromises as fs } from "../../../../../utils/unpatchedFs";
import path from "path";
import { app } from "electron";
import { psdTempRoot } from "../../storage/cacheInventory";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { dialogTranslator, showOpenDialog } from "../fileDialog";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import type { PsdBakedLayer, PsdDocument } from "@shared/types/psdImport";
import { bakePsdLayers, readPsdDocument } from "@/app/application/managers/psdImportManager";
import { FsRejectErrorCode } from "@shared/types/os";

function denied(filePath: string): Error {
    return Object.assign(new Error(`File system access is not allowed for path: ${filePath}`), {
        code: FsRejectErrorCode.PERMISSION_DENIED,
    });
}

/**
 * Pick a PSD and read its layer tree.
 *
 * One handler rather than two because the native picker is the only thing that can grant read access
 * to a file outside the project: asking the renderer to pass a path it typed would be refused by the
 * storage manager, exactly as it refuses a hand-typed project directory.
 */
export class PsdOpenHandler extends IPCHandler<IPCEventType.psdOpen> {
    readonly name = IPCEventType.psdOpen;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ filePath: string | null; document: PsdDocument | null }>> {
        const { t } = dialogTranslator(window);
        const result = await showOpenDialog(window, {
            title: t("dialogs.file.title.importPsd"),
            properties: ["openFile"],
            filters: [{ name: t("dialogs.file.filter.photoshop"), extensions: ["psd", "psb"] }],
            securityScopedBookmarks: true,
        });
        if (result.canceled || result.filePaths.length === 0) {
            return this.success({ filePath: null, document: null });
        }
        const filePath = result.filePaths[0];
        try {
            window.app.storageManager.grantFileSystemAccess(window, filePath, "read", false, result.bookmarks?.[0]);
            if (!(await window.app.storageManager.isPathAllowed(window, filePath, "read"))) {
                return this.failed(denied(filePath));
            }
            const document = await readPsdDocument(window.getApp(), filePath);
            return this.success({ filePath, document });
        } catch (error: unknown) {
            return this.failed(error);
        }
    }
}

/**
 * Read the layer tree of a PSD the renderer names by path, without a dialog.
 *
 * For an agent laying out a layered character from a PSD the author put in the project or in a
 * directory they allowed agents to read: there is nobody at a dialog to pick it. The renderer's own
 * check against those directories is not what protects the file system - a renderer can say anything
 * - so the path goes through the same window grant every path-taking handler does, and a path the
 * window could not already read is refused here.
 */
export class PsdReadHandler extends IPCHandler<IPCEventType.psdRead> {
    readonly name = IPCEventType.psdRead;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { filePath }: IPCEvents[IPCEventType.psdRead]["data"],
    ): Promise<RequestStatus<{ document: PsdDocument }>> {
        if (typeof filePath !== "string" || !/\.(psd|psb)$/i.test(filePath)) {
            return this.failed(new Error("Not a Photoshop document (.psd or .psb)."));
        }
        if (!(await window.app.storageManager.isPathAllowed(window, filePath, "read"))) {
            return this.failed(denied(filePath));
        }
        try {
            return this.success({ document: await readPsdDocument(window.getApp(), filePath) });
        } catch (error: unknown) {
            return this.failed(error);
        }
    }
}

/** Bake the chosen layers to full-canvas PNGs. The bytes come back for the renderer to import. */
export class PsdBakeHandler extends IPCHandler<IPCEventType.psdBake> {
    readonly name = IPCEventType.psdBake;
    readonly type = IPCMessageType.request;

    /** Baked files remain readable until their owning window closes. */
    private readonly outputs = new WeakMap<AppWindow, { directories: Set<string>; closed: boolean }>();

    private outputsFor(window: AppWindow): { directories: Set<string>; closed: boolean } {
        const existing = this.outputs.get(window);
        if (existing) return existing;
        const state = { directories: new Set<string>(), closed: false };
        this.outputs.set(window, state);
        window.onClose(() => {
            state.closed = true;
            for (const directory of state.directories) {
                void fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
            }
        });
        return state;
    }

    public async handle(
        window: AppWindow,
        { request }: IPCEvents[IPCEventType.psdBake]["data"],
    ): Promise<RequestStatus<{ layers: PsdBakedLayer[] }>> {
        if (typeof request?.filePath !== "string" || !(await window.app.storageManager.isPathAllowed(window, request.filePath, "read"))) {
            return this.failed(denied(String(request?.filePath)));
        }
        const state = this.outputsFor(window);
        let outputDir: string | undefined;
        let keep = false;
        try {
            const root = psdTempRoot(app.getPath("temp"));
            await fs.mkdir(root, { recursive: true });
            outputDir = await fs.mkdtemp(path.join(root, "bake-"));
            state.directories.add(outputDir);
            if (state.closed) throw new Error("Window closed during PSD import.");
            const layers = await bakePsdLayers(window.getApp(), { ...request, outputDir });
            if (state.closed) throw new Error("Window closed during PSD import.");
            window.app.storageManager.grantFileSystemAccess(window, outputDir, "read", true, undefined, "session");
            keep = true;
            return this.success({ layers });
        } catch (error: unknown) {
            return this.failed(error);
        } finally {
            if (outputDir && (!keep || state.closed)) {
                state.directories.delete(outputDir);
                await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
            }
        }
    }
}
