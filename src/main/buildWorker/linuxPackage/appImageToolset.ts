import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import zlib from "zlib";
import { CacheNamespace } from "@shared/types/constants";
import { readBodyWithProgress } from "@shared/types/downloadProgress";
import type { DownloadRewriteRule } from "@shared/types/downloadSource";
import { describeRewrite, rewriteDownloadUrl } from "@shared/utils/downloadSource";
import { reportDownload } from "../downloadReporting";
import { binariesMirror } from "../winCodeSignCache";
import type { SquashfsEntry } from "./squashfs";

/**
 * The AppImage runtime and bundled libraries, fetched for a host electron-builder cannot build an
 * AppImage on.
 *
 * An AppImage is a small static executable - the runtime, which mounts what follows it and runs
 * `AppRun` - with a squashfs image appended. electron-builder takes both the runtime and a handful of
 * libraries it puts in the image's `usr/lib` from one archive in its binaries repository, which it
 * downloads itself when it builds an AppImage on Linux or macOS. On Windows nothing downloads it, so
 * this does: the same archive, from the same release, pinned to the same checksum electron-builder
 * pins, through the same mirror setting the rest of electron-builder's downloads honour.
 *
 * ## Where it is kept, and why it is not unpacked
 *
 * In electron-builder's own download cache (`ELECTRON_BUILDER_CACHE`, which the build worker is
 * started with, else Studio's cache root), under the path electron-builder itself caches the archive
 * at: `appimage@<version>/<archive>`. That is the bucket the cache inventory already measures and
 * clears for "electron-builder's downloads", and it means an archive electron-builder fetched and
 * one fetched here are the same file in the same place.
 *
 * The archive stays packed and is read in memory each time. Unpacked onto NTFS it would lose exactly
 * what matters about it: the libraries are reached through symbolic links (`libXss.so.1 ->
 * libXss.so.1.0.0`) and carry their own modes, and the image has to contain them as electron-builder
 * would copy them on a POSIX host. Twelve megabytes take a moment to inflate.
 */

/** The toolset electron-builder means by `toolsets: { appimage: "1.0.3" }`. */
export const APPIMAGE_TOOLSET_VERSION = "1.0.3";

/**
 * The archive, as pinned in `app-builder-lib/out/toolsets/linux.js` (`appimageChecksums`). A test
 * holds this to the installed electron-builder, so the two cannot drift apart unnoticed.
 */
export const APPIMAGE_TOOLSET_ARCHIVE = {
    release: `appimage@${APPIMAGE_TOOLSET_VERSION}`,
    file: "appimage-tools-runtime-20251108.tar.gz",
    sha256: "84021a78ee214ae6fd33a2d62a92ba25542dd10bc86bf117a9b2d0bba44e7665",
    /** Compressed bytes, only for the progress readout when a server sends no length. */
    bytes: 11979282,
} as const;

/** The architectures an AppImage is built for, in Studio's vocabulary. */
export type AppImageArch = "x64" | "arm64";

/**
 * What the archive provides for one architecture.
 *
 * The toolset also carries `mksquashfs`, `desktop-file-validate` and their libraries for Linux and
 * macOS hosts; none of it is any use here, where the image is written by `squashfs.ts`.
 */
export type AppImageToolset = {
    /** The static runtime executable an AppImage begins with. */
    runtime: Buffer;
    /** The toolset's `lib/<arch>`, as entries under `usr/lib`, symbolic links and modes as archived. */
    libraries: SquashfsEntry[];
};

export type EnsureAppImageToolsetOptions = {
    /** Studio's cache root, `App.getCacheRootDir()`. A parameter so this module stays Electron-free. */
    cacheRoot: string;
    /** `electronBuilderBinariesMirror` from the worker config. Empty or absent means the official source. */
    mirror?: string;
    /** The author's download rewrites, handed over for the reason `zigToolchain` takes them. */
    rewrites?: readonly DownloadRewriteRule[];
    log?: (level: "info" | "warning" | "error", message: string) => void;
};

/**
 * The cached archive's path. Must agree with `electronBuilderCacheRoot` in `cacheInventory.ts`,
 * which is what measures and offers to clear it; that module cannot be imported here because it
 * reaches for Electron.
 */
export function appImageToolsetArchivePath(cacheRoot: string): string {
    const builderCache = process.env.ELECTRON_BUILDER_CACHE?.trim() || path.join(cacheRoot, CacheNamespace.ElectronBuilder);
    return path.join(builderCache, APPIMAGE_TOOLSET_ARCHIVE.release, APPIMAGE_TOOLSET_ARCHIVE.file);
}

