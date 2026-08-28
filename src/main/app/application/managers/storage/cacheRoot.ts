import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { CACHE_ROOT_DIR_NAME, CacheNamespace } from "@shared/types/constants";

/**
 * Where everything Studio can re-fetch lives, and how it got there.
 *
 * One root for every {@link CacheNamespace}, decided once per launch. Before this there were
 * three: `<userData>/cache` for most buckets, `%LOCALAPPDATA%/electron-builder/Cache` for the
 * packaging toolchain, and a Zig toolchain that an author looking at the installed application
 * would never find. On this maintainer's machine that was 1.5 GB in three places, only one of
 * which had "narraleaf" anywhere in its path.
 *
 * The root goes **beside the executable** where the platform allows it, so an installed Studio
 * keeps what it downloads inside its own installation - and falls back to userData where it does
 * not, rather than failing or writing somewhere that breaks the application. See
 * {@link appDirectoryCacheCandidate} for what "allows it" means on each platform; the short of it
 * is that only Windows and an unpacked Linux install qualify.
 *
 * Nothing here decides *what* is cached. The rule for that is unchanged and lives on
 * {@link CacheNamespace}: deleting it must cost time, never work. It is what makes the fallback
 * safe to differ from the primary, and what makes a root that moves between launches - a Windows
 * update reinstalls into a fresh directory - a slow launch rather than a lost one.
 */

/** Why the root is where it is. Surfaced in the log and in the cache inventory. */
export type CacheRootReason =
    /** Beside the executable, as intended. */
    | "app-directory"
    /** The application directory exists but refused a write: a per-machine install, a locked ACL. */
    | "app-directory-read-only"
    /** The platform has no writable application directory at all; see the notes below. */
    | "app-directory-unsupported"
    /** Development, where the application directory is the checkout. */
    | "development";

export type CacheRootResolution = {
    root: string;
    reason: CacheRootReason;
};

export type CacheRootInput = {
    packaged: boolean;
    userDataDir: string;
    /** Defaults to the running process; a parameter so the resolution is testable. */
    execPath?: string;
    platform?: NodeJS.Platform;
    /** `process.env.APPIMAGE` - set only when running from an AppImage. */
    appImage?: string | undefined;
    /** Defaults to {@link probeWritable}. */
    isWritable?: (dir: string) => boolean;
};

/**
 * The application directory's cache root, or null where writing into it is not allowed.
 *
 * Three platforms, three different answers, and the two refusals are rules rather than probes
 * because in both cases a probe would succeed and the damage would come later:
 *
 *   - **macOS** never qualifies. The application directory is inside `NarraLeaf Studio.app`, and
 *     the bundle carries an ad-hoc signature (`electronFuses.resetAdHocDarwinSignature`) that
 *     covers its contents. Writing into it is perfectly permitted by the filesystem and breaks
 *     the signature, at which point an arm64 Mac refuses to launch the application at all. A
 *     writability probe would report "yes" right up until the first cache write bricked Studio.
 *   - **A Linux AppImage** never qualifies. The mount is read-only, so a probe would refuse it
 *     anyway - but it would refuse it for the wrong reason. The mount point is a fresh
 *     `/tmp/.mount_*` on every launch, so even a writable one would be a cache that never hits.
 *   - **Development** never qualifies. The application directory is the checkout; a few hundred
 *     megabytes of Zig belongs no more in a working tree than a build output does. Development
 *     keeps the userData root, which `setupUserDataDir` has already pointed at `.dev/temp`.
 *
 * What is left - Windows, and a Linux install unpacked to a real directory - is probed rather
 * than assumed, because a per-machine Windows install lands under Program Files and is not
 * writable by the user running it.
 */
export function appDirectoryCacheCandidate(input: CacheRootInput): string | null {
    const platform = input.platform ?? process.platform;
    if (!input.packaged || platform === "darwin") {
        return null;
    }
    if (platform === "linux" && (input.appImage ?? process.env.APPIMAGE)) {
        return null;
    }
    return path.join(path.dirname(input.execPath ?? process.execPath), CACHE_ROOT_DIR_NAME);
}

/**
 * Whether a directory can be created and written to.
 *
 * An actual write, not `fs.access(W_OK)`: on Windows that call reports only the read-only
 * attribute and says nothing about the ACL, so it answers "writable" for Program Files.
 */
