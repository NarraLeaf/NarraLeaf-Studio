import path from "path";
import fs from "fs/promises";
import {Dirent, default as fsSync, Stats} from "fs";
import {randomBytes} from "crypto";
import mime from "mime-types";
import { FsRequestResult, FsRejectError, FsRejectErrorCode } from "../types/os";
import { ATOMIC_WRITE_TEMP_SUFFIX } from "./atomicWriteTemp";

/**
 * The scratch-file naming lives in its own module because this one imports Node at
 * module scope and the renderer needs the same suffix (see atomicWriteTemp.ts).
 * Re-exported here so every existing importer keeps working from this path.
 */
export { ATOMIC_WRITE_TEMP_PATTERN, ATOMIC_WRITE_TEMP_SUFFIX } from "./atomicWriteTemp";

export type FileStat = {
    name: string;
    ext: string | null;
    type: "file" | "directory";
};

/**
 * A directory-listing entry: a {@link FileStat} plus the reassembled full filename.
 *
 * `name` keeps its old meaning - the stem with the extension stripped off - so nothing that matches
 * on `name`/`ext` (see `@shared/utils/nlproj`) changes behaviour. `fileName` is the additive escape
 * hatch: it is the complete filename as it sits on disk, so a caller joining a child path should use
 * it rather than `name`, which addresses a file that is not there for anything with an extension.
 */
export type FileEntry = FileStat & {
    /** The complete filename on disk (`name` + `ext`), the value {@link entryFileName} reassembles. */
    fileName: string;
};

/**
 * The result of totalling a directory tree - the one measurement the build and the asset overview
 * now share (see {@link Fs.directorySize}).
 */
