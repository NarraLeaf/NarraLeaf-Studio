import msgpack from "msgpack-lite";

export const PROJECT_PACKAGE_EXTENSION = ".nlspkg";
export const PROJECT_PACKAGE_FORMAT = "narraleaf-studio.project-package";

/**
 * The format Studio writes today: an index at the end, file bytes in the middle.
 *
 * Version 1 put the whole project inside one msgpack object, so exporting held every byte of it in
 * memory three times over - once as the files, once as the encoding of them, once as the copy that
 * got the magic prefixed - and importing held it twice. On a half-gigabyte project that is a
 * gigabyte and a half of resident memory and a main process that stops answering, to copy files
 * from one folder to another. Version 2 exists to be written and read a chunk at a time.
 *
 * The index sits at the END rather than the front because a writer only knows how large each file
 * turned out once it has finished copying it. A leading index would have to be written from
 * `stat` sizes taken beforehand and would be wrong about any file that changed underneath the
 * export - which is the one thing an index may not be wrong about, since every entry after the
 * mistake is then read from the wrong offset. Zip solved this the same way and for the same reason.
 *
 *     [0, 8)                 magic, ending in the format version
 *     [8, 8 + bodyLength)    every file's bytes, back to back, in the order the index lists them
 *     [.., length - 4)       the msgpack index
 *     [length - 4, length)   uint32 LE: how long that index is
 *
 * Version 1 is still read, because packages already written are still packages.
 */
export const PROJECT_PACKAGE_FORMAT_VERSION = 2;
export const PROJECT_PACKAGE_LEGACY_VERSION = 1;

/** Where the first file's bytes begin, and the length of the magic that precedes them. */
export const PROJECT_PACKAGE_BODY_OFFSET = 8;
/** The uint32 LE at the very end of a version 2 package, giving the index's length. */
export const PROJECT_PACKAGE_INDEX_LENGTH_SIZE = 4;

const MAGIC_PREFIX = [0x4e, 0x4c, 0x53, 0x50, 0x4b, 0x47, 0x00] as const;
const PROJECT_PACKAGE_MAGIC_V1 = new Uint8Array([...MAGIC_PREFIX, PROJECT_PACKAGE_LEGACY_VERSION]);
const PROJECT_PACKAGE_MAGIC_V2 = new Uint8Array([...MAGIC_PREFIX, PROJECT_PACKAGE_FORMAT_VERSION]);

/** What a version 2 index says about one file: its name, and how many bytes of the body are it. */
export interface ProjectPackageIndexEntry {
    path: string;
    size: number;
}

export interface ProjectPackageIndex {
    format: typeof PROJECT_PACKAGE_FORMAT;
    version: typeof PROJECT_PACKAGE_FORMAT_VERSION;
    createdAt: string;
    projectName: string;
    projectIdentifier?: string;
    directories: string[];
    files: ProjectPackageIndexEntry[];
}

/** One entry of a version 2 index, resolved to the span of the package that holds it. */
export interface ProjectPackageFileLocation extends ProjectPackageIndexEntry {
    /** Byte offset of this file's first byte within the package. */
    offset: number;
}

/** A version 1 package, which is only ever produced by reading one. */
export interface ProjectPackageLegacyFileEntry {
    path: string;
    data: Uint8Array;
}

export interface ProjectPackageLegacyPayload {
    format: typeof PROJECT_PACKAGE_FORMAT;
    version: typeof PROJECT_PACKAGE_LEGACY_VERSION;
    createdAt: string;
    projectName: string;
    projectIdentifier?: string;
    directories: string[];
    files: ProjectPackageLegacyFileEntry[];
}

/** The eight bytes every version 2 package starts with. */
export function projectPackageMagic(): Uint8Array {
    return new Uint8Array(PROJECT_PACKAGE_MAGIC_V2);
}

/**
 * Which format this is, decided from the first eight bytes - so a reader can tell before it has
 * committed to holding the file in memory, which is the whole difference between the two versions.
 * `null` for anything that is not a package at all.
 */
export function readProjectPackageVersion(head: Uint8Array): 1 | 2 | null {
    if (startsWith(head, PROJECT_PACKAGE_MAGIC_V2)) {
        return PROJECT_PACKAGE_FORMAT_VERSION;
    }
    if (startsWith(head, PROJECT_PACKAGE_MAGIC_V1)) {
        return PROJECT_PACKAGE_LEGACY_VERSION;
    }
    return null;
}

