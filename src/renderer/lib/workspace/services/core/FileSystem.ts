import { FsRejectError, FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import { FileDetails, FileStat, FileEntry, DirectorySizeResult } from "@shared/utils/fs";
import { IFileSystemService, WorkspaceContext } from "../services";
import { Service } from "../Service";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AppHost, AppProtocol } from "@shared/types/constants";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { refuseFrozenWrite } from "@/lib/app/writeFreeze";
import { getInterface } from "@/lib/app/bridge";

/**
 * The result of one attempt to put bytes on disk, reported for every write that goes through this
 * module.
 *
 * This is the only place in the renderer that knows both *which file* a save was aiming at and
 * whether it landed - each document service only sees its own `FsRequestResult` and, before
 * SaveStatusService, most of them dropped it. Observing here means one subscriber can report every
 * failing path without each service having to remember to say so.
 */
export type FsWriteOutcome = {
    path: string;
    ok: boolean;
    error?: FsRejectError;
};

const writeObservers = new Set<(outcome: FsWriteOutcome) => void>();

/**
 * A write that the freeze latch refused, answered as a no-op success.
 *
 * The four verbs below report to {@link writeObservers}, and a refusal must not reach them: the
 * subscriber is `SaveStatusService`, whose whole vocabulary there is "this path failed" / "this path
 * recovered". A refusal is neither. It is announced on its own channel
 * (`observeRefusedWrites`) instead, which is what lets the notice say *frozen* rather than *failed*.
 *
 * See `frozenNoOp` in the privileged facade for why a refusal is not an error.
 */
const FROZEN_NO_OP: FsRequestResult<void> = { ok: true, data: undefined };

function reportWriteOutcome(path: string, result: FsRequestResult<void>): FsRequestResult<void> {
    if (writeObservers.size > 0) {
        const outcome: FsWriteOutcome = result.ok ? { path, ok: true } : { path, ok: false, error: result.error };
        for (const observer of writeObservers) {
            try {
                observer(outcome);
            } catch (error) {
                // An observer must never be able to turn a successful write into a failed one.
                console.warn("[FileSystem] write observer threw", error);
            }
        }
    }
    return result;
}

export class BaseFileSystemService {
    /**
     * Watch every write this module performs. Returns an unsubscribe.
     *
     * Deliberately module-level rather than per-workspace: the writes themselves are static, and a
     * subscriber that outlives a project switch is a subscriber that still reports the writes made
     * while the next project loads.
     */
    public static observeWrites(observer: (outcome: FsWriteOutcome) => void): () => void {
        writeObservers.add(observer);
        return () => {
            writeObservers.delete(observer);
        };
    }

