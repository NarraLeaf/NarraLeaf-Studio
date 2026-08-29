import type { WriteStream } from "fs";
import path from "path";
import { once } from "events";
import { finished, pipeline } from "stream/promises";
import {
    PROJECT_PACKAGE_BODY_OFFSET,
    PROJECT_PACKAGE_FORMAT,
    PROJECT_PACKAGE_FORMAT_VERSION,
    PROJECT_PACKAGE_INDEX_LENGTH_SIZE,
    PROJECT_PACKAGE_LEGACY_VERSION,
    ProjectPackageIndex,
    decodeProjectPackage,
    decodeProjectPackageIndex,
    encodeProjectPackageIndex,
    locateProjectPackageFiles,
    normalizeProjectPackagePath,
    projectPackageMagic,
    readProjectPackageVersion,
    shouldExcludeProjectPackagePath,
} from "@shared/utils/projectPackage";
import { unpatchedFs as nodeFs, unpatchedFsPromises as fs } from "../../../utils/unpatchedFs";

/**
 * Reading and writing `.nlspkg` files, a chunk at a time.
 *
 * A project package is a copy of a project's folder, and a project's folder is mostly its assets -
 * hundreds of megabytes of images and audio in any real game. So the one rule this module keeps is
 * that no more than one chunk of one file is resident at a time: files are copied stream to
 * stream, and the only thing held whole is the index, which is names and sizes.
 *
 * Everything here goes through the unpatched `fs`. These are the author's own files, and Electron's
 * asar patch would serve any of them whose path contains ".asar" out of an archive instead of
 * reading it - see `src/main/utils/unpatchedFs.ts`.
 */

export interface ProjectPackageWriteResult {
    fileCount: number;
    byteLength: number;
    /** Entries the walk deliberately left out: caches, build output, symlinks, sockets. */
    skippedCount: number;
}

export interface ProjectPackageReadResult {
    projectName: string;
    fileCount: number;
    byteLength: number;
}

interface ProjectPackageSource {
    projectRoot: string;
    packagePath: string;
    projectName: string;
    projectIdentifier?: string;
    createdAt: string;
}

interface WalkedProject {
    directories: string[];
    files: { absolutePath: string; relativePath: string }[];
    skippedCount: number;
}

/**
 * Write the project at `projectRoot` to `packagePath`, which must not exist.
 *
 * A failure part-way through leaves nothing behind: the half-written package is removed, because a
 * truncated `.nlspkg` is indistinguishable from a whole one until somebody tries to import it.
 */
export async function writeProjectPackage(source: ProjectPackageSource): Promise<ProjectPackageWriteResult> {
    const walked = await walkProject(source.projectRoot);

    // `wx`, so an export never overwrites a package that is already there - and the wait for `open`
    // is what separates "this file was ours to clean up" from "this file was already here". Only a
    // failure after this point removes anything.
    const out = nodeFs.createWriteStream(source.packagePath, { flags: "wx" });
    await once(out, "open");

    try {
        const byteLength = await streamPackage(source, walked, out);
        return { fileCount: walked.files.length, byteLength, skippedCount: walked.skippedCount };
    } catch (error) {
        out.destroy();
        await fs.rm(source.packagePath, { force: true }).catch(() => undefined);
        throw error;
    }
}

async function streamPackage(
    source: ProjectPackageSource,
    walked: WalkedProject,
    out: WriteStream,
): Promise<number> {
    let byteLength = PROJECT_PACKAGE_BODY_OFFSET;
    out.write(projectPackageMagic());

    const entries: ProjectPackageIndex["files"] = [];
    for (const file of walked.files) {
        const size = await copyFileInto(out, file.absolutePath, file.relativePath);
        entries.push({ path: file.relativePath, size });
        byteLength += size;
    }

    const index = encodeProjectPackageIndex({
        format: PROJECT_PACKAGE_FORMAT,
        version: PROJECT_PACKAGE_FORMAT_VERSION,
        createdAt: source.createdAt,
        projectName: source.projectName,
        projectIdentifier: source.projectIdentifier,
        directories: walked.directories,
        files: entries,
    });
    out.write(index);

    const trailer = Buffer.alloc(PROJECT_PACKAGE_INDEX_LENGTH_SIZE);
    trailer.writeUInt32LE(index.byteLength, 0);
    out.write(trailer);

    out.end();
    await finished(out);
    return byteLength + index.byteLength + PROJECT_PACKAGE_INDEX_LENGTH_SIZE;
}

