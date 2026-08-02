import { describe, expect, it } from "vitest";
import { AssetOrderManager } from "./AssetOrderManager";
import { AssetsMetadataManager } from "./AssetsMetadataManager";
import { GroupAssetsManager } from "./GroupAssetsManager";
import { AssetsService } from "../../core/AssetsService";
import { AssetCategory, AssetType } from "../assetTypes";
import { Services } from "../../services";

/**
 * Whether the browser still shows the author's rows in the author's order once the shards are
 * written with sorted keys — and whether a project that has never heard of the order file still
 * loads exactly as it always did.
 *
 * Seam tests, like `AssetsService.test.ts`: the filesystem is a stub that hands back file text and
 * records what was written. The two shards are asserted to stay byte-shape identical to today,
 * because the Dev Mode bundler, the runtime packer and every previously shipped Studio parse their
 * top level as `{ id: record }`.
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const IMAGE_METADATA = "assets.metadata.image.json";
const IMAGE_GROUPS = "assets.groups.image.json";
const IMAGE_ORDER = "assets.order.image.json";

function assetJson(id: string): string {
    return `{"id":"${id}","type":"image","name":"${id}.png","hash":"h-${id}","ext":"png","source":"local","meta":{},"tags":[],"description":""}`;
}

function metadataShard(...ids: string[]): string {
    return `{${ids.map(id => `"${id}":${assetJson(id)}`).join(",")}}`;
}

function groupJson(id: string): string {
    return `{"id":"${id}","name":"${id}","type":"image","createdAt":0,"updatedAt":0}`;
}

function groupsShard(...ids: string[]): string {
    return `{${ids.map(id => `"${id}":${groupJson(id)}`).join(",")}}`;
}

function orderShard(assetIds: string[], groupIds: string[] = []): string {
    return JSON.stringify({ assetIds, groupIds });
}

/** `path suffix → file text`. Anything not listed reads back as absent. */
function createHarness(files: Record<string, string> = {}) {
    const writes: { path: string; data: string }[] = [];
    const present = { ...files };

    const readText = (path: string): string | undefined => {
        const suffix = Object.keys(present).find(candidate => path.endsWith(candidate));
        return suffix === undefined ? undefined : present[suffix];
    };

    const record = (path: string, data: string) => {
        writes.push({ path, data });
        const suffix = Object.keys(present).find(candidate => path.endsWith(candidate));
        present[suffix ?? path.split("/").pop()!] = data;
        return { ok: true as const, data: undefined };
    };

    const filesystemService = {
        async ensureRegularFile(path: string, data: string) {
            if (readText(path) === undefined) {
                return record(path, data);
            }
            return { ok: true as const, data: undefined };
        },
        async isFileExists(path: string) {
            return { ok: true as const, data: readText(path) !== undefined };
        },
        async read(path: string) {
            const text = readText(path);
            return text === undefined
                ? { ok: false as const, error: { code: "ENOENT", message: "missing" } }
                : { ok: true as const, data: text };
        },
        async readJSON(path: string) {
            const text = readText(path);
            if (text === undefined) {
                return { ok: false as const, error: { code: "ENOENT", message: "missing" } };
            }
            try {
                return { ok: true as const, data: JSON.parse(text) };
            } catch {
                return { ok: false as const, error: { code: "EINVAL", message: "bad json" } };
            }
        },
        async write(path: string, data: string) {
            return record(path, data);
        },
        async writeFileNoFollow(path: string, data: string) {
            // Refuses an absent file, exactly as the real one does: it opens with an `lstat` so it
            // can inspect and reject a symlink, and therefore can only overwrite. Modelling a write
            // as "append to a list" is what let an order file written with this API pass every test
            // here while failing on the first open of every real project.
            if (readText(path) === undefined) {
                return { ok: false as const, error: { code: "ENOENT", message: `lstat '${path}'` } };
            }
            return record(path, data);
        },
        async recoverCorruptedJsonFile(path: string, replacement: string) {
            return record(path, replacement);
        },
    };

    const context = {
        project: { resolve: (segments: string[]) => segments.join("/") },
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.FileSystem) {
                    return filesystemService;
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        },
    };

    const service = new AssetsService();
    service.setContext(context as any);

    return { service, context, writes };
}

