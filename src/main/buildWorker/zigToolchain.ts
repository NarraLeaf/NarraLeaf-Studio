import { path7za } from "7zip-bin";
import { execFile } from "child_process";
import { createHash } from "crypto";
import type { Dirent } from "fs";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { CacheNamespace, UserDataNamespace } from "@shared/types/constants";
import { readBodyWithProgress } from "@shared/types/downloadProgress";
import type { DownloadRewriteRule } from "@shared/types/downloadSource";
import { describeRewrite, rewriteDownloadUrl } from "@shared/utils/downloadSource";
import { reportDownload } from "./downloadReporting";

/**
 * Fetches a Zig toolchain the first time a build needs one, and caches it.
 *
 * Zig is a C toolchain that cross-compiles: one download on any host produces native objects for
 * every desktop target Studio builds for, which is the whole reason it is here rather than a
 * platform SDK per platform. Nothing ships it - a machine that has never built has no copy, and
 * asking an author to install one by hand before their first build is a wall in front of a feature
 * they did not know they were using.
 *
 * Shaped after `ensureWinCodeSignCache`, which solves the same problem for the code-signing bundle:
 * a pinned checksum, a cache under a known root, a mirror resolved as "what the author set, then
 * what the host's environment says, then the official source", and an extraction into a staging
 * directory that is renamed into place only once it is complete. That last part is what makes the
 * existence check at the top a sufficient one - a directory under this name is a finished toolchain
 * or it is not there, never a half-extracted tree a later build would try to compile with.
 *
 * Deliberately Electron-free, like the rest of this directory: `userDataDir` arrives as an argument
 * so this can run in either build worker or on the main process, and the author's download rewrites
 * arrive as data for the same reason.
 *
 * ## Why it is pruned
 *
 * The published tree is 382 MB extracted, and the great majority of it is C headers for platforms
 * this never targets and a standard-library documentation set nothing reads. What actually builds
 * all four desktop targets is 311 MB, and the difference is a third of the disk the author gives up
 * for a compiler they did not ask for. The kept set below is the one that was measured, not the one
 * that looked plausible - see {@link PRUNED_LEVELS}.
 */

const execFileAsync = promisify(execFile);

/** The version every build compiles with; changing it invalidates the cache directory by name. */
export const ZIG_VERSION = "0.16.0";

/** Where the official archives live. `<base><version>/<archive>`. */
const DEFAULT_ZIG_MIRROR = "https://ziglang.org/download/";

/**
 * Set on a host that reaches the network through somewhere else, and honoured below the Studio
 * setting.
 *
 * Named for this product rather than borrowed, because Zig publishes no environment variable for
 * this the way electron-builder does - an existing name would be one this respects and nothing else
 * sets, which is worse than a name that says who reads it.
 */
const ZIG_MIRROR_ENV = "NARRALEAF_ZIG_MIRROR";

/**
 * One published build, as `https://ziglang.org/download/index.json` describes it.
 *
 * Pinned here rather than resolved from that index at build time, for the reason every other
 * download in Studio is pinned: an index fetched at the moment of use decides both what to download
 * AND what it should hash to, so whoever serves the index decides what runs on the author's machine.
 * A digest in the source is a digest a mirror cannot talk its way past.
 */
type ZigRelease = {
    /** File name under `<mirror><version>/`. */
    archive: string;
    /** sha256, as ziglang.org publishes it. */
    sha256: string;
    /** Compressed bytes, used only to sanity-check the readout - never to decide anything. */
    bytes: number;
};

/**
 * Keyed `<process.platform>-<process.arch>`: which build runs on THIS machine.
 *
 * Not which platform is being built for. Zig cross-compiles, so one host toolchain covers every
 * target; a table keyed by target would download a compiler per platform in the request and use all
 * but one of them for nothing.
 */
