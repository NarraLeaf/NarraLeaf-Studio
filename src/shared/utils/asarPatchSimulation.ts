import type nodeFsModule from "fs";
import Module, { createRequire } from "module";
import path from "path";
import { Readable, Writable } from "stream";
import { fileURLToPath } from "url";

/**
 * Electron's asar patch, reproduced for tests that run under plain node.
 *
 * Tests run where `fs` was never patched, so a test that walks a folder holding `bundle.asar`
 * passes whether or not the code under it went through `unpatchedFs` - which is exactly the
 * difference that matters inside Studio. This module gives a test file the patched `fs` back:
 *
 * ```ts
 * vi.mock("fs", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsModule());
 * vi.mock("fs/promises", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsPromisesModule());
 * afterAll(async () => (await import("@shared/utils/asarPatchSimulation")).restoreOriginalFs());
 * ```
 *
 * Every module the test imports then sees the patched behaviour on `fs` and `fs/promises`, and
 * `require("original-fs")` answers with node's real, unpatched `fs` - so `unpatchedFs` resolves to a
 * different module from `fs`, as it does in Electron. Code that still reads an author's file through
 * `fs` fails the way it fails in Studio, and code that goes through `unpatchedFs` does not.
 *
 * The behaviour reproduced is what Electron 38 was MEASURED doing on Windows, not what its source
 * suggests; see `unpatchedFs.ts` for the list. Two things are left out on purpose: the contents of
 * an archive are never served (a read inside one fails instead of answering with the archive's
 * bytes, which is enough to show the code went the wrong way), and the file lock is not reproduced
 * (it is a property of Windows file handles, not of anything a test can observe portably).
 *
 * Only the file names are matched, never the contents: any regular file whose name ends in `.asar`
 * counts as an archive, whether or not it is a valid one.
 */

type NodeFs = typeof nodeFsModule;
type NodeFsPromises = typeof nodeFsModule.promises;

/** Node's own `fs`, fetched through `require` so a `vi.mock("fs")` never hands back the simulation. */
const nodeRequire = createRequire(__filename);
const realFs: NodeFs = nodeRequire("fs");

const ARCHIVE_EXTENSION = /\.asar$/i;

/** Where a path meets an archive, if it does: the archive file and the path inside it. */
type ArchiveSplit = {
    archive: string;
    inner: string;
    /** Whether `archive` is a regular file. When it is not, the patch answers "Invalid package". */
    valid: boolean;
};

function asPathString(target: unknown): string | null {
    if (typeof target === "string") {
        return target;
    }
    if (Buffer.isBuffer(target)) {
        return target.toString();
    }
    if (target instanceof URL) {
        return fileURLToPath(target);
    }
    return null;
}

function notFoundInArchive(split: ArchiveSplit): NodeJS.ErrnoException {
    return Object.assign(new Error(`ENOENT, ${split.inner} not found in ${split.archive}`), { code: "ENOENT", errno: -2 });
}

function invalidPackage(split: ArchiveSplit): Error {
    return new Error(`Invalid package ${split.archive}`);
}

function refusal(split: ArchiveSplit): Error {
    return split.valid ? notFoundInArchive(split) : invalidPackage(split);
}

function isDirectoryNow(target: string): boolean {
    return realFs.statSync(target, { throwIfNoEntry: false })?.isDirectory() === true;
}

function isFileNow(target: string): boolean {
    return realFs.statSync(target, { throwIfNoEntry: false })?.isFile() === true;
}

/** Every regular file named like an archive under `root`, found with node's own `fs`. */
function archivesUnder(root: string): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of realFs.readdirSync(dir, { withFileTypes: true })) {
            const child = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(child);
            } else if (entry.isFile() && ARCHIVE_EXTENSION.test(entry.name)) {
                found.push(child);
            }
        }
    };
    if (isDirectoryNow(root)) {
        walk(root);
    }
    return found;
}

