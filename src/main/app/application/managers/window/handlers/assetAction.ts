import fs from "fs/promises";
import path from "path";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import type { AssetExportFailure, AssetExportFileResult, AssetExportResult } from "@shared/types/assetExport";
import type { RemoteAssetFetchResult } from "@shared/types/remoteAsset";
import { fileExtensionFromBytes, MEDIA_SNIFF_PREFIX_BYTES } from "@shared/utils/mediaSniff";
import { fetchRemoteAsset } from "../../remoteAssetFetcher";
import { refuseDistrustedWindow } from "../../../utils/projectTrustGate";
import { dialogTranslator, showOpenDialog, showSaveDialog } from "../fileDialog";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Fetch a remote asset's bytes on the renderer's behalf.
 *
 * Where those bytes are then written is gated on the privileged file-system facade the renderer
 * already goes through, so this handler does not gate the write. What it does gate is the request.
 *
 * # Why a distrusted project may not do this
 *
 * The reasoning that once applied here - "a URL the author typed, touching nothing on the machine"
 * - holds only for a project the author wrote. In one that arrived from elsewhere the addresses in
 * the asset table were chosen by whoever built the package, and Refresh turns one of them into a
 * request from this machine, at this address, at a moment somebody else picked. That is an effect
 * on the world, which is exactly what trust governs, and it is not covered by the network block on
 * the workspace window: this request leaves from main.
 */
export class AssetFetchRemoteHandler extends IPCHandler<IPCEventType.assetFetchRemote> {
    readonly name = IPCEventType.assetFetchRemote;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.assetFetchRemote]["data"],
    ): Promise<RequestStatus<RemoteAssetFetchResult>> {
        const distrusted = refuseDistrustedWindow(window, "remote asset download");
        if (distrusted) {
            return this.failed(new Error(distrusted));
        }
        return this.tryUse(() => fetchRemoteAsset(data.url, data.validators));
    }
}

