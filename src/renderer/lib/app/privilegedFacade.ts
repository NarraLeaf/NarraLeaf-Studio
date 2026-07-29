import type { FileDetails, FileStat, FileEntry } from "@shared/utils/fs";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import type { RequestStatus } from "@shared/types/ipcEvents";
import type { PluginIdentity, PluginPermissionRequest, PluginPermissionPromptResult } from "@shared/types/pluginPermissions";
import type { PrivilegedBashExecuteResult } from "@shared/types/privileged";
import { getPrivilegedInterface } from "./bridge";
import {
    createPluginFacadeToken,
    defaultFacadeToken,
    resolvePrivilegedActor,
    revokePrivilegedToken,
    type PrivilegedFacadeToken,
} from "./privilegedTokens";
import { refuseFrozenWrite } from "./writeFreeze";

export type BoundPrivilegedFacade = ReturnType<typeof createBoundPrivilegedFacade>;

/**
 * A mutation that did not happen because the workspace is frozen, reported to the caller as if it
 * had.
 *
 * Success rather than an error, deliberately. `DebouncedSaver` keeps a rejected write as a debt and
 * retries it forever, so an error here would park the frozen-out write and replay it the instant the
 * author left the historical revision - which is precisely the write this gate exists to stop. A
 * refusal has to end the write, not defer it. Visibility comes from the refusal observers
 * (`SaveStatusService` raises the notice), never from this return value.
 */
function frozenNoOp(): Promise<RequestStatus<FsRequestResult<void>>> {
    return Promise.resolve({ success: true, data: { ok: true, data: undefined } });
}

/**
 * The refusal for the two verbs that mint a write URL. They have no representable no-op - there is
 * no URL that writes nothing - so they answer a rejection instead. Unreachable in practice:
 * `BaseFileSystemService` checks the same latch before asking for one. This is the backstop for
 * anything that reaches the facade directly, including plugins.
 */
function frozenRejection(path: string): Promise<RequestStatus<FsRequestResult<string>>> {
    return Promise.resolve({
        success: true,
        data: {
            ok: false,
            error: {
                code: FsRejectErrorCode.PERMISSION_DENIED,
                message: `The workspace is frozen; ${path} was not written.`,
            },
        },
    });
}

/**
 * Every privileged filesystem verb the renderer has, bound to one actor.
 *
 * The mutating verbs consult the freeze latch first. This is the layer that does it because it is
 * the only one every write passes through: `BaseFileSystemService` is a convenience wrapper over
 * this object, asset import calls `appPrivilegedFacade.fs.copyFile` directly, and plugins get their
 * own binding of this same factory. Gating the wrapper alone would have left the last two open, and
 * asset import writes straight into `assets/content/` - the most versioned tree in the project.
 */
