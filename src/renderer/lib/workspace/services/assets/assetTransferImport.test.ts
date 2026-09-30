import { describe, expect, it } from "vitest";
import { AssetType } from "./assetTypes";
import { AssetSource, type Asset, type AssetsMap } from "./types";
import { buildAssetTransferEntries } from "./assetTransferImport";
import type { AssetsService } from "../core/AssetsService";

/**
 * What a copy vouches for when it offers its selection's files to another window.
 *
 * The manifest is where the two halves of a directory-backed asset meet: it is the only place that
 * says a model bundle is a tree, and both the recursive grant the main process mints and the copy
 * the pasting project performs are decided by that one field.
 */

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

function record<T extends AssetType>(type: T, id: string, name: string): Asset<T, AssetSource.Local> {
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

/** A library, as `buildAssetTransferEntries` asks about one. */
function library(...assets: Asset<AssetType, AssetSource.Local>[]): AssetsService {
    const map = emptyAssetsMap();
    for (const asset of assets) {
        (map[asset.type] as Record<string, unknown>)[asset.id] = asset;
    }
    return {
        getAssets: () => map,
        getLocalAssetsManager: () => ({ getLocalAssetPath: (id: string) => `/projects/a/assets/content/${id}` }),
    } as unknown as AssetsService;
}

describe("describing a selection's files for an offer", () => {
    it("marks a model bundle as a directory and leaves every other type unmarked", () => {
        const service = library(
            record(AssetType.Model, "asset-model", "Hiyori"),
            record(AssetType.Image, "asset-cg", "kaede-cg.png"),
        );

        expect(buildAssetTransferEntries(service, ["asset-model", "asset-cg"])).toEqual([
            {
                assetId: "asset-model",
                fileName: "Hiyori",
                type: AssetType.Model,
                isDirectory: true,
                sourcePath: "/projects/a/assets/content/asset-model",
            },
            {
                assetId: "asset-cg",
                fileName: "kaede-cg.png",
                type: AssetType.Image,
                sourcePath: "/projects/a/assets/content/asset-cg",
            },
        ]);
    });

    it("falls back to the id when a record carries no name", () => {
        // One blank name refuses the whole manifest, so a nameless record is described by its id
        // rather than dropped - which would cost the rest of the selection its files.
        const service = library(record(AssetType.Model, "asset-model", "   "));

        expect(buildAssetTransferEntries(service, ["asset-model"])).toEqual([
            {
                assetId: "asset-model",
                fileName: "asset-model",
                type: AssetType.Model,
                isDirectory: true,
                sourcePath: "/projects/a/assets/content/asset-model",
            },
        ]);
    });

    it("skips an id with no record behind it", () => {
        // An asset set, or a reference this project has already lost. Either way there is nothing
        // to vouch for.
        const service = library(record(AssetType.Image, "asset-cg", "kaede-cg.png"));

        expect(buildAssetTransferEntries(service, ["asset-gone"])).toEqual([]);
    });

    it("offers nothing at all when the library is not open yet", () => {
        const service = {
            getAssets: () => {
                throw new Error("assets not loaded");
            },
        } as unknown as AssetsService;

        expect(buildAssetTransferEntries(service, ["asset-cg"])).toEqual([]);
    });
});