/** The order `AssetsService.init` brings the three managers up in. */
async function initAssets(harness: ReturnType<typeof createHarness>) {
    const orderManager = await new AssetOrderManager(harness.context as any).init();
    (harness.service as any).assetOrderManager = orderManager;

    const metadataManager = new AssetsMetadataManager(harness.service, harness.context as any);
    (harness.service as any).assetsMetadataManager = metadataManager;
    (harness.service as any).assetsMetadataInitializing = true;
    try {
        await metadataManager.init();
    } finally {
        (harness.service as any).assetsMetadataInitializing = false;
    }
    await harness.service["flushPendingWrites"]();

    const groupManager = await new GroupAssetsManager(harness.service, harness.context as any).init();
    (harness.service as any).groupAssetsManager = groupManager;

    for (const category of orderManager.listMissingCategories()) {
        (harness.service as any).dirtyOrderCategories.add(category);
    }
    await harness.service["flushPendingWrites"]();

    return { metadataManager, groupManager, orderManager };
}

function lastWrite(writes: { path: string; data: string }[], suffix: string): string | undefined {
    return [...writes].reverse().find(write => write.path.endsWith(suffix))?.data;
}

describe("asset order, for a project that predates the order file", () => {
    it("loads with every asset present, in key order", async () => {
        // The compatibility direction. Nothing about opening an old project may change: not which
        // assets are there, not the sequence, not the shard on disk.
        const harness = createHarness({
            [IMAGE_METADATA]: metadataShard(C, A, B),
            [IMAGE_GROUPS]: groupsShard("group_2", "group_1"),
        });

        const { metadataManager, groupManager } = await initAssets(harness);

        expect(metadataManager.getOrderedAssets(AssetType.Image).map(asset => asset.id)).toEqual([C, A, B]);
        expect(groupManager.getGroups(AssetCategory.Image).map(group => group.id)).toEqual(["group_2", "group_1"]);
        expect(lastWrite(harness.writes, IMAGE_METADATA)).toBeUndefined();
        expect(lastWrite(harness.writes, IMAGE_GROUPS)).toBeUndefined();
    });

    it("writes the recovered order out on that same open, before any key sort can reach the shards", async () => {
        const harness = createHarness({
            [IMAGE_METADATA]: metadataShard(C, A, B),
            [IMAGE_GROUPS]: groupsShard("group_2", "group_1"),
        });

        await initAssets(harness);

        expect(JSON.parse(lastWrite(harness.writes, IMAGE_ORDER)!)).toEqual({
            assetIds: [C, A, B],
            groupIds: ["group_2", "group_1"],
        });
    });

    it("leaves both shards byte-shape identical: still a bare record at the top level", async () => {
        const harness = createHarness({ [IMAGE_METADATA]: metadataShard(C, A) });
        const { metadataManager } = await initAssets(harness);

        metadataManager.getAssets()[AssetType.Image][B] = JSON.parse(assetJson(B));
        await harness.service.transaction(() => {
            harness.service.markDirty(AssetType.Image);
        });

        // Exactly what an older Studio, the Dev Mode bundler and the runtime packer expect: every
        // top-level key is an asset id, every value is that asset.
        const shard = JSON.parse(lastWrite(harness.writes, IMAGE_METADATA)!);
        expect(Object.keys(shard).sort()).toEqual([A, B, C].sort());
        for (const [id, asset] of Object.entries<{ id: string }>(shard)) {
            expect(asset.id).toBe(id);
        }
    });
});

