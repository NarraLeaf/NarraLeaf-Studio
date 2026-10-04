import crypto from "crypto";
import mountedFs from "fs/promises";
import os from "os";
import path from "path";
import { openAssetArchive, ASSET_ARCHIVE_FILENAME, ARCHIVE_READER_FILENAME } from "@narraleaf/bindings/read";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { GAME_RUNTIME_BUNDLE_PACK_ENTRY, RUNTIME_HOST_FILE_PREFIXES } from "@shared/utils/gameRuntimeBundle";
import { unpatchedFsPromises as fs } from "../../../../utils/unpatchedFs";

/**
 * Reading a compiled app directory's payload back out, entry by entry.
 *
 * A patch is made of the same entries a build's payload is made of, addressed by
 * the same names, so producing one means reading a payload the compiler has just
 * written and sealing the parts of it that changed. This is also how the baseline
 * side is read - the build the patch is for is an app directory too - which is
 * why one reader serves both and neither can drift from the other.
 *
 * Which shape the directory is in is decided by looking at it, never by being
 * told, the same way the shipped game and the content audit decide.
 *
 * ## Reading a build leaves nothing of it held
 *
 * What gets read here is a build folder, and the next thing an author does with
 * one is build into it again - which deletes everything in it first. On Windows a
 * file a process still holds cannot be deleted, so anything this kept would fail
 * that build, for as long as the process holding it ran. Two things hold a build:
 *
 * - **Electron's patched `fs`**, which is what reads inside a packaged build's
 *   `app.asar` - and keeps every archive it has opened open until the process exits.
 *   Nothing releases one, and `process.noAsar` only makes the inside unreadable. So
 *   a packaged build is read only in a process that exits once it has answered: the
 *   artifact compile worker (`readBuildPayloadInWorker`). In Studio's main process
 *   {@link openPayload} refuses one before touching it.
 * - **The native reader a sealed payload carries**, which has to be loaded to read
 *   it, and a loaded module stays loaded. From a compiled app directory it is
 *   loaded from Studio's own copy ({@link payloadReaderCopy}), never from the
 *   directory, so the staging folders a patch or DLC export compiles into stay free
 *   to be compiled into again. A packaged build's reader is loaded where it lies,
 *   which is only ever in the worker.
 */

/**
 * The directories a payload carries besides the descriptor and the assets.
 *
 * Exactly the ones the runtime serves the page from, and derived from the runtime's own list rather
 * than written out: this was a second copy, and when compiled scripts joined that list they did not
 * join this one, so a patch for an unprotected build left a changed script behind and the installed
 * game kept running the old one.
 */
const PAYLOAD_FILE_PREFIXES = RUNTIME_HOST_FILE_PREFIXES.map(prefix => prefix.replace(/\/+$/, ""));

export interface PayloadReader {
    /** The pack descriptor, already parsed - callers need it to name the assets. */
    pack: GameRuntimePackV1;
    /** Every entry name in this payload, in a stable order. */
    names: string[];
    read(name: string): Promise<Buffer>;
    close(): Promise<void>;
}

/** What a payload's descriptor is called on disk, in the shape that keeps it loose. */
const PACK_FILE = "pack.json";

/**
 * Where a payload's entries are read from, by path: a compiled app directory, or a packaged build's
 * archive seen through Electron's patch, which serves the inside of one as if it were a directory.
 */
interface PayloadLocation {
    readonly path: string;
    /** Whether {@link path} is an archive, which only the patched `fs` can see into. */
    readonly mounted: boolean;
}

/** The `fs` that reads inside `location`: the patched one only where there is an archive to see into. */
function fsFor(location: PayloadLocation): typeof fs {
    return location.mounted ? mountedFs : fs;
}

/** Whether a process that reads inside an archive will go on running afterwards, and keep it open. */
function processKeepsArchivesOpen(): boolean {
    // `browser` is Electron's name for the main process. The artifact compile worker is `utility`,
    // and a plain node process (a test) has no patch to keep anything.
    return (process as { type?: string }).type === "browser";
}

