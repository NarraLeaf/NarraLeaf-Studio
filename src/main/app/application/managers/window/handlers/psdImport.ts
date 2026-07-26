import path from "path";
import { app, dialog } from "electron";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import type { PsdBakedLayer, PsdDocument } from "@shared/types/psdImport";
import { bakePsdLayers, readPsdDocument } from "@/app/application/managers/psdImportManager";

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
        const result = await dialog.showOpenDialog(window.win, {
            title: "Import PSD",
            properties: ["openFile"],
            filters: [{ name: "Photoshop", extensions: ["psd", "psb"] }],
        });
        if (result.canceled || result.filePaths.length === 0) {
            return this.success({ filePath: null, document: null });
        }
        const filePath = result.filePaths[0];
        try {
            const document = await readPsdDocument(window.getApp(), filePath);
            return this.success({ filePath, document });
        } catch (error: unknown) {
            return this.failed(error);
        }
    }
}

/** Bake the chosen layers to full-canvas PNGs. The bytes come back for the renderer to import. */
export class PsdBakeHandler extends IPCHandler<IPCEventType.psdBake> {
    readonly name = IPCEventType.psdBake;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { request }: IPCEvents[IPCEventType.psdBake]["data"],
    ): Promise<RequestStatus<{ layers: PsdBakedLayer[] }>> {
        // The renderer never names a directory: it would be refused by the storage manager anyway,
        // and the temp location is the main process's business. The grant is what lets the asset
        // library read the baked files straight back in through its normal file import.
        const outputDir = path.join(app.getPath("temp"), "narraleaf-psd", String(Date.now()));
        try {
            const layers = await bakePsdLayers(window.getApp(), { ...request, outputDir });
            window.app.storageManager.grantFileSystemAccess(window, outputDir, "read", true, undefined, "session");
            return this.success({ layers });
        } catch (error: unknown) {
            return this.failed(error);
        }
    }
}
