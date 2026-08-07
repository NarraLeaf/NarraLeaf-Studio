import fs from "fs/promises";
import path from "path";
import { dialog } from "electron";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import type { AssetExportFailure, AssetExportResult } from "@shared/types/assetExport";
import type { RemoteAssetFetchResult } from "@shared/types/remoteAsset";
import { fetchRemoteAsset } from "../../remoteAssetFetcher";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Fetch a remote asset's bytes on the renderer's behalf.
 *
 * There is no capability gate: this reads a URL the author typed and returns the bytes, touching
 * nothing on the machine. The things worth gating - where those bytes are then written - are on the
 * privileged file-system facade the renderer already has to go through.
 */
export class AssetFetchRemoteHandler extends IPCHandler<IPCEventType.assetFetchRemote> {
    readonly name = IPCEventType.assetFetchRemote;
    readonly type = IPCMessageType.request;

    public async handle(
        _window: AppWindow,
        data: IPCEvents[IPCEventType.assetFetchRemote]["data"],
    ): Promise<RequestStatus<RemoteAssetFetchResult>> {
        return this.tryUse(() => fetchRemoteAsset(data.url, data.validators));
    }
}

/** Reduce one renderer-supplied path segment to something safe to create on any platform. */
function sanitizeExportSegment(segment: string): string {
    const cleaned = segment
        .replace(/[/\\:*?"<>|\x00-\x1f]+/g, "-")
        .replace(/\.+$/, "")
        .trim();
    // "." and ".." collapse to nothing here, which is the point: a segment that means "somewhere
    // else" is not a name, and the caller drops the entry rather than guessing at one.
    return cleaned === "." || cleaned === ".." ? "" : cleaned;
}

/**
 * Where an entry lands under the chosen folder, or null if its path does not name a place inside it.
 *
 * Segments are sanitized one at a time and the result is re-checked against the root, so neither a
 * crafted `..` nor a drive prefix that `path.join` would absorb can walk out of the folder the
 * author picked.
 */
function resolveExportTarget(exportDir: string, relativePath: string): string | null {
    if (relativePath.includes("\0")) {
        return null;
    }
    const segments = relativePath
        .split(/[/\\]/)
        .map(sanitizeExportSegment)
        .filter(segment => segment.length > 0);
    if (segments.length === 0) {
        return null;
    }
    const target = path.resolve(exportDir, ...segments);
    const root = path.resolve(exportDir);
    const withSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    return target.startsWith(withSeparator) ? target : null;
}

/** A free path next to `target`, suffixing the stem rather than overwriting what is already there. */
async function resolveAvailableExportPath(target: string): Promise<string> {
    const dir = path.dirname(target);
    const base = path.basename(target);
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    for (let index = 0; index < 1000; index += 1) {
        const candidate = index === 0 ? target : path.join(dir, `${stem}-${index}${ext}`);
        try {
            await fs.access(candidate);
        } catch {
            return candidate;
        }
    }
    throw new Error(`Unable to choose a free name for "${base}" in the selected folder.`);
}

/**
 * Copy library files out to a folder the author picks.
 *
 * Runs entirely in main because a folder picked through `fsSelectDirectory` carries a read-only
 * grant - see `permissions.ts` - so the renderer cannot write into it even though it just chose it.
 * Every source is checked against the window's own grants before it is read, which keeps this from
 * becoming a way to copy an arbitrary file off the machine on a compromised renderer's say-so.
 *
 * A failed entry does not abandon the run: the rest are still copied and the failures come back
 * named, because half an export the author is told about beats none they are not.
 */
export class AssetExportToFolderHandler extends IPCHandler<IPCEventType.assetExportToFolder> {
    readonly name = IPCEventType.assetExportToFolder;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { entries }: IPCEvents[IPCEventType.assetExportToFolder]["data"],
    ): Promise<RequestStatus<AssetExportResult>> {
        try {
            if (!Array.isArray(entries) || entries.length === 0) {
                return this.failed("Nothing was handed to the export.");
            }

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

            const failures: AssetExportFailure[] = [];
            let exportedCount = 0;

            for (const entry of entries) {
                const relativePath = typeof entry?.relativePath === "string" ? entry.relativePath : "";
                try {
                    const source = path.resolve(entry.sourcePath);
                    if (!await window.app.storageManager.isPathAllowed(window, source, "read")) {
                        throw new Error("This file is outside the project and was not exported.");
                    }

                    const target = resolveExportTarget(exportDir, relativePath);
                    if (!target) {
                        throw new Error("That name does not point anywhere inside the chosen folder.");
                    }

                    await fs.mkdir(path.dirname(target), { recursive: true });
                    const destination = await resolveAvailableExportPath(target);
                    if (entry.isDirectory) {
                        await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false });
                    } else {
                        await fs.copyFile(source, destination);
                    }
                    exportedCount += 1;
                } catch (error) {
                    failures.push({
                        relativePath: relativePath || "(unnamed)",
                        reason: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            return this.success({
                canceled: false,
                directory: exportDir,
                exportedCount,
                failures: failures.length > 0 ? failures : undefined,
            });
        } catch (error) {
            return this.failed(error);
        }
    }
}
