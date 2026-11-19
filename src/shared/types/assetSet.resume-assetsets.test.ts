import { describe, expect, it } from "vitest";
import {
    assetSetParent,
    assetSetSubtree,
    childAssetSets,
    makeAssetSetAxis,
    normalizeProjectAssetSets,
    topLevelAssetSets,
    validateAssetSet,
    type AssetSet,
} from "./assetSet";

describe("asset set nesting", () => {
    it("requires a child to add a tag even when its parent's axis value is already in the filter", () => {
        const first: AssetSet = {
            id: "first",
            name: "First",
            type: "image",
            filter: ["set:root", "locale:en"],
            axis: makeAssetSetAxis("locale", ["en", "ja"]),
        };
        const second = { ...first, id: "second", name: "Second" };
        const sets = [first, second];

        expect(childAssetSets(first, "en", sets)).toEqual([]);
        expect(childAssetSets(second, "en", sets)).toEqual([]);
        expect(assetSetParent(first, sets)).toBeNull();
        expect(topLevelAssetSets(sets).map(set => set.id)).toEqual(["first", "second"]);
        expect(assetSetSubtree(first, sets).map(set => set.id)).toEqual(["first"]);
    });
});

describe("asset set migration", () => {
    it("collapses both spellings of the release edition to one axis value", () => {
        const document = normalizeProjectAssetSets({
            sets: [{
                id: "cover",
                name: "Cover",
                type: "image",
                filter: ["set:cover"],
                axis: { kind: "release", values: ["release", "main", "demo"], fallback: "release" },
            }],
        });

        expect(document.sets[0].axis.values).toEqual(["main", "demo"]);
        expect(document.sets[0].axis.fallback).toBe("main");
        expect(validateAssetSet(document.sets[0])).toEqual([]);
        expect(normalizeProjectAssetSets(document)).toEqual(document);
    });
});