async function fileHasContent(location: PayloadLocation, name: string): Promise<boolean> {
    try {
        const stats = await fsFor(location).stat(path.join(location.path, name));
        return stats.isFile() && stats.size > 0;
    } catch {
        return false;
    }
}

/**
 * `candidate` as a place a payload could be, when it holds one; null when it does not.
 *
 * Whether it holds one is asked by looking for something the payload always has - which also
 * separates this game's payload from any other package. A folder is asked with the unpatched `fs`.
 * An archive can only be asked with the patched one, from inside, because asking about the archive
 * path with nothing after it does not resolve to a file or to an entry.
 */
async function payloadAt(candidate: string): Promise<PayloadLocation | null> {
    const stats = await fs.stat(candidate).catch(() => null);
    if (!stats) {
        return null;
    }
    let location: PayloadLocation;
    if (stats.isDirectory()) {
        location = { path: candidate, mounted: false };
    } else if (stats.isFile()) {
        if (processKeepsArchivesOpen()) {
            // A single look inside would hold the archive until Studio exits, and with it the build.
            throw new Error(
                `${candidate} is a packaged build, which Studio reads in the artifact compile worker `
                + "so that nothing keeps it open; read it with readBuildPayloadInWorker.",
            );
        }
        location = { path: candidate, mounted: true };
    } else {
        return null;
    }
    for (const marker of [PACK_FILE, ASSET_ARCHIVE_FILENAME]) {
        if (await fileHasContent(location, marker)) {
            return location;
        }
    }
    return null;
}

/**
 * Find a build's payload from whatever the author pointed at.
 *
 * What an author has after a build is the output folder the packager wrote, and
 * the payload is buried in it differently on every platform: beside the
 * executable on Windows and Linux, three levels inside a bundle on macOS. Asking
 * them to know that, and to browse into a package to reach a file called
 * `app.asar`, is asking them to know how the packager works.
 *
 * So every shape resolves here: the output folder, the application bundle, the
 * archive itself, or a compiled app directory. A path that is none of those says
 * what was looked for rather than failing as a missing file.
 */
async function findPayload(target: string): Promise<PayloadLocation> {
    const candidates = [
        // A desktop output folder, and equally an application bundle's Contents.
        path.join(target, "resources", "app.asar"),
        // The bundle itself, if that is what got picked.
        path.join(target, "Contents", "resources", "app.asar"),
        path.join(target, "Contents", "Resources", "app.asar"),
    ];
    // The target itself first: a compiled app directory is what an unprotected
    // build stages, and it is what the payload reader speaks natively.
    for (const candidate of [target, ...candidates]) {
        const found = await payloadAt(candidate);
        if (found) {
            return found;
        }
    }
    // A macOS output folder holds the bundle rather than the payload, and its
    // name is the product's, which this has no way to know.
    const entries = await fs.readdir(target).catch(() => [] as string[]);
    for (const entry of entries) {
        if (!entry.toLowerCase().endsWith(".app")) {
            continue;
        }
        for (const inside of ["resources", "Resources"]) {
            const found = await payloadAt(path.join(target, entry, "Contents", inside, "app.asar"));
            if (found) {
                return found;
            }
        }
    }
    throw new Error(
        `${target} does not look like a build of this game: expected an output folder holding `
        + "resources/app.asar, an application bundle, or a compiled app directory.",
    );
}

/** Where a build's payload is, from whatever the author pointed at; see {@link findPayload}. */
export async function resolvePayloadLocation(target: string): Promise<string> {
    return (await findPayload(target)).path;
}

