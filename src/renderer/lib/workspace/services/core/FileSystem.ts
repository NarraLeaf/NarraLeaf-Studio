import { FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import { FileDetails, FileStat } from "@shared/utils/fs";
import { IFileSystemService, Service, WorkspaceContext } from "../services";
import { getInterface } from "@/lib/app/bridge";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AppHost, AppProtocol } from "@shared/types/constants";

export class FileSystemService extends Service implements IFileSystemService {
    protected init(_ctx: WorkspaceContext): Promise<void> | void {}

    public async stat(path: string): Promise<FsRequestResult<FileStat>> {
        return this.wrapIPCError(await getInterface().fs.stat(path));
    }

    public async list(path: string): Promise<FsRequestResult<FileStat[]>> {
        return this.wrapIPCError(await getInterface().fs.list(path));
    }

    public async details(path: string): Promise<FsRequestResult<FileDetails>> {
        return this.wrapIPCError(await getInterface().fs.details(path));
    }

    public async read(path: string, encoding: BufferEncoding): Promise<FsRequestResult<string>> {
        return this.fetch(path, encoding);
    }

    public async readRaw(path: string): Promise<FsRequestResult<Buffer>> {
        return this.fetchRaw(path);
    }

    public async write(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>> {
        return this.put(path, data, encoding);
    }

    public async writeRaw(path: string, data: Buffer): Promise<FsRequestResult<void>> {
        return this.putRaw(path, data);
    }

    public async createDir(path: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.createDir(path));
    }

    public async deleteFile(path: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.deleteFile(path));
    }

    public async deleteDir(path: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.deleteDir(path));
    }

    public async rename(oldPath: string, newPath: string, isDir: boolean): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.rename(oldPath, newPath, isDir));
    }

    public async copyFile(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.copyFile(src, dest));
    }

    public async copyDir(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.copyDir(src, dest));
    }

    public async moveFile(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.moveFile(src, dest));
    }

    public async moveDir(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrapIPCError(await getInterface().fs.moveDir(src, dest));
    }

    public async isFileExists(path: string): Promise<FsRequestResult<boolean>> {
        return this.wrapIPCError(await getInterface().fs.isFileExists(path));
    }

    public async isDirExists(path: string): Promise<FsRequestResult<boolean>> {
        return this.wrapIPCError(await getInterface().fs.isDirExists(path));
    }

    public async isFile(path: string): Promise<FsRequestResult<boolean>> {
        return this.wrapIPCError(await getInterface().fs.isFile(path));
    }

    public async isDir(path: string): Promise<FsRequestResult<boolean>> {
        return this.wrapIPCError(await getInterface().fs.isDir(path));
    }

    public async readJSON<T>(path: string, encoding: BufferEncoding = "utf-8"): Promise<FsRequestResult<T>> {
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

    private async fetch(path: string, encoding: BufferEncoding): Promise<FsRequestResult<string>> {
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

    private async fetchRaw(path: string): Promise<FsRequestResult<Buffer>> {
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
            data: Buffer.from(await response.arrayBuffer()),
        };
    }

    private async put(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>> {
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

    private async putRaw(path: string, data: Buffer): Promise<FsRequestResult<void>> {
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

    private constructUrl(hash: string): string {
        return `${AppProtocol}://${AppHost.Fs}/${hash}`;
    }

    private wrapIPCError<T>(result: RequestStatus<FsRequestResult<T>>): FsRequestResult<T> {
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
