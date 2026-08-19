import { describe, expect, it } from "vitest";
import {
    formatAssetSetCoordinateReading,
    isLanguageAxis,
    readAssetSetAxis,
    readAssetSetCoordinate,
    type AssetSetAxisNaming,
} from "./assetSetLabels";
import type { AssetSet, AssetSetAxis } from "./assetSet";

const LOCALES = new Map([["en", "English"], ["zh-CN", "简体中文"]]);

function naming(overrides: Partial<AssetSetAxisNaming> = {}): AssetSetAxisNaming {
    return {
        locales: LOCALES,
        editionsByAxis: new Map([["rating", new Map([["all-ages", ["Demo"]], ["adult", ["Release"]]])]]),
        words: { language: "Language", edition: "Variant" },
        ...overrides,
    };
}

function axis(key: string, values: string[], residency: AssetSetAxis["residency"] = "build"): AssetSetAxis {
    return { key, residency, values };
}

function set(axes: AssetSetAxis[]): AssetSet {
    return { id: "s", name: "alice", type: "image", filter: ["char:alice"], axes };
}

describe("isLanguageAxis", () => {
    it("is a language axis when every value is a declared language", () => {
        expect(isLanguageAxis(axis("locale", ["en", "zh-CN"]), LOCALES)).toBe(true);
    });

    it("is not one when a value is not declared", () => {
        expect(isLanguageAxis(axis("locale", ["en", "ja"]), LOCALES)).toBe(false);
    });

    it("is not one when it ranges over nothing", () => {
        expect(isLanguageAxis(axis("locale", []), LOCALES)).toBe(false);
    });
});

describe("readAssetSetAxis", () => {
    it("names a language axis and its language", () => {
        expect(readAssetSetAxis(axis("locale", ["en", "zh-CN"]), "zh-CN", naming()))
            .toEqual({ axis: "Language", value: "简体中文" });
    });

    it("names the edition that declares the value for itself", () => {
        expect(readAssetSetAxis(axis("rating", ["all-ages", "adult"]), "all-ages", naming()))
            .toEqual({ axis: "Variant", value: "Demo" });
    });

    it("prints the tag when two editions declare the same value", () => {
        const shared = naming({
            editionsByAxis: new Map([["rating", new Map([["all-ages", ["Demo", "Trial"]]])]]),
        });
        expect(readAssetSetAxis(axis("rating", ["all-ages"]), "all-ages", shared))
            .toEqual({ axis: "rating", value: "all-ages" });
    });

    it("prints the tag for an axis the project says nothing about", () => {
        expect(readAssetSetAxis(axis("mood", ["happy", "sad"]), "happy", naming()))
            .toEqual({ axis: "mood", value: "happy" });
    });

    it("reads a value the project does not declare as itself", () => {
        // The axis is not a language axis, so no lookup is attempted for its values.
        expect(readAssetSetAxis(axis("locale", ["en", "ja"]), "ja", naming()))
            .toEqual({ axis: "locale", value: "ja" });
    });

    it("ignores surrounding space on either side", () => {
        expect(readAssetSetAxis(axis(" rating ", ["all-ages"]), " all-ages ", naming()))
            .toEqual({ axis: "Variant", value: "Demo" });
    });
});

describe("readAssetSetCoordinate", () => {
    it("reads every axis, outermost first", () => {
        const readings = readAssetSetCoordinate(
            set([axis("rating", ["all-ages", "adult"]), axis("locale", ["en", "zh-CN"], "runtime")]),
            { rating: "adult", locale: "en" },
            naming(),
        );
        expect(readings).toEqual([
            { axis: "Variant", value: "Release" },
            { axis: "Language", value: "English" },
        ]);
    });

    it("leaves out an axis the coordinate says nothing about", () => {
        const readings = readAssetSetCoordinate(
            set([axis("rating", ["adult"]), axis("mood", ["happy"])]),
            { rating: "adult" },
            naming(),
        );
        expect(readings).toEqual([{ axis: "Variant", value: "Release" }]);
    });

    it("writes one line for a row that has one", () => {
        expect(formatAssetSetCoordinateReading([
            { axis: "Variant", value: "Demo" },
            { axis: "Language", value: "English" },
        ])).toBe("Variant: Demo · Language: English");
    });
});
