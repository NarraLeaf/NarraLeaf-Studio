import type { FileDetails, FileStat } from "@shared/utils/fs";
import type { FsRequestResult } from "@shared/types/os";
import type { RequestStatus } from "@shared/types/ipcEvents";
import type { PluginIdentity, PluginPermissionRequest, PluginPermissionPromptResult } from "@shared/types/pluginPermissions";
import type { PrivilegedBashExecuteResult } from "@shared/types/privileged";
import { getInterface } from "./bridge";
import {
    createPluginFacadeToken,
    defaultFacadeToken,
    resolvePrivilegedActor,
    revokePrivilegedToken,
    type PrivilegedFacadeToken,
} from "./privilegedTokens";

export type BoundPrivilegedFacade = ReturnType<typeof createBoundPrivilegedFacade>;

function createBoundPrivilegedFacade(token: PrivilegedFacadeToken) {
    const actor = () => resolvePrivilegedActor(token);
    return {
        fs: {
            stat: (path: string): Promise<RequestStatus<FsRequestResult<FileStat>>> =>
                getInterface().privileged.fs.stat(actor(), path),
            list: (path: string): Promise<RequestStatus<FsRequestResult<FileStat[]>>> =>
                getInterface().privileged.fs.list(actor(), path),
            details: (path: string): Promise<RequestStatus<FsRequestResult<FileDetails>>> =>
                getInterface().privileged.fs.details(actor(), path),
            requestRead: (path: string, encoding: BufferEncoding): Promise<RequestStatus<FsRequestResult<string>>> =>
                getInterface().privileged.fs.requestRead(actor(), path, encoding),
            requestReadRaw: (path: string): Promise<RequestStatus<FsRequestResult<string>>> =>
                getInterface().privileged.fs.requestReadRaw(actor(), path),
            requestWrite: (path: string, encoding: BufferEncoding): Promise<RequestStatus<FsRequestResult<string>>> =>
                getInterface().privileged.fs.requestWrite(actor(), path, encoding),
            requestWriteRaw: (path: string): Promise<RequestStatus<FsRequestResult<string>>> =>
                getInterface().privileged.fs.requestWriteRaw(actor(), path),
            ensureRegularFile: (path: string, data: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>> =>
                getInterface().privileged.fs.ensureRegularFile(actor(), path, data, encoding),
            writeFileNoFollow: (path: string, data: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>> =>
                getInterface().privileged.fs.writeFileNoFollow(actor(), path, data, encoding),
            recoverCorruptedJsonFile: (path: string, replacement: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>> =>
                getInterface().privileged.fs.recoverCorruptedJsonFile(actor(), path, replacement, encoding),
            createDir: (path: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                getInterface().privileged.fs.createDir(actor(), path),
            deleteFile: (path: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                getInterface().privileged.fs.deleteFile(actor(), path),
            deleteDir: (path: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                getInterface().privileged.fs.deleteDir(actor(), path),
            rename: (oldPath: string, newName: string, isDir: boolean): Promise<RequestStatus<FsRequestResult<void>>> =>
                getInterface().privileged.fs.rename(actor(), oldPath, newName, isDir),
            copyFile: (src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                getInterface().privileged.fs.copyFile(actor(), src, dest),
            copyDir: (src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                getInterface().privileged.fs.copyDir(actor(), src, dest),
            moveFile: (src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                getInterface().privileged.fs.moveFile(actor(), src, dest),
            moveDir: (src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                getInterface().privileged.fs.moveDir(actor(), src, dest),
            isFileExists: (path: string): Promise<RequestStatus<FsRequestResult<boolean>>> =>
                getInterface().privileged.fs.isFileExists(actor(), path),
            isDirExists: (path: string): Promise<RequestStatus<FsRequestResult<boolean>>> =>
                getInterface().privileged.fs.isDirExists(actor(), path),
            isFile: (path: string): Promise<RequestStatus<FsRequestResult<boolean>>> =>
                getInterface().privileged.fs.isFile(actor(), path),
            isDir: (path: string): Promise<RequestStatus<FsRequestResult<boolean>>> =>
                getInterface().privileged.fs.isDir(actor(), path),
            hash: (path: string): Promise<RequestStatus<FsRequestResult<string>>> =>
                getInterface().privileged.fs.hash(actor(), path),
        },
        permissions: {
            request: (request: PluginPermissionRequest): Promise<RequestStatus<PluginPermissionPromptResult>> =>
                getInterface().privileged.permissions.request(actor(), request),
            revokePlugin: (pluginId: string): Promise<RequestStatus<void>> =>
                getInterface().privileged.permissions.revokePlugin(actor(), pluginId),
        },
        bash: {
            execute: (command: string, cwd?: string): Promise<RequestStatus<PrivilegedBashExecuteResult>> =>
                getInterface().privileged.bash.execute(actor(), command, cwd),
        },
    };
}

export const appPrivilegedFacade = createBoundPrivilegedFacade(defaultFacadeToken);

export function createPluginPrivilegedFacade(plugin: PluginIdentity) {
    const token = createPluginFacadeToken(plugin.id);
    return {
        app: createBoundPrivilegedFacade(token),
        revoke: () => revokePrivilegedToken(token),
    };
}
