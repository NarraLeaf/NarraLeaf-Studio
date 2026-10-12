import { describe, expect, it } from "vitest";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset, type AssetGroup } from "@/lib/workspace/services/assets/types";
import { createEmptyAssetCategoryRecord } from "../state/assetCategoryRecord";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import {
    assetBrowserItemUsage,
    assetBrowserLocationItems,
    assetBrowserResultItems,
    assetBrowserRowOrder,
    assetBrowserStepTarget,
    groupPath,
    nextAssetBrowserSort,
    parentAssetBrowserLocation,
    resolveAssetBrowserLocation,
    sortAssetBrowserItems,
    type AssetBrowserItem,
    type AssetBrowserLibrary,
    type AssetBrowserMeasures,
} from "./assetBrowserModel";

function group(id: string, name: string, parentGroupId?: string, category = AssetCategory.Image): AssetGroup {
    return { id, name, category, parentGroupId, createdAt: 0, updatedAt: 0 };
}

function image(id: string, name: string, groupId?: string, ext = "png"): Asset {
    return {
        id,
        type: AssetType.Image,
        name,
        ext,
        hash: id,
        source: AssetSource.Local,
        meta: {} as Asset["meta"],
        tags: [],
        description: "",
        ...(groupId ? { groupId } : {}),
    };
}

const CHARACTERS = group("g-chars", "Characters");
const FACES = group("g-faces", "Faces", CHARACTERS.id);
const BACKGROUNDS = group("g-bg", "Backgrounds");

function library(assets: Asset[], groups: AssetGroup[] = [CHARACTERS, FACES, BACKGROUNDS]): AssetBrowserLibrary {
    const assetRecord = createEmptyAssetCategoryRecord<Asset>();
    assetRecord[AssetCategory.Image] = assets;
    const groupRecord = createEmptyAssetCategoryRecord<AssetGroup>();
    groupRecord[AssetCategory.Image] = groups;
    return {
        assets: assetRecord,
        groups: groupRecord,
        assetSets: createEmptyAssetCategoryRecord<ResolvedAssetSet>(),
        rootAssetSets: createEmptyAssetCategoryRecord<ResolvedAssetSet>(),
        memberAssetIds: new Set(),
    };
}

const NO_MEASURES: AssetBrowserMeasures = { bytesByAssetId: null, referenceCountByAssetId: null, usageUnknownAssetIds: null };
const describeCell = () => "";

describe("asset browser locations", () => {
    it("walks a folder's path from the category root down", () => {
        expect(groupPath(FACES.id, [CHARACTERS, FACES, BACKGROUNDS]).map(entry => entry.name)).toEqual(["Characters", "Faces"]);
        expect(groupPath(undefined, [CHARACTERS])).toEqual([]);
    });

    it("stops walking a hand-edited folder list that loops", () => {
        const a = group("a", "A", "b");
        const b = group("b", "B", "a");
        expect(groupPath("a", [a, b]).map(entry => entry.id)).toEqual(["b", "a"]);
    });

    it("brings a deleted folder back to its category's root", () => {
        const groups = library([]).groups;
        expect(resolveAssetBrowserLocation({ category: AssetCategory.Image, groupId: "gone" }, groups))
            .toEqual({ category: AssetCategory.Image });
        expect(resolveAssetBrowserLocation({ category: AssetCategory.Image, groupId: FACES.id }, groups))
            .toEqual({ category: AssetCategory.Image, groupId: FACES.id });
        expect(resolveAssetBrowserLocation(null, groups)).toEqual({ category: AssetCategory.Image });
    });

    it("goes up a folder at a time and stops at the root", () => {
        const groups = library([]).groups;
        expect(parentAssetBrowserLocation({ category: AssetCategory.Image, groupId: FACES.id }, groups))
            .toEqual({ category: AssetCategory.Image, groupId: CHARACTERS.id });
        expect(parentAssetBrowserLocation({ category: AssetCategory.Image, groupId: CHARACTERS.id }, groups))
            .toEqual({ category: AssetCategory.Image });
        expect(parentAssetBrowserLocation({ category: AssetCategory.Image }, groups)).toBeNull();
    });
});

