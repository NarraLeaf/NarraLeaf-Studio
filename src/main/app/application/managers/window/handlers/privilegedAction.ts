import crypto from "crypto";
import fs from "fs/promises";
import pathModule from "path";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import type { FsTextEncoding } from "@shared/types/textEncoding";
import { PrivilegedCapability, PrivilegedFileSystemCallResult } from "@shared/types/privileged";
import { PluginPermissionPromptResult, PluginPermissionRequest } from "@shared/types/pluginPermissions";
import type { FileDetails, FileStat, FileEntry } from "@shared/utils/fs";
import { Fs } from "@shared/utils/fs";
import { WRITE_BATCH_MAX_ENTRIES } from "@shared/utils/writeBatchFrame";
import { splitFileEntry } from "@shared/utils/fileEntry";
import { dialogTranslator, showOpenDialog, showSaveDialog } from "../fileDialog";
import { AppWindow } from "../appWindow";
import {
    authorizeActorCapabilityRequest,
    authorizeActorFileSystemRequest,
} from "../actorAuthorization";
import { getRuntimeGrantPolicy } from "../permissions";
import { IPCHandler } from "./IPCHandler";

function unauthorizedResult<T>(message: string): FsRequestResult<T> {
    return {
        ok: false,
        error: {
            code: FsRejectErrorCode.PERMISSION_DENIED,
            message,
        },
    };
}

async function ensureActorPathAllowed<T>(
    window: AppWindow,
    data: IPCEvents[IPCEventType.privilegedFsCall]["data"],
    fsPath: string,
    mode: "read" | "write",
): Promise<FsRequestResult<T> | null> {
    const authorization = await authorizeActorFileSystemRequest(window, data.actor, fsPath, mode);
    if (authorization.allowed) {
        return null;
    }
    return unauthorizedResult<T>(authorization.reason ?? `File system access is not allowed for path: ${fsPath}`);
}

async function ensureActorPathsAllowed<T>(
    window: AppWindow,
    data: IPCEvents[IPCEventType.privilegedFsCall]["data"],
    mode: "read" | "write",
    ...paths: string[]
): Promise<FsRequestResult<T> | null> {
    for (const fsPath of paths) {
        const denied = await ensureActorPathAllowed<T>(window, data, fsPath, mode);
        if (denied) {
            return denied;
        }
    }
    return null;
}

