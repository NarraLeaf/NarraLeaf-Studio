import { describe, expect, it, vi } from "vitest";
import type { LiveAssetFolderOp, LiveAssetOp } from "@shared/live/ops";
import { AssetsService, type AssetOpSink } from "./AssetsService";
import { AssetsMetadataManager } from "../assets/mgr/AssetsMetadataManager";
import { GroupAssetsManager } from "../assets/mgr/GroupAssetsManager";
import { AssetCategory, AssetType } from "../assets/assetTypes";
import { AssetSource, type Asset, type AssetGroup, type AssetGroupMap, type AssetsMap } from "../assets/types";
import { Services } from "../services";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * The asset library's half of a live session, at the seam rather than through a room.
 *
 * What these pin is the bargain every shared document makes: with a sink installed an edit becomes an
 * operation and the shard is NOT touched, and the row moves when the effect comes back. The failure
 * on the other side of that is the expensive one - a record that lands here and nowhere else, with
 * nothing anywhere reporting it - so the cases below are mostly about what does not happen.
 */

function emptyAssetsMap(): AssetsMap {
    return {
        [AssetType.Image]: {},
        [AssetType.Audio]: {},
        [AssetType.Video]: {},
        [AssetType.JSON]: {},
        [AssetType.Blueprint]: {},
        [AssetType.Font]: {},
        [AssetType.Model]: {},
        [AssetType.Other]: {},
    };
}

function emptyGroupMap(): AssetGroupMap {
    return {
        [AssetCategory.Image]: {},
        [AssetCategory.Media]: {},
        [AssetCategory.Data]: {},
        [AssetCategory.Font]: {},
        [AssetCategory.Model]: {},
        [AssetCategory.Other]: {},
    };
}

function asset<T extends AssetType>(id: string, type: T, overrides: Partial<Asset<T, AssetSource.Local>> = {}): Asset<T, AssetSource.Local> {
    return {
        id,
        type,
        name: `${id}.bin`,
        hash: `hash-${id}`,
        ext: "bin",
        source: AssetSource.Local,
        meta: {},
        tags: [],
        description: "",
        ...overrides,
    } as unknown as Asset<T, AssetSource.Local>;
}

function createHarness(assets: Asset<AssetType, AssetSource.Local>[], groups: AssetGroup[] = []) {
    const metadata = emptyAssetsMap();
    for (const record of assets) {
        (metadata[record.type] as Record<string, unknown>)[record.id] = record;
    }
    const groupMap = emptyGroupMap();
    for (const group of groups) {
        groupMap[group.category][group.id] = group;
    }

    const writes: string[] = [];
    const context = {
        project: {
            resolve: (...parts: (string | string[])[]) =>
                parts.flatMap(part => (Array.isArray(part) ? part : [part])).join("/").replace(/\/+/g, "/"),
        },
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.FileSystem) {
                    return {
                        writeFileNoFollow: async (path: string) => {
                            writes.push(path);
                            return { ok: true, data: undefined };
                        },
                        writeFileNoFollowOrCreate: async (path: string) => {
                            writes.push(path);
                            return { ok: true, data: undefined };
                        },
                    };
                }
                if (serviceId === Services.Reference) {
                    // The delete guard still runs first inside a session - a file something still
                    // points at is refused before anything is stated - so it needs an index that can
                    // answer. Nothing here references anything.
                    return {
                        async ensureReady() { },
                        async flushPendingRebuilds() { },
                        getReferencesForAll: () => new Map(),
                        getIndexResult: () => ({ complete: true, gaps: [] }),
                    };
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        },
    };

    const service = new AssetsService();
    service.setContext(context as never);
    const metadataManager = new AssetsMetadataManager(service, context as never);
    metadataManager.assetsMetadata = metadata;
    const groupAssetsManager = new GroupAssetsManager(service, context as never);
    groupAssetsManager.assetsGroups = groupMap;
    (service as unknown as Record<string, unknown>).assetsMetadataManager = metadataManager;
    (service as unknown as Record<string, unknown>).groupAssetsManager = groupAssetsManager;

    const stated: (LiveAssetOp | LiveAssetFolderOp)[] = [];
    const updated: string[] = [];
    service.getEvents().on("updated", record => updated.push(record.id));
    const sink: AssetOpSink = {
        handle(op) {
            stated.push(op);
            return true;
        },
    };

    return { service, metadata, groupMap, stated, updated, writes, sink };
}

