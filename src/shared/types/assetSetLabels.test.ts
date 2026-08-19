import { describe, expect, it } from "vitest";
import {
    formatAssetSetCoordinateReading,
    readAssetSetAxis,
    readAssetSetCoordinate,
    type AssetSetAxisNaming,
} from "./assetSetLabels";
import { makeAssetSetAxis, type AssetSet, type AssetSetAxis } from "./assetSet";

function naming(overrides: Partial<AssetSetAxisNaming> = {}): AssetSetAxisNaming {
    return {
        locales: new Map([["en", "English"], ["zh-CN", "简体中文"]]),
        editions: new Map([["release", "main"], ["demo", "Demo"]]),
        words: { language: "Language", edition: "Variant" },
        ...overrides,
    };
}

function set(axis: AssetSetAxis): AssetSet {
    return { id: "s", name: "alice", type: "image", filter: ["set:s"], axis };
}

describe("readAssetSetAxis", () => {
    it("names a language axis and the language", () => {
        expect(readAssetSetAxis(makeAssetSetAxis("locale", ["en", "zh-CN"]), "zh-CN", naming()))
            .toEqual({ axis: "Language", value: "简体中文" });
    });

    it("names an edition axis and the edition", () => {
        expect(readAssetSetAxis(makeAssetSetAxis("release", ["release", "demo"]), "demo", naming()))
            .toEqual({ axis: "Variant", value: "Demo" });
    });

    it("prints a value the project no longer declares as it is stored", () => {
        expect(readAssetSetAxis(makeAssetSetAxis("locale", ["ja"]), "ja", naming()))
            .toEqual({ axis: "Language", value: "ja" });
    });

    it("ignores surrounding space on either side", () => {
        expect(readAssetSetAxis(makeAssetSetAxis("release", ["demo"]), " demo ", naming()))
            .toEqual({ axis: "Variant", value: "Demo" });
    });
});

describe("readAssetSetCoordinate", () => {
    it("reads the set's own axis", () => {
        const readings = readAssetSetCoordinate(
            set(makeAssetSetAxis("locale", ["en", "zh-CN"])),
            { locale: "en" },
            naming(),
        );
        expect(readings).toEqual([{ axis: "Language", value: "English" }]);
    });

    it("answers nothing when the coordinate says nothing about that axis", () => {
        const readings = readAssetSetCoordinate(
            set(makeAssetSetAxis("release", ["demo"])),
            { locale: "en" },
            naming(),
        );
        expect(readings).toEqual([]);
    });

    it("writes one line for a row that has one", () => {
        expect(formatAssetSetCoordinateReading([
            { axis: "Variant", value: "Demo" },
            { axis: "Language", value: "English" },
        ])).toBe("Variant: Demo · Language: English");
    });
});
