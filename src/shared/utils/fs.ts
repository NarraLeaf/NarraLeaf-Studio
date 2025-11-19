import path from "path";
import fs from "fs/promises";
import {Dirent, default as fsSync} from "fs";
import mime from "mime-types";
import { FsRequestResult, FsRejectError, FsRejectErrorCode } from "../types/os";

export type FileStat = {
    name: string;
    ext: string | null;
    type: "file" | "directory";
};

export type FileDetails = {
    name: string;
    ext: string | null;
    type: "file" | "directory";
    size: number;
    mtime: string;
    atime: string;
    ctime: string;
    birthtime: string;
    encoding: BufferEncoding | null;
};

export class Fs {
    public static read(path: string, encoding: BufferEncoding = "utf-8"): Promise<FsRequestResult<string>> {
        return this.wrap(fs.readFile(path, {encoding}));
    }

    public static readRaw(path: string): Promise<FsRequestResult<Buffer>> {
        return this.wrap(fs.readFile(path));
    }

    public static write(path: string, data: string, encoding: BufferEncoding = "utf-8"): Promise<FsRequestResult<void>> {
        return this.wrap(fs.writeFile(path, data, {encoding}));
    }

    public static writeRaw(path: string, data: Buffer): Promise<FsRequestResult<void>> {
        return this.wrap(fs.writeFile(path, data));
    }

    public static append(path: string, data: string, encoding: BufferEncoding = "utf-8"): Promise<FsRequestResult<void>> {
        return this.wrap(fs.appendFile(path, data, {encoding}));
    }

    public static createDir(path: string): Promise<FsRequestResult<string | undefined>> {
        return this.wrap(fs.mkdir(path, {recursive: true}));
    }