export type DirectorySizeResult = {
    /** Sum of the sizes of every regular file in the tree. */
    totalBytes: number;
    /** How many regular files were summed. */
    fileCount: number;
    /**
     * Bytes of each regular file, keyed by its path relative to the walked root and joined with `/`
     * on every platform. Lets a caller attribute the total back to individual files without a second
     * walk; callers that only need the total (the build) ignore it.
     */
    bytesByRelativePath: Record<string, number>;
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

    /**
     * Write a file so that a reader only ever sees the old contents or the new ones.
     *
     * The signature is unchanged; only the mechanism is. `fs.writeFile` truncates the target and
     * then streams into it, so a crash, a power cut or a full disk halfway through leaves a
     * half-written file on disk - and this is the call every document save funnels into
     * (`UIDocumentService` -> `FileSystem.put` -> `requestWrite` -> `FileSystemHandler` -> here),
     * where the payload is a megabyte-plus of JSON that is worthless if truncated.
     *
     * @see writeFileAtomicCore for the mechanism and its edges.
     */
    public static write(path: string, data: string, encoding: BufferEncoding = "utf-8"): Promise<FsRequestResult<void>> {
        return this.wrap(this.writeFileAtomicCore(path, Buffer.from(data, encoding), true));
    }

    /** Binary counterpart of {@link Fs.write}, with the same atomicity guarantee. */
    public static writeRaw(path: string, data: Buffer): Promise<FsRequestResult<void>> {
        return this.wrap(this.writeFileAtomicCore(path, data, true));
    }

    /**
     * Make sure a plain regular file exists at `path`, writing `data` **only if it is not there**.
     *
     * An existing file is inspected and left exactly as it is - this is the verb that puts a blank
     * shard next to a project that predates it (`AssetsMetadataManager.initAssetsMetadata`), and one
     * that overwrote would reset every asset shard in the project on the next open. A caller that
     * wants the bytes on disk whatever was there before wants
     * {@link writeFileNoFollowOrCreate} instead.
     *
     * **Only one of the two branches is atomic.** The create branch is a plain `fs.writeFile` with
     * `wx`, not the temp-and-rename of {@link writeFileAtomicCore}: a crash inside it can leave a
     * truncated file. That is deliberate and safe *here*, where the payload is a placeholder
     * measured in bytes, and it is not a property to lean on from a caller writing a document.
     */
    public static ensureRegularFile(path: string, data: string, encoding: BufferEncoding = "utf-8"): Promise<FsRequestResult<void>> {
        return this.wrap((async () => {
            try {
                this.assertSafeFileStat(path, await fs.lstat(path));
            } catch (error) {
                if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
                    await fs.writeFile(path, data, {encoding, flag: "wx"});
                    return;
                }

                throw error;
            }
        })());
    }

    /**
     * Create `path` with `data`, and say whether this call is the one that created it.
     *
     * `data: true` means the file was not there and now is; `data: false` means something else was
     * already at that path and nothing was written. Both are successes, because the question this
     * verb answers is "did I get it", and only one caller can.
     *
     * This is the primitive a lock file needs and the one neither neighbour provides.
     * {@link ensureRegularFile} performs the same `wx` create but reports nothing about which branch
     * it took, so two processes calling it both come away believing they wrote the file; the atomic
     * writers replace whatever is there, which for a lock is precisely the failure. The exclusivity
     * is the filesystem's `O_EXCL`, so it holds between processes rather than only within one.
     *
     * Not atomic in the crash sense, deliberately: the payload is a few hundred bytes of JSON, and a
     * temp-and-rename would have to replace the target, which is the guarantee being asked for here.
     */
    public static createFileExclusive(path: string, data: string, encoding: BufferEncoding = "utf-8"): Promise<FsRequestResult<boolean>> {
        return (async () => {
            try {
                await fs.writeFile(path, data, {encoding, flag: "wx"});
                return {ok: true as const, data: true} satisfies FsRequestResult<boolean, true>;
            } catch (error) {
                if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
                    return {ok: true as const, data: false} satisfies FsRequestResult<boolean, true>;
                }
                return {ok: false, error: this.createError(error)} satisfies FsRequestResult<boolean, false>;
            }
        })();
    }

    /**
     * Atomically write a file that must already exist as a plain, unlinked regular file.
     *
     * The `lstat` gate in front of the write is a **rejection contract**, not a safety property:
     * callers rely on a symlink, a non-regular file or a hard-linked file failing with
     * `INVALID_PATH` instead of being written through. A rename would cheerfully replace any of
     * them, so the gate has to stay, and stay in front.
     *
     * The gate is inherently racy, which is exactly why the rename is an improvement over the old
     * in-place write: `rename` does not follow symlinks, so a symlink planted between the check and
     * the write is *replaced* rather than written through. The old open-then-overwrite could be
     * defeated by that race; this cannot.
     */
    public static writeFileNoFollow(path: string, data: string, encoding: BufferEncoding = "utf-8"): Promise<FsRequestResult<void>> {
        return this.wrap((async () => {
            this.assertSafeFileStat(path, await fs.lstat(path));

            await this.writeFileAtomicCore(path, Buffer.from(data, encoding), false);
        })());
    }

    /**
     * Atomically write a file that may or may not exist yet, without following a symlink.
     *
     * This is the gap between the two verbs above, and it exists because a document service falls
     * straight into it. {@link writeFileNoFollow} carries the rejection contract but can only ever
     * *overwrite* - `lstat` on a missing path is `ENOENT` - while {@link ensureRegularFile} can
     * create but deliberately writes nothing when the file is already there. A service that creates
     * its file on the first open of a project that predates it and then rewrites it on every save
     * needs both behaviours from **one** call: composing them out of a probe and a write is two IPC
     * round trips, and it is a race whose losing side reports success having dropped its payload.
     *
     * For a path that already exists the contract is {@link writeFileNoFollow}'s, unchanged: a
     * symlink, a non-regular file or a hard-linked file is refused with `INVALID_PATH` rather than
     * written through. The only thing this verb additionally accepts is a path that is not there.
     *
     * Unlike {@link ensureRegularFile}, **both** branches go through {@link writeFileAtomicCore}, so
     * a create is as crash-safe as a replacement. That matters here and does not there: the file
     * being created is a whole document, and a half-written one on first save is the same loss as a
     * half-written one on the thousandth.
     *
     * A missing *parent directory* still fails, and fails loudly: the `lstat` reports `ENOENT`, the
     * create branch is taken, and `createTempSibling` then cannot open a file in a directory that is
     * not there - so the caller gets `NOT_FOUND`, which is the same answer the write-grant route
     * gave when it stat'd the parent itself.
     */
    public static writeFileNoFollowOrCreate(path: string, data: string, encoding: BufferEncoding = "utf-8"): Promise<FsRequestResult<void>> {
        return this.wrap((async () => {
            try {
                this.assertSafeFileStat(path, await fs.lstat(path));
            } catch (error) {
                // "Not there yet" is the one failure this verb absorbs. `assertSafeFileStat`'s own
                // `EINVAL` and every other stat error propagate, which is what keeps the rejection
                // contract a rejection rather than a reason to create a second file beside it.
                if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
                    throw error;
                }
            }

            await this.writeFileAtomicCore(path, Buffer.from(data, encoding), false);
        })());
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

    /**
     * Whether the process may create files in `dirPath`.
     *
     * `ok: true, data: false` means "asked and denied"; `ok: false` means the question could not be
     * answered. Callers that only gate a write on this should treat both as a refusal.
     */
    public static isWritableDir(dirPath: string): Promise<FsRequestResult<boolean>> {
        return (async () => {
            try {
                await fs.access(dirPath, fsSync.constants.W_OK);
                return {ok: true as const, data: true} satisfies FsRequestResult<boolean, true>;
            } catch (error) {
                const code = (error as NodeJS.ErrnoException)?.code;
                if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
                    return {ok: true as const, data: false} satisfies FsRequestResult<boolean, true>;
                }
                return {ok: false, error: this.createError(error)} satisfies FsRequestResult<boolean, false>;
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

    /**
     * Total the bytes of a directory tree, recursively.
     *
     * This is the single measurement the game build and the asset overview both read from. The
     * build only wants {@link DirectorySizeResult.totalBytes}; the overview also needs the per-file
     * breakdown to attribute bytes back to individual assets. Sharing one walk is the point - a
     * second implementation would be free to disagree on the edges, and the overview's "actual vs
     * reachable" read-out is only worth anything if its left-hand number is the one the build ships.
     *
     * The edges, fixed here so both sides inherit them:
     *  - A directory that cannot be read counts as empty rather than failing the whole walk.
     *  - A file whose size cannot be read counts as zero, because a build that would still ship
     *    those bytes must not be reported as smaller than it is.
     *  - Classification is by `Dirent`, so a symlink is neither a file nor a directory: it
     *    contributes nothing and a symlinked directory is not descended into. Nothing the editor
     *    writes creates one; this is a note about hand-made trees, not a case anyone should hit.
     */
    public static async directorySize(dir: string): Promise<DirectorySizeResult> {
        const result: DirectorySizeResult = {totalBytes: 0, fileCount: 0, bytesByRelativePath: {}};
        await this.accumulateDirectorySize(dir, "", result);
        return result;
    }

    private static async accumulateDirectorySize(dir: string, relativePrefix: string, result: DirectorySizeResult): Promise<void> {
        let entries: Dirent[];
        try {
            entries = await fs.readdir(dir, {withFileTypes: true});
        } catch {
            return;
        }
        for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            // Relative keys are joined with "/" on every platform so they line up with the
            // renderer's own "/"-joined asset paths regardless of the host separator.
            const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await this.accumulateDirectorySize(entryPath, relativePath, result);
            } else if (entry.isFile()) {
                const size = await fs.stat(entryPath).then(stat => stat.size).catch(() => 0);
                result.totalBytes += size;
                result.fileCount += 1;
                result.bytesByRelativePath[relativePath] = size;
            }
        }
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

    /**
     * Write `data` to `targetPath` through a temporary sibling and a rename, so the target is only
     * ever the complete old file or the complete new one - never a truncated middle.
     *
     * Sequence, and why each step is there:
     *  1. Resolve the effective target. `fs.writeFile` follows symlinks; `rename` does not, so
     *     without this a symlinked file would be *replaced by* a regular file instead of written
     *     through. `followSymlinks: false` skips this for the no-follow contract, which has already
     *     rejected symlinks by the time it gets here.
     *  2. Create the scratch file in the **same directory**. A temp directory would put it on a
     *     different device and the rename would fail with `EXDEV`.
     *  3. Name it from `crypto.randomBytes`, not a timestamp or the pid. A predictable temp name in
     *     a directory an attacker can write to is precisely the symlink-planting hole
     *     {@link Fs.assertSafeFileStat} exists to refuse; `O_EXCL | O_NOFOLLOW` closes the rest.
     *  4. `fchmod` after the fact, because the mode passed to `open` is filtered through the umask
     *     and would silently drop permissions the replaced file used to have.
     *  5. `fsync` the file before the rename: rename is atomic with respect to *readers*, but a
     *     power cut can still commit the directory entry ahead of the data blocks.
     *  6. `fsync` the directory after it, so the rename itself survives a power cut. Not possible on
     *     win32 and not fatal anywhere - a best-effort durability upgrade, not a correctness step.
     */
    private static async writeFileAtomicCore(targetPath: string, data: Buffer, followSymlinks: boolean): Promise<void> {
        const effectivePath = followSymlinks ? await this.resolveSymlinkTarget(targetPath) : targetPath;
        const mode = await this.readReplacedFileMode(effectivePath);

        const {handle, tempPath} = await this.createTempSibling(effectivePath);
        let committed = false;
        try {
            try {
                // `writeFile` on the handle rather than a single `write`: a lone `write` may be a
                // partial write, and these payloads run to megabytes.
                await handle.writeFile(data);
                await handle.chmod(mode);
                await handle.sync();
            } finally {
                await handle.close();
            }

            await this.renameReplacing(tempPath, effectivePath);
            committed = true;
        } finally {
            if (!committed) {
                // A failed write must not leave litter next to the user's project.
                await fs.unlink(tempPath).catch(() => undefined);
            }
        }

        await this.syncDirectory(path.dirname(effectivePath));
    }

    /**
     * Follow a symlink to the file the caller actually meant to write, preserving `fs.writeFile`
     * semantics. A dangling symlink still resolves to its declared destination, because
     * `fs.writeFile` would have created that file.
     */
    private static async resolveSymlinkTarget(targetPath: string): Promise<string> {
        let stats: Stats;
        try {
            stats = await fs.lstat(targetPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
                return targetPath;
            }
            throw error;
        }

        if (!stats.isSymbolicLink()) {
            return targetPath;
        }

        const resolved = await fs.realpath(targetPath).catch(() => null);
        return resolved ?? path.resolve(path.dirname(targetPath), await fs.readlink(targetPath));
    }

    /**
     * The mode the replacement file should carry: the existing file's, or the one `fs.writeFile`
     * would have produced for a new file (`0o666` minus the umask).
     *
     * Set-user/group bits are deliberately masked off - re-creating them on a brand new inode is a
     * privilege the old in-place write never had to grant.
     */
    private static async readReplacedFileMode(filePath: string): Promise<number> {
        try {
            const stats = await fs.stat(filePath);
            if (stats.isDirectory()) {
                // Report the same failure the truncating write did, rather than letting `rename`
                // decide (which picks a different errno per platform).
                throw this.createNodeError("EISDIR", `Refusing to write over a directory: ${filePath}`);
            }
            return stats.mode & 0o777;
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
                throw error;
            }
            return 0o666 & ~this.readProcessUmask();
        }
    }

    private static cachedUmask: number | null = null;

    private static readProcessUmask(): number {
        if (this.cachedUmask === null) {
            try {
                // The no-argument form reads without mutating. Unavailable in worker threads, hence
                // the fallback to the conventional default.
                this.cachedUmask = process.umask();
            } catch {
                this.cachedUmask = 0o022;
            }
        }
        return this.cachedUmask;
    }

    private static async createTempSibling(targetPath: string): Promise<{handle: Awaited<ReturnType<typeof fs.open>>; tempPath: string}> {
        const constants = fsSync.constants as typeof fsSync.constants & { O_NOFOLLOW?: number };
        const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
        const directory = path.dirname(targetPath);
        const baseName = path.basename(targetPath);

        for (let attempt = 0; attempt < 5; attempt++) {
            const tempPath = path.join(directory, `.${baseName}.${randomBytes(8).toString("hex")}${ATOMIC_WRITE_TEMP_SUFFIX}`);
            try {
                // 0o600 while in flight: the contents are nobody else's business until they are the
                // real file, and step 4 above widens it to the target's mode before the rename.
                const handle = await fs.open(tempPath, flags, 0o600);
                return {handle, tempPath};
            } catch (error) {
                if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
                    continue;
                }
                throw error;
            }
        }

        throw this.createNodeError("EEXIST", `Unable to create a temporary file next to ${targetPath}`);
    }

    private static async renameReplacing(from: string, to: string): Promise<void> {
        for (let attempt = 0; ; attempt++) {
            try {
                await fs.rename(from, to);
                return;
            } catch (error) {
                const code = (error as NodeJS.ErrnoException)?.code;
                // Windows has no atomic-replace-while-open guarantee: a virus scanner or the search
                // indexer holding the destination open makes `MoveFileEx` fail for a few
                // milliseconds. POSIX has no such window, so the retry is scoped to win32 to avoid
                // papering over a real permission error everywhere else.
                const transient = process.platform === "win32"
                    && (code === "EPERM" || code === "EACCES" || code === "EBUSY");
                if (!transient || attempt >= 5) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
            }
        }
    }

    private static async syncDirectory(directory: string): Promise<void> {
        if (process.platform === "win32") {
            // Directories cannot be opened for fsync on Windows; the rename is as durable as the
            // platform offers.
            return;
        }

        let handle: Awaited<ReturnType<typeof fs.open>>;
        try {
            handle = await fs.open(directory, fsSync.constants.O_RDONLY);
        } catch {
            return;
        }

        try {
            await handle.sync();
        } catch {
            // Best effort: some filesystems reject fsync on a directory handle. The rename already
            // happened either way, so this must never turn a successful write into a failure.
        } finally {
            await handle.close().catch(() => undefined);
        }
    }

    private static assertSafeFileStat(filePath: string, stats: Stats): void {
        if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
            throw this.createNodeError("EINVAL", `Refusing to use unsafe file path: ${filePath}`);
        }
    }

    private static createNodeError(code: string, message: string): NodeJS.ErrnoException {
        const error = new Error(message) as NodeJS.ErrnoException;
        error.code = code;
        return error;
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
                    case 'EEXIST':
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
