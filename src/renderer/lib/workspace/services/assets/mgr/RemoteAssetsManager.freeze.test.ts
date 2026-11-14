import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freezeProjectWrites, thawProjectWrites } from "@/lib/app/writeFreeze";
import { BaseFileSystemService } from "../../core/FileSystem";
import { Services } from "../../services";
import { AssetCategory, AssetType } from "../assetTypes";
import { FileFormatValidator } from "../FileFormatValidator";
import { AssetSource, type Asset } from "../types";
import { RemoteAssetsManager } from "./RemoteAssetsManager";

const ROOT = "D:/projects/my-game";
const ID = "11111111-1111-4111-8111-111111111111";
const FETCHED_AT = "2026-01-01T00:00:00.000Z";
const host = vi.hoisted(() => ({ fetchRemote: vi.fn(), hash: vi.fn() }));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ assets: { fetchRemote: host.fetchRemote } }),
}));
vi.mock("@/lib/app/privilegedFacade", () => ({
    appPrivilegedFacade: { fs: { hash: host.hash } },
}));

function createHarness() {
    const metadata = Object.fromEntries(Object.values(AssetType).map(type => [type, {}]));
    const offer = vi.fn(async () => false);
    const dirty = vi.fn();
    const filesystem = {
        isFileExists: async () => ({ ok: true, data: true }),
        isDirExists: async () => ({ ok: true, data: true }),
        writeRaw: async (...args: Parameters<typeof BaseFileSystemService.writeRaw>) => {
            freezeProjectWrites({ projectPath: ROOT, reason: { kind: "manual" } });
            return BaseFileSystemService.writeRaw(...args);
        },
    };
    const context = {
        project: { resolve: (...parts: (string | string[])[]) => [ROOT, ...parts.flat()].join("/") },
        services: {
            get: (id: Services) => id === Services.FileSystem ? filesystem : { generate: () => ID },
        },
    };
    const assets = {
        getFileFormatValidator: () => new FileFormatValidator(),
        getAssetsMetadataManager: () => ({ getAssets: () => metadata }),
        offerCreatedAsset: offer,
        markDirty: dirty,
        getEvents: () => ({ emit: vi.fn() }),
        mintTransferId: () => "transfer",
    };
    return { manager: new RemoteAssetsManager(assets as never, context as never), metadata, offer, dirty };
}

beforeEach(() => {
    host.fetchRemote.mockReset();
    host.hash.mockReset();
    host.fetchRemote.mockResolvedValue({
        success: true,
        data: { kind: "ok", bytes: new Uint8Array([1, 2, 3]) },
    });
    host.hash.mockResolvedValue({ success: true, data: { ok: true, data: "old-hash" } });
});

afterEach(() => thawProjectWrites());

describe("remote snapshots during a workspace freeze", () => {
    it("does not register an import whose snapshot write was refused", async () => {
        const { manager, metadata, offer, dirty } = createHarness();
        const result = await manager.importRemoteAsset(AssetCategory.Other, "https://example.com/file.bin");

        expect(result).toMatchObject({ success: false, refusal: { kind: "projectNotAccepting" } });
        expect(metadata[AssetType.Other]).toEqual({});
        expect(offer).not.toHaveBeenCalled();
        expect(dirty).not.toHaveBeenCalled();
        expect(host.hash).not.toHaveBeenCalled();
    });

    it("does not report a successful refresh when the snapshot write was refused", async () => {
        const { manager } = createHarness();
        const asset: Asset<AssetType.Other, AssetSource.Remote> = {
            id: ID, type: AssetType.Other, source: AssetSource.Remote, name: "file.bin", ext: "bin",
            hash: "old-hash", meta: { url: "https://example.com/file.bin", fetchedAt: FETCHED_AT }, tags: [], description: "",
        };
        const result = await manager.refresh(asset);

        expect(result).toMatchObject({ success: false, refusal: { kind: "projectNotAccepting" } });
        expect(host.hash).not.toHaveBeenCalled();
    });

    it("does not update validators when the project freezes before a not-modified response", async () => {
        const { manager } = createHarness();
        host.fetchRemote.mockImplementationOnce(async () => {
            freezeProjectWrites({ projectPath: ROOT, reason: { kind: "manual" } });
            return { success: true, data: { kind: "not-modified" } };
        });
        const asset: Asset<AssetType.Other, AssetSource.Remote> = {
            id: ID, type: AssetType.Other, source: AssetSource.Remote, name: "file.bin", ext: "bin",
            hash: "old-hash", meta: { url: "https://example.com/file.bin", fetchedAt: FETCHED_AT, etag: "etag" }, tags: [], description: "",
        };

        expect(await manager.refresh(asset)).toMatchObject({
            success: false, refusal: { kind: "projectNotAccepting" },
        });
    });
});