/** Where the archive is fetched from, mirror applied: `<mirror><release>/<archive>`, as electron-builder builds it. */
export function appImageToolsetUrl(mirror?: string): string {
    return `${binariesMirror(mirror)}${APPIMAGE_TOOLSET_ARCHIVE.release}/${APPIMAGE_TOOLSET_ARCHIVE.file}`;
}

/** Names the transfer for the readout. */
const TRANSFER_ID = `appimage-tools-${APPIMAGE_TOOLSET_VERSION}`;

/**
 * The verified archive's bytes, downloading it first if this machine has no good copy.
 *
 * A cached copy is hashed every time it is used rather than trusted for being there: it is twelve
 * megabytes, the hash costs less than inflating it, and a copy that has been damaged or replaced is
 * then fetched again instead of becoming the first thing every AppImage runs.
 */
export async function ensureAppImageToolset(options: EnsureAppImageToolsetOptions): Promise<Buffer> {
    const { log } = options;
    const archivePath = appImageToolsetArchivePath(options.cacheRoot);
    const cached = await fs.readFile(archivePath).catch(() => null);
    if (cached && sha256(cached) === APPIMAGE_TOOLSET_ARCHIVE.sha256) {
        return cached;
    }
    if (cached) {
        log?.("warning", `the cached AppImage toolset at ${archivePath} does not match its checksum; fetching it again`);
    }

    const url = appImageToolsetUrl(options.mirror);
    const outcome = rewriteDownloadUrl(url, options.rewrites ?? []);
    const rewriteLine = describeRewrite(url, outcome);
    if (rewriteLine) {
        log?.("info", rewriteLine);
    }
    log?.("info", `fetching the AppImage toolset ${APPIMAGE_TOOLSET_VERSION} (${APPIMAGE_TOOLSET_ARCHIVE.file})`);
    const archive = await downloadArchive(outcome.url, url);

    // Written beside its final name and renamed into place, so the path only ever holds a whole
    // archive - a build cut off mid-write leaves a stray temporary file, not a short archive.
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    const staging = `${archivePath}.staging-${process.pid}-${Date.now()}`;
    try {
        await fs.writeFile(staging, archive);
        await fs.rename(staging, archivePath);
    } catch (error) {
        // Caching is a convenience; this build has the verified bytes either way.
        log?.("warning", `could not cache the AppImage toolset (${messageOf(error)})`);
    } finally {
        await fs.rm(staging, { force: true }).catch(() => undefined);
    }
    return archive;
}

/**
 * @param url The address to fetch, after any rewrite.
 * @param declaredUrl The address before it, which is what an error names.
 */
async function downloadArchive(url: string, declaredUrl: string): Promise<Buffer> {
    reportDownload({ phase: "start", id: TRANSFER_ID, kind: "toolchainDownload" });
    let buffer: Buffer;
    try {
        const response = await fetch(url).catch((error: unknown) => {
            throw new Error(`could not download ${declaredUrl} (${messageOf(error)})`);
        });
        if (!response.ok) {
            throw new Error(`download of ${declaredUrl} failed with HTTP ${response.status}`);
        }
        buffer = await readBodyWithProgress(response, (done, total) => {
            reportDownload({ phase: "advance", id: TRANSFER_ID, done, total: total ?? APPIMAGE_TOOLSET_ARCHIVE.bytes });
        });
    } finally {
        reportDownload({ phase: "end", id: TRANSFER_ID });
    }
    const digest = sha256(buffer);
    if (digest !== APPIMAGE_TOOLSET_ARCHIVE.sha256) {
        throw new Error(`${declaredUrl} has sha256 ${digest}, not the pinned ${APPIMAGE_TOOLSET_ARCHIVE.sha256}; nothing was cached`);
    }
    return buffer;
}

/** The runtime and libraries for one architecture, read out of the archive. */
export async function readAppImageToolset(archive: Buffer, arch: AppImageArch): Promise<AppImageToolset> {
    const tar = await promisify(zlib.gunzip)(archive);
    // The toolset's own names for the architectures, from `getAppImageTools`.
    const runtimePath = `runtimes/runtime-${arch}`;
    const libraryDir = `lib/${arch}/`;
    let runtime: Buffer | null = null;
    const libraries: SquashfsEntry[] = [];
    for (const entry of readTar(tar)) {
        if (entry.path === runtimePath && entry.type === "file") {
            runtime = entry.data;
            continue;
        }
        if (!entry.path.startsWith(libraryDir) || entry.path === libraryDir) {
            continue;
        }
        const target = `usr/lib/${entry.path.slice(libraryDir.length).replace(/\/$/, "")}`;
        if (entry.type === "file") {
            libraries.push({ kind: "file", path: target, mode: entry.mode, content: entry.data });
        } else if (entry.type === "symlink") {
            libraries.push({ kind: "symlink", path: target, target: entry.linkName });
        } else if (entry.type === "directory") {
            libraries.push({ kind: "directory", path: target, mode: entry.mode });
        }
    }
    if (!runtime) {
        throw new Error(`the AppImage toolset has no ${runtimePath}`);
    }
    if (libraries.length === 0) {
        throw new Error(`the AppImage toolset has nothing under ${libraryDir}`);
    }
    return { runtime, libraries };
}