describe("asset order, once the order file exists", () => {
    it("draws the stored order, not the shard's key order", async () => {
        // What a canonically written shard looks like: keys sorted, order carried beside it.
        const harness = createHarness({
            [IMAGE_METADATA]: metadataShard(A, B, C),
            [IMAGE_ORDER]: orderShard([C, A, B]),
        });

        const { metadataManager } = await initAssets(harness);

        expect(metadataManager.listOrdered(AssetType.Image)).toEqual([C, A, B]);
    });

    it("is a no-op on open: nothing is rewritten", async () => {
        const harness = createHarness({
            [IMAGE_METADATA]: metadataShard(A, C),
            [IMAGE_ORDER]: orderShard([C, A]),
        });

        await initAssets(harness);

        expect(harness.writes.filter(write => write.path.endsWith(IMAGE_ORDER))).toHaveLength(0);
    });

    it("shows a newly imported asset the order file cannot know about, at the end, and persists it", async () => {
        const harness = createHarness({
            [IMAGE_METADATA]: metadataShard(A, C),
            [IMAGE_ORDER]: orderShard([C, A]),
        });
        const { metadataManager } = await initAssets(harness);

        metadataManager.getAssets()[AssetType.Image][B] = JSON.parse(assetJson(B));

        expect(metadataManager.listOrdered(AssetType.Image)).toEqual([C, A, B]);

        await harness.service.transaction(() => {
            harness.service.markDirty(AssetType.Image);
        });
        expect(JSON.parse(lastWrite(harness.writes, IMAGE_ORDER)!).assetIds).toEqual([C, A, B]);
    });

    it("drops an id the record no longer holds instead of handing out an empty row", async () => {
        const harness = createHarness({
            [IMAGE_METADATA]: metadataShard(A, C),
            [IMAGE_ORDER]: orderShard([C, B, A]),
        });

        const { metadataManager } = await initAssets(harness);

        expect(metadataManager.listOrdered(AssetType.Image)).toEqual([C, A]);
        expect(metadataManager.getOrderedAssets(AssetType.Image).every(asset => asset !== undefined)).toBe(true);
    });

    it("forgets ids for records the metadata validator rejected", async () => {
        // `9` is not a valid storage id, so the record is dropped on load; the order must not keep
        // pointing at it, or `getOrderedAssets` hands out an `undefined` row.
        const harness = createHarness({
            [IMAGE_METADATA]: `{"9":${assetJson("9")},"${A}":${assetJson(A)}}`,
            [IMAGE_ORDER]: orderShard(["9", A]),
        });

        const { metadataManager } = await initAssets(harness);

        expect(metadataManager.listOrdered(AssetType.Image)).toEqual([A]);
    });

    it("survives an unreadable order file by falling back to key order", async () => {
        const harness = createHarness({
            [IMAGE_METADATA]: metadataShard(C, A),
            [IMAGE_ORDER]: "{ this is not json",
        });

        const { metadataManager } = await initAssets(harness);

        expect(metadataManager.listOrdered(AssetType.Image)).toEqual([C, A]);
    });
});

describe("group order", () => {
    it("draws the stored order and appends a group created after it was written", async () => {
        const harness = createHarness({
            [IMAGE_GROUPS]: groupsShard("group_1", "group_2"),
            [IMAGE_ORDER]: orderShard([], ["group_2", "group_1"]),
        });
        const { groupManager } = await initAssets(harness);

        expect(groupManager.getGroups(AssetCategory.Image).map(group => group.id)).toEqual(["group_2", "group_1"]);

        let createdId = "";
        await harness.service.transaction(async () => {
            const created = await groupManager.createGroup(AssetCategory.Image, "new");
            createdId = created.success ? created.data!.id : "";
        });

        expect(groupManager.getGroups(AssetCategory.Image).map(group => group.id)).toEqual(["group_2", "group_1", createdId]);
        expect(JSON.parse(lastWrite(harness.writes, IMAGE_ORDER)!).groupIds).toEqual(["group_2", "group_1", createdId]);
    });

    it("keeps the groups shard a bare record when a group is created", async () => {
        const harness = createHarness({ [IMAGE_GROUPS]: groupsShard("group_1") });
        const { groupManager } = await initAssets(harness);

        await harness.service.transaction(async () => {
            await groupManager.createGroup(AssetCategory.Image, "new");
        });

        const shard = JSON.parse(lastWrite(harness.writes, IMAGE_GROUPS)!);
        for (const [id, group] of Object.entries<{ id: string }>(shard)) {
            expect(group.id).toBe(id);
        }
    });
});
