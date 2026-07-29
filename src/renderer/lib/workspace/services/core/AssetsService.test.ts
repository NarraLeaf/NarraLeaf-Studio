import { describe, expect, it, vi } from "vitest";
import { AssetsService } from "./AssetsService";
import { AssetsMetadataManager } from "../assets/mgr/AssetsMetadataManager";
import { GroupAssetsManager } from "../assets/mgr/GroupAssetsManager";
import { AssetType } from "../assets/assetTypes";
import { AssetSource, type Asset, type AssetGroup, type AssetGroupMap, type AssetsMap } from "../assets/types";
import { Services } from "../services";

/**
 * The asset write path had no coverage at all before this file, which is how the two defects this
 * suite pins could exist: a replacement that never moved the hash or dropped the thumbnail, and a
 * delete guard that lived in a React hook and so was skipped by every other caller.
 *
 * These are seam tests, not filesystem tests — the bytes are somebody else's problem. What is
 * asserted here is the order the service does things in, and that nothing can reach a delete without
 * passing the reference check first.
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

function imageGroup(id: string, parentGroupId?: string): AssetGroup {
    return { id, name: id, type: AssetType.Image, parentGroupId, createdAt: 0, updatedAt: 0 };
}

function imageAsset(id: string, overrides: Partial<Asset<AssetType.Image, AssetSource.Local>> = {}): Asset<AssetType.Image, AssetSource.Local> {
    return {
        id,
        type: AssetType.Image,
        name: `${id}.png`,
        hash: `hash-${id}`,
        ext: "png",
        source: AssetSource.Local,
        meta: {},
        tags: [],
        description: "",
        ...overrides,
    };
}

interface HarnessOptions {
    /** `assetId → reference labels`. Anything listed here counts as "still in use". */
    references?: Record<string, string[]>;
    /** Simulate a reference index that cannot answer (unbuilt, or the service is missing). */
    referenceLookup?: "ok" | "throws" | "missing";
    groups?: AssetGroup[];
}

function createHarness(assets: Asset<AssetType.Image, AssetSource.Local>[], options: HarnessOptions = {}) {
    const calls: string[] = [];
    const metadata = emptyAssetsMap();
    for (const asset of assets) {
        metadata[AssetType.Image][asset.id] = asset;
    }
    const groupMap = emptyGroupMap();
    for (const group of options.groups ?? []) {
        groupMap[AssetType.Image][group.id] = group;
    }

    const referenceService = {
        async ensureReady() {
            if (options.referenceLookup === "throws") {
                throw new Error("index build failed");
            }
        },
        async flushPendingRebuilds() { },
        getReferencesForAll(ids: readonly string[]) {
            const result = new Map<string, unknown[]>();
            for (const id of ids) {
                const labels = options.references?.[id];
                if (labels?.length) {
                    result.set(id, labels.map(label => ({ id: `${id}:${label}`, kind: "story", label })));
                }
            }
            return result;
        },
    };

    const context = {
        project: { resolve: (segment: string) => segment },
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.FileSystem) {
                    return {
                        writeFileNoFollow: async () => ({ ok: true, data: undefined }),
                        write: async () => ({ ok: true, data: undefined }),
                    };
                }
                if (serviceId === Services.Reference) {
                    if (options.referenceLookup === "missing") {
                        throw new Error("Reference service is not registered");
                    }
                    return referenceService;
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        },
    };

    const service = new AssetsService();
    service.setContext(context as any);

    const metadataManager = new AssetsMetadataManager(service, context as any);
    metadataManager.assetsMetadata = metadata;

    const localAssetsManager = {
        async writeAssetContentFromPath(_asset: Asset, sourcePath: string) {
            calls.push("write-bytes");
            return {
                success: true as const,
                data: {
                    hash: `hash-of:${sourcePath}`,
                    ext: sourcePath.split(".").pop()?.toLowerCase(),
                },
            };
        },
        async deleteAsset(asset: Asset) {
            calls.push(`delete-asset:${asset.id}`);
            delete metadata[asset.type][asset.id];
            service.getEvents().emit("deleted", asset);
            return { success: true as const, data: undefined };
        },
    };

    // The real group manager, because the cascade is the thing being tested: it deletes contained
    // assets one at a time through `AssetsService.deleteAsset`, which is where the guard now sits.
    const groupAssetsManager = new GroupAssetsManager(service, context as any);
    groupAssetsManager.assetsGroups = groupMap;

    (service as any).assetsMetadataManager = metadataManager;
    (service as any).localAssetsManager = localAssetsManager;
    (service as any).groupAssetsManager = groupAssetsManager;

    vi.spyOn(service, "clearThumbnailCache").mockImplementation(async (assetId?: string) => {
        calls.push(`clear-thumbnail:${assetId}`);
    });

    service.getEvents().on("updated", asset => calls.push(`updated:${asset.id}`));

    return { service, metadata, groupMap, calls };
}