export type TarEntry = {
    /** Relative, `/`-separated, without a leading `./`; a directory's ends in `/` as archived. */
    path: string;
    type: "file" | "directory" | "symlink" | "other";
    /** Permission bits. */
    mode: number;
    linkName: string;
    data: Buffer;
};

/**
 * The entries of an uncompressed tar archive.
 *
 * Enough of the format for what GNU tar and libarchive write: ustar headers with their name prefix,
 * GNU long names and long link names, and pax `path` / `linkpath` records. Hard links, devices and
 * the rest are reported as `other`.
 *
 * Written out here rather than taken from the `tar` package, which is in `node_modules` only because
 * electron-builder depends on it: bundling a package Studio does not declare is bundling whichever
 * version the next lockfile happens to resolve.
 */
export function* readTar(archive: Buffer): Generator<TarEntry> {
    let at = 0;
    let longName: string | null = null;
    let longLink: string | null = null;
    let paxPath: string | null = null;
    let paxLink: string | null = null;
    while (at + 512 <= archive.length) {
        const header = archive.subarray(at, at + 512);
        if (header.every(byte => byte === 0)) {
            break;
        }
        checkHeaderChecksum(header, at);
        const size = readNumber(header.subarray(124, 136));
        const typeFlag = String.fromCharCode(header[156] || 0x30);
        const dataStart = at + 512;
        const data = archive.subarray(dataStart, dataStart + size);
        if (data.length !== size) {
            throw new Error("the tar archive ends inside an entry");
        }
        at = dataStart + Math.ceil(size / 512) * 512;

        if (typeFlag === "L") {
            longName = cString(data);
            continue;
        }
        if (typeFlag === "K") {
            longLink = cString(data);
            continue;
        }
        if (typeFlag === "x") {
            const records = paxRecords(data);
            paxPath = records.get("path") ?? paxPath;
            paxLink = records.get("linkpath") ?? paxLink;
            continue;
        }
        if (typeFlag === "g") {
            continue;
        }

        const isUstar = header.subarray(257, 262).toString("latin1") === "ustar";
        const prefix = isUstar && header[262] === 0 ? cString(header.subarray(345, 500)) : "";
        const ownName = cString(header.subarray(0, 100));
        const name = paxPath ?? longName ?? (prefix ? `${prefix}/${ownName}` : ownName);
        const linkName = paxLink ?? longLink ?? cString(header.subarray(157, 257));
        longName = longLink = paxPath = paxLink = null;

        yield {
            path: name.replace(/^(\.\/)+/, ""),
            type: typeFlag === "0" || typeFlag === "7"
                ? "file"
                : typeFlag === "5" ? "directory" : typeFlag === "2" ? "symlink" : "other",
            mode: readNumber(header.subarray(100, 108)) & 0o7777,
            linkName,
            data,
        };
    }
}

function checkHeaderChecksum(header: Buffer, at: number): void {
    let sum = 0;
    for (let i = 0; i < 512; i++) {
        sum += i >= 148 && i < 156 ? 0x20 : header[i];
    }
    if (sum !== readNumber(header.subarray(148, 156))) {
        throw new Error(`the tar header at byte ${at} fails its checksum`);
    }
}

/** An octal field, or GNU's base-256 form for values too large for one. */
function readNumber(field: Buffer): number {
    if (field[0] & 0x80) {
        let value = field[0] & 0x7f;
        for (let i = 1; i < field.length; i++) {
            value = value * 256 + field[i];
        }
        return value;
    }
    const text = cString(field).trim();
    return text === "" ? 0 : parseInt(text, 8);
}

function cString(bytes: Buffer): string {
    const end = bytes.indexOf(0);
    return bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
}

/** `<length> <key>=<value>\n` records, the length counting the whole record. */
function paxRecords(data: Buffer): Map<string, string> {
    const records = new Map<string, string>();
    let at = 0;
    while (at < data.length) {
        const space = data.indexOf(0x20, at);
        if (space === -1) {
            break;
        }
        const length = parseInt(data.subarray(at, space).toString("latin1"), 10);
        if (!(length > 0)) {
            break;
        }
        const record = data.subarray(space + 1, at + length - 1).toString("utf8");
        const equals = record.indexOf("=");
        if (equals > 0) {
            records.set(record.slice(0, equals), record.slice(equals + 1));
        }
        at += length;
    }
    return records;
}

function sha256(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
