import { describe, expect, it } from "vitest";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset } from "@/lib/workspace/services/assets/types";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { ReferenceIndexResult } from "@/lib/workspace/services/references/referenceModel";
import type { DirectorySizeResult } from "@shared/utils/fs";
import { buildAssetOverview } from "./assetOverviewModel";
import { assetBytesFromWalk, assetContentRelativePath, computeAssetOverviewSnapshot } from "./assetOverviewSnapshot";

function asset(id: string, type: AssetType): Asset {
    return { id, name: id, type, hash: id, source: AssetSource.Local, meta: {}, tags: [], description: "" } as Asset;
}

describe("assetBytesFromWalk for directory assets", () => {
    it("attributes every file in a model bundle to that asset", () => {
        const model = asset("abcdef01-2345-6789-abcd-ef0123456789", AssetType.Model);
        const image = asset("12345678-2345-6789-abcd-ef0123456789", AssetType.Image);
        const modelPath = assetContentRelativePath(model)!;
        const imagePath = assetContentRelativePath(image)!;
        const bytes = assetBytesFromWalk([model, image], {
            [`${modelPath}/model.json`]: 100,
            [`${modelPath}/textures/face.png`]: 900,
            [`${modelPath}-other/extra.png`]: 500,
            [imagePath]: 200,
        });

        expect(bytes.get(model.id)).toBe(1000);
        expect(bytes.get(image.id)).toBe(200);

        const summary = buildAssetOverview({
            assets: [model, image],
            bytesByAssetId: bytes,
            referenceCountByAssetId: new Map([[model.id, 1]]),
            indexResult: { complete: true, gaps: [] },
            directoryBytes: 1700,
            directoryFileCount: 4,
            topCount: 2,
        });
        expect(summary.total.bytes).toBe(1200);
        expect(summary.referenced.bytes).toBe(1000);
        expect(summary.largest[0].asset.id).toBe(model.id);
    });

    it("keeps the size unknown when a model has no files in the walk", () => {
        const model = asset("abcdef01-2345-6789-abcd-ef0123456789", AssetType.Model);
        expect(assetBytesFromWalk([model], {}).has(model.id)).toBe(false);
    });
});

describe("computeAssetOverviewSnapshot", () => {
    it("uses the coverage from the same index pass as its reference counts", async () => {
        const picture = asset("abcdef01-2345-6789-abcd-ef0123456789", AssetType.Image);
        let index: ReferenceIndexResult = {
            complete: false,
            gaps: [{ reason: "computedAssetPin", affects: ["image"] }],
        };
        let resolveWalk!: (result: { ok: true; data: DirectorySizeResult }) => void;
        let startedWalk!: () => void;
        const walkStarted = new Promise<void>(resolve => { startedWalk = resolve; });
        const pendingWalk = new Promise<{ ok: true; data: DirectorySizeResult }>(resolve => { resolveWalk = resolve; });
        const services = {
            [Services.Assets]: { getAssets: () => ({ image: { [picture.id]: picture } }) },
            [Services.Reference]: {
                ensureReady: async () => {},
                flushPendingRebuilds: async () => {},
                getReferencesForAll: () => new Map(),
                getIndexResult: () => index,
            },
            [Services.FileSystem]: { directorySize: () => { startedWalk(); return pendingWalk; } },
        };
        const context = {
            services: { get: (key: keyof typeof services) => services[key] },
            project: { resolve: () => "/project/assets/" },
        } as unknown as WorkspaceContext;

        const pending = computeAssetOverviewSnapshot(context);
        await walkStarted;
        index = { complete: true, gaps: [] };
        resolveWalk({ ok: true, data: { totalBytes: 10, fileCount: 1, bytesByRelativePath: {
            [assetContentRelativePath(picture)!]: 10,
        } } });
        const { summary } = await pending;

        expect(summary.entries[0].usageKnown).toBe(false);
        expect(summary.orphan.count).toBe(0);
    });
});