/** Every file under `root`, as entry names relative to the payload, with `/` separators. */
async function listEntryNames(location: PayloadLocation, root: string): Promise<string[]> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
        entries = await fsFor(location).readdir(path.join(location.path, root), { withFileTypes: true });
    } catch {
        return [];
    }
    const names: string[] = [];
    for (const entry of entries) {
        const child = `${root}/${entry.name}`;
        if (entry.isDirectory()) {
            names.push(...await listEntryNames(location, child));
        } else if (entry.isFile()) {
            names.push(child);
        }
    }
    return names;
}

/**
 * Open a build's payload.
 *
 * In Studio's main process this takes a compiled app directory and refuses a packaged build - see
 * the top of this module; `readBuildPayloadInWorker` reads those.
 *
 * The sealed shape answers for itself: its item table already names every entry.
 * The loose shape is enumerated from the manifest for assets and from disk for
 * the runtime files - from the manifest rather than from the assets directory
 * because the manifest is what a reader addresses an asset by, and a file the
 * manifest does not name is not reachable in the shipped game either.
 */
export async function openPayload(target: string): Promise<PayloadReader> {
    const location = await findPayload(target);
    const files = fsFor(location);
    const bundlePath = path.join(location.path, ASSET_ARCHIVE_FILENAME);
    if (await fileHasContent(location, ASSET_ARCHIVE_FILENAME)) {
        const readerPath = location.mounted
            ? path.join(location.path, ARCHIVE_READER_FILENAME)
            : await payloadReaderCopy(await files.readFile(path.join(location.path, ARCHIVE_READER_FILENAME)));
        const sealed = await openAssetArchive(readerPath, bundlePath);
        try {
            const pack = JSON.parse(
                (await sealed.read(GAME_RUNTIME_BUNDLE_PACK_ENTRY)).toString("utf-8"),
            ) as GameRuntimePackV1;
            return {
                pack,
                names: sealed.names().slice().sort((a, b) => a.localeCompare(b)),
                read: name => sealed.read(name),
                close: () => sealed.close(),
            };
        } catch (error) {
            await sealed.close().catch(() => undefined);
            throw error;
        }
    }

    const pack = JSON.parse(await files.readFile(path.join(location.path, PACK_FILE), "utf-8")) as GameRuntimePackV1;
    const names = [GAME_RUNTIME_BUNDLE_PACK_ENTRY];
    for (const item of Object.values(pack.assets?.items ?? {})) {
        names.push(item.relativePath);
    }
    for (const prefix of PAYLOAD_FILE_PREFIXES) {
        names.push(...await listEntryNames(location, prefix));
    }
    const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b));
    return {
        pack,
        names: unique,
        read: name => files.readFile(path.join(location.path, name === GAME_RUNTIME_BUNDLE_PACK_ENTRY ? PACK_FILE : name)),
        close: async () => {},
    };
}

/**
 * What a build says about itself and, when asked, the digest of every entry it carries - which is
 * all anything outside an export needs of a build: the patch dialog shows the first, and an export
 * compares against the second.
 *
 * One plain answer rather than a reader, because this is what the artifact compile worker sends
 * back across the process boundary for a packaged build.
 */
export interface PayloadSummary {
    pack: GameRuntimePackV1;
    /** Entry name and digest, in the payload's order; absent unless asked for. */
    digests?: Array<[string, string]>;
}

export async function summarizePayload(target: string, options: { digests: boolean }): Promise<PayloadSummary> {
    const payload = await openPayload(target);
    try {
        return {
            pack: payload.pack,
            ...(options.digests ? { digests: [...(await digestPayload(payload)).entries()] } : {}),
        };
    } finally {
        await payload.close().catch(() => undefined);
    }
}

/**
 * Where the native readers sealed payloads carry are copied to before they are loaded.
 *
 * Studio's own folder rather than the payload's, because loading a module pins the file it came from
 * until the process exits (see the top of this module). Under the system temp folder because a copy
 * is only needed by the process that loaded it, and outlives that one only until a later one sweeps it.
 */
export function payloadReaderCopiesRoot(): string {
    return path.join(os.tmpdir(), "narraleaf-payload-readers");
}

