import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetsService } from "../../core/AssetsService";
import { AssetsMetadataManager } from "./AssetsMetadataManager";
import { LocalAssetsManager } from "./LocalAssetsManager";
import { AssetType } from "../assetTypes";
import { AssetCreateErrorCode, AssetSource, type Asset, type AssetsMap } from "../types";
import { Services } from "../../services";

/**
 * Creating an asset under an id the caller chose.
 *
 * The id is the whole point of the option and also its whole risk: it is sliced into directory
 * segments to build the content path, and it names a file in a tree shared by every asset type. So
 * what is pinned here is the shape gate, the refusal to overwrite, and that a refusal happens before
 * anything is written - a half-performed import would leave bytes under an id no record claims.
 *
 * A seam test, not a filesystem test. The disk is a map from path to bytes, which is enough to ask
 * both questions that matter: which path was written, and whether an existing one was disturbed.
 */

const fakeDisk = new Map<string, Uint8Array>();
const fakeDirs = new Set<string>();

vi.mock("@/lib/app/privilegedFacade", () => ({
    appPrivilegedFacade: {
        fs: {
            hash: async (path: string) => ({
                success: true as const,
                data: { ok: true as const, data: `hash-of:${(fakeDisk.get(path) ?? new Uint8Array()).join(",")}` },
            }),
        },
    },
}));

/** A v4-shaped id, so it passes the storage-id gate the way a real asset id does. */
const IMPORTED_ID = "11111111-1111-4111-8111-111111111111";
const OCCUPIED_ID = "22222222-2222-4222-8222-222222222222";
const MINTED_ID = "33333333-3333-4333-8333-333333333333";

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

function assetRecord<T extends AssetType>(type: T, id: string, name: string): Asset<T, AssetSource.Local> {
    return {
        id,
        type,
        name,
        hash: `hash-of-${id}`,
        ext: name.split(".").pop(),
        source: AssetSource.Local,
        meta: {},
        tags: [],
        description: "",
    } as Asset<T, AssetSource.Local>;
}

/** The path the manager is expected to derive, built the way the storage convention builds it. */
function contentPath(id: string): string {
    const clean = id.replace(/-/g, "");
    return `assets/content/${clean.slice(0, 2)}/${clean.slice(2, 4)}/${clean.slice(4)}`;
}

function createHarness(seed: Asset<AssetType, AssetSource.Local>[] = []) {
    const metadata = emptyAssetsMap();
    for (const asset of seed) {
        (metadata[asset.type] as Record<string, unknown>)[asset.id] = asset;
        fakeDisk.set(contentPath(asset.id), new Uint8Array([0xff]));
        fakeDirs.add(contentPath(asset.id).split("/").slice(0, -1).join("/"));
    }

    const rawWrites: string[] = [];
    const createdDirs: string[] = [];
    const generate = vi.fn(() => MINTED_ID);

    const filesystemService = {
        isDirExists: async (path: string) => ({ ok: true as const, data: fakeDirs.has(path) }),
        createDir: async (path: string) => {
            createdDirs.push(path);
            fakeDirs.add(path);
            return { ok: true as const, data: undefined };
        },
        writeRaw: async (path: string, data: Uint8Array) => {
            rawWrites.push(path);
            fakeDisk.set(path, data);
            return { ok: true as const, data: undefined };
        },
        // The metadata shard flush that `markDirty` kicks off. Nothing here reads it back.
        writeFileNoFollow: async () => ({ ok: true as const, data: undefined }),
        write: async () => ({ ok: true as const, data: undefined }),
    };

    const context = {
        // Mirrors Porject.resolve: flatten every argument and join the segments.
        project: {
            resolve: (...parts: (string | string[])[]) =>
                parts.flatMap(part => (Array.isArray(part) ? part : [part])).join("/").replace(/\/+/g, "/"),
        },
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.FileSystem) return filesystemService;
                if (serviceId === Services.Uuid) return { generate };
                throw new Error(`Unexpected service ${serviceId}`);
            },
        },
    };

    const service = new AssetsService();
    service.setContext(context as never);

    const metadataManager = new AssetsMetadataManager(service, context as never);
    metadataManager.assetsMetadata = metadata;
    (service as unknown as { assetsMetadataManager: AssetsMetadataManager }).assetsMetadataManager = metadataManager;

    const manager = new LocalAssetsManager(service, context as never);
    (service as unknown as { localAssetsManager: LocalAssetsManager }).localAssetsManager = manager;

    const announced: string[] = [];
    service.getEvents().on("updated", (asset: Asset) => announced.push(asset.id));

    return { service, manager, metadata, rawWrites, createdDirs, generate, announced };
}

beforeEach(() => {
    fakeDisk.clear();
    fakeDirs.clear();
});