function isWriteFlag(flags: unknown): boolean {
    if (typeof flags === "number") {
        return (flags & (realFs.constants.O_WRONLY | realFs.constants.O_RDWR)) !== 0;
    }
    return typeof flags === "string" && /[wa+]/.test(flags);
}

/**
 * One simulated process: a patched `fs`, a patched `fs/promises`, and the per-process memory of
 * which paths were directories that the real patch keeps (see `unpatchedFs.ts`).
 */
function createSimulation(): { fs: NodeFs; promises: NodeFsPromises } {
    const directoryAnswers = new Map<string, boolean>();
    const isDirectoryRemembered = (target: string): boolean => {
        let answer = directoryAnswers.get(target);
        if (answer === undefined) {
            answer = isDirectoryNow(target);
            directoryAnswers.set(target, answer);
        }
        return answer;
    };

    /**
     * The archive a path runs through, found the way Electron finds it: from the full path upward,
     * the first component named like an archive that is not (remembered as) a directory.
     */
    const split = (target: unknown): ArchiveSplit | null => {
        const raw = asPathString(target);
        if (raw === null || !/\.asar/i.test(raw)) {
            return null;
        }
        let current = path.resolve(raw);
        const rest: string[] = [];
        while (true) {
            if (ARCHIVE_EXTENSION.test(path.basename(current)) && !isDirectoryRemembered(current)) {
                return { archive: current, inner: rest.join(path.sep), valid: isFileNow(current) };
            }
            const parent = path.dirname(current);
            if (parent === current) {
                return null;
            }
            rest.unshift(path.basename(current));
            current = parent;
        }
    };

    /** The archive root as the patch describes it: a directory of size 0. */
    const archiveRootStats = (archive: string): nodeFsModule.Stats => {
        const real = realFs.statSync(archive);
        const stats = Object.create(Object.getPrototypeOf(real)) as nodeFsModule.Stats;
        Object.assign(stats, real, {
            mode: (real.mode & ~realFs.constants.S_IFMT) | realFs.constants.S_IFDIR,
            size: 0,
        });
        return stats;
    };

    const statLike = (target: unknown): nodeFsModule.Stats | null => {
        const where = split(target);
        if (!where) {
            return null;
        }
        if (!where.valid || where.inner !== "") {
            throw refusal(where);
        }
        return archiveRootStats(where.archive);
    };

    const refuseIfArchive = (target: unknown): void => {
        const where = split(target);
        if (where) {
            throw refusal(where);
        }
    };

    const listArchive = (target: unknown): [] | null => {
        const where = split(target);
        if (!where) {
            return null;
        }
        if (!where.valid || where.inner !== "") {
            throw refusal(where);
        }
        // What is inside is never served; see the module comment.
        return [];
    };

    const refuseMkdir = (target: unknown): void => {
        const where = split(target);
        if (where && where.inner !== "") {
            throw Object.assign(new Error("ENOTDIR, not a directory"), { code: "ENOTDIR" });
        }
    };

    const refuseRm = (target: unknown, options: unknown): void => {
        const raw = asPathString(target);
        const where = split(target);
        if (where && where.valid && where.inner === "") {
            throw Object.assign(
                new Error(`Path is a directory: rm returned EISDIR (is a directory) ${where.archive}`),
                { code: "ERR_FS_EISDIR" },
            );
        }
        if (raw !== null && (options as { recursive?: boolean } | undefined)?.recursive) {
            const inside = archivesUnder(path.resolve(raw));
            if (inside.length > 0) {
                throw Object.assign(new Error(`EBUSY: resource busy or locked, rmdir '${inside[0]}'`), { code: "EBUSY" });
            }
        }
    };

    const refuseCp = (source: unknown, destination: unknown): void => {
        refuseIfArchive(source);
        const from = asPathString(source);
        const to = asPathString(destination);
        if (from === null || to === null) {
            return;
        }
        const inside = archivesUnder(path.resolve(from));
        if (inside.length > 0) {
            const landing = path.join(path.resolve(to), path.relative(path.resolve(from), inside[0]));
            throw new Error(`Invalid package ${landing}`);
        }
    };

    const promises: NodeFsPromises = {
        ...realFs.promises,
        stat: (async (target: nodeFsModule.PathLike, options?: nodeFsModule.StatOptions) =>
            statLike(target) ?? realFs.promises.stat(target, options)) as NodeFsPromises["stat"],
        lstat: (async (target: nodeFsModule.PathLike, options?: nodeFsModule.StatOptions) =>
            statLike(target) ?? realFs.promises.lstat(target, options)) as NodeFsPromises["lstat"],
        readFile: (async (target: Parameters<NodeFsPromises["readFile"]>[0], options?: unknown) => {
            refuseIfArchive(target);
            return realFs.promises.readFile(target, options as never);
        }) as NodeFsPromises["readFile"],
        open: (async (target: nodeFsModule.PathLike, flags?: nodeFsModule.OpenMode, mode?: nodeFsModule.Mode) => {
            refuseIfArchive(target);
            return realFs.promises.open(target, flags, mode);
        }) as NodeFsPromises["open"],
        copyFile: (async (source: nodeFsModule.PathLike, destination: nodeFsModule.PathLike, mode?: number) => {
            refuseIfArchive(source);
            return realFs.promises.copyFile(source, destination, mode);
        }) as NodeFsPromises["copyFile"],
        access: (async (target: nodeFsModule.PathLike, mode?: number) => {
            refuseIfArchive(target);
            return realFs.promises.access(target, mode);
        }) as NodeFsPromises["access"],
        readdir: (async (target: nodeFsModule.PathLike, options?: unknown) =>
            listArchive(target) ?? realFs.promises.readdir(target, options as never)) as NodeFsPromises["readdir"],
        mkdir: (async (target: nodeFsModule.PathLike, options?: unknown) => {
            refuseMkdir(target);
            return realFs.promises.mkdir(target, options as never);
        }) as NodeFsPromises["mkdir"],
        rm: (async (target: nodeFsModule.PathLike, options?: nodeFsModule.RmOptions) => {
            refuseRm(target, options);
            return realFs.promises.rm(target, options);
        }) as NodeFsPromises["rm"],
        cp: (async (source: string | URL, destination: string | URL, options?: nodeFsModule.CopyOptions) => {
            refuseCp(source, destination);
            return realFs.promises.cp(source, destination, options);
        }) as NodeFsPromises["cp"],
    };

    /** The callback form of a promise function above, so the callback API agrees with it. */
    const callbackOf = <A extends unknown[]>(run: (...args: A) => Promise<unknown>) =>
        (...args: unknown[]): void => {
            const callback = args.pop() as (error: unknown, value?: unknown) => void;
            run(...(args as A)).then(value => callback(null, value), error => callback(error));
        };

    const fs: NodeFs = {
        ...realFs,
        promises,
        statSync: ((target: nodeFsModule.PathLike, options?: nodeFsModule.StatSyncOptions) =>
            statLike(target) ?? realFs.statSync(target, options)) as NodeFs["statSync"],
        lstatSync: ((target: nodeFsModule.PathLike, options?: nodeFsModule.StatSyncOptions) =>
            statLike(target) ?? realFs.lstatSync(target, options)) as NodeFs["lstatSync"],
        readFileSync: ((target: nodeFsModule.PathOrFileDescriptor, options?: unknown) => {
            refuseIfArchive(target);
            return realFs.readFileSync(target, options as never);
        }) as NodeFs["readFileSync"],
        openSync: ((target: nodeFsModule.PathLike, flags: nodeFsModule.OpenMode = "r", mode?: nodeFsModule.Mode) => {
            refuseIfArchive(target);
            return realFs.openSync(target, flags, mode);
        }) as NodeFs["openSync"],
        copyFileSync: ((source: nodeFsModule.PathLike, destination: nodeFsModule.PathLike, mode?: number) => {
            refuseIfArchive(source);
            return realFs.copyFileSync(source, destination, mode);
        }) as NodeFs["copyFileSync"],
        accessSync: ((target: nodeFsModule.PathLike, mode?: number) => {
            refuseIfArchive(target);
            return realFs.accessSync(target, mode);
        }) as NodeFs["accessSync"],
        existsSync: ((target: nodeFsModule.PathLike) => {
            const where = split(target);
            if (where) {
                return where.valid && where.inner === "";
            }
            return realFs.existsSync(target);
        }) as NodeFs["existsSync"],
        readdirSync: ((target: nodeFsModule.PathLike, options?: unknown) =>
            listArchive(target) ?? realFs.readdirSync(target, options as never)) as NodeFs["readdirSync"],
        mkdirSync: ((target: nodeFsModule.PathLike, options?: unknown) => {
            refuseMkdir(target);
            return realFs.mkdirSync(target, options as never);
        }) as NodeFs["mkdirSync"],
        rmSync: ((target: nodeFsModule.PathLike, options?: nodeFsModule.RmOptions) => {
            refuseRm(target, options);
            return realFs.rmSync(target, options);
        }) as NodeFs["rmSync"],
        // Measured: the synchronous copy is native and copies an archive as the file it is.
        cpSync: realFs.cpSync,
        createReadStream: ((target: nodeFsModule.PathLike, options?: unknown) => {
            const where = split(target);
            if (!where) {
                return realFs.createReadStream(target, options as never);
            }
            const stream = new Readable({ read() {} });
            process.nextTick(() => stream.destroy(refusal(where)));
            return stream;
        }) as NodeFs["createReadStream"],
        createWriteStream: ((target: nodeFsModule.PathLike, options?: unknown) => {
            const where = split(target);
            if (!where) {
                return realFs.createWriteStream(target, options as never);
            }
            const stream = new Writable({ write(_chunk, _encoding, done) { done(invalidPackage(where)); } });
            process.nextTick(() => stream.destroy(invalidPackage(where)));
            return stream;
        }) as unknown as NodeFs["createWriteStream"],
        stat: callbackOf(promises.stat) as NodeFs["stat"],
        lstat: callbackOf(promises.lstat) as NodeFs["lstat"],
        readFile: callbackOf(promises.readFile) as NodeFs["readFile"],
        copyFile: callbackOf(promises.copyFile) as NodeFs["copyFile"],
        access: callbackOf(promises.access) as NodeFs["access"],
        readdir: callbackOf(promises.readdir) as NodeFs["readdir"],
        mkdir: callbackOf(promises.mkdir) as NodeFs["mkdir"],
        rm: callbackOf(promises.rm) as NodeFs["rm"],
        cp: callbackOf(promises.cp) as NodeFs["cp"],
        open: ((target: nodeFsModule.PathLike, ...rest: unknown[]) => {
            const callback = rest.pop() as (error: unknown, fd?: number) => void;
            const where = split(target);
            if (where) {
                process.nextTick(() => callback(isWriteFlag(rest[0]) ? invalidPackage(where) : refusal(where)));
                return;
            }
            (realFs.open as (...args: unknown[]) => void)(target, ...rest, callback);
        }) as NodeFs["open"],
    };
    return { fs, promises };
}

