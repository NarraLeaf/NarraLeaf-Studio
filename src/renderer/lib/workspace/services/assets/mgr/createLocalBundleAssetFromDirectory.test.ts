import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetsService } from "../../core/AssetsService";
import { AssetsMetadataManager } from "./AssetsMetadataManager";
import { LocalAssetsManager } from "./LocalAssetsManager";
import { AssetType } from "../assetTypes";
import { AssetCreateErrorCode, AssetSource, type Asset, type AssetsMap } from "../types";
import { Services } from "../../services";

/**
 * Creating a model bundle from a directory, under an id the caller chose.
 *
 * The route a bundle takes into a project that did not author it. Bytes cannot describe a model, so
 * this is the directory-backed counterpart of `createLocalAssetFromBytes`, and it answers the same
 * questions: which path the tree landed at, that the id gate refuses before anything is copied, and
 * that a tree which did not arrive whole leaves neither files nor a record behind.
 *
 * A seam test. The disk is a set of directories and the tree walk is a fake, which is enough for all
 * three: what matters is which copy was asked for and what was registered afterwards.
 */

const copies: Array<{ src: string; dest: string }> = [];
const removed: string[] = [];
/** What a listing of a path answers with. Absent means the path could not be read. */
const listings = new Map<string, string[]>();

vi.mock("@/lib/app/privilegedFacade", () => ({
    appPrivilegedFacade: {
        fs: {
            copyDir: async (src: string, dest: string) => {
                copies.push({ src, dest });
                return { success: true as const, data: { ok: true as const, data: undefined } };
            },
            deleteDir: async (path: string) => {
                removed.push(path);
                return { success: true as const, data: { ok: true as const, data: undefined } };
            },
            hash: async () => ({ success: true as const, data: { ok: true as const, data: "hash" } }),
        },
    },
}));

/** v4-shaped ids, so they pass the storage-id gate the way real asset ids do. */
const TRAVELLED_ID = "11111111-1111-4111-8111-111111111111";
const OCCUPIED_ID = "22222222-2222-4222-8222-222222222222";
const MINTED_ID = "33333333-3333-4333-8333-333333333333";

/** A bundle as it sits in the project it was copied out of: a shard path named after its id. */
const SOURCE_DIR = `/projects/other/assets/content/44/44/4444-4444-4444-444444444444`;
const SOURCE_FILES = ["hiyori.2048/texture_00.png", "hiyori.model3.json", "motions/tap.motion3.json"];