describe("what a place holds", () => {
    const files = [
        image("a-hero", "hero", CHARACTERS.id),
        image("a-smile", "smile", FACES.id),
        image("a-loose", "logo"),
        image("a-room", "room", BACKGROUNDS.id),
    ];

    it("lists the folders and the loose files at the root, and nothing filed deeper", () => {
        const items = assetBrowserLocationItems({ category: AssetCategory.Image }, [], library(files), describeCell);
        expect(items.map(item => item.key)).toEqual(["group:g-chars", "group:g-bg", "asset:a-loose"]);
    });

    it("lists what is filed in one folder", () => {
        const items = assetBrowserLocationItems({ category: AssetCategory.Image, groupId: CHARACTERS.id }, [], library(files), describeCell);
        expect(items.map(item => item.key)).toEqual(["group:g-faces", "asset:a-hero"]);
    });

    it("counts a folder's direct contents and previews pictures from anywhere inside it", () => {
        const items = assetBrowserLocationItems({ category: AssetCategory.Image }, [], library(files), describeCell);
        const characters = items.find(item => item.key === "group:g-chars");
        expect(characters?.kind).toBe("group");
        if (characters?.kind === "group") {
            // One sub-folder and one file directly inside; the file in the sub-folder is previewed.
            expect(characters.childCount).toBe(2);
            expect(characters.preview.map(asset => asset.id)).toEqual(["a-hero", "a-smile"]);
        }
    });

    it("finds results across the library: matched folders, then files", () => {
        const lib = library(files);
        const filteredAssets = createEmptyAssetCategoryRecord<Asset>();
        filteredAssets[AssetCategory.Image] = [files[1]];
        const filteredGroups = createEmptyAssetCategoryRecord<AssetGroup>();
        filteredGroups[AssetCategory.Image] = [CHARACTERS, FACES];
        const items = assetBrowserResultItems({
            filteredAssets,
            filteredGroups,
            // Characters is only the scaffolding a tree needs to reach Faces; it is not a hit.
            matchedGroupIds: new Set([FACES.id]),
            library: lib,
            query: "fa",
        });
        expect(items.map(item => item.key)).toEqual(["group:g-faces", "asset:a-smile"]);
    });
});

describe("sorting the contents", () => {
    const files = [
        image("a-1", "b-file", undefined, "png"),
        image("a-2", "a-file", undefined, "webp"),
        image("a-3", "c-file", undefined, "jpg"),
    ];
    const items = assetBrowserLocationItems({ category: AssetCategory.Image }, [], library(files, [BACKGROUNDS]), describeCell);

    it("keeps the library's own order with no sort", () => {
        expect(sortAssetBrowserItems(items, null, NO_MEASURES).map(item => item.key))
            .toEqual(["group:g-bg", "asset:a-1", "asset:a-2", "asset:a-3"]);
    });

    it("sorts files by name and keeps folders first in both directions", () => {
        expect(sortAssetBrowserItems(items, { key: "name", direction: "asc" }, NO_MEASURES).map(item => item.key))
            .toEqual(["group:g-bg", "asset:a-2", "asset:a-1", "asset:a-3"]);
        expect(sortAssetBrowserItems(items, { key: "name", direction: "desc" }, NO_MEASURES).map(item => item.key))
            .toEqual(["group:g-bg", "asset:a-3", "asset:a-1", "asset:a-2"]);
    });

    it("sorts by size with the sizes it does not know last either way", () => {
        const measures: AssetBrowserMeasures = {
            ...NO_MEASURES,
            bytesByAssetId: new Map([["a-1", 300], ["a-3", 100]]),
        };
        expect(sortAssetBrowserItems(items, { key: "size", direction: "asc" }, measures).map(item => item.key))
            .toEqual(["group:g-bg", "asset:a-3", "asset:a-1", "asset:a-2"]);
        expect(sortAssetBrowserItems(items, { key: "size", direction: "desc" }, measures).map(item => item.key))
            .toEqual(["group:g-bg", "asset:a-1", "asset:a-3", "asset:a-2"]);
    });

    it("says how many places use a file, and says none only where the index can vouch for it", () => {
        const measures: AssetBrowserMeasures = {
            bytesByAssetId: null,
            referenceCountByAssetId: new Map([["a-1", 2], ["a-2", 0], ["a-3", 0]]),
            // The index has gaps for a-1 and a-3: what it found is still found, its "none" is not.
            usageUnknownAssetIds: new Set(["a-1", "a-3"]),
        };
        const usage = Object.fromEntries(items
            .filter(item => item.kind === "asset")
            .map(item => [item.key, assetBrowserItemUsage(item, measures)]));
        expect(usage).toEqual({ "asset:a-1": 2, "asset:a-2": 0, "asset:a-3": null });
    });

    it("walks a header through ascending, descending and back to no sort", () => {
        const first = nextAssetBrowserSort(null, "size");
        expect(first).toEqual({ key: "size", direction: "asc" });
        const second = nextAssetBrowserSort(first, "size");
        expect(second).toEqual({ key: "size", direction: "desc" });
        expect(nextAssetBrowserSort(second, "size")).toBeNull();
        expect(nextAssetBrowserSort(second, "name")).toEqual({ key: "name", direction: "asc" });
    });

    it("slices shift ranges out of the order the items are drawn in", () => {
        const sorted = sortAssetBrowserItems(items, { key: "name", direction: "asc" }, NO_MEASURES);
        expect(assetBrowserRowOrder(sorted)).toEqual(["group:g-bg", "asset:a-2", "asset:a-1", "asset:a-3"]);
    });
});