let simulation: ReturnType<typeof createSimulation> | null = null;
let restoreLoader: (() => void) | null = null;

/**
 * Make `require("original-fs")` answer with node's own `fs`, as it answers in Electron.
 *
 * Installed the first time a mock factory below runs, which is before any module under test has
 * finished importing `fs` - and so before `unpatchedFs` asks for `original-fs`.
 */
function provideOriginalFs(): void {
    if (restoreLoader) {
        return;
    }
    const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
    const previous = loader._load;
    loader._load = function load(this: unknown, request: string, ...rest: unknown[]) {
        return request === "original-fs" ? realFs : previous.call(this, request, ...rest);
    };
    restoreLoader = () => {
        loader._load = previous;
    };
}

function currentSimulation(): ReturnType<typeof createSimulation> {
    provideOriginalFs();
    simulation ??= createSimulation();
    return simulation;
}

/** The namespace a `vi.mock("fs", ...)` factory returns. */
export function simulatedFsModule(): Record<string, unknown> {
    const { fs } = currentSimulation();
    return { ...fs, default: fs };
}

/** The namespace a `vi.mock("fs/promises", ...)` factory returns. */
export function simulatedFsPromisesModule(): Record<string, unknown> {
    const { promises } = currentSimulation();
    return { ...promises, default: promises };
}