describe("AssetsService.replaceAssetContent", () => {
    it("moves the hash, drops the thumbnail before announcing, and keeps the id", async () => {
        const asset = imageAsset("asset-1");
        const { service, metadata, calls } = createHarness([asset]);

        const result = await service.replaceAssetContent(asset, "C:/incoming/new-room.png");

        expect(result.success).toBe(true);
        // The id is the whole point of replacing: every reference stores it, so nothing relinks.
        expect(result.success && result.data?.id).toBe("asset-1");
        expect(metadata[AssetType.Image]["asset-1"].hash).toBe("hash-of:C:/incoming/new-room.png");
        expect(metadata[AssetType.Image]["asset-1"].hash).not.toBe("hash-asset-1");

        // Order matters: a subscriber woken before the thumbnail PNG is gone re-reads the old one.
        expect(calls).toEqual([
            "write-bytes",
            "clear-thumbnail:asset-1",
            "updated:asset-1",
        ]);
    });

    it("follows the new file's extension and keeps the display name unique", async () => {
        const asset = imageAsset("asset-1", { name: "room.png" });
        const sibling = imageAsset("asset-2", { name: "room.jpg", ext: "jpg" });
        const { service, metadata } = createHarness([asset, sibling]);

        await service.replaceAssetContent(asset, "C:/incoming/room.JPG");

        expect(metadata[AssetType.Image]["asset-1"].ext).toBe("jpg");
        expect(metadata[AssetType.Image]["asset-1"].name).toBe("room-1.jpg");
        expect(metadata[AssetType.Image]["asset-2"].name).toBe("room.jpg");
    });

    it("refuses remote assets, which have no local file to overwrite", async () => {
        const asset = imageAsset("asset-1");
        const { service, calls } = createHarness([asset]);

        const remote = { ...asset, source: AssetSource.Remote } as unknown as Asset<AssetType.Image>;
        const result = await service.replaceAssetContent(remote, "C:/incoming/new-room.png");

        expect(result.success).toBe(false);
        expect(calls).toEqual([]);
    });
});