describe("moving the selection with the keys", () => {
    const set = (id: string): AssetBrowserItem => ({
        key: "set:" + id,
        kind: "set",
        category: AssetCategory.Image,
        entry: { set: { id } } as unknown as ResolvedAssetSet,
        movable: true,
    });
    const file = (id: string): AssetBrowserItem => ({ key: "asset:" + id, kind: "asset", category: AssetCategory.Image, asset: image(id, id) });
    // Drawn three to a row:  s1 s2 f1 / f2 f3 f4 / f5
    const items = [set("s1"), set("s2"), file("f1"), file("f2"), file("f3"), file("f4"), file("f5")];
    const grid = { view: "grid" as const, columns: 3 };
    const details = { view: "details" as const, columns: 3 };

    it("steps sideways in the grid and over what cannot be selected", () => {
        expect(assetBrowserStepTarget(items, 2, "right", grid)).toBe(3);
        expect(assetBrowserStepTarget(items, 3, "left", grid)).toBe(2);
        // Nothing selectable before the first file.
        expect(assetBrowserStepTarget(items, 2, "left", grid)).toBeNull();
        expect(assetBrowserStepTarget(items, 6, "right", grid)).toBeNull();
    });

    it("steps a row in the grid, to the last item when the row below is shorter", () => {
        expect(assetBrowserStepTarget(items, 3, "down", grid)).toBe(6);
        expect(assetBrowserStepTarget(items, 5, "down", grid)).toBe(6);
        expect(assetBrowserStepTarget(items, 6, "down", grid)).toBeNull();
        expect(assetBrowserStepTarget(items, 5, "up", grid)).toBe(2);
        // Above f2 is a set: the nearest selectable item before it in that direction is taken, and
        // there is none, so the selection goes forward to the first file instead.
        expect(assetBrowserStepTarget(items, 3, "up", grid)).toBe(2);
        expect(assetBrowserStepTarget(items, 2, "up", grid)).toBeNull();
    });

    it("steps one row at a time in the table, where left and right do nothing", () => {
        expect(assetBrowserStepTarget(items, 3, "down", details)).toBe(4);
        expect(assetBrowserStepTarget(items, 3, "up", details)).toBe(2);
        expect(assetBrowserStepTarget(items, 2, "up", details)).toBeNull();
        expect(assetBrowserStepTarget(items, 3, "right", details)).toBeNull();
        expect(assetBrowserStepTarget(items, 3, "left", details)).toBeNull();
    });

    it("starts from the first item when nothing is selected, and goes to either end", () => {
        expect(assetBrowserStepTarget(items, -1, "down", grid)).toBe(2);
        expect(assetBrowserStepTarget(items, -1, "up", details)).toBe(2);
        expect(assetBrowserStepTarget(items, 5, "first", grid)).toBe(2);
        expect(assetBrowserStepTarget(items, 2, "last", grid)).toBe(6);
        expect(assetBrowserStepTarget([set("s1")], -1, "down", grid)).toBeNull();
        expect(assetBrowserStepTarget([], -1, "last", grid)).toBeNull();
    });
});
