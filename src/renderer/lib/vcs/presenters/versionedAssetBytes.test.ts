import { describe, expect, it, vi } from "vitest";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { createVersionedAssetBytesSource, VERSIONED_ASSET_LIMITS } from "./versionedAssetBytes";

/**
 * The one thing this source exists to make true: two columns of a comparison read the same asset id
 * at two different revisions, and a file replaced between them is drawn twice, differently.
 *
 * Everything else here guards a way that answer can go quietly wrong - a set resolved against
 * today's tags, an unbounded cache, a read storm on the channel Studio is still using - or a way it
 * can go quietly silent, which is worse: a refusal nobody counts is a blank widget nobody is told
 * about.
 *
 * The fixtures are trees keyed by repository-relative path, because that is what a revision IS to
 * this module. The content paths are written out rather than derived from
 * `ProjectNameConvention.AssetsDataShard`: deriving them would make the test agree with the
 * convention by construction, and the premise being pinned is that an id becomes a path by
 * arithmetic which is as valid at a year-old revision as it is today.
 */

const BACKGROUND = "11111111-1111-4111-8111-111111111111";
const BACKGROUND_PATH = "assets/content/11/11/1111111141118111111111111111";
const REPLACEMENT = "22222222-2222-4222-8222-222222222222";
const REPLACEMENT_PATH = "assets/content/22/22/2222222242228222222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const THIRD_PATH = "assets/content/33/33/3333333343338333333333333333";
const FOURTH = "44444444-4444-4444-8444-444444444444";
const FOURTH_PATH = "assets/content/44/44/4444444444448444444444444444";

const IMAGE_SHARD = "assets/assets.metadata.image.json";
const ASSET_SETS = "editor/asset-sets.json";

/** One revision, as the files it holds. */
type Version = Record<string, Uint8Array>;

