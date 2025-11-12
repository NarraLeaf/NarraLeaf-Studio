import { FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import { FileDetails, FileStat } from "@shared/utils/fs";
import { IFileSystemService, WorkspaceContext } from "../services";
import { Service } from "../Service";
import { getInterface } from "@/lib/app/bridge";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AppHost, AppProtocol } from "@shared/types/constants";

export class BaseFileSystemService {
    public static async stat(path: string): Promise<FsRequestResult<FileStat>> {
        return this.wrapIPCError(await getInterface().fs.stat(path));
    }

    public static async list(path: string): Promise<FsRequestResult<FileStat[]>> {
        return this.wrapIPCError(await getInterface().fs.list(path));
    }

    public static async details(path: string): Promise<FsRequestResult<FileDetails>> {
        return this.wrapIPCError(await getInterface().fs.details(path));
    }

    public static async read(path: string, encoding: BufferEncoding): Promise<FsRequestResult<string>> {
        return this.fetch(path, encoding);
    }

    public static async readRaw(path: string): Promise<FsRequestResult<Uint8Array>> {
        return this.fetchRaw(path);
    }

    public static async write(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>> {
        return this.put(path, data, encoding);
    }

    public static async writeRaw(path: string, data: Uint8Array): Promise<FsRequestResult<void>> {
        return this.putRaw(path, data);
    }

    public static async createDir(path: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.createDir(path));
    }

    public static async deleteFile(path: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.deleteFile(path));
    }

    public static async deleteDir(path: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.deleteDir(path));
    }

    public static async rename(oldPath: string, newPath: string, isDir: boolean): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.rename(oldPath, newPath, isDir));
    }

    public static async copyFile(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.copyFile(src, dest));
    }

    public static async copyDir(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.copyDir(src, dest));
    }

    public static async moveFile(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.moveFile(src, dest));
    }

    public static async moveDir(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.moveDir(src, dest));
    }

    public static async isFileExists(path: string): Promise<FsRequestResult<boolean>> {
        return this.wrapIPCError(await getInterface().fs.isFileExists(path));
    }

    public static async isDirExists(path: string): Promise<FsRequestResult<boolean>> {
        return this.wrapIPCError(await getInterface().fs.isDirExists(path));
    }

    public static async isFile(path: string): Promise<FsRequestResult<boolean>> {
        return this.wrapIPCError(await getInterface().fs.isFile(path));
    }

    public static async isDir(path: string): Promise<FsRequestResult<boolean>> {
        return this.wrapIPCError(await getInterface().fs.isDir(path));
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
        const requestResult = this.wrapIPCError(await getInterface().fs.requestRead(path, encoding));
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
        const requestResult = this.wrapIPCError(await getInterface().fs.requestReadRaw(path));
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
        const requestResult = this.wrapIPCError(await getInterface().fs.requestWrite(path, encoding));
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
        const requestResult = this.wrapIPCError(await getInterface().fs.requestWriteRaw(path));
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

    public async stat(path: string): Promise<FsRequestResult<FileStat>> {
        return BaseFileSystemService.stat(path);
    }

    public async list(path: string): Promise<FsRequestResult<FileStat[]>> {
        return BaseFileSystemService.list(path);
    }

    public async details(path: string): Promise<FsRequestResult<FileDetails>> {
        return BaseFileSystemService.details(path);
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