/** Undo {@link provideOriginalFs}, for an `afterAll`. The mocks themselves end with the test file. */
export function restoreOriginalFs(): void {
    restoreLoader?.();
    restoreLoader = null;
    simulation = null;
}

/** Node's real `fs`, for a test that builds its fixture beside the simulation rather than through it. */
export const unsimulatedFs: NodeFs = realFs;

/**
 * The bytes of a real asar archive holding `files` (paths joined with `/`).
 *
 * The format is small enough to write here - two pickles, the JSON header, then the file bodies -
 * and writing it avoids depending on a package this repository only has transitively. The output
 * is what `@electron/asar` lists and extracts, and what Electron's own patch opens.
 */
export function asarArchiveBytes(files: Record<string, string | Uint8Array>): Buffer {
    type HeaderNode = { files: Record<string, HeaderNode | { size: number; offset: string }> };
    const header: HeaderNode = { files: {} };
    const bodies: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const bytes = Buffer.from(content);
        const parts = name.split("/");
        let node = header;
        for (const directory of parts.slice(0, -1)) {
            node.files[directory] ??= { files: {} };
            node = node.files[directory] as HeaderNode;
        }
        node.files[parts[parts.length - 1]] = { size: bytes.length, offset: String(offset) };
        bodies.push(bytes);
        offset += bytes.length;
    }
    const json = Buffer.from(JSON.stringify(header), "utf8");
    const paddedLength = Math.ceil(json.length / 4) * 4;
    const headerPickle = Buffer.alloc(8 + paddedLength);
    headerPickle.writeUInt32LE(4 + paddedLength, 0);
    headerPickle.writeInt32LE(json.length, 4);
    json.copy(headerPickle, 8);
    const sizePickle = Buffer.alloc(8);
    sizePickle.writeUInt32LE(4, 0);
    sizePickle.writeUInt32LE(headerPickle.length, 4);
    return Buffer.concat([sizePickle, headerPickle, ...bodies]);
}

/** The author files {@link writeArchiveNamedTree} puts down, by path relative to its root. */
export const ARCHIVE_NAMED_FILES = ["bundle.asar", "old.asar/note.txt", "old.asar/deeper/inner.txt"] as const;

/**
 * Put down the two shapes that trip the patch, under `root`, with node's own `fs`: a real archive
 * named `bundle.asar`, and a folder named `old.asar/` with a file in it and a folder below that.
 * Answers each file's bytes by its path relative to `root`.
 */
export function writeArchiveNamedTree(root: string): Record<(typeof ARCHIVE_NAMED_FILES)[number], Buffer> {
    const bytes = {
        "bundle.asar": asarArchiveBytes({ "inside.txt": "inside the archive\n", "lib/blob.bin": Buffer.alloc(3000, 7) }),
        "old.asar/note.txt": Buffer.from("a note kept in a folder named old.asar\n"),
        "old.asar/deeper/inner.txt": Buffer.from("one level further down\n"),
    };
    for (const [relative, content] of Object.entries(bytes)) {
        const target = path.join(root, ...relative.split("/"));
        realFs.mkdirSync(path.dirname(target), { recursive: true });
        realFs.writeFileSync(target, content);
    }
    return bytes;
}
