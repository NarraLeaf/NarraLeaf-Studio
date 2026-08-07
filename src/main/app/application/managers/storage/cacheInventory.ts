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
 * Sizes are computed on demand rather than tracked: walking `electron-builder/Cache` is not free
 * and nothing else needs the number, so paying for it when a panel asks is the honest trade.
 */

/** Chromium's own caches under userData. Storage that is not a cache is not listed. */
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

/** The build-dependency cache root; must agree with `buildDependencyCacheRoot`. */
const BUILD_DEPS_RELATIVE = path.join(UserDataNamespace.Cache, CacheNamespace.BuildDependencies);

/** Theme posters from the UI template store. */
const UI_TEMPLATE_POSTERS_RELATIVE = path.join(UserDataNamespace.Cache, CacheNamespace.UITemplatePosters);

export function psdTempRoot(tempDir: string = os.tmpdir()): string {
    return path.join(tempDir, PSD_TEMP_DIR_NAME);
}

/**
 * electron-builder's download cache, which Studio fills during a game build.
 *
 * Resolved the way electron-builder itself resolves it - the same logic `winCodeSignCache`
 * already carries for Windows, extended to the other two platforms. Returns null when the host
 * gives us nothing to go on, which is reported as "no path" rather than guessed at.
 */
export function electronBuilderCacheRoot(): string | null {
    const override = process.env.ELECTRON_BUILDER_CACHE?.trim();
    if (override) {
        return override;
    }
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

function bucketDefinitions(userDataDir: string): BucketDefinition[] {
    const builderRoot = electronBuilderCacheRoot();
    const browserDirs = BROWSER_CACHE_DIRS.map(name => path.join(userDataDir, name));
    return [
        {
            id: "pluginIcons",
            dirs: [path.join(userDataDir, UserDataNamespace.PluginIcons)],
            displayPath: path.join(userDataDir, UserDataNamespace.PluginIcons),
        },
        {
            id: "uiTemplatePosters",
            dirs: [path.join(userDataDir, UI_TEMPLATE_POSTERS_RELATIVE)],
            displayPath: path.join(userDataDir, UI_TEMPLATE_POSTERS_RELATIVE),
        },
        {
            id: "buildDependencies",
            dirs: [path.join(userDataDir, BUILD_DEPS_RELATIVE)],
            displayPath: path.join(userDataDir, BUILD_DEPS_RELATIVE),
        },
        {
            id: "electronBuilder",
            dirs: builderRoot ? [builderRoot] : [],
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

export async function measureCacheInventory(userDataDir: string): Promise<CacheInventoryReport> {
    const buckets: CacheBucketReport[] = [];
    let totalBytes = 0;
    for (const definition of bucketDefinitions(userDataDir)) {
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
    userDataDir: string,
    ids: readonly string[],
): Promise<CacheClearResult> {
    const definitions = new Map(bucketDefinitions(userDataDir).map(definition => [definition.id, definition]));
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