    public static async stat(path: string): Promise<FsRequestResult<FileStat>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.stat(path));
    }

    public static async list(path: string): Promise<FsRequestResult<FileEntry[]>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.list(path));
    }

    public static async details(path: string): Promise<FsRequestResult<FileDetails>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.details(path));
    }

    /**
     * Total the bytes of a directory tree in one round trip, sharing the game build's own
     * measurement (`Fs.directorySize`). Goes through the base app bridge rather than the privileged
     * facade: this is a Studio-internal capability, not part of the plugin-facing fs surface.
     */
    public static async directorySize(path: string): Promise<FsRequestResult<DirectorySizeResult>> {
        return this.wrapIPCError(await getInterface().fs.directorySize(path));
    }

    public static async read(path: string, encoding: BufferEncoding): Promise<FsRequestResult<string>> {
        return this.fetch(path, encoding);
    }

    public static async readRaw(path: string): Promise<FsRequestResult<Uint8Array>> {
        return this.fetchRaw(path);
    }

    public static async write(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>> {
        if (refuseFrozenWrite(path)) {
            return FROZEN_NO_OP;
        }
        return reportWriteOutcome(path, await this.put(path, data, encoding));
    }

    public static async writeRaw(path: string, data: Uint8Array): Promise<FsRequestResult<void>> {
        if (refuseFrozenWrite(path)) {
            return FROZEN_NO_OP;
        }
        return reportWriteOutcome(path, await this.putRaw(path, data));
    }

    public static async ensureRegularFile(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>> {
        if (refuseFrozenWrite(path)) {
            return FROZEN_NO_OP;
        }
        return reportWriteOutcome(path, this.wrapIPCError(await appPrivilegedFacade.fs.ensureRegularFile(path, data, encoding)));
    }

    public static async writeFileNoFollow(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>> {
        if (refuseFrozenWrite(path)) {
            return FROZEN_NO_OP;
        }
        return reportWriteOutcome(path, this.wrapIPCError(await appPrivilegedFacade.fs.writeFileNoFollow(path, data, encoding)));
    }

    public static async recoverCorruptedJsonFile(path: string, replacement: string, encoding: BufferEncoding): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.recoverCorruptedJsonFile(path, replacement, encoding));
    }

    public static async createDir(path: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.createDir(path));
    }

    public static async deleteFile(path: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.deleteFile(path));
    }

    public static async deleteDir(path: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.deleteDir(path));
    }

    public static async rename(oldPath: string, newPath: string, isDir: boolean): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.rename(oldPath, newPath, isDir));
    }

    public static async copyFile(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.copyFile(src, dest));
    }

    public static async copyDir(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.copyDir(src, dest));
    }

    public static async moveFile(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.moveFile(src, dest));
    }

    public static async moveDir(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.moveDir(src, dest));
    }

    public static async isFileExists(path: string): Promise<FsRequestResult<boolean>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.isFileExists(path));
    }

    public static async isDirExists(path: string): Promise<FsRequestResult<boolean>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.isDirExists(path));
    }

    public static async isFile(path: string): Promise<FsRequestResult<boolean>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.isFile(path));
    }

    public static async isDir(path: string): Promise<FsRequestResult<boolean>> {
        return this.wrapIPCError(await appPrivilegedFacade.fs.isDir(path));
    }

    public static async readJSON<T>(path: string, encoding: BufferEncoding = "utf-8"): Promise<FsRequestResult<T>> {
        const fileResult = await this.read(path, encoding);
        if (!fileResult.ok) {
            return fileResult;
        }
        try {
            return {
                ok: true,
                data: JSON.parse(fileResult.data) as T,
            };
        } catch (error) {
            return {
                ok: false,
                error: {
                    code: FsRejectErrorCode.INVALID_JSON,
                    message: `Failed to parse JSON from ${path}`,
                }
            };
        }
    }

    private static async fetch(path: string, encoding: BufferEncoding): Promise<FsRequestResult<string>> {
        const requestResult = this.wrapIPCError(await appPrivilegedFacade.fs.requestRead(path, encoding));
        if (!requestResult.ok) {
            return requestResult;
        }

        const url = this.constructUrl(requestResult.data);
        const response = await fetch(url);

        if (!response.ok) {
            return {
                ok: false,
                error: {
                    code: FsRejectErrorCode.IPC_ERROR,
                    message: `Failed to fetch file from ${url}: ${response.statusText}`,
                }
            };
        }
        return {
            ok: true,
            data: await response.text(),
        };
    }

    private static async fetchRaw(path: string): Promise<FsRequestResult<Uint8Array>> {
        const requestResult = this.wrapIPCError(await appPrivilegedFacade.fs.requestReadRaw(path));
        if (!requestResult.ok) {
            return requestResult;
        }

        const url = this.constructUrl(requestResult.data);
        const response = await fetch(url);

        if (!response.ok) {
            return {
                ok: false,
                error: {
                    code: FsRejectErrorCode.IPC_ERROR,
                    message: `Failed to fetch file from ${url}: ${response.statusText}`,
                }
            };
        }
        return {
            ok: true,
            data: new Uint8Array(await response.arrayBuffer()),
        };
    }

    private static async put(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>> {
        const requestResult = this.wrapIPCError(await appPrivilegedFacade.fs.requestWrite(path, encoding));
        if (!requestResult.ok) {
            return requestResult;
        }

        const url = this.constructUrl(requestResult.data);
        const response = await fetch(url, {
            method: "PUT",
            body: data,
        });
        if (!response.ok) {
            return {
                ok: false,
                error: {
                    code: FsRejectErrorCode.IPC_ERROR,
                    message: `Failed to write file to ${url}: ${response.statusText}`,
                }
            };
        }

        return {
            ok: true,
            data: undefined,
        };
    }

    private static async putRaw(path: string, data: Uint8Array): Promise<FsRequestResult<void>> {
        const requestResult = this.wrapIPCError(await appPrivilegedFacade.fs.requestWriteRaw(path));
        if (!requestResult.ok) {
            return requestResult;
        }

        const url = this.constructUrl(requestResult.data);
        const response = await fetch(url, {
            method: "PUT",
            body: new Uint8Array(data),
            headers: {
                "Content-Type": "application/octet-stream",
            },
        });
        if (!response.ok) {
            return {
                ok: false,
                error: {
                    code: FsRejectErrorCode.IPC_ERROR,
                    message: `Failed to write file to ${url}: ${response.statusText}`,
                }
            };
        }

        return {
            ok: true,
            data: undefined,
        };
    }

    private static constructUrl(hash: string): string {
        return `${AppProtocol}://${AppHost.Fs}/${hash}`;
    }

    private static wrapIPCError<T>(result: RequestStatus<FsRequestResult<T>>): FsRequestResult<T> {
        if (!result.success) {
            return {
                ok: false,
                error: {
                    code: FsRejectErrorCode.IPC_ERROR,
                    message: result.error ?? "",
                }
            };
        }
        return result.data;
    }
}