export function probeWritable(dir: string): boolean {
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(probe, "");
        return true;
    } catch {
        return false;
    } finally {
        try {
            fs.rmSync(probe, { force: true });
        } catch {
            // The probe file is 0 bytes and named after this process; leaving one behind on a
            // filesystem that let us create it but not remove it is not worth failing over.
        }
    }
}

/** The fallback root, and the only root a development or macOS Studio ever uses. */
export function userDataCacheRoot(userDataDir: string): string {
    return path.join(userDataDir, CACHE_ROOT_DIR_NAME);
}

/**
 * Where `<userData>/cache` used to be.
 *
 * Kept as a named function rather than inlined into the migration, because on Windows and on a
 * default macOS filesystem this path *is* `<userData>/Cache` - Chromium's HTTP cache - and every
 * reader of it has to be written knowing that. {@link migrateLegacyCacheRoot} is the only caller
 * and it removes named children, never the directory.
 */
export function legacyCacheRoot(userDataDir: string): string {
    return path.join(userDataDir, "cache");
}

export function resolveCacheRoot(input: CacheRootInput): CacheRootResolution {
    const candidate = appDirectoryCacheCandidate(input);
    if (candidate === null) {
        return {
            root: userDataCacheRoot(input.userDataDir),
            reason: input.packaged ? "app-directory-unsupported" : "development",
        };
    }
    if ((input.isWritable ?? probeWritable)(candidate)) {
        return { root: candidate, reason: "app-directory" };
    }
    return { root: userDataCacheRoot(input.userDataDir), reason: "app-directory-read-only" };
}

/** Reads for the log line, so a support bundle says where this machine put its caches and why. */
export function describeCacheRoot(resolution: CacheRootResolution): string {
    switch (resolution.reason) {
        case "app-directory":
            return `Cache root: ${resolution.root} (application directory)`;
        case "app-directory-read-only":
            return `Cache root: ${resolution.root} (user data; the application directory is not writable)`;
        case "app-directory-unsupported":
            return `Cache root: ${resolution.root} (user data; this platform has no writable application directory)`;
        case "development":
            return `Cache root: ${resolution.root} (user data; development build)`;
    }
}

/**
 * Move what the old `<userData>/cache` holds into the resolved root, once, at startup.
 *
 * Two things make this narrower than it looks. It moves **only the directories this build knows
 * by name**, because the directory it is reading is Chromium's `Cache` on two of the three
 * platforms and deleting an unrecognised child would be deleting Chromium's index. And it falls
 * back to deleting rather than copying when a rename will not do, because a rename across volumes
 * fails (`<userData>` on C:, the application on D: - exactly this maintainer's layout) and
 * copying 300 MB of Zig at startup to save one download is the wrong trade. Everything here is by
 * definition re-fetchable; the migration exists to stop the old copy occupying disk that nothing
 * will ever read again, not to preserve it.
 *
 * Returns the number of buckets it dealt with, for the log. Never throws: a machine that cannot
 * complete this still has a working cache root, it just also has an old directory in it.
 */
export async function migrateLegacyCacheRoot(
    userDataDir: string,
    cacheRoot: string,
    log?: (message: string) => void,
): Promise<number> {
    const legacy = legacyCacheRoot(userDataDir);
    if (path.resolve(legacy) === path.resolve(cacheRoot)) {
        return 0;
    }
    let handled = 0;
    for (const bucket of Object.values(CacheNamespace)) {
        const from = path.join(legacy, bucket);
        if (!await exists(from)) {
            continue;
        }
        const to = path.join(cacheRoot, bucket);
        const moved = !await exists(to) && await rename(from, to);
        if (!moved) {
            // Either the destination already holds this bucket (a second migration, or a root
            // that moved back and forth) or the rename crossed a volume. Both mean the old copy
            // is redundant, and it is a cache.
            await fsp.rm(from, { recursive: true, force: true }).catch(() => undefined);
        }
        handled += 1;
        log?.(moved ? `Moved ${bucket} to ${to}` : `Discarded the previous ${bucket} cache at ${from}`);
    }
    // Only when it is empty, and never recursively: on Windows this is Chromium's own directory.
    await fsp.rmdir(legacy).catch(() => undefined);
    return handled;
}

async function exists(target: string): Promise<boolean> {
    return await fsp.stat(target).then(() => true).catch(() => false);
}

async function rename(from: string, to: string): Promise<boolean> {
    try {
        await fsp.mkdir(path.dirname(to), { recursive: true });
        await fsp.rename(from, to);
        return true;
    } catch {
        return false;
    }
}