/**
 * One file into the open package, chunk by chunk, returning how many bytes it turned out to be.
 *
 * The count is taken from what is handed to the output rather than from `bytesWritten`, which only
 * counts bytes the filesystem has already taken and therefore lags behind whatever is still queued.
 * An index built from a lagging count would put every later file at the wrong offset.
 */
async function copyFileInto(out: WriteStream, absolutePath: string, relativePath: string): Promise<number> {
    let size = 0;
    try {
        for await (const chunk of nodeFs.createReadStream(absolutePath)) {
            size += (chunk as Buffer).length;
            if (!out.write(chunk)) {
                await once(out, "drain");
            }
        }
    } catch (error) {
        throw describeFileFailure(relativePath, error);
    }
    return size;
}

/**
 * The files an export carries, and the directories that hold them.
 *
 * Empty directories are listed in their own right so that an imported project has the same shape as
 * the one that was exported - a project can hold a folder that means something while it is still
 * empty. Symlinks are skipped rather than followed: an export is bytes, and a link is a claim about
 * a filesystem the recipient does not have.
 */
async function walkProject(projectRoot: string): Promise<WalkedProject> {
    const directories = new Set<string>();
    const files: WalkedProject["files"] = [];
    let skippedCount = 0;

    async function walk(directory: string): Promise<void> {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            const absolutePath = path.join(directory, entry.name);
            const relativePath = toProjectPackagePath(projectRoot, absolutePath);

            if (entry.isSymbolicLink() || shouldExcludeProjectPackagePath(relativePath)) {
                skippedCount += 1;
                continue;
            }

            if (entry.isDirectory()) {
                directories.add(relativePath);
                await walk(absolutePath);
                continue;
            }

            if (entry.isFile()) {
                files.push({ absolutePath, relativePath });
                continue;
            }

            skippedCount += 1;
        }
    }

    await walk(projectRoot);

    return {
        directories: Array.from(directories).sort(),
        files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
        skippedCount,
    };
}

/**
 * Unpack `packagePath` into `targetDir`, which must be empty.
 *
 * Version 2 is read by seeking: the index at the end says where every file is, so each one is
 * copied stream to stream. Version 1 has no index and its bytes are values inside a single msgpack
 * object, so it is read whole - the format Studio no longer writes is also the format that cannot
 * be read any other way.
 */