/** The readers this process has loaded copies of, by digest. Their copies stay until it exits. */
const readerCopiesInUse = new Set<string>();

/**
 * How long a copy has gone unused before a sweep removes it. Long enough that a copy another Studio
 * has just placed is loaded before it qualifies; a copy still loaded is refused by Windows anyway.
 */
const READER_COPY_SWEEP_AGE_MS = 60 * 60 * 1000;

/**
 * Studio's own copy of a payload's native reader, as a path to load it from.
 *
 * Named by its bytes, so a reader read again - the same staging folder after the next compile, or
 * two payloads of one title - is the same copy, and a process loads one file per reader rather than
 * one per read. The first time a process meets a reader, copies nobody has used for a while are
 * swept away.
 */
export async function payloadReaderCopy(bytes: Buffer, root: string = payloadReaderCopiesRoot()): Promise<string> {
    const digest = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    const file = path.join(root, digest, ARCHIVE_READER_FILENAME);
    const placed = await fs.readFile(file).catch(() => null);
    if (placed?.equals(bytes)) {
        // Marked as in use, so a sweep in another Studio does not take it between here and the load.
        const now = new Date();
        await fs.utimes(file, now, now).catch(() => undefined);
    } else {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const partial = `${file}.${process.pid}.partial`;
        await fs.writeFile(partial, bytes);
        try {
            await fs.rename(partial, file);
        } catch (error) {
            // Another Studio placed the same bytes first and has them loaded, which Windows will not
            // let anything replace. What it placed is this copy.
            await fs.rm(partial, { force: true }).catch(() => undefined);
            if (!(await fs.readFile(file).catch(() => null))?.equals(bytes)) {
                throw error;
            }
        }
    }
    if (!readerCopiesInUse.has(digest)) {
        readerCopiesInUse.add(digest);
        await sweepReaderCopies(root);
    }
    return file;
}

async function sweepReaderCopies(root: string): Promise<void> {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const cutoff = Date.now() - READER_COPY_SWEEP_AGE_MS;
    for (const entry of entries) {
        if (!entry.isDirectory() || readerCopiesInUse.has(entry.name)) {
            continue;
        }
        const dir = path.join(root, entry.name);
        const stats = await fs.stat(path.join(dir, ARCHIVE_READER_FILENAME)).catch(() => fs.stat(dir).catch(() => null));
        if (stats && stats.mtimeMs < cutoff) {
            // Refused for a copy another running Studio has loaded, which keeps it for that one.
            await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
    }
}


/**
 * Entry name -> content digest, for deciding what a patch has to carry.
 *
 * Digests rather than timestamps or sizes: a rebuild rewrites every file, and
 * two different images the same length apart are exactly the case a patch must
 * not miss. Reading the whole baseline is the price, and it is paid once against
 * a directory already on the author's disk.
 */
export async function digestPayload(reader: PayloadReader): Promise<Map<string, string>> {
    const digests = new Map<string, string>();
    for (const name of reader.names) {
        digests.set(name, crypto.createHash("sha256").update(await reader.read(name)).digest("base64"));
    }
    return digests;
}

/**
 * Whether a patch has to carry this entry.
 *
 * The pack descriptor always goes in. It is what a new scene arrives in, it is
 * small next to any asset, and a compile rewrites it every time - so comparing it
 * would only ever answer "changed" while leaving a reader wondering whether it
 * might not have. With no baseline everything goes in, which is always correct
 * and is the answer when the author no longer has the build to compare against.
 *
 * A caller patching a build that composes content deltas carries that difference instead and drops
 * the pack itself; this still answers for it, because whether the pack has to travel at all is a
 * question about the baseline rather than about the entry.
 */
export function patchCarriesEntry(
    name: string,
    digest: string,
    baseline: Map<string, string> | null,
): boolean {
    if (name === GAME_RUNTIME_BUNDLE_PACK_ENTRY || !baseline) {
        return true;
    }
    return baseline.get(name) !== digest;
}
