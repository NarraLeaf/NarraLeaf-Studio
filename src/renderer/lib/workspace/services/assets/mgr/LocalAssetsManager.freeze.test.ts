import { afterEach, describe, expect, it, vi } from "vitest";
import { freezeProjectWrites, thawProjectWrites } from "@/lib/app/writeFreeze";
import { BaseFileSystemService } from "../../core/FileSystem";
import { Services } from "../../services";
import { AssetType } from "../assetTypes";
import { AssetSource, type Asset, type AssetsMap } from "../types";
import { LocalAssetsManager } from "./LocalAssetsManager";

const ROOT = "D:/projects/my-game";
const ID = "11111111-1111-4111-8111-111111111111";
const host = vi.hoisted(() => ({ hash: vi.fn() }));

vi.mock("@/lib/app/privilegedFacade", () => ({
    appPrivilegedFacade: { fs: { hash: host.hash } },
}));

function createHarness() {
    const asset: Asset<AssetType.Other, AssetSource.Local> = {
        id: ID, type: AssetType.Other, source: AssetSource.Local, name: "notes.txt", ext: "txt",
        hash: "old", meta: {}, tags: [], description: "",
    };
    const metadata = Object.fromEntries(Object.values(AssetType).map(type => [type, {}])) as AssetsMap;
    const dirty = vi.fn();
    const filesystem = {
        isDirExists: async () => ({ ok: true, data: true }),
        writeRaw: async (...args: Parameters<typeof BaseFileSystemService.writeRaw>) => {
            freezeProjectWrites({ projectPath: ROOT, reason: { kind: "manual" } });
            return BaseFileSystemService.writeRaw(...args);
        },
        write: async (...args: Parameters<typeof BaseFileSystemService.write>) => {
            freezeProjectWrites({ projectPath: ROOT, reason: { kind: "manual" } });
            return BaseFileSystemService.write(...args);
        },
    };
    const context = {
        project: { resolve: (...parts: (string | string[])[]) => [ROOT, ...parts.flat()].join("/") },
        services: { get: (id: Services) => id === Services.FileSystem ? filesystem : { generate: () => ID } },
    };
    const assets = {
        getContext: () => context,
        getAssetsMetadataManager: () => ({ getAssets: () => metadata }),
        markDirty: dirty,
        offerCreatedAsset: vi.fn(async () => false),
        getEvents: () => ({ emit: vi.fn() }),
        mintTransferId: () => "transfer",
    };
    return { manager: new LocalAssetsManager(assets as never, context as never), metadata, asset, dirty };
}

afterEach(() => {
    thawProjectWrites();
    host.hash.mockReset();
});

describe("local asset writes during a workspace freeze", () => {
    it("does not register a new file whose content write was refused", async () => {
        const { manager, metadata, dirty } = createHarness();
        host.hash.mockResolvedValue({ success: true, data: { ok: true, data: "hash" } });

        const result = await manager.createLocalAssetFromBytes(AssetType.Other, "notes.txt", new Uint8Array([1]));

        expect(result.success).toBe(false);
        expect(metadata[AssetType.Other]).toEqual({});
        expect(dirty).not.toHaveBeenCalled();
        expect(host.hash).not.toHaveBeenCalled();
    });

    it("does not report an unsaved text buffer as written", async () => {
        const { manager, metadata, asset } = createHarness();
        metadata[AssetType.Other][ID] = asset;
        host.hash.mockResolvedValue({ success: true, data: { ok: true, data: "old" } });

        const result = await manager.writeAssetContentText(asset, "new text", "utf-8");

        expect(result.success).toBe(false);
        expect(host.hash).not.toHaveBeenCalled();
    });
});