export class PrivilegedFsCallHandler extends IPCHandler<IPCEventType.privilegedFsCall> {
    readonly name = IPCEventType.privilegedFsCall;
    readonly type = IPCMessageType.request;
    /**
     * How many read grants `requestReadMany` mints at once.
     *
     * Each is a pair of stats and nothing else, so the useful width is whatever the filesystem
     * answers in parallel. Thirty-two is the width the asset resolver already asked at from the
     * renderer side, and measured no better at sixty-four.
     */
    private static readonly ReadManyConcurrency = 32;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.privilegedFsCall]["data"],
    ): Promise<RequestStatus<PrivilegedFileSystemCallResult>> {
        switch (data.operation) {
            case "selectFile": {
                if (data.actor.kind !== "facade" || data.actor.id !== "default") {
                    return this.success(unauthorizedResult<string[]>("Only the default facade can open the file picker"));
                }
                const grantPolicy = getRuntimeGrantPolicy(window, "selectFile");
                if (!grantPolicy) {
                    return this.success(unauthorizedResult<string[]>("File picker is not allowed for this window"));
                }

                try {
                    const { t } = dialogTranslator(window);
                    const dialogOptions: Electron.OpenDialogOptions = {
                        // The caller's own sentence when it has one. Without it the picker says what
                        // it is choosing rather than what one caller happens to choose with it.
                        title: data.title ?? t("dialogs.file.title.selectFile"),
                        buttonLabel: t("dialogs.file.button.select"),
                        properties: data.multiple ? ["openFile", "multiSelections"] : ["openFile"],
                        securityScopedBookmarks: true,
                    };

                    if (data.filters.length > 0) {
                        dialogOptions.filters = [
                            { name: t("dialogs.file.filter.supported"), extensions: data.filters },
                            { name: t("dialogs.file.filter.all"), extensions: ["*"] },
                        ];
                    }

                    const result = await showOpenDialog(window, dialogOptions);
                    if (result.canceled) {
                        return this.success({ ok: true, data: [] });
                    }

                    for (const [index, filePath] of result.filePaths.entries()) {
                        window.app.storageManager.grantFileSystemAccess(
                            window,
                            filePath,
                            grantPolicy.mode,
                            grantPolicy.recursive,
                            result.bookmarks?.[index],
                        );
                    }

                    return this.success({ ok: true, data: result.filePaths });
                } catch (error) {
                    return this.success(this.unknownError<string[]>(error));
                }
            }
            case "selectSaveFile": {
                if (data.actor.kind !== "facade" || data.actor.id !== "default") {
                    return this.success(unauthorizedResult<string | null>("Only the default facade can open the save dialog"));
                }
                const grantPolicy = getRuntimeGrantPolicy(window, "selectSaveFile");
                if (!grantPolicy) {
                    return this.success(unauthorizedResult<string | null>("Save dialog is not allowed for this window"));
                }

                try {
                    const { t } = dialogTranslator(window);
                    const dialogOptions: Electron.SaveDialogOptions = {
                        title: t("dialogs.file.title.saveFile"),
                        defaultPath: data.defaultFileName,
                        securityScopedBookmarks: true,
                    };
                    if (data.filters.length > 0) {
                        dialogOptions.filters = [
                            { name: t("dialogs.file.filter.supported"), extensions: data.filters },
                            { name: t("dialogs.file.filter.all"), extensions: ["*"] },
                        ];
                    }

                    const result = await showSaveDialog(window, dialogOptions);
                    if (result.canceled || !result.filePath) {
                        return this.success({ ok: true, data: null });
                    }

                    window.app.storageManager.grantFileSystemAccess(
                        window,
                        result.filePath,
                        grantPolicy.mode,
                        grantPolicy.recursive,
                        result.bookmark,
                    );

                    return this.success({ ok: true, data: result.filePath });
                } catch (error) {
                    return this.success(this.unknownError<string | null>(error));
                }
            }
            case "stat": {
                const denied = await ensureActorPathAllowed<FileStat>(window, data, data.path, "read");
                return this.success(denied ?? await Fs.stat(data.path));
            }
            case "list": {
                const denied = await ensureActorPathAllowed<FileEntry[]>(window, data, data.path, "read");
                if (denied) return this.success(denied);
                const entries = await Fs.dirEntries(data.path);
                if (!entries.ok) return this.success(entries as FsRequestResult<FileEntry[]>);
                // Same split factory as the internal `FsListHandler` (fsAction.ts): `name` keeps the
                // stripped stem for backward compatibility, `fileName` is the additive whole name.
                const listing: FileEntry[] = entries.data.map(entry => ({
                    ...splitFileEntry(entry.name),
                    type: entry.isDirectory() ? "directory" : "file",
                }));
                return this.success({
                    ok: true,
                    data: listing,
                });
            }
            case "details": {
                const denied = await ensureActorPathAllowed<FileDetails>(window, data, data.path, "read");
                return this.success(denied ?? await Fs.details(data.path));
            }
            case "requestRead": {
                const denied = await ensureActorPathAllowed<string>(window, data, data.path, "read");
                if (denied) return this.success(denied);
                return this.success(await this.allocateRead(window, data.path, data.raw, "encoding" in data ? data.encoding : undefined));
            }
            case "requestReadMany": {
                return this.success(await this.allocateReadMany(window, data, data.paths));
            }
            case "requestWrite": {
                const denied = await ensureActorPathAllowed<string>(window, data, data.path, "write");
                if (denied) return this.success(denied);
                return this.success(await this.allocateWrite(window, data.path, data.raw, "encoding" in data ? data.encoding : undefined));
            }
            case "requestWriteBatch": {
                return this.success(await this.allocateWriteBatch(window, data));
            }
            case "ensureRegularFile": {
                const denied = await ensureActorPathAllowed<void>(window, data, data.path, "write");
                return this.success(denied ?? await Fs.ensureRegularFile(data.path, data.data, data.encoding));
            }
            case "writeFileNoFollow": {
                const denied = await ensureActorPathAllowed<void>(window, data, data.path, "write");
                return this.success(denied ?? await Fs.writeFileNoFollow(data.path, data.data, data.encoding));
            }
            case "writeFileNoFollowOrCreate": {
                // Authorized exactly as the write-grant route authorizes the same path: this verb
                // exists to skip the grant's *round trip*, never its permission check.
                const denied = await ensureActorPathAllowed<void>(window, data, data.path, "write");
                return this.success(denied ?? await Fs.writeFileNoFollowOrCreate(data.path, data.data, data.encoding));
            }
            case "createDir": {
                const denied = await ensureActorPathAllowed<void>(window, data, data.path, "write");
                return this.success(denied ?? await Fs.createDir(data.path) as FsRequestResult<void>);
            }
            case "deleteFile": {
                const denied = await ensureActorPathAllowed<void>(window, data, data.path, "write");
                return this.success(denied ?? await Fs.deleteFile(data.path));
            }
            case "deleteDir": {
                const denied = await ensureActorPathAllowed<void>(window, data, data.path, "write");
                return this.success(denied ?? await Fs.deleteDir(data.path));
            }
            case "rename": {
                const nextPath = pathModule.join(pathModule.dirname(data.oldPath), data.newName);
                const denied = await ensureActorPathsAllowed<void>(window, data, "write", data.oldPath, nextPath);
                return this.success(denied ?? await Fs.rename(data.oldPath, nextPath));
            }
            case "copyFile": {
                const readDenied = await ensureActorPathAllowed<void>(window, data, data.src, "read");
                if (readDenied) return this.success(readDenied);
                const writeDenied = await ensureActorPathAllowed<void>(window, data, data.dest, "write");
                return this.success(writeDenied ?? await Fs.cpFile(data.src, data.dest));
            }
            case "copyDir": {
                const readDenied = await ensureActorPathAllowed<void>(window, data, data.src, "read");
                if (readDenied) return this.success(readDenied);
                const writeDenied = await ensureActorPathAllowed<void>(window, data, data.dest, "write");
                return this.success(writeDenied ?? await Fs.copyDir(data.src, data.dest));
            }
            case "moveFile": {
                const readDenied = await ensureActorPathAllowed<void>(window, data, data.src, "read");
                if (readDenied) return this.success(readDenied);
                const writeDenied = await ensureActorPathsAllowed<void>(window, data, "write", data.src, data.dest);
                return this.success(writeDenied ?? await Fs.moveFile(data.src, data.dest));
            }
            case "moveDir": {
                const readDenied = await ensureActorPathAllowed<void>(window, data, data.src, "read");
                if (readDenied) return this.success(readDenied);
                const writeDenied = await ensureActorPathsAllowed<void>(window, data, "write", data.src, data.dest);
                return this.success(writeDenied ?? await Fs.moveDir(data.src, data.dest));
            }
            case "fileExists": {
                const denied = await ensureActorPathAllowed<boolean>(window, data, data.path, "read");
                return this.success(denied ?? await Fs.isFileExists(data.path));
            }
            case "dirExists": {
                const denied = await ensureActorPathAllowed<boolean>(window, data, data.path, "read");
                return this.success(denied ?? await Fs.isDirExists(data.path) as FsRequestResult<boolean>);
            }
            case "isFile": {
                const denied = await ensureActorPathAllowed<boolean>(window, data, data.path, "read");
                return this.success(denied ?? await Fs.isFile(data.path));
            }
            case "isDir": {
                const denied = await ensureActorPathAllowed<boolean>(window, data, data.path, "read");
                return this.success(denied ?? await Fs.isDir(data.path));
            }
            case "hash": {
                const denied = await ensureActorPathAllowed<string>(window, data, data.path, "read");
                if (denied) return this.success(denied);
                return this.success(await this.hashFile(data.path));
            }
            default:
                return this.success(unauthorizedResult(`Unsupported privileged file system operation: ${(data as any).operation}`));
        }
    }

    /**
     * Mint one read grant per path, concurrently.
     *
     * Each path goes through the same authorization and the same existence checks as a
     * `requestRead` for it alone, so nothing here can reach a file the one-at-a-time route
     * would have refused. A path that fails either answers `null` and the rest still stand -
     * the grants are independent, and a caller resolving an asset library wants the ones that
     * worked rather than nothing at all.
     *
     * The width is for the filesystem, not the CPU: every one of these is a pair of stats.
     */
    private async allocateReadMany(
        window: AppWindow,
        data: IPCEvents[IPCEventType.privilegedFsCall]["data"],
        paths: string[],
    ): Promise<FsRequestResult<(string | null)[]>> {
        const grants: (string | null)[] = new Array(paths.length).fill(null);
        let index = 0;
        await Promise.all(Array.from(
            { length: Math.min(PrivilegedFsCallHandler.ReadManyConcurrency, paths.length) },
            async () => {
                while (index < paths.length) {
                    const at = index;
                    index += 1;
                    const fsPath = paths[at]!;
                    const denied = await ensureActorPathAllowed<string>(window, data, fsPath, "read");
                    if (denied) {
                        continue;
                    }
                    // One `stat` where the single-path route takes an `access` and then a `stat`.
                    // A `stat` that answers says both that the path is there and that it is a
                    // file; what the extra `access` adds is turning "exists but is not readable"
                    // into a refused grant rather than a read that fails. Over a whole library
                    // that second syscall is a measurable share of the wait and the distinction is
                    // one the caller cannot use - an asset it cannot read is a missing asset
                    // either way. The single-path route keeps the stricter pair: it answers one
                    // caller about one file and can afford to.
                    const hash = window.app.storageManager.allocateHash(fsPath, true, "read", window.getWebContents().id);
                    const isFile = await Fs.isFile(fsPath);
                    if (isFile.ok && isFile.data) {
                        window.app.storageManager.updateStatus(hash, "ready");
                        grants[at] = hash;
                    } else {
                        window.app.storageManager.cleanup(hash);
                    }
                }
            },
        ));
        return { ok: true, data: grants };
    }
    private async allocateRead(
        window: AppWindow,
        fsPath: string,
        raw: boolean,
        encoding?: FsTextEncoding,
    ): Promise<FsRequestResult<string>> {
        const hash = window.app.storageManager.allocateHash(fsPath, raw, "read", window.getWebContents().id, encoding);
        try {
            const exists = await Fs.isFileExists(fsPath);
            if (!exists.ok || !exists.data) {
                window.app.storageManager.cleanup(hash);
                return !exists.ok ? exists as FsRequestResult<string> : {
                    ok: false,
                    error: { code: FsRejectErrorCode.NOT_FOUND, message: "File does not exist: " + fsPath },
                };
            }
            const isFile = await Fs.isFile(fsPath);
            if (!isFile.ok || !isFile.data) {
                window.app.storageManager.cleanup(hash);
                return !isFile.ok ? isFile as FsRequestResult<string> : {
                    ok: false,
                    error: { code: FsRejectErrorCode.NOT_A_FILE, message: "Path is not a file: " + fsPath },
                };
            }
            window.app.storageManager.updateStatus(hash, "ready");
            return { ok: true, data: hash };
        } catch (error) {
            window.app.storageManager.cleanup(hash);
            return this.unknownError(error);
        }
    }

    /**
     * Mint one grant covering every path in `entries`.
     *
     * All-or-nothing on *authorization*: one denied path refuses the whole grant, so a batch can
     * never reach a file that `requestWrite` for it alone would have refused. The refusal carries the
     * first offending path's own message, which is the same sentence the single-path route would
     * have produced.
     *
     * Per-file on everything else. Whether each directory still exists is checked when the bytes
     * arrive, not here - `allocateWrite` does it up front because it has exactly one file to fail,
     * while a batch that refused the whole set over one missing directory would be strictly worse
     * than the N separate writes it replaces. See `FileSystemHashHandler.handleBatchWrite`.
     */
    private async allocateWriteBatch(
        window: AppWindow,
        data: Extract<IPCEvents[IPCEventType.privilegedFsCall]["data"], { operation: "requestWriteBatch" }>,
    ): Promise<FsRequestResult<string>> {
        if (data.entries.length === 0) {
            return {
                ok: false,
                error: { code: FsRejectErrorCode.INVALID_PATH, message: "A batched write grant must name at least one file" },
            };
        }
        if (data.entries.length > WRITE_BATCH_MAX_ENTRIES) {
            return {
                ok: false,
                error: {
                    code: FsRejectErrorCode.INVALID_PATH,
                    message: `A batched write grant may name at most ${WRITE_BATCH_MAX_ENTRIES} files; ${data.entries.length} were asked for`,
                },
            };
        }

        const seen = new Set<string>();
        for (const entry of data.entries) {
            // Refused rather than resolved to a winner. The files in a batch are written
            // concurrently, so naming one twice has no defined outcome, and quietly picking one of
            // the two payloads is a worse answer than saying the request is malformed.
            if (seen.has(entry.path)) {
                return {
                    ok: false,
                    error: { code: FsRejectErrorCode.INVALID_PATH, message: `A batched write grant names ${entry.path} twice` },
                };
            }
            seen.add(entry.path);

            const denied = await ensureActorPathAllowed<string>(window, data, entry.path, "write");
            if (denied) {
                return denied;
            }
        }

        const hash = window.app.storageManager.allocateWriteBatchHash(
            data.entries.map(entry => ({
                path: entry.path,
                // Same meaning as the single-path verbs: no encoding is the `raw: true` arm.
                raw: entry.encoding === undefined,
                encoding: entry.encoding,
            })),
            window.getWebContents().id,
        );
        window.app.storageManager.updateStatus(hash, "ready");
        return { ok: true, data: hash };
    }

    private async allocateWrite(
        window: AppWindow,
        fsPath: string,
        raw: boolean,
        encoding?: FsTextEncoding,
    ): Promise<FsRequestResult<string>> {
        const hash = window.app.storageManager.allocateHash(fsPath, raw, "write", window.getWebContents().id, encoding);
        try {
            const dirPath = pathModule.dirname(fsPath);
            const dirExists = await Fs.isDirExists(dirPath);
            if (!dirExists.ok || !dirExists.data) {
                window.app.storageManager.cleanup(hash);
                return !dirExists.ok ? dirExists as FsRequestResult<string> : {
                    ok: false,
                    error: { code: FsRejectErrorCode.NOT_FOUND, message: "Directory does not exist" },
                };
            }
            window.app.storageManager.updateStatus(hash, "ready");
            return { ok: true, data: hash };
        } catch (error) {
            window.app.storageManager.cleanup(hash);
            return this.unknownError(error);
        }
    }

    private async hashFile(fsPath: string): Promise<FsRequestResult<string>> {
        try {
            const exists = await Fs.isFileExists(fsPath);
            if (!exists.ok || !exists.data) {
                return !exists.ok ? exists as FsRequestResult<string> : {
                    ok: false,
                    error: { code: FsRejectErrorCode.NOT_FOUND, message: "File does not exist: " + fsPath },
                };
            }
            const isFile = await Fs.isFile(fsPath);
            if (!isFile.ok || !isFile.data) {
                return !isFile.ok ? isFile as FsRequestResult<string> : {
                    ok: false,
                    error: { code: FsRejectErrorCode.NOT_A_FILE, message: "Path is not a file: " + fsPath },
                };
            }
            const buffer = await fs.readFile(fsPath);
            return { ok: true, data: crypto.createHash("sha256").update(buffer).digest("hex") };
        } catch (error) {
            return this.unknownError(error);
        }
    }

    private unknownError<T>(error: unknown): FsRequestResult<T> {
        return {
            ok: false,
            error: {
                code: FsRejectErrorCode.UNKNOWN,
                message: error instanceof Error ? error.message : String(error),
            },
        };
    }
}