const IMAGE_GROUP: AssetGroup = {
    id: "group-1",
    name: "Backgrounds",
    category: AssetCategory.Image,
    createdAt: 0,
    updatedAt: 0,
};

describe("an asset record edit inside a live session", () => {
    it("becomes one operation carrying the record as it would have been written", async () => {
        const record = asset("asset-1", AssetType.Image, { name: "room.png", ext: "png" });
        const { service, stated, sink } = createHarness([record]);
        service.setOperationSink(sink);

        await service.renameAsset(record, "hall.png");

        // ⚠ The record, not the patch. A patch states an intention that every machine would resolve
        // against its own copy, and a rename resolves into two fields rather than one.
        expect(stated).toHaveLength(1);
        expect(stated[0]).toEqual({
            op: "update-asset",
            assetType: AssetType.Image,
            assetId: "asset-1",
            record: expect.objectContaining({ id: "asset-1", name: "hall.png", ext: "png" }),
        });
    });

    it("leaves the library exactly as it was, because nothing is applied optimistically", async () => {
        const record = asset("asset-1", AssetType.Image, { name: "room.png", ext: "png", description: "" });
        const { service, metadata, updated, writes, sink } = createHarness([record]);
        service.setOperationSink(sink);

        await service.renameAsset(record, "hall.jpg");
        await service.updateAssetDescription(record, "the empty classroom");
        await service.updateAssetTags(record, ["bg", "school"]);

        const held = metadata[AssetType.Image]["asset-1"];
        expect(held.name).toBe("room.png");
        expect(held.ext).toBe("png");
        expect(held.description).toBe("");
        expect(held.tags).toEqual([]);
        // Nothing redrew and nothing was saved: the row moves when the effect comes back.
        expect(updated).toEqual([]);
        expect(writes).toEqual([]);
    });

    it("puts back a key the edit added rather than leaving it undefined", async () => {
        // `undefined` and absent read the same in TypeScript and are not the same value to the
        // canonical encoder or to the shard's digest, so a restore that assigned `undefined` would
        // eject this machine from the room on the next effect.
        const record = asset("asset-1", AssetType.Image);
        const { service, metadata, sink } = createHarness([record]);
        service.setOperationSink(sink);

        await service.patchAssetExtras(record, { modelEntry: "Hiyori.model3.json" });

        expect("extras" in metadata[AssetType.Image]["asset-1"]).toBe(false);
    });

    it("goes back to writing the shard the moment the sink is taken away", async () => {
        const record = asset("asset-1", AssetType.Image, { name: "room.png", ext: "png" });
        const { service, metadata, updated, sink } = createHarness([record]);
        service.setOperationSink(sink);
        await service.renameAsset(record, "hall.png");
        service.setOperationSink(null);

        await service.renameAsset(record, "hall.png");

        expect(metadata[AssetType.Image]["asset-1"].name).toBe("hall.png");
        expect(updated).toEqual(["asset-1"]);
    });
});