export class FileSystemService extends Service<FileSystemService> implements IFileSystemService {
    protected init(_ctx: WorkspaceContext): Promise<void> | void {}

    /** See {@link BaseFileSystemService.observeWrites}. */
    public observeWrites(observer: (outcome: FsWriteOutcome) => void): () => void {
        return BaseFileSystemService.observeWrites(observer);
    }

    public async stat(path: string): Promise<FsRequestResult<FileStat>> {
        return BaseFileSystemService.stat(path);
    }

    public async list(path: string): Promise<FsRequestResult<FileEntry[]>> {
        return BaseFileSystemService.list(path);
    }

    public async details(path: string): Promise<FsRequestResult<FileDetails>> {
        return BaseFileSystemService.details(path);
    }

    public async directorySize(path: string): Promise<FsRequestResult<DirectorySizeResult>> {
        return BaseFileSystemService.directorySize(path);
    }

    public async read(path: string, encoding: BufferEncoding): Promise<FsRequestResult<string>> {
        return BaseFileSystemService.read(path, encoding);
    }

    public async readRaw(path: string): Promise<FsRequestResult<Uint8Array>> {
        return BaseFileSystemService.readRaw(path);
    }

    public async write(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>> {
        return BaseFileSystemService.write(path, data, encoding);
    }

    public async writeRaw(path: string, data: Uint8Array): Promise<FsRequestResult<void>> {
        return BaseFileSystemService.writeRaw(path, data);
    }

    public async ensureRegularFile(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>> {
        return BaseFileSystemService.ensureRegularFile(path, data, encoding);
    }

    public async writeFileNoFollow(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>> {
        return BaseFileSystemService.writeFileNoFollow(path, data, encoding);
    }

    public async recoverCorruptedJsonFile(path: string, replacement: string, encoding: BufferEncoding): Promise<FsRequestResult<void>> {
        return BaseFileSystemService.recoverCorruptedJsonFile(path, replacement, encoding);
    }

    public async createDir(path: string): Promise<FsRequestResult<void>> {
        return BaseFileSystemService.createDir(path);
    }

    public async deleteFile(path: string): Promise<FsRequestResult<void>> {
        return BaseFileSystemService.deleteFile(path);
    }

    public async deleteDir(path: string): Promise<FsRequestResult<void>> {
        return BaseFileSystemService.deleteDir(path);
    }

    public async rename(oldPath: string, newPath: string, isDir: boolean): Promise<FsRequestResult<void>> {
        return BaseFileSystemService.rename(oldPath, newPath, isDir);
    }

    public async copyFile(src: string, dest: string): Promise<FsRequestResult<void>> {
        return BaseFileSystemService.copyFile(src, dest);
    }

    public async copyDir(src: string, dest: string): Promise<FsRequestResult<void>> {
        return BaseFileSystemService.copyDir(src, dest);
    }

    public async moveFile(src: string, dest: string): Promise<FsRequestResult<void>> {
        return BaseFileSystemService.moveFile(src, dest);
    }

    public async moveDir(src: string, dest: string): Promise<FsRequestResult<void>> {
        return BaseFileSystemService.moveDir(src, dest);
    }

    public async isFileExists(path: string): Promise<FsRequestResult<boolean>> {
        return BaseFileSystemService.isFileExists(path);
    }

    public async isDirExists(path: string): Promise<FsRequestResult<boolean>> {
        return BaseFileSystemService.isDirExists(path);
    }

    public async isFile(path: string): Promise<FsRequestResult<boolean>> {
        return BaseFileSystemService.isFile(path);
    }

    public async isDir(path: string): Promise<FsRequestResult<boolean>> {
        return BaseFileSystemService.isDir(path);
    }

    public async readJSON<T>(path: string, encoding: BufferEncoding = "utf-8"): Promise<FsRequestResult<T>> {
        return BaseFileSystemService.readJSON<T>(path, encoding);
    }
}