function createBoundPrivilegedFacade(token: PrivilegedFacadeToken) {
    const actor = () => resolvePrivilegedActor(token);
    const privileged = () => getPrivilegedInterface();
    return {
        fs: {
            selectFile: (filters: string[], multiple: boolean): Promise<RequestStatus<FsRequestResult<string[]>>> =>
                privileged().fs.selectFile(actor(), filters, multiple),
            /** Native save dialog; resolves to the chosen path, or null when cancelled. */
            selectSaveFile: (defaultFileName: string, filters: string[]): Promise<RequestStatus<FsRequestResult<string | null>>> =>
                privileged().fs.selectSaveFile(actor(), defaultFileName, filters),
            stat: (path: string): Promise<RequestStatus<FsRequestResult<FileStat>>> =>
                privileged().fs.stat(actor(), path),
            list: (path: string): Promise<RequestStatus<FsRequestResult<FileEntry[]>>> =>
                privileged().fs.list(actor(), path),
            details: (path: string): Promise<RequestStatus<FsRequestResult<FileDetails>>> =>
                privileged().fs.details(actor(), path),
            requestRead: (path: string, encoding: BufferEncoding): Promise<RequestStatus<FsRequestResult<string>>> =>
                privileged().fs.requestRead(actor(), path, encoding),
            requestReadRaw: (path: string): Promise<RequestStatus<FsRequestResult<string>>> =>
                privileged().fs.requestReadRaw(actor(), path),
            requestWrite: (path: string, encoding: BufferEncoding): Promise<RequestStatus<FsRequestResult<string>>> =>
                refuseFrozenWrite(path)
                    ? frozenRejection(path)
                    : privileged().fs.requestWrite(actor(), path, encoding),
            requestWriteRaw: (path: string): Promise<RequestStatus<FsRequestResult<string>>> =>
                refuseFrozenWrite(path)
                    ? frozenRejection(path)
                    : privileged().fs.requestWriteRaw(actor(), path),
            ensureRegularFile: (path: string, data: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>> =>
                refuseFrozenWrite(path)
                    ? frozenNoOp()
                    : privileged().fs.ensureRegularFile(actor(), path, data, encoding),
            writeFileNoFollow: (path: string, data: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>> =>
                refuseFrozenWrite(path)
                    ? frozenNoOp()
                    : privileged().fs.writeFileNoFollow(actor(), path, data, encoding),
            recoverCorruptedJsonFile: (path: string, replacement: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>> =>
                refuseFrozenWrite(path)
                    ? frozenNoOp()
                    : privileged().fs.recoverCorruptedJsonFile(actor(), path, replacement, encoding),
            createDir: (path: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                refuseFrozenWrite(path)
                    ? frozenNoOp()
                    : privileged().fs.createDir(actor(), path),
            deleteFile: (path: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                refuseFrozenWrite(path)
                    ? frozenNoOp()
                    : privileged().fs.deleteFile(actor(), path),
            deleteDir: (path: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                refuseFrozenWrite(path)
                    ? frozenNoOp()
                    : privileged().fs.deleteDir(actor(), path),
            // Both ends: a rename unlinks the old name as surely as it creates the new one.
            rename: (oldPath: string, newName: string, isDir: boolean): Promise<RequestStatus<FsRequestResult<void>>> =>
                refuseFrozenWrite(oldPath, newName)
                    ? frozenNoOp()
                    : privileged().fs.rename(actor(), oldPath, newName, isDir),
            copyFile: (src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                refuseFrozenWrite(dest)
                    ? frozenNoOp()
                    : privileged().fs.copyFile(actor(), src, dest),
            copyDir: (src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                refuseFrozenWrite(dest)
                    ? frozenNoOp()
                    : privileged().fs.copyDir(actor(), src, dest),
            moveFile: (src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                refuseFrozenWrite(src, dest)
                    ? frozenNoOp()
                    : privileged().fs.moveFile(actor(), src, dest),
            moveDir: (src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>> =>
                refuseFrozenWrite(src, dest)
                    ? frozenNoOp()
                    : privileged().fs.moveDir(actor(), src, dest),
            isFileExists: (path: string): Promise<RequestStatus<FsRequestResult<boolean>>> =>
                privileged().fs.isFileExists(actor(), path),
            isDirExists: (path: string): Promise<RequestStatus<FsRequestResult<boolean>>> =>
                privileged().fs.isDirExists(actor(), path),
            isFile: (path: string): Promise<RequestStatus<FsRequestResult<boolean>>> =>
                privileged().fs.isFile(actor(), path),
            isDir: (path: string): Promise<RequestStatus<FsRequestResult<boolean>>> =>
                privileged().fs.isDir(actor(), path),
            hash: (path: string): Promise<RequestStatus<FsRequestResult<string>>> =>
                privileged().fs.hash(actor(), path),
        },
        permissions: {
            request: (request: PluginPermissionRequest): Promise<RequestStatus<PluginPermissionPromptResult>> =>
                privileged().permissions.request(actor(), request),
            revokePlugin: (pluginId: string): Promise<RequestStatus<void>> =>
                privileged().permissions.revokePlugin(actor(), pluginId),
        },
        bash: {
            execute: (command: string, cwd?: string): Promise<RequestStatus<PrivilegedBashExecuteResult>> =>
                privileged().bash.execute(actor(), command, cwd),
        },
    };
}

export const appPrivilegedFacade = createBoundPrivilegedFacade(defaultFacadeToken);

export function createPluginPrivilegedFacade(plugin: PluginIdentity) {
    const token = createPluginFacadeToken(plugin);
    return {
        app: createBoundPrivilegedFacade(token),
        revoke: () => revokePrivilegedToken(token),
    };
}