/** Reduce one renderer-supplied path segment to something safe to create on any platform. */
function sanitizeExportSegment(segment: string): string {
    // Trailing dots are stripped after the trim, not before it: Windows drops a trailing dot from a
    // filename, so `"chapter one. "` has to lose both the space and the dot to name what it says.
    const cleaned = segment
        .replace(/[/\\:*?"<>|\x00-\x1f]+/g, "-")
        .trim()
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

/**
 * The name to write `source` under, given the name the library holds for it.
 *
 * An asset's bytes live at an id-sharded path with no extension, and the record's `ext` is where the
 * one it came in with is kept - except that the field is optional and a shipped template's records
 * do not carry it, so the name arriving here can be a bare `classroom`. A file written under that
 * name is one the author's system cannot open, which is the whole point of exporting it.
 *
 * So when the name has no extension, the bytes are asked: the same sniffer the runtime serves a
 * protected pack with. A format it does not recognise leaves the name alone - a wrong suffix tells
 * the OS something untrue, which is worse than none.
 *
 * Directories are left alone: a model bundle is a folder, and folders have no extension.
 */
async function nameWithExtension(source: string, name: string, isDirectory: boolean): Promise<string> {
    if (isDirectory || path.extname(name) !== "") {
        return name;
    }
    let handle: fs.FileHandle | undefined;
    try {
        handle = await fs.open(source, "r");
        const head = Buffer.alloc(MEDIA_SNIFF_PREFIX_BYTES);
        const { bytesRead } = await handle.read(head, 0, MEDIA_SNIFF_PREFIX_BYTES, 0);
        const extension = fileExtensionFromBytes(head.subarray(0, bytesRead));
        return extension ? `${name}.${extension}` : name;
    } catch {
        // The copy itself is about to fail on the same file and will say so with its own path in
        // hand; naming is not the place to report that.
        return name;
    } finally {
        await handle?.close();
    }
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
 * Doing the copy here rather than widening that grant is the point: the read-only scope survives,
 * and this handler stays the only thing that can write into the chosen folder.
 *
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

            const { t } = dialogTranslator(window);
            const selection = await showOpenDialog(window, {
                title: t("dialogs.file.title.exportAssets"),
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
            // macOS wants the security scope opened before anything may write into a folder that
            // has just come back from a picker. Deliberately NOT `grantFileSystemAccess`: the
            // copying below happens here, in main, so the renderer needs no grant over the author's
            // folder at all - and issuing one would hand it a recursive, session-long readwrite
            // reach into a directory that `selectDirectory` only ever grants read on, which is the
            // policy that makes the picker safe to offer in the first place.
            window.app.storageManager.startSecurityScopedAccess(
                window,
                exportDir,
                selection.bookmarks?.[0],
                "session",
            );

            const failures: AssetExportFailure[] = [];
            let exportedCount = 0;

            for (const entry of entries) {
                const relativePath = typeof entry?.relativePath === "string" ? entry.relativePath : "";
                try {
                    const source = path.resolve(entry.sourcePath);
                    if (!await window.app.storageManager.isPathAllowed(window, source, "read")) {
                        throw new Error("This file is outside the project and was not exported.");
                    }

                    const target = resolveExportTarget(
                        exportDir,
                        await nameWithExtension(source, relativePath, entry.isDirectory === true),
                    );
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

/**
 * Copy one library file out to a place the author names.
 *
 * The single-file counterpart of {@link AssetExportToFolderHandler}, and it lives here rather than
 * in the renderer for the same reason: a path that comes back from a picker carries no write grant,
 * so the copy is made in main. The author names the file in the dialog, which is also where an
 * overwrite is confirmed - so unlike the folder export this writes over what it is pointed at,
 * because that is what the dialog just asked about.
 */
export class AssetExportToFileHandler extends IPCHandler<IPCEventType.assetExportToFile> {
    readonly name = IPCEventType.assetExportToFile;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { entry }: IPCEvents[IPCEventType.assetExportToFile]["data"],
    ): Promise<RequestStatus<AssetExportFileResult>> {
        try {
            if (!entry || typeof entry.sourcePath !== "string" || entry.sourcePath.length === 0) {
                return this.failed("Nothing was handed to the export.");
            }

            // Asked before the dialog: a source this window may not read is not worth a picker the
            // author would fill in and then be refused on.
            const source = path.resolve(entry.sourcePath);
            if (!await window.app.storageManager.isPathAllowed(window, source, "read")) {
                return this.failed("This file is outside the project and was not exported.");
            }

            const fileName = await nameWithExtension(
                source,
                sanitizeExportSegment(typeof entry.fileName === "string" ? entry.fileName : ""),
                false,
            );
            const extension = path.extname(fileName).replace(/^\./, "");

            const { t } = dialogTranslator(window);
            const selection = await showSaveDialog(window, {
                title: t("dialogs.file.title.exportAsset"),
                buttonLabel: t("dialogs.file.button.export"),
                ...(fileName ? { defaultPath: fileName } : {}),
                filters: extension
                    ? [{ name: extension.toUpperCase(), extensions: [extension] }, { name: t("dialogs.file.filter.all"), extensions: ["*"] }]
                    : [{ name: t("dialogs.file.filter.all"), extensions: ["*"] }],
                securityScopedBookmarks: true,
            });

            if (selection.canceled || !selection.filePath) {
                return this.success({ canceled: true });
            }

            const target = path.resolve(selection.filePath);
            if (await window.app.storageManager.isPathProtected(target)) {
                return this.failed("Selected location is inside protected Studio storage.");
            }
            // The scope, not a grant: main does the writing, so the renderer needs no reach into the
            // folder the author picked. Same reasoning as the folder export.
            window.app.storageManager.startSecurityScopedAccess(
                window,
                target,
                selection.bookmark,
                "session",
            );

            await fs.copyFile(source, target);
            return this.success({ canceled: false, filePath: target });
        } catch (error) {
            return this.failed(error);
        }
    }
}
