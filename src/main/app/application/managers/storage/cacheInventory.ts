import type { Dirent } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { session } from "electron";
import { CacheNamespace, UserDataNamespace } from "@shared/types/constants";
import {
    CACHE_BUCKET_IDS,
    type CacheBucketId,
    type CacheBucketReport,
    type CacheClearResult,
    type CacheInventoryReport,
} from "@shared/types/cacheInventory";

/**
 * Measuring and clearing the caches Studio leaves on disk.
 *
 * Deliberately the only place that knows where they are. Before this, three of them were named
 * in the module that happened to write them and two more (Chromium's, electron-builder's) were
 * named nowhere at all, so "how much disk is Studio using" had no answer and "clear it" had no
 * implementation.
 *
 * Sizes are computed on demand rather than tracked: walking the packaging toolchain's downloads
 * is not free and nothing else needs the number, so paying for it when a panel asks is the honest
 * trade.
 */

/**
 * Chromium's own caches under userData. Storage that is not a cache is not listed.
 *
 * `Cache` is the reason the cache root is called `nl-cache` and not `cache`: Windows and the
 * default macOS filesystem cannot tell the two apart, so a root spelled `cache` would put every
 * bucket below inside this entry. It did, until they were renamed - the `browser` bucket then
 * measured the Zig toolchain, the `toolchains` bucket measured it again, and clearing the browser
 * cache deleted every download Studio had ever made.
 */
const BROWSER_CACHE_DIRS = [
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "blob_storage",
];

/** Where `PsdBakeHandler` writes baked layers. See `psdImport.ts`. */
export const PSD_TEMP_DIR_NAME = "narraleaf-psd";

export function psdTempRoot(tempDir: string = os.tmpdir()): string {
    return path.join(tempDir, PSD_TEMP_DIR_NAME);
}

/**
 * electron-builder's download cache: winCodeSign, NSIS, AppImage, and the Electron distribution a
 * cross-platform target needs.
 *
 * Inside Studio's own cache root, which is what `GameBuildManager` sets `ELECTRON_BUILDER_CACHE`
 * to for the build worker. An author who exported that variable for themselves still wins - CI
 * images set it, and a host that has deliberately pointed every electron-builder on it at one
 * shared directory should not find Studio quietly opting out.
 */
export function electronBuilderCacheRoot(cacheRoot: string): string {
    return process.env.ELECTRON_BUILDER_CACHE?.trim() || path.join(cacheRoot, CacheNamespace.ElectronBuilder);
}

/**
 * Where electron-builder puts its downloads when nobody tells it otherwise.
 *
 * Studio no longer writes here, but every Studio before this one did, and on this maintainer's
 * machine that was 377 MB. It stays in the `electronBuilder` bucket - measured and cleared with
 * the rest - so those bytes remain findable rather than becoming an orphan nothing names.
 *
 * Not Studio's directory, which is why it is only ever *listed*: any other electron-builder on
 * the host shares it, and clearing it costs them a re-download and nothing else.
 */
export function hostElectronBuilderCacheRoot(): string | null {
    if (process.platform === "win32") {
        const localAppData = process.env.LOCALAPPDATA?.trim();
        return localAppData ? path.join(localAppData, "electron-builder", "Cache") : null;
    }
    const home = os.homedir();
    if (!home) {
        return null;
    }
    return process.platform === "darwin"
        ? path.join(home, "Library", "Caches", "electron-builder")
        : path.join(home, ".cache", "electron-builder");
}

type BucketDefinition = {
    id: CacheBucketId;
    /** Directories the bucket occupies. Empty means the host has nowhere for it. */
    dirs: string[];
    /** The single path worth showing, when there is one. */
    displayPath: string | null;
    /**
     * Extra work beyond deleting the directories - the browser bucket also has to tell the
     * running session to drop what it is holding in memory, or the files come straight back.
     */
    afterClear?: () => Promise<void>;
};

/** Where the caches are. `cacheRoot` is `App.getCacheRootDir()`; see `cacheRoot.ts`. */
export type CacheLocations = {
    userDataDir: string;
    cacheRoot: string;
};

/** One bucket in the shared cache root, which is all of them bar Chromium's, PSDs and the logs. */
function inRoot(cacheRoot: string, namespace: CacheNamespace): Pick<BucketDefinition, "dirs" | "displayPath"> {
    const dir = path.join(cacheRoot, namespace);
    return { dirs: [dir], displayPath: dir };
}

