import { describe, expect, it } from "vitest";
import { AssetOrderManager } from "./AssetOrderManager";
import { AssetsMetadataManager } from "./AssetsMetadataManager";
import { GroupAssetsManager } from "./GroupAssetsManager";
import { AssetsService } from "../../core/AssetsService";
import { AssetCategory, AssetType } from "../assetTypes";
import { Services } from "../../services";

/**
 * Folding the per-type folder and row-order shards up into per-category ones, on the open that
 * finds the category shard missing.
 *
 * This is the one migration in the asset library that can destroy an author's work rather than
 * merely look wrong: a project whose folders live in `assets.groups.audio.json` and whose new
 * `assets.groups.media.json` is written as `{}` opens with every audio asset un-filed, its `groupId`
 * pointing at a group nothing holds any more. So the assertions here are about the three things the
 * merge must not get wrong — ids unchanged, old files untouched, same-named folders not collapsed —
 * and not about the shape of the new file.
 *
 * Seam tests, like `assetOrderMigration.test.ts`: the filesystem is a stub that hands back file text
 * and records what was written.
 */

const AUDIO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIDEO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const MEDIA_GROUPS = "assets.groups.media.json";

function group(id: string, name: string, category: AssetCategory): string {
    return `{"id":"${id}","name":"${name}","category":"${category}","createdAt":0,"updatedAt":0}`;
}

function groupsShard(...records: string[]): string {
    return `{${records.map(record => `${JSON.stringify(JSON.parse(record).id)}:${record}`).join(",")}}`;
}

function assetRecord(id: string, type: AssetType, groupId?: string): string {
    const group = groupId ? `,"groupId":"${groupId}"` : "";
    return `{"id":"${id}","type":"${type}","name":"${id}","hash":"h-${id}","ext":"bin","source":"local","meta":{},"tags":[],"description":""${group}}`;
}

function metadataShard(...records: string[]): string {
    return `{${records.map(record => `${JSON.stringify(JSON.parse(record).id)}:${record}`).join(",")}}`;
}

/**
 * Every metadata shard, empty.
 *
 * Only needed by a harness that refuses writes: `AssetsMetadataManager` creates its shards with
 * `ensureRegularFile` and, when that is refused, falls down its own corrupted-shard recovery path.
 * That is a different question from this file's, and seeding the files keeps it out of the way.
 */
function emptyMetadataShards(): Record<string, string> {
    return Object.fromEntries(Object.values(AssetType).map(type => [`assets.metadata.${type}.json`, "{}"]));
}

/**
 * `path suffix → file text`. Anything not listed reads back as absent.
 *
 * `refuseWrites` is the freeze latch, and it is the reason the merge cannot be built on a write:
 * `FileSystemService` answers a write refused by the freeze - or by a working tree being re-read
 * after a version restore - as a no-op success, so the file never appears and the only thing in the
 * result that says so is `refused`. Modelled on the four verbs that carry the guard, `refused` flag
 * and all: a harness that answered a bare `{ok: true}` would model a route that had lost the flag as
 * if it were working.
 */
function createHarness(files: Record<string, string> = {}, options: { refuseWrites?: boolean } = {}) {
    const writes: { path: string; data: string }[] = [];
    const present = { ...files };
    const refused = { ok: true as const, data: undefined, refused: true as const };

    const suffixOf = (path: string): string | undefined =>
        Object.keys(present).find(candidate => path.endsWith(candidate));

    const readText = (path: string): string | undefined => {
        const suffix = suffixOf(path);
        return suffix === undefined ? undefined : present[suffix];
    };

    const record = (path: string, data: string) => {
        writes.push({ path, data });
        present[suffixOf(path) ?? path.split("/").pop()!] = data;
        return { ok: true as const, data: undefined };
    };

    const filesystemService = {
        async ensureRegularFile(path: string, data: string) {
            if (options.refuseWrites) {
                return refused;
            }
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
            if (options.refuseWrites) {
                return refused;
            }
            return record(path, data);
        },
        async writeFileNoFollow(path: string, data: string) {
            if (options.refuseWrites) {
                return refused;
            }
            if (readText(path) === undefined) {
                return { ok: false as const, error: { code: "ENOENT", message: `lstat '${path}'` } };
            }
            return record(path, data);
        },
        /** Creates as well as replaces - the difference from `writeFileNoFollow` above. */
        async writeFileNoFollowOrCreate(path: string, data: string) {
            if (options.refuseWrites) {
                return refused;
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

    return { service, context, writes, present };
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

describe("a category's folder shard", () => {
    it("reads the shard that is there, and writes nothing", async () => {
        const harness = createHarness({
            [MEDIA_GROUPS]: groupsShard(group("group_kept", "Cutscenes", AssetCategory.Media)),
        });

        const { groupManager } = await initAssets(harness);

        expect(groupManager.getGroups(AssetCategory.Media).map(one => one.id)).toEqual(["group_kept"]);
        expect(harness.writes.some(write => write.path.endsWith(MEDIA_GROUPS))).toBe(false);
    });

    it("leaves a category whose shard is absent with no folders, and creates the file", async () => {
        const harness = createHarness({});

        const { groupManager } = await initAssets(harness);

        expect(groupManager.getGroups(AssetCategory.Media)).toEqual([]);
        expect(JSON.parse(lastWrite(harness.writes, MEDIA_GROUPS)!)).toEqual({});
    });

    it("still opens when the write that would create the file is refused", async () => {
        // The open a frozen workspace performs, and the one a version restore performs while it
        // re-reads the working tree. Creating the shard is an optimisation for the next open; if it
        // were a precondition for reading, every such open would fail on the read-back of a file
        // that was never written.
        const harness = createHarness({ ...emptyMetadataShards() }, { refuseWrites: true });

        const { groupManager } = await initAssets(harness);

        expect(groupManager.getGroups(AssetCategory.Media)).toEqual([]);
        // The refusal really did keep the file off the disk, so the next open tries again.
        expect(harness.present[MEDIA_GROUPS]).toBeUndefined();
    });

    it("refuses a shard that is on disk and cannot be read, and writes nothing", async () => {
        // The other half of "absent means no folders": a shard that exists but does not parse holds
        // folders this open cannot see. Treating it as empty would write an empty file over them,
        // and every open after that would read the file that was written - one bad read turned into
        // a permanent loss.
        const harness = createHarness({ [MEDIA_GROUPS]: "{ not json at all" });

        await expect(initAssets(harness)).rejects.toThrow(/assets groups shard/);

        expect(harness.writes.some(write => write.path.endsWith(MEDIA_GROUPS))).toBe(false);
    });
});