export class PrivilegedPermissionRequestHandler extends IPCHandler<IPCEventType.privilegedPermissionRequest> {
    readonly name = IPCEventType.privilegedPermissionRequest;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.privilegedPermissionRequest]["data"],
    ): Promise<RequestStatus<PluginPermissionPromptResult>> {
        const capability = authorizeActorCapabilityRequest(
            window,
            { kind: "facade", id: "default" },
            getRequiredPermissionRequestCapability(data.request),
        );
        if (!capability.allowed) {
            return this.failed(capability.reason ?? "Permission request is not allowed");
        }
        if (data.actor.kind === "plugin" && data.request.kind === "install") {
            return this.failed("Installed plugins cannot request plugin installation");
        }
        if (data.actor.kind === "plugin" && data.request.plugin.id !== data.actor.pluginId) {
            return this.failed("Plugin permission request actor does not match request plugin");
        }
        if (
            data.actor.kind === "plugin" &&
            data.actor.version &&
            data.request.plugin.version &&
            data.request.plugin.version !== data.actor.version
        ) {
            return this.failed("Plugin permission request version does not match request plugin");
        }

        const existingGrant = window.app.pluginPermissionManager.getExistingGrantResult(data.request);
        if (existingGrant) {
            return this.success(existingGrant);
        }

        const promptWindow = await window.getApp().launchPluginPermissionPrompt(window, { request: data.request });
        window.addChild(promptWindow);

        return new Promise<RequestStatus<PluginPermissionPromptResult>>(resolve => {
            promptWindow.setCloseResultResolver(result => {
                resolve(this.success(result ?? null));
            });
        });
    }
}