describe("AssetsService delete guard", () => {
    it("refuses to delete a referenced asset", async () => {
        const asset = imageAsset("asset-1", { name: "room.jpg" });
        const { service, metadata, calls } = createHarness([asset], {
            references: { "asset-1": ["First Day"] },
        });

        const result = await service.deleteAsset(asset);

        expect(result.success).toBe(false);
        expect(result.success === false && result.error).toContain("room.jpg");
        expect(calls).toEqual([]);
        expect(metadata[AssetType.Image]["asset-1"]).toBeDefined();
    });

    it("lets an author who has been shown the references through", async () => {
        const asset = imageAsset("asset-1");
        const { service, metadata, calls } = createHarness([asset], {
            references: { "asset-1": ["First Day"] },
        });

        const result = await service.deleteAsset(asset, { allowReferenced: true });

        expect(result.success).toBe(true);
        expect(calls).toEqual(["delete-asset:asset-1", "clear-thumbnail:asset-1"]);
        expect(metadata[AssetType.Image]["asset-1"]).toBeUndefined();
    });

    it("deletes an unreferenced asset without asking anyone", async () => {
        const asset = imageAsset("asset-1");
        const { service, metadata } = createHarness([asset]);

        const result = await service.deleteAsset(asset);

        expect(result.success).toBe(true);
        expect(metadata[AssetType.Image]["asset-1"]).toBeUndefined();
    });

    it("refuses when the reference index cannot answer, rather than reading silence as consent", async () => {
        const asset = imageAsset("asset-1");
        const { service, metadata } = createHarness([asset], { referenceLookup: "throws" });

        const result = await service.deleteAsset(asset);

        expect(result.success).toBe(false);
        expect(metadata[AssetType.Image]["asset-1"]).toBeDefined();

        const missing = createHarness([imageAsset("asset-2")], { referenceLookup: "missing" });
        expect((await missing.service.deleteAsset(imageAsset("asset-2"))).success).toBe(false);
    });

    /**
     * The bypass this card exists to close: deleting a *group* used to walk its contents straight
     * into `deleteAsset` without ever consulting the index, because the check lived in the panel's
     * hook. A folder of referenced backgrounds went quietly.
     */
    it("blocks a group cascade whose contents are still referenced, before deleting anything", async () => {
        const kept = imageAsset("asset-1", { name: "room.jpg", groupId: "group-a" });
        const alsoKept = imageAsset("asset-2", { name: "hall.jpg", groupId: "group-a" });
        const { service, metadata, groupMap, calls } = createHarness([kept, alsoKept], {
            groups: [imageGroup("group-a")],
            references: { "asset-2": ["First Day"] },
        });

        const result = await service.deleteGroup(AssetType.Image, "group-a", true);

        expect(result.success).toBe(false);
        expect(result.success === false && result.error).toContain("hall.jpg");
        // Nothing was removed — not even the unreferenced sibling that happened to be enumerated first.
        expect(calls).toEqual([]);
        expect(metadata[AssetType.Image]["asset-1"]).toBeDefined();
        expect(metadata[AssetType.Image]["asset-2"]).toBeDefined();
        expect(groupMap[AssetType.Image]["group-a"]).toBeDefined();
    });

    it("sees references inside nested groups the cascade would reach", async () => {
        const nested = imageAsset("asset-1", { name: "sky.jpg", groupId: "group-b" });
        const { service, metadata } = createHarness([nested], {
            groups: [imageGroup("group-a"), imageGroup("group-b", "group-a")],
            references: { "asset-1": ["Prologue"] },
        });

        const result = await service.deleteGroup(AssetType.Image, "group-a", true);

        expect(result.success).toBe(false);
        expect(metadata[AssetType.Image]["asset-1"]).toBeDefined();
    });

    it("deletes the whole group once the author has confirmed", async () => {
        const first = imageAsset("asset-1", { groupId: "group-a" });
        const nested = imageAsset("asset-2", { groupId: "group-b" });
        const { service, metadata, groupMap } = createHarness([first, nested], {
            groups: [imageGroup("group-a"), imageGroup("group-b", "group-a")],
            references: { "asset-2": ["Prologue"] },
        });

        const result = await service.deleteGroup(AssetType.Image, "group-a", true, { allowReferenced: true });

        expect(result.success).toBe(true);
        expect(metadata[AssetType.Image]["asset-1"]).toBeUndefined();
        expect(metadata[AssetType.Image]["asset-2"]).toBeUndefined();
        expect(groupMap[AssetType.Image]["group-a"]).toBeUndefined();
        expect(groupMap[AssetType.Image]["group-b"]).toBeUndefined();
    });
});