describe("filing assets in a folder inside a live session", () => {
    it("is one operation per shard, however many rows the drag collected", async () => {
        const one = asset("audio-1", AssetType.Audio);
        const two = asset("audio-2", AssetType.Audio);
        const three = asset("video-1", AssetType.Video);
        const media: AssetGroup = { ...IMAGE_GROUP, id: "media-1", category: AssetCategory.Media };
        const { service, stated, sink } = createHarness([one, two, three], [media]);
        service.setOperationSink(sink);

        await service.moveAssetsToGroup([one, two, three], "media-1");

        // ⚠ Two, not three and not one: a message names one document, and audio and video live in
        // two shards. Each shard's share of the drag is stated whole.
        expect(stated).toHaveLength(2);
        expect(stated[0]).toEqual({
            op: "move-assets",
            assetType: AssetType.Audio,
            moves: [{ assetId: "audio-1", groupId: "media-1" }, { assetId: "audio-2", groupId: "media-1" }],
        });
        expect(stated[1]).toEqual({
            op: "move-assets",
            assetType: AssetType.Video,
            moves: [{ assetId: "video-1", groupId: "media-1" }],
        });
    });

    it("says where each row is going, so the operation can be its own inverse", async () => {
        // The rows a drag collects came from different folders, so a batch that named one
        // destination for all of them would have nothing to undo with.
        const one = asset("image-1", AssetType.Image, { groupId: "group-1" });
        const { service, stated, sink } = createHarness([one], [IMAGE_GROUP]);
        service.setOperationSink(sink);

        await service.moveAssetsToGroup([one], undefined);

        expect(stated[0]).toEqual({
            op: "move-assets",
            assetType: AssetType.Image,
            moves: [{ assetId: "image-1", groupId: null }],
        });
    });

    it("refuses the whole drag when one target is gone, rather than filing half of it", async () => {
        const one = asset("image-1", AssetType.Image);
        const { service, stated, metadata, sink } = createHarness([one]);
        service.setOperationSink(sink);

        const result = await service.moveAssetsToGroup([one], "group-that-went");

        expect(result.success).toBe(false);
        expect(stated).toEqual([]);
        expect(metadata[AssetType.Image]["image-1"].groupId).toBeUndefined();
    });

    it("files rows itself outside a session, and drops the key at the section root", async () => {
        const one = asset("image-1", AssetType.Image, { groupId: "group-1" });
        const { service, metadata, updated } = createHarness([one], [IMAGE_GROUP]);

        await service.moveAssetsToGroup([one], undefined);

        expect("groupId" in metadata[AssetType.Image]["image-1"]).toBe(false);
        expect(updated).toEqual(["image-1"]);
    });
});

describe("an effect arriving for the asset library", () => {
    it("writes the record in place, so the panel holding it redraws", () => {
        const record = asset("asset-1", AssetType.Image, { name: "room.png", ext: "png" });
        const { service, metadata, updated } = createHarness([record]);

        service.applyLiveOp({
            op: "update-asset",
            assetType: AssetType.Image,
            assetId: "asset-1",
            record: { ...record, name: "hall.jpg", ext: "jpg", description: "somebody else's words" },
        });

        // The same object, not a replacement: the browser and the inspector hold this record.
        expect(metadata[AssetType.Image]["asset-1"]).toBe(record);
        expect(record.name).toBe("hall.jpg");
        expect(record.description).toBe("somebody else's words");
        expect(updated).toEqual(["asset-1"]);
    });

    it("drops a key the incoming record does not have", () => {
        const record = asset("asset-1", AssetType.Image, { groupId: "group-1" });
        const { service } = createHarness([record]);
        const { groupId: _filed, ...atRoot } = record as unknown as Record<string, unknown>;

        service.applyLiveOp({
            op: "update-asset",
            assetType: AssetType.Image,
            assetId: "asset-1",
            record: atRoot,
        });

        expect("groupId" in record).toBe(false);
    });

    it("files every row of a batch and wakes the panel once per row", () => {
        const one = asset("audio-1", AssetType.Audio);
        const two = asset("audio-2", AssetType.Audio, { groupId: "media-1" });
        const { service, metadata, updated } = createHarness([one, two]);

        service.applyLiveOp({
            op: "move-assets",
            assetType: AssetType.Audio,
            moves: [{ assetId: "audio-1", groupId: "media-1" }, { assetId: "audio-2", groupId: null }],
        });

        expect(metadata[AssetType.Audio]["audio-1"].groupId).toBe("media-1");
        expect("groupId" in metadata[AssetType.Audio]["audio-2"]).toBe(false);
        expect(updated).toEqual(["audio-1", "audio-2"]);
    });

    it("is a no-op for a record this window does not hold, rather than a throw", () => {
        // An applier runs inside the host reading a message; one that threw would take the session
        // down over one row. The shard's digest is a value, so the guard catches it on this effect.
        const { service } = createHarness([]);

        expect(() => service.applyLiveOp({
            op: "update-asset",
            assetType: AssetType.Image,
            assetId: "nobody",
            record: {},
        })).not.toThrow();
        expect(() => service.applyLiveOp({
            op: "move-assets",
            assetType: "a-type-from-a-newer-build",
            moves: [{ assetId: "nobody", groupId: null }],
        })).not.toThrow();
    });
});