function emptyAssetsMap(): AssetsMap {
    return {
        [AssetType.Image]: {},
        [AssetType.Audio]: {},
        [AssetType.Video]: {},
        [AssetType.JSON]: {},
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
    }

    const createdDirs: string[] = [];
    const generate = vi.fn(() => MINTED_ID);

    const filesystemService = {
        isDirExists: async (path: string) => ({ ok: true as const, data: listings.has(path) }),
        createDir: async (path: string) => {
            createdDirs.push(path);
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
    service.modelService = {
        listBundle: async (root: string) => {
            const files = listings.get(root);
            return files
                ? { success: true as const, data: { files, totalBytes: files.length } }
                : { success: false as const, error: `Failed to list ${root}` };
        },
    } as never;

    const metadataManager = new AssetsMetadataManager(service, context as never);
    metadataManager.assetsMetadata = metadata;
    (service as unknown as { assetsMetadataManager: AssetsMetadataManager }).assetsMetadataManager = metadataManager;

    const manager = new LocalAssetsManager(service, context as never);
    (service as unknown as { localAssetsManager: LocalAssetsManager }).localAssetsManager = manager;

    const announced: string[] = [];
    service.getEvents().on("updated", (asset: Asset) => announced.push(asset.id));

    return { service, manager, metadata, createdDirs, generate, announced };
}

beforeEach(() => {
    copies.length = 0;
    removed.length = 0;
    listings.clear();
    listings.set(SOURCE_DIR, SOURCE_FILES);
});

describe("createLocalBundleAssetFromDirectory", () => {
    it("copies the tree to the path the given id names, and records it under that id", async () => {
        const harness = createHarness();
        // What the copy will have produced by the time the manager re-reads it.
        listings.set(contentPath(TRAVELLED_ID), SOURCE_FILES);

        const result = await harness.service.createLocalBundleAssetFromDirectory(AssetType.Model, SOURCE_DIR, {
            id: TRAVELLED_ID,
            name: "Hiyori",
        });

        expect(result.success).toBe(true);
        expect(result.data?.id).toBe(TRAVELLED_ID);
        expect(copies).toEqual([{ src: SOURCE_DIR, dest: contentPath(TRAVELLED_ID) }]);
        expect(harness.metadata[AssetType.Model][TRAVELLED_ID]).toBe(result.data);
        expect(harness.announced).toEqual([TRAVELLED_ID]);
        // Nothing was minted: an id that came from outside must be the one used, or the reference
        // that arrived with the tree still points at nothing.
        expect(harness.generate).not.toHaveBeenCalled();
    });

    it("takes its name from the caller rather than from the folder it read", async () => {
        // A bundle arriving from another project is read out of that project's content tree, where
        // the folder is named after the id. Naming the asset after it would file every travelled
        // model under a uuid.
        const harness = createHarness();
        listings.set(contentPath(TRAVELLED_ID), SOURCE_FILES);

        const result = await harness.service.createLocalBundleAssetFromDirectory(AssetType.Model, SOURCE_DIR, {
            id: TRAVELLED_ID,
            name: "Hiyori",
        });

        expect(result.data?.name).toBe("Hiyori");
        // Detection still runs over what landed, so the record names its own entry file.
        expect(result.data?.extras?.modelEntry).toBe("hiyori.model3.json");
        expect(result.data?.ext).toBeUndefined();
    });

    it("refuses an id the library already holds, copying nothing", async () => {
        const existing = assetRecord(AssetType.Model, OCCUPIED_ID, "already-here");
        const harness = createHarness([existing]);

        const result = await harness.service.createLocalBundleAssetFromDirectory(AssetType.Model, SOURCE_DIR, {
            id: OCCUPIED_ID,
            name: "Hiyori",
        });

        expect(result.success).toBe(false);
        // Distinguishable from a failure: the caller's answer to this one is to carry on, because
        // the asset the reference names is already in the library.
        expect(result.code).toBe(AssetCreateErrorCode.IdInUse);
        expect(copies).toEqual([]);
        expect(removed).toEqual([]);
        expect(harness.metadata[AssetType.Model][OCCUPIED_ID]).toBe(existing);
        expect(harness.announced).toEqual([]);
    });

    it("refuses an id held by an asset of a different type", async () => {
        // The content tree has no type segment, so one id is one path for the whole library.
        const harness = createHarness([assetRecord(AssetType.Image, OCCUPIED_ID, "portrait.png")]);

        const result = await harness.service.createLocalBundleAssetFromDirectory(AssetType.Model, SOURCE_DIR, {
            id: OCCUPIED_ID,
        });

        expect(result.code).toBe(AssetCreateErrorCode.IdInUse);
        expect(copies).toEqual([]);
        expect(harness.metadata[AssetType.Model]).toEqual({});
    });

    it("refuses an id that is not a storage id, before it touches the disk", async () => {
        const harness = createHarness();

        const result = await harness.service.createLocalBundleAssetFromDirectory(AssetType.Model, SOURCE_DIR, {
            id: "aaaa../../../../../victim",
        });

        expect(result.success).toBe(false);
        expect(result.code).toBe(AssetCreateErrorCode.InvalidId);
        expect(copies).toEqual([]);
        expect(harness.createdDirs).toEqual([]);
        expect(harness.metadata[AssetType.Model]).toEqual({});
    });

    it("removes what it copied and registers nothing when part of the tree did not arrive", async () => {
        const harness = createHarness();
        // The textures did not make it. Studio never reads the manifest that names them, so a
        // record here would be a model that lists in the browser and fails at mount.
        listings.set(contentPath(TRAVELLED_ID), ["hiyori.model3.json"]);

        const result = await harness.service.createLocalBundleAssetFromDirectory(AssetType.Model, SOURCE_DIR, {
            id: TRAVELLED_ID,
            name: "Hiyori",
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("hiyori.2048/texture_00.png");
        expect(removed).toEqual([contentPath(TRAVELLED_ID)]);
        expect(harness.metadata[AssetType.Model]).toEqual({});
        expect(harness.announced).toEqual([]);
    });

    it("removes what it copied when the copy cannot be read back at all", async () => {
        const harness = createHarness();

        const result = await harness.service.createLocalBundleAssetFromDirectory(AssetType.Model, SOURCE_DIR, {
            id: TRAVELLED_ID,
        });

        expect(result.success).toBe(false);
        expect(removed).toEqual([contentPath(TRAVELLED_ID)]);
        expect(harness.metadata[AssetType.Model]).toEqual({});
    });

    it("refuses a source folder it cannot read, before it copies anything", async () => {
        const harness = createHarness();
        listings.delete(SOURCE_DIR);

        const result = await harness.service.createLocalBundleAssetFromDirectory(
            AssetType.Model,
            SOURCE_DIR,
            { id: TRAVELLED_ID },
        );

        expect(result.success).toBe(false);
        expect(copies).toEqual([]);
        expect(removed).toEqual([]);
    });

    it("refuses a type whose payload is a single file", async () => {
        const harness = createHarness();

        const result = await harness.service.createLocalBundleAssetFromDirectory(AssetType.Image, SOURCE_DIR, {
            id: TRAVELLED_ID,
        });

        expect(result.success).toBe(false);
        expect(copies).toEqual([]);
    });

    it("mints an id when the caller holds none, as the folder picker's import does", async () => {
        const harness = createHarness();
        listings.set(contentPath(MINTED_ID), SOURCE_FILES);

        const result = await harness.service.createLocalBundleAssetFromDirectory(AssetType.Model, SOURCE_DIR);

        expect(result.data?.id).toBe(MINTED_ID);
        expect(harness.generate).toHaveBeenCalledTimes(1);
        expect(copies).toEqual([{ src: SOURCE_DIR, dest: contentPath(MINTED_ID) }]);
    });
});