describe("createLocalAssetFromBytes with a caller-chosen id", () => {
    it("writes the bytes at the shard path derived from that id, and records it under it", async () => {
        const harness = createHarness();

        const result = await harness.service.createLocalAssetFromBytes(
            AssetType.Image,
            "portrait.png",
            new Uint8Array([1, 2, 3]),
            undefined,
            { id: IMPORTED_ID },
        );

        expect(result.success).toBe(true);
        expect(result.data?.id).toBe(IMPORTED_ID);
        expect(harness.rawWrites).toEqual([contentPath(IMPORTED_ID)]);
        expect(fakeDisk.get(contentPath(IMPORTED_ID))).toEqual(new Uint8Array([1, 2, 3]));
        expect(harness.metadata[AssetType.Image][IMPORTED_ID]).toBe(result.data);
        expect(harness.announced).toEqual([IMPORTED_ID]);
        // Nothing was minted: an id that came from outside must be the one used, or the reference
        // that arrived with the bytes still points at nothing.
        expect(harness.generate).not.toHaveBeenCalled();
    });

    it("still resolves a unique display name and honours the group", async () => {
        const harness = createHarness([assetRecord(AssetType.Image, OCCUPIED_ID, "portrait.png")]);

        const result = await harness.service.createLocalAssetFromBytes(
            AssetType.Image,
            "portrait.png",
            new Uint8Array([1]),
            "group-7",
            { id: IMPORTED_ID },
        );

        expect(result.data?.name).toBe("portrait-1.png");
        expect(result.data?.groupId).toBe("group-7");
        expect(result.data?.ext).toBe("png");
    });

    it("refuses an id that is not a storage id, and writes nothing", async () => {
        const harness = createHarness();

        const result = await harness.service.createLocalAssetFromBytes(
            AssetType.Image,
            "portrait.png",
            new Uint8Array([1, 2, 3]),
            undefined,
            { id: "aaaa../../../../../victim.txt" },
        );

        expect(result.success).toBe(false);
        expect(result.code).toBe(AssetCreateErrorCode.InvalidId);
        // The refusal has to precede every side effect: a directory created for a traversal path is
        // already the interesting half of the problem.
        expect(harness.rawWrites).toEqual([]);
        expect(harness.createdDirs).toEqual([]);
        expect(fakeDisk.size).toBe(0);
        expect(harness.metadata[AssetType.Image]).toEqual({});
        expect(harness.announced).toEqual([]);
    });

    it("refuses an empty id rather than treating it as absent", async () => {
        const harness = createHarness();

        const result = await harness.service.createLocalAssetFromBytes(
            AssetType.Image,
            "portrait.png",
            new Uint8Array([1]),
            undefined,
            { id: "" },
        );

        expect(result.success).toBe(false);
        expect(result.code).toBe(AssetCreateErrorCode.InvalidId);
        expect(harness.generate).not.toHaveBeenCalled();
    });

    it("refuses an id the library already holds, leaving the bytes and the record untouched", async () => {
        const existing = assetRecord(AssetType.Image, OCCUPIED_ID, "already-here.png");
        const harness = createHarness([existing]);
        const bytesBefore = fakeDisk.get(contentPath(OCCUPIED_ID));

        const result = await harness.service.createLocalAssetFromBytes(
            AssetType.Image,
            "incoming.png",
            new Uint8Array([9, 9, 9]),
            undefined,
            { id: OCCUPIED_ID },
        );

        expect(result.success).toBe(false);
        // Distinguishable from a failure: the caller's answer to this one is to carry on, because
        // the asset the reference names is already in the library.
        expect(result.code).toBe(AssetCreateErrorCode.IdInUse);
        expect(harness.rawWrites).toEqual([]);
        expect(fakeDisk.get(contentPath(OCCUPIED_ID))).toBe(bytesBefore);
        expect(harness.metadata[AssetType.Image][OCCUPIED_ID]).toBe(existing);
        expect(harness.metadata[AssetType.Image][OCCUPIED_ID].name).toBe("already-here.png");
        expect(harness.announced).toEqual([]);
    });

    it("refuses an id held by an asset of a different type", async () => {
        // The content tree has no type segment, so one id is one file for the whole library. A
        // check scoped to the type being created would let an image land on an audio asset's bytes.
        const harness = createHarness([assetRecord(AssetType.Audio, OCCUPIED_ID, "theme.mp3")]);

        const result = await harness.service.createLocalAssetFromBytes(
            AssetType.Image,
            "incoming.png",
            new Uint8Array([9]),
            undefined,
            { id: OCCUPIED_ID },
        );

        expect(result.success).toBe(false);
        expect(result.code).toBe(AssetCreateErrorCode.IdInUse);
        expect(harness.rawWrites).toEqual([]);
        expect(harness.metadata[AssetType.Image]).toEqual({});
    });

    it("refuses a model bundle before it looks at the id at all", async () => {
        const harness = createHarness();

        const result = await harness.service.createLocalAssetFromBytes(
            AssetType.Model,
            "hiyori",
            new Uint8Array([1]),
            undefined,
            { id: IMPORTED_ID },
        );

        expect(result.success).toBe(false);
        expect(result.code).toBeUndefined();
        expect(result.error).toContain("model bundle");
    });
});

describe("createLocalAssetFromBytes without one", () => {
    it("mints an id and writes at the minted path, as it always did", async () => {
        const harness = createHarness();

        const result = await harness.service.createLocalAssetFromBytes(
            AssetType.JSON,
            "notes.txt",
            new Uint8Array([7]),
        );

        expect(result.success).toBe(true);
        expect(harness.generate).toHaveBeenCalledTimes(1);
        expect(result.data?.id).toBe(MINTED_ID);
        expect(harness.rawWrites).toEqual([contentPath(MINTED_ID)]);
        expect(harness.metadata[AssetType.JSON][MINTED_ID]).toBe(result.data);
        expect(harness.announced).toEqual([MINTED_ID]);
    });

    it("is unaffected by an empty options object", async () => {
        const harness = createHarness();

        const result = await harness.service.createLocalAssetFromBytes(
            AssetType.JSON,
            "notes.txt",
            new Uint8Array([7]),
            undefined,
            {},
        );

        expect(result.data?.id).toBe(MINTED_ID);
        expect(harness.generate).toHaveBeenCalledTimes(1);
    });
});