const ZIG_RELEASES: Readonly<Record<string, ZigRelease>> = {
    "win32-x64": {
        archive: `zig-x86_64-windows-${ZIG_VERSION}.zip`,
        sha256: "68659eb5f1e4eb1437a722f1dd889c5a322c9954607f5edcf337bc3684a75a7e",
        bytes: 97217739,
    },
    "win32-arm64": {
        archive: `zig-aarch64-windows-${ZIG_VERSION}.zip`,
        sha256: "aee38316ee4111717900f45dd3130145c39289e105541d737eb8c5ed653c78ef",
        bytes: 93109828,
    },
    "darwin-x64": {
        archive: `zig-x86_64-macos-${ZIG_VERSION}.tar.xz`,
        sha256: "0387557ed1877bc6a2e1802c8391953baddba76081876301c522f52977b52ba7",
        bytes: 57396836,
    },
    "darwin-arm64": {
        archive: `zig-aarch64-macos-${ZIG_VERSION}.tar.xz`,
        sha256: "b23d70deaa879b5c2d486ed3316f7eaa53e84acf6fc9cc747de152450d401489",
        bytes: 52238004,
    },
    "linux-x64": {
        archive: `zig-x86_64-linux-${ZIG_VERSION}.tar.xz`,
        sha256: "70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00",
        bytes: 55478392,
    },
    "linux-arm64": {
        archive: `zig-aarch64-linux-${ZIG_VERSION}.tar.xz`,
        sha256: "ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17",
        bytes: 51211944,
    },
};

/** Names the transfer for the readout; one toolchain per version, so the version is enough. */
const ZIG_TRANSFER_ID = `zig-${ZIG_VERSION}`;

/**
 * What survives the prune, level by level, as paths relative to the toolchain root.
 *
 * A level listed here keeps only the directories it names; a directory kept but not listed again is
 * kept whole. Anything not named goes. Written this way rather than as a list of things to delete
 * because the deletions are open-ended - a future release adds directories, and a keep-list adds
 * them to the prune while a drop-list silently ships them.
 *
 * The set is the one a build was actually run against, and two entries in it are the kind that look
 * removable and are not:
 *
 * - `lib/c` is required. Without it the compiler stops at `unable to load 'c/wchar.zig'`, which
 *   names a file nothing in the target triple suggested.
 * - The header directories are named by CPU FAMILY, not by the triple. It is `x86-linux-gnu`, and
 *   `x86_64-linux-gnu` does not exist; a keep-list written from the triples keeps nothing and every
 *   Linux target fails to find its headers. `zig cc -target <triple> -v -c` prints the search list
 *   a target really uses, which is how this one was settled.
 */
const PRUNED_LEVELS: Readonly<Record<string, { keepFiles: "all" | ReadonlySet<string>; keepDirs: ReadonlySet<string> }>> = {
    "": {
        // The compiler itself and its licence. The documentation tree beside them is not something
        // a build reads, and an author who wants it has the same download this one came from.
        keepFiles: new Set(["zig", "zig.exe", "LICENSE"]),
        keepDirs: new Set(["lib"]),
    },
    "lib": {
        keepFiles: "all",
        keepDirs: new Set(["std", "compiler_rt", "compiler", "include", "libunwind", "c", "libc"]),
    },
    "lib/libc": {
        keepFiles: "all",
        keepDirs: new Set(["darwin", "glibc", "mingw", "include"]),
    },
    "lib/libc/include": {
        keepFiles: "all",
        keepDirs: new Set([
            "any-windows-any",
            "any-darwin-any",
            "any-linux-any",
            "generic-glibc",
            "x86-linux-gnu",
            "x86-linux-any",
            "aarch64-linux-gnu",
            "aarch64-linux-any",
        ]),
    },
};

export type EnsureZigToolchainOptions = {
    /** Electron's userData directory. A parameter so this module stays Electron-free. */
    userDataDir: string;
    /** `build.zigMirror`, as the author set it. Empty or absent means "look at the host, then use the official source". */
    mirror?: string;
    /**
     * The author's download rewrites.
     *
     * Handed over rather than read, because this runs in a build worker with no access to global
     * state - the same reason `pluginBuildDependencies` takes them. A main-process caller passes
     * `currentDownloadRewrites()`, which is what `applyDownloadRewrite` reads.
     */
    rewrites?: readonly DownloadRewriteRule[];
    log?: (level: "info" | "warning" | "error", message: string) => void;
};

/** Base URL for the archives, as "what the author set, then the host, then the official source". */
export function zigMirror(configured?: string): string {
    // The Studio setting wins over the environment for the reason the binaries mirror gives: it is
    // the one an author can actually reach, and a variable exported on this host years ago should
    // not quietly override what they just typed.
    const mirror = configured?.trim() || process.env[ZIG_MIRROR_ENV]?.trim() || DEFAULT_ZIG_MIRROR;
    return mirror.endsWith("/") ? mirror : `${mirror}/`;
}

