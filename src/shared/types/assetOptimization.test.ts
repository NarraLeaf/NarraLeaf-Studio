import { describe, expect, it } from "vitest";
import {
    DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION,
    normalizeAssetOptimizationConfiguration,
    readAssetOptimizationConfiguration,
} from "./assetOptimization";

describe("normalizeAssetOptimizationConfiguration", () => {
    it("gives a project that never opened the panel the default", () => {
        expect(normalizeAssetOptimizationConfiguration(undefined))
            .toEqual(DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION);
        expect(DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION.lossyImages).toBe(false);
    });

    it("only turns lossy on for a literal true", () => {
        // A config file hand-edited into nonsense must not be able to turn on the
        // one step that cannot be undone.
        for (const value of ["true", 1, {}, null]) {
            expect(normalizeAssetOptimizationConfiguration({ lossyImages: value }).lossyImages).toBe(false);
        }
        expect(normalizeAssetOptimizationConfiguration({ lossyImages: true }).lossyImages).toBe(true);
    });

    it("clamps the quality into the range the panel offers", () => {
        expect(normalizeAssetOptimizationConfiguration({ lossyQuality: 0 }).lossyQuality).toBe(1);
        expect(normalizeAssetOptimizationConfiguration({ lossyQuality: 900 }).lossyQuality).toBe(100);
        expect(normalizeAssetOptimizationConfiguration({ lossyQuality: 70.9 }).lossyQuality).toBe(70);
        expect(normalizeAssetOptimizationConfiguration({ lossyQuality: "nonsense" }).lossyQuality)
            .toBe(DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION.lossyQuality);
    });
});

describe("readAssetOptimizationConfiguration", () => {
    it("reads the key the setting lives under", () => {
        expect(readAssetOptimizationConfiguration({ assetOptimization: { lossyImages: true, lossyQuality: 60 } }))
            .toEqual({ lossyImages: true, lossyQuality: 60 });
    });

    it("still reads a project last written under the old key", () => {
        // `app.webOptimization` carried these same two fields beside two switches
        // for steps that are now unconditional. The decision survives the rename;
        // the switches had nothing to carry.
        expect(readAssetOptimizationConfiguration({
            webOptimization: { losslessImages: false, precompress: false, lossyImages: true, lossyQuality: 55 },
        })).toEqual({ lossyImages: true, lossyQuality: 55 });
    });

    it("prefers the new key when a project carries both", () => {
        expect(readAssetOptimizationConfiguration({
            assetOptimization: { lossyImages: false, lossyQuality: 82 },
            webOptimization: { lossyImages: true, lossyQuality: 40 },
        })).toEqual({ lossyImages: false, lossyQuality: 82 });
    });

    it("answers for a project with no app config at all", () => {
        expect(readAssetOptimizationConfiguration(undefined)).toEqual(DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION);
        expect(readAssetOptimizationConfiguration({})).toEqual(DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION);
    });
});
