import path from "path";
import fs from "fs/promises";
import {Dirent, default as fsSync} from "fs";
import mime from "mime-types";

export type FsResult<T, OK extends true | false = true | false> = OK extends true ? { ok: true; data: T } : {
    ok: false;
    error: string
};

export type FileStat = {
    name: string;
    ext: string;
};

export class Fs {
    public static read(path: string, encoding: BufferEncoding = "utf-8"): Promise<FsResult<string>> {
        return this.wrap(fs.readFile(path, {encoding}));
    }

    public static readRaw(path: string): Promise<FsResult<Buffer>> {
        return this.wrap(fs.readFile(path));
    }

    public static write(path: string, data: string, encoding: BufferEncoding = "utf-8"): Promise<FsResult<void>> {
        return this.wrap(fs.writeFile(path, data, {encoding}));
    }

    public static writeRaw(path: string, data: Buffer): Promise<FsResult<void>> {
        return this.wrap(fs.writeFile(path, data));
    }

    public static append(path: string, data: string, encoding: BufferEncoding = "utf-8"): Promise<FsResult<void>> {
        return this.wrap(fs.appendFile(path, data, {encoding}));
    }

    public static createDir(path: string): Promise<FsResult<string | undefined>> {
        return this.wrap(fs.mkdir(path, {recursive: true}));
    }

    public static isFileExists(path: string): Promise<FsResult<boolean>> {
        return (async () => {
            try {
                await fs.access(path);
                return {
                    ok: true as const,
                    data: true,
                } satisfies FsResult<boolean, true>;
            } catch (error) {
                // File does not exist → ok: true, data: false
                if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
                    return {
                        ok: true as const,
                        data: false,
                    } satisfies FsResult<boolean, true>;
                }

                // Other errors (permission denied, IO, etc.) → ok: false
                return {
                    ok: false,
                    error: this.errorToString(error),
                } satisfies FsResult<boolean, false>;
            }
        })();
    }

    public static appendSync(path: string, data: string, encoding: BufferEncoding = "utf-8"): FsResult<void> {
        return this.wrapSync(() => fsSync.appendFileSync(path, data, {encoding}));
    }

    public static isDirExists(path: string): Promise<FsResult<void>> {
        return this.wrap(new Promise<void>((resolve, reject) => {
            fs.access(path)
                .then(() => resolve())
                .catch(() => reject());
        }));
    }

    public static copyDir(src: string, destDir: string): Promise<FsResult<void>> {
        return this.wrap(fs.cp(src, destDir, {recursive: true}));
    }

    public static cpFile(src: string, destFile: string): Promise<FsResult<void>> {
        return this.wrap(fs.copyFile(src, destFile));
    }

    public static getFiles(dir: string, ext?: string | string[]): Promise<FsResult<string[]>> {
        return this.wrap(fs.readdir(dir, {withFileTypes: true}).then((files) => {
            const extSet = new Set(Array.isArray(ext) ? ext : [ext]);
            return files
                .filter((file) => file.isFile() && (extSet.size === 0 || extSet.has(path.extname(file.name))))
                .map((file) => path.join(dir, file.name));
        }));
    }

    public static listFiles(dir: string): Promise<FsResult<FileStat[]>> {
        return this.wrap(fs.readdir(dir, {withFileTypes: true}).then((files) => {
            return files
                .filter((file) => file.isFile())
                .map((file) => ({
                    name: file.name,
                    ext: path.extname(file.name),
                }));
        }));
    }

    public static listDirs(dir: string): Promise<FsResult<string[]>> {
        return this.wrap(fs.readdir(dir, {withFileTypes: true}).then((files) => {
            return files
                .filter((file) => file.isDirectory())
                .map((file) => file.name);
        }));
    }

    public static deleteFile(path: string): Promise<FsResult<void>> {
        return this.wrap(fs.unlink(path));
    }

    public static dirEntries(dir: string): Promise<FsResult<Dirent[]>> {
        return this.wrap(fs.readdir(dir, {withFileTypes: true}));
    }

    private static errorToString(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }

    private static async wrap<T>(promise: Promise<T>): Promise<FsResult<T>> {
        try {
            const data = await promise;
            return ({
                ok: true as true,
                data
            });
        } catch (error) {
            return ({
                ok: false,
                error: this.errorToString(error)
            });
        }
    }

    private static wrapSync<T>(fn: () => T): FsResult<T> {
        try {
            return {
                ok: true as true,
                data: fn()
            };
        } catch (error) {
            return {
                ok: false,
                error: this.errorToString(error)
            };
        }
    }
}