describe("the gestures that move a file", () => {
    /**
     * ⚠ **The half of the library that used to be refused outright.** What these pin is that each of
     * them now becomes an operation and touches nothing locally - the record moves when the effect
     * comes back, exactly as an edit does. A gesture that quietly did its local half as well would be
     * a library one machine has and the others do not.
     */
    it("states a deletion rather than doing one, and trashes nothing yet", async () => {
        const record = asset("asset-1", AssetType.Image);
        const { service, metadata, stated, sink } = createHarness([record]);
        service.setOperationSink(sink);

        const answer = await service.deleteAsset(record);

        expect(answer.success).toBe(true);
        expect(stated).toEqual([{ op: "delete-assets", assetType: AssetType.Image, assetIds: ["asset-1"] }]);
        // Still here: every machine, this one included, removes it when the effect arrives.
        expect(metadata[AssetType.Image]["asset-1"]).toBeDefined();
    });

    it("states a folder rather than making one, and mints its id here", async () => {
        // ⚠ The id and the timestamps are decided by one machine on purpose: an applier that minted
        // its own would give every machine a different folder from one gesture.
        const { service, groupMap, stated, sink } = createHarness([]);
        service.setOperationSink(sink);

        const answer = await service.createGroup(AssetCategory.Image, "Chapter 2");

        expect(answer.success).toBe(true);
        expect(stated).toHaveLength(1);
        expect(stated[0]).toMatchObject({
            op: "set-asset-folder",
            category: AssetCategory.Image,
            folder: { name: "Chapter 2", category: AssetCategory.Image },
        });
        expect(Object.keys(groupMap[AssetCategory.Image])).toHaveLength(0);
    });

    it("states a rename and a re-parent as the same verb, carrying the whole record", async () => {
        const { service, groupMap, stated, sink } = createHarness([], [IMAGE_GROUP]);
        service.setOperationSink(sink);

        await service.renameGroup(AssetCategory.Image, "group-1", "Chapter 1");
        await service.moveGroupToParent(AssetCategory.Image, "group-1", undefined);

        expect(stated.map(op => op.op)).toEqual(["set-asset-folder", "set-asset-folder"]);
        expect(stated[0]).toMatchObject({ folder: { id: "group-1", name: "Chapter 1" } });
        // And nothing moved here: the tree redraws when the effect comes back.
        expect(groupMap[AssetCategory.Image]["group-1"].name).toBe("Backgrounds");
    });

    it("states a folder deletion as one operation and carries none of the cascade", async () => {
        // Which folders are below this one and which files are in them is a question every machine
        // answers for itself, from documents the room already agrees on.
        const { service, stated, sink } = createHarness([], [IMAGE_GROUP]);
        service.setOperationSink(sink);

        const answer = await service.deleteGroup(AssetCategory.Image, "group-1", true);

        expect(answer.success).toBe(true);
        expect(stated).toEqual([{
            op: "delete-asset-folder",
            category: AssetCategory.Image,
            folderId: "group-1",
            recursive: true,
        }]);
    });

    it("goes back to doing all of them the moment the sink is gone", async () => {
        const { service, groupMap } = createHarness([]);

        const created = await service.createGroup(AssetCategory.Image, "Chapter 2");

        expect(created.success).toBe(true);
        expect(Object.keys(groupMap[AssetCategory.Image])).toHaveLength(1);
    });
});

describe("what a session carries", () => {
    it("is every shard the library holds, and nothing before it is up", () => {
        const { service } = createHarness([asset("asset-1", AssetType.Image)]);

        expect([...service.shardTypes()].sort()).toEqual([...Object.values(AssetType)].sort());
        expect(service.recordsOf(AssetType.Image)).toEqual({ "asset-1": expect.objectContaining({ id: "asset-1" }) });
        // A type from a newer build is not a shard this one can be asked about.
        expect(service.recordsOf("hologram")).toBeNull();
    });
});