export class PrivilegedPermissionRevokePluginHandler extends IPCHandler<IPCEventType.privilegedPermissionRevokePlugin> {
    readonly name = IPCEventType.privilegedPermissionRevokePlugin;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.privilegedPermissionRevokePlugin]["data"],
    ): RequestStatus<void> {
        if (data.actor.kind !== "facade" || data.actor.id !== "default") {
            return this.failed("Only the default facade can revoke plugin permissions");
        }

        const authorization = authorizeActorCapabilityRequest(
            window,
            data.actor,
            PrivilegedCapability.PluginInstall,
        );
        if (!authorization.allowed) {
            return this.failed(authorization.reason ?? "Plugin permission revocation is not allowed");
        }

        window.app.pluginPermissionManager.revokePluginPermissions(data.pluginId);
        return this.success();
    }
}

function getRequiredPermissionRequestCapability(request: PluginPermissionRequest): PrivilegedCapability {
    if (request.kind === "install") {
        return PrivilegedCapability.PluginInstall;
    }
    return PrivilegedCapability.PluginPermissionRequest;
}

export class PrivilegedBashExecuteHandler extends IPCHandler<IPCEventType.privilegedBashExecute> {
    readonly name = IPCEventType.privilegedBashExecute;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.privilegedBashExecute]["data"],
    ): RequestStatus<never> {
        const authorization = authorizeActorCapabilityRequest(
            window,
            data.actor,
            PrivilegedCapability.BashExecute,
        );
        if (!authorization.allowed) {
            return this.failed(authorization.reason ?? "Bash execution is not allowed");
        }
        return this.failed("Bash execution is not implemented yet");
    }
}