/** The cache root; must agree with `cacheInventory`, which is what offers to delete it. */
export function zigCacheRoot(userDataDir: string): string {
    return path.join(userDataDir, UserDataNamespace.Cache, CacheNamespace.Toolchains);
}

/** The executable inside a toolchain directory. */
export function zigExecutablePath(toolchainDir: string): string {
    return path.join(toolchainDir, process.platform === "win32" ? "zig.exe" : "zig");
}

/**
 * The Zig executable for this host, downloading and unpacking one if this machine has none.
 *
 * Returns the absolute path of the binary. Throws where a toolchain cannot be had - an unsupported
 * host, a download that failed, an archive whose digest is not the pinned one - because the caller's
 * only alternative to a compiler is not building, and a build that carried on without one would fail
 * later somewhere that says nothing about the cause.
 */
export async function ensureZigToolchain(options: EnsureZigToolchainOptions): Promise<string> {
    const { userDataDir, log } = options;
    const hostKey = `${process.platform}-${process.arch}`;
    const release = ZIG_RELEASES[hostKey];
    if (!release) {
        throw new Error(
            `No Zig ${ZIG_VERSION} build is published for this machine (${hostKey}). `
            + "Building from protected sources needs one.",
        );
    }

    const finalDir = path.join(zigCacheRoot(userDataDir), `zig-${ZIG_VERSION}`);
    const executable = zigExecutablePath(finalDir);
    // The directory only ever appears complete - it is renamed into place - so its presence is the
    // whole check. The executable rather than the directory, so a tree somebody emptied by hand is
    // rebuilt instead of handed back.
    if (await exists(executable)) {
        return executable;
    }

    const url = `${zigMirror(options.mirror)}${ZIG_VERSION}/${release.archive}`;
    const outcome = rewriteDownloadUrl(url, options.rewrites ?? []);
    const rewriteLine = describeRewrite(url, outcome);
    if (rewriteLine) {
        log?.("info", rewriteLine);
    }
    log?.("info", `fetching the Zig ${ZIG_VERSION} toolchain (${release.archive})`);

    const stagingDir = `${finalDir}.staging-${process.pid}-${Date.now()}`;
    const archivePath = `${stagingDir}${path.extname(release.archive)}`;
    try {
        await fs.mkdir(path.dirname(finalDir), { recursive: true });
        await fs.writeFile(archivePath, await downloadArchive(outcome.url, url, release));
        await extractArchive(archivePath, stagingDir);
        const root = await singleTopLevelDirectory(stagingDir);
        await pruneToolchain(root);
        if (!await exists(zigExecutablePath(root))) {
            throw new Error(`the ${release.archive} archive holds no zig executable`);
        }
        if (process.platform !== "win32") {
            // Set rather than trusted: whether the extractor carried the tar's permission bits
            // across depends on which 7-Zip build the host has, and a compiler without its execute
            // bit fails at the point of use with a message about permissions rather than about a
            // toolchain that was unpacked wrong.
            await fs.chmod(zigExecutablePath(root), 0o755);
        }
        try {
            await fs.rename(root, finalDir);
        } catch (error) {
            // Lost a race against another build provisioning the same version; theirs is as good as
            // this one would have been, so long as it really is there.
            if (!await exists(executable)) {
                throw error;
            }
        }
        log?.("info", `Zig ${ZIG_VERSION} is ready`);
        return executable;
    } finally {
        await fs.rm(archivePath, { force: true }).catch(() => undefined);
        await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

/**
 * @param url The address to fetch, after any rewrite.
 * @param declaredUrl The address the pin names, which is what an error should say - a reader can
 *                    look that one up, and the rewrite that redirected it is logged separately.
 */
async function downloadArchive(url: string, declaredUrl: string, release: ZigRelease): Promise<Buffer> {
    reportDownload({ phase: "start", id: ZIG_TRANSFER_ID, kind: "toolchainDownload" });
    let buffer: Buffer;
    try {
        const response = await fetch(url).catch((error: unknown) => {
            throw new Error(`could not download ${declaredUrl} (${messageOf(error)})`);
        });
        if (!response.ok) {
            throw new Error(`download of ${declaredUrl} failed with HTTP ${response.status}`);
        }
        // Chunk by chunk: this is ninety megabytes, and `arrayBuffer()` would leave the status bar
        // with nothing to say for the whole of it. The declared size is the fallback total for a
        // server that sends no content length, and never overrides one that does.
        buffer = await readBodyWithProgress(response, (done, total) => {
            reportDownload({ phase: "advance", id: ZIG_TRANSFER_ID, done, total: total ?? release.bytes });
        });
    } finally {
        // Closed either way: a transfer that failed is one that is no longer happening, and the
        // reason travels as the thrown error rather than as a task stuck on the strip.
        reportDownload({ phase: "end", id: ZIG_TRANSFER_ID });
    }
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== release.sha256) {
        // Nothing has been written under the cache name yet, so there is no half-good toolchain for
        // the next build to pick up and compile with.
        throw new Error(
            `${declaredUrl} has sha256 ${digest}, not the pinned ${release.sha256}; nothing was cached`,
        );
    }
    return buffer;
}

/**
 * Unpack the archive into `into`, whichever of the two published formats it is.
 *
 * Both go through the bundled 7za rather than a host `tar` or `unzip`: it is the extractor this
 * directory already depends on, and it is present on every host by construction - which `xz`, which
 * a `.tar.xz` needs, is not.
 */
async function extractArchive(archivePath: string, into: string): Promise<void> {
    if (archivePath.endsWith(".zip")) {
        await execFileAsync(path7za, ["x", "-bd", "-y", `-o${into}`, archivePath], { maxBuffer: MAX_7ZA_OUTPUT });
        return;
    }
    // `.tar.xz` is two containers, and 7za unwraps one at a time: the compression first, leaving a
    // `.tar` beside it, then the archive itself.
    const unpackedTarDir = `${into}.tar-stage`;
    try {
        await execFileAsync(path7za, ["x", "-bd", "-y", `-o${unpackedTarDir}`, archivePath], { maxBuffer: MAX_7ZA_OUTPUT });
        const tarName = (await fs.readdir(unpackedTarDir)).find(name => name.endsWith(".tar"));
        if (!tarName) {
            throw new Error(`${path.basename(archivePath)} did not decompress to a tar archive`);
        }
        await execFileAsync(
            path7za,
            ["x", "-bd", "-y", `-o${into}`, path.join(unpackedTarDir, tarName)],
            { maxBuffer: MAX_7ZA_OUTPUT },
        );
    } finally {
        await fs.rm(unpackedTarDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

/** Extracting tens of thousands of files prints more than the default 1 MB of chatter. */
const MAX_7ZA_OUTPUT = 32 * 1024 * 1024;

/**
 * The one directory the archive holds, which is the toolchain root.
 *
 * Every published archive wraps its tree in `zig-<target>-<version>/`. Reading the name from disk
 * rather than composing it keeps this working if that convention shifts, and refusing anything else
 * keeps a surprise from being renamed into place as though it were a toolchain.
 */
async function singleTopLevelDirectory(dir: string): Promise<string> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const directories = entries.filter(entry => entry.isDirectory());
    if (directories.length !== 1) {
        throw new Error(
            `expected one directory inside the Zig archive, found ${directories.length}`,
        );
    }
    return path.join(dir, directories[0].name);
}

/**
 * Delete everything {@link PRUNED_LEVELS} does not keep.
 *
 * Exported for its tests, which walk a stand-in tree: verifying this against a real 382 MB download
 * would make the test a network fetch, and what is being checked is the rule rather than the
 * archive.
 */
export async function pruneToolchain(root: string, relative = ""): Promise<void> {
    const rule = PRUNED_LEVELS[relative];
    if (!rule) {
        return;
    }
    const dir = relative ? path.join(root, relative) : root;
    let entries: Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        const kept = entry.isDirectory()
            ? rule.keepDirs.has(entry.name)
            : rule.keepFiles === "all" || rule.keepFiles.has(entry.name);
        if (!kept) {
            await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
            continue;
        }
        if (entry.isDirectory()) {
            // A kept directory that is itself a pruned level; one that is not returns immediately.
            await pruneToolchain(root, childRelative);
        }
    }
}

async function exists(target: string): Promise<boolean> {
    return await fs.access(target).then(() => true).catch(() => false);
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
