import crypto from "crypto";
import fs from "fs/promises";
import pathModule from "path";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import { PrivilegedCapability, PrivilegedFileSystemCallResult } from "@shared/types/privileged";
import { PluginPermissionPromptResult, PluginPermissionRequest } from "@shared/types/pluginPermissions";
import type { FileDetails, FileStat } from "@shared/utils/fs";
import { Fs } from "@shared/utils/fs";
import { AppWindow } from "../appWindow";
import {
    authorizeActorCapabilityRequest,
    authorizeActorFileSystemRequest,
} from "../actorAuthorization";
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

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.privilegedFsCall]["data"],
    ): Promise<RequestStatus<PrivilegedFileSystemCallResult>> {
        switch (data.operation) {
            case "stat": {
                const denied = await ensureActorPathAllowed<FileStat>(window, data, data.path, "read");
                return this.success(denied ?? await Fs.stat(data.path));
            }
            case "list": {
                const denied = await ensureActorPathAllowed<FileStat[]>(window, data, data.path, "read");
                if (denied) return this.success(denied);
                const entries = await Fs.dirEntries(data.path);
                if (!entries.ok) return this.success(entries as FsRequestResult<FileStat[]>);
                return this.success({
                    ok: true,
                    data: entries.data.map(entry => ({
                        name: pathModule.parse(entry.name).name,
                        ext: pathModule.extname(entry.name) || null,
                        type: entry.isDirectory() ? "directory" : "file",
                    })),
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
            case "requestWrite": {
                const denied = await ensureActorPathAllowed<string>(window, data, data.path, "write");
                if (denied) return this.success(denied);
                return this.success(await this.allocateWrite(window, data.path, data.raw, "encoding" in data ? data.encoding : undefined));
            }
            case "ensureRegularFile": {
                const denied = await ensureActorPathAllowed<void>(window, data, data.path, "write");
                return this.success(denied ?? await Fs.ensureRegularFile(data.path, data.data, data.encoding));
            }
            case "writeFileNoFollow": {
                const denied = await ensureActorPathAllowed<void>(window, data, data.path, "write");
                return this.success(denied ?? await Fs.writeFileNoFollow(data.path, data.data, data.encoding));
            }
            case "recoverCorruptedJsonFile": {
                const denied = await ensureActorPathAllowed<void>(window, data, data.path, "write");
                return this.success(denied ?? await Fs.recoverCorruptedJsonFile(data.path, data.replacement, data.encoding));
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

    private async allocateRead(
        window: AppWindow,
        fsPath: string,
        raw: boolean,
        encoding?: BufferEncoding,
    ): Promise<FsRequestResult<string>> {
        const hash = window.app.storageManager.allocateHash(fsPath, raw, "read", encoding);
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

    private async allocateWrite(
        window: AppWindow,
        fsPath: string,
        raw: boolean,
        encoding?: BufferEncoding,
    ): Promise<FsRequestResult<string>> {
        const hash = window.app.storageManager.allocateHash(fsPath, raw, "write", encoding);
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
