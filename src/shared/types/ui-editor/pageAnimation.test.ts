import { describe, expect, it } from "vitest";
import {
    DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
    normalizeOptionalUIPageAnimationSettings,
    normalizeUIPageAnimationSettings,
} from "./pageAnimation";

describe("UI page animation settings", () => {
    it("normalizes missing and partial settings to defaults", () => {
        expect(normalizeUIPageAnimationSettings(null)).toEqual(DEFAULT_UI_PAGE_ANIMATION_SETTINGS);
        expect(normalizeUIPageAnimationSettings({ enter: "fade" })).toEqual({
            ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
            enter: "fade",
        });
    });

    it("keeps valid legacy enter/exit strings and rejects invalid values", () => {
        expect(
            normalizeUIPageAnimationSettings({
                enter: "slide",
                exit: "blur",
                direction: "left",
                speed: "slow",
            }),
        ).toEqual({
            enter: "slide",
            exit: "blur",
            direction: "left",
            speed: "slow",
        });
        expect(
            normalizeUIPageAnimationSettings({
                enter: "spin",
                exit: "explode",
                direction: "diagonal",
                speed: "instant",
            }),
        ).toEqual(DEFAULT_UI_PAGE_ANIMATION_SETTINGS);
    });

    it("keeps optional settings undefined for inherited Page component animation", () => {
        expect(normalizeOptionalUIPageAnimationSettings(undefined)).toBeUndefined();
        expect(normalizeOptionalUIPageAnimationSettings({ enter: "fade" })).toEqual({
            ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
            enter: "fade",
        });
    });
});