export class ProjectFs {
    public readonly root: string;

    constructor(root: string) {
        if (!path.isAbsolute(root)) {
            throw new Error("Root path must be absolute");
        }
        this.root = root;
    }

    public read(path: string, encoding: BufferEncoding = "utf-8"): Promise<FsResult<string>> {
        return Fs.read(this.resolve(path), encoding);
    }

    /**
     * Tries to read a file from the list of paths
     *
     * Returns the first path that exists
     */
    public tryRead(paths: string | string[], encoding: BufferEncoding = "utf-8"): Promise<FsResult<string>> {
        if (typeof paths === "string") {
            return this.read(paths, encoding);
        }
        return this.retry(
            paths,
            (path) => this.read(path, encoding),
            this.toRetryStack(paths)
        );
    }

    /**
     * Tries to access a file or a directory from the list of paths
     *
     * Returns the first path that exists
     */
    public tryAccessDir(pathsRaw: string | string[]): Promise<FsResult<string>> {
        const paths = typeof pathsRaw === "string" ? [pathsRaw] : pathsRaw;
        return this.retry(
            paths,
            (path) => this.isDirExists(path).then(result => result.ok ? {ok: true, data: path} : result),
            this.toRetryStack(paths, "dirs are not found")
        );
    }

    /**
     * Tries to access a file from the list of paths
     *
     * Returns the first path that exists
     */
    public tryAccessFile(pathsRaw: string | string[]): Promise<FsResult<string>> {
        const paths = typeof pathsRaw === "string" ? [pathsRaw] : pathsRaw;
        return this.retry(
            paths,
            (path) => this.isFileExists(path).then(result => (result.ok && result.data) ? {ok: true, data: path} : {ok: false, error: "file not exist"}),
            this.toRetryStack(paths, "files are not found")
        );
    }

    /**
     * This method will fail if the file doesn't exist
     */
    public isDirExists(path: string): Promise<FsResult<void>> {
        return Fs.isDirExists(this.resolve(path));
    }

    /**
     * This method will fail if the file doesn't exist
     */
    public isFileExists(path: string): Promise<FsResult<boolean>> {
        return Fs.isFileExists(this.resolve(path));
    }

    public resolve(p: string): string {
        return path.isAbsolute(p) ? p : path.resolve(this.root, p);
    }

    public isProjectFile(p: string): boolean {
        return path.isAbsolute(p) ? p.startsWith(this.root) : !path.relative(this.root, p).startsWith("..");
    }

    public isRelative(p: string): boolean {
        return !path.isAbsolute(p);
    }

    private async retry<T>(
        paths: string[],
        action: (path: string) => Promise<FsResult<T>>,
        errText: string = "files or dirs are not found"
    ): Promise<FsResult<T>> {
        for (let i = 0; i < paths.length; i++) {
            const result = await action(paths[i]);
            if (result.ok) {
                return result;
            }
        }
        return {ok: false, error: errText};
    }

    private toRetryStack(paths: string[], message: string = ""): string {
        return message + "\nFiles tried:" + paths.map(p => `\n    ${p}`);
    }
}

export function getMimeType(filePath: string) {
    return mime.lookup(filePath) || "application/octet-stream";
}
