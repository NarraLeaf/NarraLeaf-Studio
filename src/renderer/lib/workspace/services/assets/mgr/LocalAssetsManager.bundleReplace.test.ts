import { beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { Services } from "../../services";
import { AssetType } from "../assetTypes";
import { AssetSource, type Asset, type AssetsMap } from "../types";
import { LocalAssetsManager } from "./LocalAssetsManager";

const ROOT = "/project";
const ID = "11111111-1111-4111-8111-111111111111";
const DEST = `${ROOT}/assets/content/11/11/${ID.replace(/-/g, "").slice(4)}`;
const SOURCE = "/incoming/model";
const disk = vi.hoisted(() => new Map<string, string>());
const host = vi.hoisted(() => ({ copyDir: vi.fn(), moveDir: vi.fn(), deleteDir: vi.fn() }));

vi.mock("@/lib/app/privilegedFacade", () => ({ appPrivilegedFacade: { fs: host } }));

const ok = () => ({ success: true as const, data: { ok: true as const, data: undefined } });
const failure = () => ({
    success: true as const,
    data: { ok: false as const, error: { code: FsRejectErrorCode.NO_SPACE, message: "disk full" } },
});
const filesUnder = (root: string) => [...disk.keys()].filter(path => path.startsWith(`${root}/`));

function createHarness() {
    const asset: Asset<AssetType.Model, AssetSource.Local> = {
        id: ID, type: AssetType.Model, source: AssetSource.Local, name: "Model", hash: "old",
        meta: {}, tags: [], description: "",
    };
    const metadata = Object.fromEntries(Object.values(AssetType).map(type => [type, {}])) as AssetsMap;
    metadata[AssetType.Model][ID] = asset;
    const filesystem = {
        isDirExists: async (path: string) => ({ ok: true, data: filesUnder(path).length > 0 }),
        createDir: async () => ({ ok: true, data: undefined }),
    };
    const context = {
        project: { resolve: (...parts: (string | string[])[]) => [ROOT, ...parts.flat()].join("/") },
        services: { get: (id: Services) => id === Services.FileSystem ? filesystem : { generate: () => "scratch-id" } },
    };
    const assets = {
        getContext: () => context,
        getAssetsMetadataManager: () => ({ getAssets: () => metadata }),
        modelService: {
            listBundle: async (path: string) => {
                const files = filesUnder(path).map(file => file.slice(path.length + 1)).sort();
                return files.length
                    ? { success: true, data: { files, totalBytes: files.length } }
                    : { success: false, error: "not found" };
            },
        },
    };
    return { manager: new LocalAssetsManager(assets as never, context as never), asset };
}

beforeEach(() => {
    disk.clear();
    disk.set(`${DEST}/old.model3.json`, "old");
    disk.set(`${SOURCE}/new.model3.json`, "new");
    host.copyDir.mockReset().mockImplementation(async (src: string, dest: string) => {
        for (const path of filesUnder(src)) disk.set(dest + path.slice(src.length), disk.get(path)!);
        return ok();
    });
    host.deleteDir.mockReset().mockImplementation(async (path: string) => {
        filesUnder(path).forEach(file => disk.delete(file));
        return ok();
    });
    host.moveDir.mockReset().mockImplementation(async (src: string, dest: string) => {
        for (const path of filesUnder(src)) {
            disk.set(dest + path.slice(src.length), disk.get(path)!);
            disk.delete(path);
        }
        return ok();
    });
});

describe("replacing a model bundle", () => {
    it("keeps the old bundle if copying the replacement fails", async () => {
        const { manager, asset } = createHarness();
        host.copyDir.mockResolvedValueOnce(failure());

        const result = await manager.writeAssetContentFromPath(asset, SOURCE);

        expect(result.success).toBe(false);
        expect(disk.get(`${DEST}/old.model3.json`)).toBe("old");
    });

    it("replaces the tree without leaving files from the old bundle", async () => {
        const { manager, asset } = createHarness();
        const result = await manager.writeAssetContentFromPath(asset, SOURCE);

        expect(result.success).toBe(true);
        expect(filesUnder(DEST)).toEqual([`${DEST}/new.model3.json`]);
    });

    it("restores the old bundle if installing the prepared tree fails", async () => {
        const { manager, asset } = createHarness();
        host.moveDir.mockImplementationOnce(async (src: string, dest: string) => {
            for (const path of filesUnder(src)) {
                disk.set(dest + path.slice(src.length), disk.get(path)!);
                disk.delete(path);
            }
            return ok();
        }).mockResolvedValueOnce(failure());

        const result = await manager.writeAssetContentFromPath(asset, SOURCE);

        expect(result.success).toBe(false);
        expect(disk.get(`${DEST}/old.model3.json`)).toBe("old");
    });

    it("keeps the old bundle in the scratch directory if restoration also fails", async () => {
        const { manager, asset } = createHarness();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        host.moveDir.mockImplementationOnce(async (src: string, dest: string) => {
            for (const path of filesUnder(src)) {
                disk.set(dest + path.slice(src.length), disk.get(path)!);
                disk.delete(path);
            }
            return ok();
        }).mockResolvedValueOnce(failure()).mockResolvedValueOnce(failure());

        try {
            const result = await manager.writeAssetContentFromPath(asset, SOURCE);
            expect(result.success).toBe(false);
            expect(disk.get(`${ROOT}/.nlstudio/convert/scratch-id/previous/old.model3.json`)).toBe("old");
            expect(host.deleteDir).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });
});
