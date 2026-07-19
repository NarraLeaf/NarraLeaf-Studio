import { UserDataNamespace } from "@shared/types/constants";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

/**
 * The app-wide cache of custom background pictures: userData/backgrounds, holding what the user
 * has picked, named by the hash of the contents. Global rather than per-project because the
 * background itself is a global setting — every window paints the same one.
 *
 * Content-addressed for two reasons. Re-picking a picture already cached copies nothing. And
 * every *different* picture gets a different name, so `ui.backgroundImage` actually changes when
 * one is picked: under the old fixed `background.<ext>` name a second .png left the setting
 * untouched and every window silently kept showing the first one.
 */

/** How many pictures the cache keeps. The live one is always the newest, so it is never evicted. */
export const BACKGROUND_CACHE_LIMIT = 8;

/** Takes userData rather than reading it off `electronApp`, so the cache stays testable without Electron. */
export function backgroundCacheDirectory(userDataDir: string): string {
    return path.join(userDataDir, UserDataNamespace.Backgrounds);
}

/** The cache name a picture's bytes map to. Half a SHA-256 keeps a handful of pictures apart with room to spare. */
export function backgroundCacheName(bytes: Uint8Array, extension: string): string {
    return `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}${extension}`;
}

/**
 * Put a picture in the cache and return the name to store in `ui.backgroundImage`.
 *
 * Bytes already cached are left alone — only their timestamp moves, which is what marks them as
 * most recently used for `pruneBackgroundCache`.
 */
export async function cacheBackgroundImage(
    directory: string,
    bytes: Uint8Array,
    extension: string,
): Promise<string> {
    const fileName = backgroundCacheName(bytes, extension);
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, fileName);
    try {
        await fs.access(target);
        const now = new Date();
        await fs.utimes(target, now, now);
    } catch {
        await fs.writeFile(target, bytes);
    }
    return fileName;
}

/**
 * Drop all but the most recently used entries, so trying out a dozen pictures does not keep them
 * all forever. `keep` is spared unconditionally: it is the picture that was just chosen, and
 * losing it would leave the setting pointing at nothing.
 */
export async function pruneBackgroundCache(directory: string, keep: string): Promise<void> {
    const names = await fs.readdir(directory);
    const entries = await Promise.all(
        names.map(async name => ({ name, mtime: (await fs.stat(path.join(directory, name))).mtimeMs })),
    );
    const stale = entries
        .sort((a, b) => b.mtime - a.mtime)
        .slice(BACKGROUND_CACHE_LIMIT)
        .filter(entry => entry.name !== keep);
    await Promise.all(stale.map(entry => fs.unlink(path.join(directory, entry.name))));
}