    public static isFileExists(path: string): Promise<FsRequestResult<boolean>> {
        return (async () => {
            try {
                await fs.access(path);
                return {
                    ok: true as const,
                    data: true,
                } satisfies FsRequestResult<boolean, true>;
            } catch (error) {
                // File does not exist → ok: true, data: false
                if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
                    return {
                        ok: true as const,
                        data: false,
                    } satisfies FsRequestResult<boolean, true>;
                }

                // Other errors (permission denied, IO, etc.) → ok: false
                return {
                    ok: false,
                    error: this.createError(error),
                } satisfies FsRequestResult<boolean, false>;
            }
        })();
    }

    public static appendSync(path: string, data: string, encoding: BufferEncoding = "utf-8"): FsRequestResult<void> {
        return this.wrapSync(() => fsSync.appendFileSync(path, data, {encoding}));
    }

    public static isDirExists(path: string): Promise<FsRequestResult<boolean>> {
        return (async () => {
            try {
                await fs.access(path);
                // Check if it's actually a directory
                const stats = await fs.stat(path);
                return {
                    ok: true as const,
                    data: stats.isDirectory(),
                } satisfies FsRequestResult<boolean, true>;
            } catch (error) {
                if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
                    return {
                        ok: true as const,
                        data: false,
                    } satisfies FsRequestResult<boolean, true>;
                }
                return {
                    ok: false,
                    error: this.createError(error)
                } satisfies FsRequestResult<boolean, false>;
            }
        })();
    }

    public static copyDir(src: string, destDir: string): Promise<FsRequestResult<void>> {
        return this.wrap(fs.cp(src, destDir, {recursive: true}));
    }

    public static cpFile(src: string, destFile: string): Promise<FsRequestResult<void>> {
        return this.wrap(fs.copyFile(src, destFile));
    }

    public static getFiles(dir: string, ext?: string | string[]): Promise<FsRequestResult<string[]>> {
        return this.wrap(fs.readdir(dir, {withFileTypes: true}).then((files) => {
            const extSet = new Set(Array.isArray(ext) ? ext : [ext]);
            return files
                .filter((file) => file.isFile() && (extSet.size === 0 || extSet.has(path.extname(file.name))))
                .map((file) => path.join(dir, file.name));
        }));
    }

    public static listFiles(dir: string): Promise<FsRequestResult<FileStat[]>> {
        return this.wrap(fs.readdir(dir, {withFileTypes: true}).then((files) => {
            return files
                .filter((file) => file.isFile())
                .map((file) => ({
                    name: path.parse(file.name).name,
                    ext: path.extname(file.name),
                    type: "file",
                }));
        }));
    }

    public static listDirs(dir: string): Promise<FsRequestResult<string[]>> {
        return this.wrap(fs.readdir(dir, {withFileTypes: true}).then((files) => {
            return files
                .filter((file) => file.isDirectory())
                .map((file) => file.name);
        }));
    }

    public static deleteFile(path: string): Promise<FsRequestResult<void>> {
        return this.wrap(fs.unlink(path));
    }

    public static dirEntries(dir: string): Promise<FsRequestResult<Dirent[]>> {
        return this.wrap(fs.readdir(dir, {withFileTypes: true}));
    }

    public static stat(filePath: string): Promise<FsRequestResult<FileStat>> {
        return this.wrap(fs.stat(filePath).then((stats) => {
            return {
                name: path.parse(filePath).name,
                ext: path.extname(filePath),
                type: stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "file",
            };
        }));
    }

    public static details(filePath: string): Promise<FsRequestResult<FileDetails>> {
        return this.wrap(fs.stat(filePath).then((stats) => {
            return {
                name: path.parse(filePath).name,
                ext: path.extname(filePath),
                type: stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "file",
                size: stats.size,
                mtime: stats.mtime.toISOString(),
                atime: stats.atime.toISOString(),
                ctime: stats.ctime.toISOString(),
                birthtime: stats.birthtime.toISOString(),
                encoding: "utf-8",
            };
        }));
    }

    public static isFile(filePath: string): Promise<FsRequestResult<boolean>> {
        return (async () => {
            try {
                const stats = await fs.stat(filePath);
                return {
                    ok: true as const,
                    data: stats.isFile(),
                } satisfies FsRequestResult<boolean, true>;
            } catch (error) {
                if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
                    return {
                        ok: true as const,
                        data: false,
                    } satisfies FsRequestResult<boolean, true>;
                }
                return {
                    ok: false,
                    error: this.createError(error)
                } satisfies FsRequestResult<boolean, false>;
            }
        })();
    }

    public static isDir(filePath: string): Promise<FsRequestResult<boolean>> {
        return (async () => {
            try {
                const stats = await fs.stat(filePath);
                return {
                    ok: true as const,
                    data: stats.isDirectory(),
                } satisfies FsRequestResult<boolean, true>;
            } catch (error) {
                if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
                    return {
                        ok: true as const,
                        data: false,
                    } satisfies FsRequestResult<boolean, true>;
                }
                return {
                    ok: false,
                    error: this.createError(error)
                } satisfies FsRequestResult<boolean, false>;
            }
        })();
    }

    public static deleteDir(dirPath: string): Promise<FsRequestResult<void>> {
        return this.wrap(fs.rm(dirPath, { recursive: true, force: true }));
    }

    public static rename(oldPath: string, newPath: string): Promise<FsRequestResult<void>> {
        return this.wrap(fs.rename(oldPath, newPath));
    }

    public static moveFile(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrap(fs.rename(src, dest));
    }

    public static moveDir(src: string, dest: string): Promise<FsRequestResult<void>> {
        return this.wrap(fs.rename(src, dest));
    }

    private static createError(error: unknown): FsRejectError {
        if (error instanceof Error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code) {
                switch (nodeError.code) {
                    case 'ENOENT':
                        return { code: FsRejectErrorCode.NOT_FOUND, message: nodeError.message };
                    case 'EACCES':
                    case 'EPERM':
                        return { code: FsRejectErrorCode.PERMISSION_DENIED, message: nodeError.message };
                    case 'EINVAL':
                        return { code: FsRejectErrorCode.INVALID_PATH, message: nodeError.message };
                    case 'EFBIG':
                        return { code: FsRejectErrorCode.FILE_TOO_LARGE, message: nodeError.message };
                    case 'EISDIR':
                        return { code: FsRejectErrorCode.NOT_A_FILE, message: nodeError.message };
                    case 'ENOTDIR':
                        return { code: FsRejectErrorCode.NOT_A_DIR, message: nodeError.message };
                    case 'EIO':
                        return { code: FsRejectErrorCode.IO_ERROR, message: nodeError.message };
                    default:
                        return { code: FsRejectErrorCode.UNKNOWN, message: nodeError.message };
                }
            }
            return { code: FsRejectErrorCode.UNKNOWN, message: error.message };
        }
        return { code: FsRejectErrorCode.UNKNOWN, message: String(error) };
    }

    private static async wrap<T>(promise: Promise<T>): Promise<FsRequestResult<T>> {
        try {
            const data = await promise;
            return ({
                ok: true as true,
                data
            });
        } catch (error) {
            return ({
                ok: false,
                error: this.createError(error)
            });
        }
    }

    private static wrapSync<T>(fn: () => T): FsRequestResult<T> {
        try {
            return {
                ok: true as true,
                data: fn()
            };
        } catch (error) {
            return {
                ok: false,
                error: this.createError(error)
            };
        }
    }
}

export function getMimeType(filePath: string) {
    return mime.lookup(filePath) || "application/octet-stream";
}