function bucketDefinitions({ userDataDir, cacheRoot }: CacheLocations): BucketDefinition[] {
    const builderRoot = electronBuilderCacheRoot(cacheRoot);
    const hostBuilderRoot = hostElectronBuilderCacheRoot();
    const browserDirs = BROWSER_CACHE_DIRS.map(name => path.join(userDataDir, name));
    return [
        {
            id: "pluginIcons",
            dirs: [path.join(userDataDir, UserDataNamespace.PluginIcons)],
            displayPath: path.join(userDataDir, UserDataNamespace.PluginIcons),
        },
        { id: "uiTemplatePosters", ...inRoot(cacheRoot, CacheNamespace.UITemplatePosters) },
        { id: "spellcheckDictionaries", ...inRoot(cacheRoot, CacheNamespace.SpellcheckDictionaries) },
        { id: "optimizedImages", ...inRoot(cacheRoot, CacheNamespace.OptimizedImages) },
        { id: "compressedMedia", ...inRoot(cacheRoot, CacheNamespace.CompressedMedia) },
        { id: "buildDependencies", ...inRoot(cacheRoot, CacheNamespace.BuildDependencies) },
        { id: "toolchains", ...inRoot(cacheRoot, CacheNamespace.Toolchains) },
        { id: "puppetRuntimes", ...inRoot(cacheRoot, CacheNamespace.PuppetRuntimes) },
        {
            id: "electronBuilder",
            // Studio's own, plus the host default earlier versions filled. The two are the same
            // directory when the author has exported `ELECTRON_BUILDER_CACHE` to point there, so
            // the list is deduplicated rather than measured twice.
            dirs: [...new Set(
                [builderRoot, ...(hostBuilderRoot ? [hostBuilderRoot] : [])].map(dir => path.resolve(dir)),
            )],
            displayPath: builderRoot,
        },
        {
            id: "browser",
            dirs: browserDirs,
            // Several directories, so no single path is the truth; the panel says so.
            displayPath: null,
            afterClear: async () => {
                // Without this the in-memory cache writes itself back out moments later and the
                // author watches the number climb again.
                await session.defaultSession.clearCache();
                await session.defaultSession.clearCodeCaches({ urls: [] });
            },
        },
        {
            id: "psdImports",
            dirs: [psdTempRoot()],
            displayPath: psdTempRoot(),
        },
        {
            id: "logs",
            dirs: [path.join(userDataDir, UserDataNamespace.Logs)],
            displayPath: path.join(userDataDir, UserDataNamespace.Logs),
        },
    ];
}

/** Bytes under `dir`, treating an absent directory as zero rather than as a failure. */
export async function directorySize(dir: string): Promise<{ bytes: number; entries: number }> {
    let entries: Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return { bytes: 0, entries: 0 };
    }
    let bytes = 0;
    for (const entry of entries) {
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            bytes += (await directorySize(child)).bytes;
        } else if (entry.isFile()) {
            // A file that vanished mid-walk (a running build writing into the same tree) is not
            // an error - it simply contributes nothing.
            bytes += await fs.stat(child).then(stat => stat.size).catch(() => 0);
        }
    }
    return { bytes, entries: entries.length };
}

export async function measureCacheInventory(locations: CacheLocations): Promise<CacheInventoryReport> {
    const buckets: CacheBucketReport[] = [];
    let totalBytes = 0;
    for (const definition of bucketDefinitions(locations)) {
        try {
            let sizeBytes = 0;
            let entryCount = 0;
            for (const dir of definition.dirs) {
                const measured = await directorySize(dir);
                sizeBytes += measured.bytes;
                entryCount += measured.entries;
            }
            totalBytes += sizeBytes;
            buckets.push({ id: definition.id, path: definition.displayPath, sizeBytes, entryCount });
        } catch (error) {
            buckets.push({
                id: definition.id,
                path: definition.displayPath,
                sizeBytes: 0,
                entryCount: 0,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return { buckets, totalBytes };
}

/**
 * Delete the named buckets.
 *
 * Each directory's contents go rather than the directory itself: the code that writes into them
 * mostly assumes they exist, and an empty directory costs nothing. A bucket whose id is not
 * recognized is reported as failed rather than ignored, because the caller asked for something
 * this build cannot do and silence would read as success.
 */
export async function clearCacheBuckets(
    locations: CacheLocations,
    ids: readonly string[],
): Promise<CacheClearResult> {
    const definitions = new Map(bucketDefinitions(locations).map(definition => [definition.id, definition]));
    const cleared: CacheBucketId[] = [];
    const failed: CacheClearResult["failed"] = [];
    let freedBytes = 0;

    for (const id of ids) {
        if (!isCacheBucketId(id)) {
            failed.push({ id: id as CacheBucketId, error: `unknown cache bucket "${id}"` });
            continue;
        }
        const definition = definitions.get(id);
        if (!definition || definition.dirs.length === 0) {
            failed.push({ id, error: "this host has no such cache" });
            continue;
        }
        try {
            for (const dir of definition.dirs) {
                freedBytes += (await directorySize(dir)).bytes;
                await removeChildren(dir);
            }
            await definition.afterClear?.();
            cleared.push(id);
        } catch (error) {
            failed.push({ id, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return { cleared, freedBytes, failed };
}

export function isCacheBucketId(value: string): value is CacheBucketId {
    return (CACHE_BUCKET_IDS as readonly string[]).includes(value);
}

/**
 * Empty a directory without removing it.
 *
 * `force` on every child: a file locked by a running build (or by the log sink writing this very
 * moment) must not abort the rest of the sweep - the next clear will get it.
 */
async function removeChildren(dir: string): Promise<void> {
    let entries: string[];
    try {
        entries = await fs.readdir(dir);
    } catch {
        return;
    }
    for (const entry of entries) {
        await fs.rm(path.join(dir, entry), { recursive: true, force: true }).catch(() => undefined);
    }
}

/**
 * Delete the PSD import scratch directories left by earlier sessions.
 *
 * Called once at startup. `PsdBakeHandler` creates `<temp>/narraleaf-psd/<timestamp>/` per import
 * and nothing ever removed them, so a profile accumulated one directory of full-canvas PNGs for
 * every PSD ever imported. The handler now cleans up after itself; this is for the backlog, and
 * for the case where Studio was killed mid-import.
 */
export async function sweepPsdTempDirectories(): Promise<number> {
    const root = psdTempRoot();
    let entries: string[];
    try {
        entries = await fs.readdir(root);
    } catch {
        return 0;
    }
    let removed = 0;
    for (const entry of entries) {
        const ok = await fs
            .rm(path.join(root, entry), { recursive: true, force: true })
            .then(() => true)
            .catch(() => false);
        if (ok) {
            removed += 1;
        }
    }
    return removed;
}
