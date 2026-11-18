// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset } from "@/lib/workspace/services/assets/types";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { assetContentRelativePath } from "./assetOverviewSnapshot";
import { useAssetLibrarySnapshot } from "./useAssetLibrarySnapshot";

async function settle() {
    await act(async () => {
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
}

describe("useAssetLibrarySnapshot with the real snapshot projection", () => {
    it("projects newly loaded records without repeating the directory walk", async () => {
        const picture = {
            id: "abcdef01-2345-6789-abcd-ef0123456789", name: "Picture", type: AssetType.Image,
            hash: "hash", source: AssetSource.Local, meta: {}, tags: [], description: "",
        } as Asset;
        let assets: Asset[] = [];
        const directorySize = vi.fn(async () => ({ ok: true, data: {
            totalBytes: 42, fileCount: 1, bytesByRelativePath: { [assetContentRelativePath(picture)!]: 42 },
        } }));
        const services = {
            [Services.Assets]: { getAssets: () => ({ image: Object.fromEntries(assets.map(item => [item.id, item])) }) },
            [Services.Reference]: {
                ensureReady: async () => {},
                flushPendingRebuilds: async () => {},
                getReferencesForAll: (ids: string[]) => new Map(ids.map(id => [id, [{}]])),
                getIndexResult: () => ({ complete: true, gaps: [] }),
                onIndexChanged: () => () => {},
            },
            [Services.FileSystem]: { directorySize },
        };
        const context = {
            services: { get: (key: keyof typeof services) => services[key] },
            project: { resolve: () => "/project/assets/" },
        } as unknown as WorkspaceContext;
        const { result, rerender } = renderHook(({ key }) => useAssetLibrarySnapshot(context, true, key), {
            initialProps: { key: undefined as string | undefined },
        });
        await settle();
        expect(result.current.snapshot?.total.count).toBe(0);

        assets = [picture];
        rerender({ key: `${picture.id}:${picture.hash}` });
        await settle();

        expect(result.current.snapshot?.total).toEqual({ count: 1, bytes: 42 });
        expect(result.current.snapshot?.referenced).toEqual({ count: 1, bytes: 42 });
        expect(directorySize).toHaveBeenCalledTimes(1);
    });
});