function utf8(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

/** The tag side of an image metadata shard, which is all this source reads out of one. */
function imageShard(entries: Record<string, string[]>): Uint8Array {
    return utf8(JSON.stringify(
        Object.fromEntries(
            Object.entries(entries).map(([id, tags]) => [id, { id, type: "image", name: id, tags }]),
        ),
    ));
}

function filled(value: number, length = 4): Uint8Array {
    return new Uint8Array(length).fill(value);
}

/**
 * A read over one version's tree.
 *
 * A path the version does not hold throws, which is what `readBlob` does and is the whole reason
 * "absent" cannot be inferred from the read alone.
 */
function readerOver(version: Version, log?: string[]): (path: string) => Promise<Uint8Array | null> {
    return async path => {
        log?.push(path);
        const held = version[path];
        if (!held) {
            throw new Error(`path not in this revision: ${path}`);
        }
        return held;
    };
}

describe("two columns, two revisions, one asset id", () => {
    it("hands each column the bytes ITS version holds, from one path at two revisions", async () => {
        const asItWas = filled(1);
        const asItIs = filled(2, 6);
        const reads: { revision: string; path: string }[] = [];

        const column = (revision: string, content: Uint8Array) => createVersionedAssetBytesSource({
            id: `revision:${revision}`,
            read: path => {
                reads.push({ revision, path });
                return readerOver({
                    [IMAGE_SHARD]: imageShard({ [BACKGROUND]: [] }),
                    [BACKGROUND_PATH]: content,
                })(path);
            },
        });

        const before = column("rev-old", asItWas);
        const after = column("rev-new", asItIs);

        const drawnBefore = await before.read(BACKGROUND, AssetType.Image);
        const drawnAfter = await after.read(BACKGROUND, AssetType.Image);

        // The failure this feature exists to remove is these two being equal.
        expect(drawnBefore).toEqual({ kind: "bytes", bytes: asItWas, mediaType: null });
        expect(drawnAfter).toEqual({ kind: "bytes", bytes: asItIs, mediaType: null });
        expect(drawnBefore).not.toEqual(drawnAfter);

        // One path, asked of two revisions - arithmetic on the id, not a lookup in either tree.
        expect(reads.filter(read => read.path === BACKGROUND_PATH)).toEqual([
            { revision: "rev-old", path: BACKGROUND_PATH },
            { revision: "rev-new", path: BACKGROUND_PATH },
        ]);
        expect(before.id).not.toBe(after.id);
    });

    it("resolves a SET against that version's tags, so a file retagged since is not the answer", async () => {
        const sets = utf8(JSON.stringify({
            version: 1,
            sets: [{
                id: "title-art",
                name: "Title art",
                type: "image",
                filter: ["set:title"],
                axis: { kind: "locale", key: "locale", residency: "build", values: ["en", "ja"], fallback: "en" },
            }],
        }));

        const column = (version: Version) => createVersionedAssetBytesSource({
            id: "column",
            previewLocale: "en",
            read: readerOver(version),
        });

        // Then: the English title art was this file.
        const before = column({
            [ASSET_SETS]: sets,
            [IMAGE_SHARD]: imageShard({ [BACKGROUND]: ["set:title", "locale:en"] }),
            [BACKGROUND_PATH]: filled(1),
        });
        // Now: the tag has moved to a different file. Resolving against today's tags would draw the
        // second file under BOTH versions' layouts, which is the substitution in miniature.
        const after = column({
            [ASSET_SETS]: sets,
            [IMAGE_SHARD]: imageShard({
                [BACKGROUND]: ["set:title"],
                [REPLACEMENT]: ["set:title", "locale:en"],
            }),
            [BACKGROUND_PATH]: filled(1),
            [REPLACEMENT_PATH]: filled(2),
        });

        expect(await before.read("title-art", AssetType.Image)).toMatchObject({ bytes: filled(1) });
        expect(await after.read("title-art", AssetType.Image)).toMatchObject({ bytes: filled(2) });
    });
});

describe("refusals", () => {
    it("calls an id with no record at this version absent, and an unreadable file a fault", async () => {
        const refusals: [string, string][] = [];
        const source = createVersionedAssetBytesSource({
            id: "rev",
            // The record is there and the content file is not, which is the shape of a fault.
            read: readerOver({ [IMAGE_SHARD]: imageShard({ [REPLACEMENT]: [] }) }),
            onRefusal: (assetId, kind) => refusals.push([assetId, kind]),
        });

        expect(await source.read(BACKGROUND, AssetType.Image)).toEqual({ kind: "absent" });
        expect((await source.read(REPLACEMENT, AssetType.Image)).kind).toBe("failed");
        expect(refusals).toEqual([[BACKGROUND, "absent"], [REPLACEMENT, "failed"]]);
    });

    it("counts one refusal per id however many widgets share it", async () => {
        const refusals: string[] = [];
        const source = createVersionedAssetBytesSource({
            id: "rev",
            read: readerOver({}),
            onRefusal: assetId => refusals.push(assetId),
        });

        await Promise.all([
            source.read(BACKGROUND, AssetType.Image),
            source.read(BACKGROUND, AssetType.Image),
            source.read(BACKGROUND, AssetType.Image),
        ]);

        expect(refusals).toEqual([BACKGROUND]);
    });
});

describe("the budget", () => {
    it("ships the ceiling the working-tree read already applies, and a cap of four", () => {
        // COMPARISON_PREVIEW_BYTE_CEILING in the main process. The two sides of a comparison must
        // refuse the same files, or one column draws what the other refuses.
        expect(VERSIONED_ASSET_LIMITS.maxBytesPerAsset).toBe(16 * 1024 * 1024);
        expect(VERSIONED_ASSET_LIMITS.maxRetainedBytes).toBe(32 * 1024 * 1024);
        expect(VERSIONED_ASSET_LIMITS.maxConcurrentReads).toBe(4);
    });

    it("refuses a single file past the per-asset ceiling instead of drawing it", async () => {
        const source = createVersionedAssetBytesSource({
            id: "rev",
            limits: { maxBytesPerAsset: 8 },
            read: readerOver({
                [IMAGE_SHARD]: imageShard({ [BACKGROUND]: [] }),
                [BACKGROUND_PATH]: filled(7, 9),
            }),
            onRefusal: () => undefined,
        });

        const result = await source.read(BACKGROUND, AssetType.Image);

        expect(result.kind).toBe("failed");
        expect(source.retainedBytes).toBe(0);
    });

    it("drops the oldest bytes it holds once the cache is past its ceiling", async () => {
        const log: string[] = [];
        const source = createVersionedAssetBytesSource({
            id: "rev",
            limits: { maxRetainedBytes: 250 },
            read: readerOver({
                [IMAGE_SHARD]: imageShard({ [BACKGROUND]: [], [REPLACEMENT]: [], [THIRD]: [] }),
                [BACKGROUND_PATH]: filled(1, 100),
                [REPLACEMENT_PATH]: filled(2, 100),
                [THIRD_PATH]: filled(3, 100),
            }, log),
        });

        await source.read(BACKGROUND, AssetType.Image);
        await source.read(REPLACEMENT, AssetType.Image);
        expect(source.retainedBytes).toBe(200);

        // 300 would be past the ceiling, so the oldest row goes and the budget is met again.
        await source.read(THIRD, AssetType.Image);
        expect(source.retainedBytes).toBe(200);

        // Evicted, not remembered as empty: asking again reads the file a second time.
        expect(log.filter(path => path === BACKGROUND_PATH)).toHaveLength(1);
        await source.read(BACKGROUND, AssetType.Image);
        expect(log.filter(path => path === BACKGROUND_PATH)).toHaveLength(2);
    });

    it("never has more reads in flight than the cap allows", async () => {
        const version: Version = {
            [IMAGE_SHARD]: imageShard({ [BACKGROUND]: [], [REPLACEMENT]: [], [THIRD]: [], [FOURTH]: [] }),
            [BACKGROUND_PATH]: filled(1),
            [REPLACEMENT_PATH]: filled(2),
            [THIRD_PATH]: filled(3),
            [FOURTH_PATH]: filled(4),
        };
        const pending: (() => void)[] = [];
        let inFlight = 0;
        let peak = 0;

        const source = createVersionedAssetBytesSource({
            id: "rev",
            limits: { maxConcurrentReads: 2 },
            read: path => new Promise<Uint8Array | null>((resolve, reject) => {
                // Counted where the read is ISSUED, which is the side of the slot the cap governs.
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                pending.push(() => {
                    inFlight -= 1;
                    const held = version[path];
                    if (held) {
                        resolve(held);
                    } else {
                        reject(new Error(`path not in this revision: ${path}`));
                    }
                });
            }),
        });

        const settled = Promise.all(
            [BACKGROUND, REPLACEMENT, THIRD, FOURTH].map(id => source.read(id, AssetType.Image)),
        );
        for (let step = 0; step < 100 && pending.length > 0; step++) {
            pending.splice(0).forEach(finish => finish());
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        expect((await settled).map(result => result.kind)).toEqual(["bytes", "bytes", "bytes", "bytes"]);
        expect(peak).toBe(2);
    });
});

describe("dispose", () => {
    it("stops answering and reports no refusal for a pane that has gone", async () => {
        const onRefusal = vi.fn();
        const source = createVersionedAssetBytesSource({ id: "rev", read: readerOver({}), onRefusal });

        source.dispose();
        expect((await source.read(BACKGROUND, AssetType.Image)).kind).toBe("failed");
        expect(onRefusal).not.toHaveBeenCalled();
        expect(source.retainedBytes).toBe(0);
    });
});
