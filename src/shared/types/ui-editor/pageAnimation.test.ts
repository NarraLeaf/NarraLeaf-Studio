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
                enterDirection: "angle",
                exitDirection: "up",
                enterAngleDegrees: 405.123,
                exitAngleDegrees: -90,
                enterDurationSeconds: 1.234,
                exitDurationSeconds: 12,
                exitBlocking: true,
            }),
        ).toEqual({
            enter: "slide",
            exit: "blur",
            enterDirection: "angle",
            exitDirection: "up",
            enterAngleDegrees: 45.12,
            exitAngleDegrees: 270,
            enterDurationSeconds: 1.23,
            exitDurationSeconds: 10,
            exitBlocking: true,
        });
        expect(
            normalizeUIPageAnimationSettings({
                enter: "spin",
                exit: "explode",
                direction: "diagonal",
                enterDurationSeconds: -1,
                exitDurationSeconds: Number.NaN,
            }),
        ).toEqual({
            ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
            enterDurationSeconds: 0,
        });
    });

    it("maps legacy speed values to enter and exit durations", () => {
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
            enterDirection: "left",
            exitDirection: "left",
            enterAngleDegrees: 0,
            exitAngleDegrees: 180,
            enterDurationSeconds: 0.42,
            exitDurationSeconds: 0.42,
            exitBlocking: true,
        });
        expect(
            normalizeUIPageAnimationSettings({
                enter: "fade",
                speed: "fast",
                enterDurationSeconds: 0.8,
            }),
        ).toEqual({
            ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
            enter: "fade",
            enterDurationSeconds: 0.8,
            exitDurationSeconds: 0.16,
        });
    });

    it("keeps optional settings undefined for inherited Page component animation", () => {
        expect(normalizeOptionalUIPageAnimationSettings(undefined)).toBeUndefined();
        expect(normalizeOptionalUIPageAnimationSettings({ enter: "fade" })).toEqual({
            ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
            enter: "fade",
        });
    });
});