export function encodeProjectPackageIndex(index: ProjectPackageIndex): Uint8Array {
    const encoded = msgpack.encode(index);
    return encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
}

/**
 * The index, checked hard enough that the offsets computed from it can be trusted.
 *
 * `bodyLength` is what the package itself says is there - the bytes between the magic and the
 * index. Sizes that do not add up to exactly that are a truncated or tampered package, and the
 * check is for equality rather than "fits" so that a package cannot carry bytes no entry claims.
 */
export function decodeProjectPackageIndex(bytes: Uint8Array, bodyLength: number): ProjectPackageIndex {
    const decoded = msgpack.decode(bytes) as Partial<ProjectPackageIndex>;
    if (decoded.format !== PROJECT_PACKAGE_FORMAT) {
        throw new Error("Project package format is not supported.");
    }
    if (decoded.version !== PROJECT_PACKAGE_FORMAT_VERSION) {
        throw new Error(`Project package version ${String(decoded.version)} is not supported.`);
    }
    if (!Array.isArray(decoded.files)) {
        throw new Error("Project package is missing file entries.");
    }

    let claimed = 0;
    const files = decoded.files.map((entry) => {
        if (!entry || typeof entry.path !== "string") {
            throw new Error("Project package contains an invalid file entry.");
        }
        if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
            throw new Error(`Project package gives an unusable size for "${entry.path}".`);
        }
        claimed += entry.size;
        return { path: normalizeProjectPackagePath(entry.path), size: entry.size };
    });

    if (claimed !== bodyLength) {
        throw new Error(
            `Project package is ${claimed > bodyLength ? "truncated" : "longer than its index accounts for"}: `
            + `the index claims ${claimed} bytes of file data and the package carries ${bodyLength}.`,
        );
    }

    return {
        format: PROJECT_PACKAGE_FORMAT,
        version: PROJECT_PACKAGE_FORMAT_VERSION,
        createdAt: typeof decoded.createdAt === "string" ? decoded.createdAt : "",
        projectName: packageProjectName(decoded.projectName),
        projectIdentifier: typeof decoded.projectIdentifier === "string" ? decoded.projectIdentifier : undefined,
        directories: Array.isArray(decoded.directories)
            ? decoded.directories.map(normalizeProjectPackagePath)
            : [],
        files,
    };
}

/** Where each file sits in the package, in the order the reader should walk them. */
export function locateProjectPackageFiles(index: ProjectPackageIndex): ProjectPackageFileLocation[] {
    let offset = PROJECT_PACKAGE_BODY_OFFSET;
    return index.files.map((entry) => {
        const located = { ...entry, offset };
        offset += entry.size;
        return located;
    });
}

/**
 * A version 1 package, read whole because that format cannot be read any other way: its file bytes
 * are values inside one msgpack object, and there is no index to seek by.
 */
export function decodeProjectPackage(bytes: Uint8Array): ProjectPackageLegacyPayload {
    if (
        readProjectPackageVersion(bytes) !== PROJECT_PACKAGE_LEGACY_VERSION
        || bytes.length <= PROJECT_PACKAGE_MAGIC_V1.length
    ) {
        throw new Error("Selected file is not a NarraLeaf Studio project package.");
    }

    const decoded = msgpack.decode(
        bytes.slice(PROJECT_PACKAGE_MAGIC_V1.length),
    ) as Partial<ProjectPackageLegacyPayload>;
    if (decoded.format !== PROJECT_PACKAGE_FORMAT) {
        throw new Error("Project package format is not supported.");
    }
    if (decoded.version !== PROJECT_PACKAGE_LEGACY_VERSION) {
        throw new Error(`Project package version ${String(decoded.version)} is not supported.`);
    }
    if (!Array.isArray(decoded.files)) {
        throw new Error("Project package is missing file entries.");
    }

    return {
        format: PROJECT_PACKAGE_FORMAT,
        version: PROJECT_PACKAGE_LEGACY_VERSION,
        createdAt: typeof decoded.createdAt === "string" ? decoded.createdAt : "",
        projectName: packageProjectName(decoded.projectName),
        projectIdentifier: typeof decoded.projectIdentifier === "string" ? decoded.projectIdentifier : undefined,
        directories: Array.isArray(decoded.directories)
            ? decoded.directories.map(normalizeProjectPackagePath)
            : [],
        files: decoded.files.map((entry) => {
            if (!entry || typeof entry.path !== "string") {
                throw new Error("Project package contains an invalid file entry.");
            }
            return {
                path: normalizeProjectPackagePath(entry.path),
                data: normalizePackageBytes(entry.data),
            };
        }),
    };
}

