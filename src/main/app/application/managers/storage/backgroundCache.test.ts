import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { BACKGROUND_CACHE_LIMIT, cacheBackgroundImage, pruneBackgroundCache } from "./backgroundCache";

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function makeCacheDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-backgrounds-"));
    tempDirs.push(dir);
    return dir;
}

const picture = (seed: string) => new TextEncoder().encode(`fake-image-bytes:${seed}`);

describe("background cache", () => {
    it("stores a picture under a name derived from its contents", async () => {
        const dir = await makeCacheDir();
        const bytes = picture("a");
        const name = await cacheBackgroundImage(dir, bytes, ".png");

        expect(name).toMatch(/^[0-9a-f]{16}\.png$/);
        expect(new Uint8Array(await fs.readFile(path.join(dir, name)))).toEqual(bytes);
    });

    it("gives different pictures different names", async () => {
        // The whole point of content addressing: `ui.backgroundImage` has to change when the user
        // picks a different picture, or the windows watching that key never repaint.
        const dir = await makeCacheDir();
        const first = await cacheBackgroundImage(dir, picture("a"), ".png");
        const second = await cacheBackgroundImage(dir, picture("b"), ".png");

        expect(second).not.toBe(first);
        expect((await fs.readdir(dir)).sort()).toEqual([first, second].sort());
    });

    it("re-caching the same picture reuses the entry and refreshes its recency", async () => {
        const dir = await makeCacheDir();
        const bytes = picture("a");
        const first = await cacheBackgroundImage(dir, bytes, ".png");
        const before = (await fs.stat(path.join(dir, first))).mtimeMs;

        await new Promise(resolve => setTimeout(resolve, 20));
        const again = await cacheBackgroundImage(dir, bytes, ".png");

        expect(again).toBe(first);
        expect(await fs.readdir(dir)).toHaveLength(1);
        expect((await fs.stat(path.join(dir, first))).mtimeMs).toBeGreaterThan(before);
    });

    it("prunes to the most recently used entries", async () => {
        const dir = await makeCacheDir();
        const names: string[] = [];
        for (let index = 0; index < BACKGROUND_CACHE_LIMIT + 3; index++) {
            names.push(await cacheBackgroundImage(dir, picture(String(index)), ".png"));
            // Same-millisecond writes would make "most recent" ambiguous.
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        const newest = names[names.length - 1];
        await pruneBackgroundCache(dir, newest);

        const remaining = await fs.readdir(dir);
        expect(remaining).toHaveLength(BACKGROUND_CACHE_LIMIT);
        expect(remaining).toContain(newest);
        // The three oldest went; nothing newer did.
        expect(remaining).toEqual(expect.arrayContaining(names.slice(3)));
        expect(remaining).not.toContain(names[0]);
    });

    it("never prunes the picture that was just chosen", async () => {
        const dir = await makeCacheDir();
        const chosen = await cacheBackgroundImage(dir, picture("chosen"), ".png");
        await new Promise(resolve => setTimeout(resolve, 5));
        for (let index = 0; index < BACKGROUND_CACHE_LIMIT + 2; index++) {
            await cacheBackgroundImage(dir, picture(String(index)), ".png");
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        // `chosen` is now the oldest entry, so only the keep-guard can save it.
        await pruneBackgroundCache(dir, chosen);

        expect(await fs.readdir(dir)).toContain(chosen);
    });
});
