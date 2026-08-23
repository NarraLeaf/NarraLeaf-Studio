import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_MINIMAP_SIZES,
    DEFAULT_BLUEPRINT_MINIMAP_PREFERENCE,
    normalizeBlueprintMinimapPreference,
} from "./blueprintMinimapPreference";

describe("normalizeBlueprintMinimapPreference", () => {
    it("reads a stored preference back", () => {
        expect(normalizeBlueprintMinimapPreference({ visible: false, size: "large" }))
            .toEqual({ visible: false, size: "large" });
    });

    it("defaults a workspace that has never chosen", () => {
        expect(normalizeBlueprintMinimapPreference(undefined)).toEqual(DEFAULT_BLUEPRINT_MINIMAP_PREFERENCE);
        expect(normalizeBlueprintMinimapPreference(null)).toEqual(DEFAULT_BLUEPRINT_MINIMAP_PREFERENCE);
        expect(normalizeBlueprintMinimapPreference("large")).toEqual(DEFAULT_BLUEPRINT_MINIMAP_PREFERENCE);
    });

    it("keeps the half of a record it can read", () => {
        expect(normalizeBlueprintMinimapPreference({ visible: false })).toEqual({ visible: false, size: "medium" });
        expect(normalizeBlueprintMinimapPreference({ size: "small" })).toEqual({ visible: true, size: "small" });
    });

    it("refuses a size it cannot draw", () => {
        expect(normalizeBlueprintMinimapPreference({ visible: true, size: "huge" }).size).toBe("medium");
    });

    it("keeps every size at the canvas's own 16:9", () => {
        for (const { width, height } of Object.values(BLUEPRINT_MINIMAP_SIZES)) {
            expect(width / height).toBeCloseTo(16 / 9, 1);
        }
    });
});