export function normalizeProjectPackagePath(value: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error("Project package path must be a non-empty relative path.");
    }
    if (value.includes("\0")) {
        throw new Error("Project package path contains an invalid character.");
    }

    const normalized = value.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
        throw new Error(`Project package path must be relative: ${value}`);
    }

    const segments = normalized.split("/");
    if (segments.some(segment => segment === "" || segment === "." || segment === "..")) {
        throw new Error(`Project package path contains unsafe segments: ${value}`);
    }

    return segments.join("/");
}

export function shouldExcludeProjectPackagePath(relativePath: string): boolean {
    const normalized = normalizeProjectPackagePath(relativePath).toLowerCase();
    const segments = normalized.split("/");
    const fileName = segments.at(-1) ?? "";

    if (fileName === ".ds_store" || fileName === "thumbs.db" || fileName.endsWith(PROJECT_PACKAGE_EXTENSION)) {
        return true;
    }
    if (segments[0] === ".git" || segments[0] === "node_modules") {
        return true;
    }
    // The repository, not the project. An export is "here is a copy of my project", and every
    // revision anyone ever made is a different offer - one that also carries the backend's own
    // store files and lock state, which have never been shown to survive being copied to another
    // machine. The `.loreignore` beside it is NOT excluded: it is a policy file, it is small, and
    // it is right about this project wherever the project ends up.
    if (segments[0] === ".lore") {
        return true;
    }
    // The builds, not the project. `<project>/dist` is where a game build lands when the author
    // has not named an output folder of their own, so any project that has been built once holds a
    // packaged Electron app - hundreds of megabytes that the recipient's own build would produce
    // again from the sources beside it. It also spares the export the archives inside such a build:
    // Electron serves reads of any path containing ".asar" out of the archive rather than as the
    // file, and a walk that reaches one gets ENOENT for a lookup it never asked to make.
    if (segments[0] === "dist") {
        return true;
    }
    if (segments[0] === "editor" && segments[1] === "cache") {
        return true;
    }
    if (segments[0] === "editor" && segments[1] === "assets" && segments[2] === "remote") {
        return true;
    }
    // Studio's own working directory for this project, whole. Version control already draws the
    // line in exactly this place - `.nlstudio` is in `@shared/vcs/workingSet`'s excluded names, at
    // any depth - and an export is the same question asked of a different destination: what of this
    // is the project, and what of it is one machine's account of having opened the project.
    //
    // The answer is that none of it is the project. What is under here is who has the project open
    // right now (`session.lock`), what Dev Mode and the preview runner compiled and the throwaway
    // saves made while testing (`preview/`, `test/`, `build/`), the snapshots a Dev Mode session
    // materialises to run a past revision (`devmode/revisions/`), bytes set aside from a document
    // that would not parse (`quarantine/`), how this window was arranged (`services/`), and scratch
    // space measured in seconds (`convert/`, `tmp/`). The recipient's own Studio writes every one of
    // them again, about their machine rather than the sender's.
    //
    // Named directories were listed here one at a time until a spelling drifted: the snapshots are
    // written to `.nlstudio/devmode` and the list said `.nlstudio/dev-mode`, so every package
    // carried a full copy of the project's documents at whatever revision the author last ran.
    // `revisionSnapshot.test.ts` holds the writer's own path against this predicate for that reason;
    // excluding the directory whole is what makes the next such directory right by default.
    if (segments[0] === ".nlstudio") {
        return true;
    }

    return false;
}

function startsWith(bytes: Uint8Array, magic: Uint8Array): boolean {
    if (bytes.length < magic.length) {
        return false;
    }
    for (let index = 0; index < magic.length; index += 1) {
        if (bytes[index] !== magic[index]) {
            return false;
        }
    }
    return true;
}

function packageProjectName(value: unknown): string {
    return typeof value === "string" && value.trim() ? value : "Imported Project";
}

function normalizePackageBytes(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (Array.isArray(value)) {
        return new Uint8Array(value);
    }
    throw new Error("Project package contains a file entry without binary data.");
}