export async function readProjectPackageInto(
    packagePath: string,
    targetDir: string,
): Promise<ProjectPackageReadResult> {
    await fs.mkdir(targetDir, { recursive: true });
    if ((await fs.readdir(targetDir)).length > 0) {
        throw new Error("Import folder must be empty. Choose an empty folder for the imported project.");
    }

    const byteLength = (await fs.stat(packagePath)).size;
    const version = readProjectPackageVersion(await readSpan(packagePath, 0, PROJECT_PACKAGE_BODY_OFFSET));
    if (version === null) {
        throw new Error("Selected file is not a NarraLeaf Studio project package.");
    }
    if (version === PROJECT_PACKAGE_LEGACY_VERSION) {
        return { ...await readLegacyPackageInto(packagePath, targetDir), byteLength };
    }

    const index = await readPackageIndex(packagePath, byteLength);
    for (const directory of index.directories) {
        await fs.mkdir(resolveInsideTarget(targetDir, directory), { recursive: true });
    }

    for (const file of locateProjectPackageFiles(index)) {
        const filePath = resolveInsideTarget(targetDir, file.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        if (file.size === 0) {
            await fs.writeFile(filePath, "", { flag: "wx" });
            continue;
        }
        try {
            await pipeline(
                nodeFs.createReadStream(packagePath, { start: file.offset, end: file.offset + file.size - 1 }),
                nodeFs.createWriteStream(filePath, { flags: "wx" }),
            );
        } catch (error) {
            throw describeFileFailure(file.path, error);
        }
    }

    return { projectName: index.projectName, fileCount: index.files.length, byteLength };
}

/**
 * The index of a version 2 package: its length is the last four bytes, and it sits immediately
 * before them. Both spans are checked against the file's actual length before either is read, so a
 * truncated package is rejected rather than turned into an enormous allocation.
 */
async function readPackageIndex(packagePath: string, byteLength: number): Promise<ProjectPackageIndex> {
    const trailerAt = byteLength - PROJECT_PACKAGE_INDEX_LENGTH_SIZE;
    if (trailerAt < PROJECT_PACKAGE_BODY_OFFSET) {
        throw new Error("Project package is truncated: it is too short to hold an index.");
    }

    const trailer = await readSpan(packagePath, trailerAt, PROJECT_PACKAGE_INDEX_LENGTH_SIZE);
    const indexLength = Buffer.from(trailer).readUInt32LE(0);
    const indexAt = trailerAt - indexLength;
    if (indexAt < PROJECT_PACKAGE_BODY_OFFSET) {
        throw new Error("Project package is truncated: its index does not fit inside it.");
    }

    return decodeProjectPackageIndex(
        await readSpan(packagePath, indexAt, indexLength),
        indexAt - PROJECT_PACKAGE_BODY_OFFSET,
    );
}

/**
 * A version 1 package, whose bytes are values inside one msgpack object. There is nothing to seek
 * by, so this is the one path that holds a whole project in memory - and the reason version 2
 * exists. It stays because packages already written are still packages.
 */
async function readLegacyPackageInto(
    packagePath: string,
    targetDir: string,
): Promise<{ projectName: string; fileCount: number }> {
    const payload = decodeProjectPackage(await fs.readFile(packagePath));

    for (const directory of payload.directories) {
        await fs.mkdir(resolveInsideTarget(targetDir, directory), { recursive: true });
    }
    for (const file of payload.files) {
        const filePath = resolveInsideTarget(targetDir, file.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.data, { flag: "wx" });
    }

    return { projectName: payload.projectName, fileCount: payload.files.length };
}

async function readSpan(filePath: string, offset: number, length: number): Promise<Uint8Array> {
    const handle = await fs.open(filePath, "r");
    try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return buffer.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }
}

/**
 * Names the file. A copy that fails part-way through a project reports whatever the filesystem
 * said, and on its own that is a path-shaped sentence about a file the author never mentioned -
 * which is all an export failure used to put in front of them.
 */
function describeFileFailure(relativePath: string, error: unknown): Error {
    const reason = error instanceof Error ? error.message : String(error);
    return new Error(`Could not copy "${relativePath}": ${reason}`);
}

function toProjectPackagePath(projectRoot: string, absolutePath: string): string {
    const relativePath = path.relative(projectRoot, absolutePath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(`Path is outside project root: ${absolutePath}`);
    }
    return normalizeProjectPackagePath(relativePath);
}

function resolveInsideTarget(targetDir: string, packagePath: string): string {
    const relativePath = normalizeProjectPackagePath(packagePath);
    const resolved = path.resolve(targetDir, ...relativePath.split("/"));
    const relativeToTarget = path.relative(targetDir, resolved);
    if (relativeToTarget.startsWith("..") || path.isAbsolute(relativeToTarget)) {
        throw new Error(`Project package path escapes import folder: ${packagePath}`);
    }
    return resolved;
}
