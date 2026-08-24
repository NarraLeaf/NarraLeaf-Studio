import { describe, expect, it } from "vitest";
import {
    DEFAULT_WINDOW_CONFIGURATION,
    nearestWindowScaleStep,
    normalizeWindowConfiguration,
    normalizeWindowScaleSteps,
    WINDOW_SCALE_STEPS,
} from "./appWindow";

describe("normalizeWindowConfiguration", () => {
    it("reads a project that never opened the page as the defaults", () => {
        expect(normalizeWindowConfiguration(undefined)).toEqual(DEFAULT_WINDOW_CONFIGURATION);
        expect(normalizeWindowConfiguration(null)).toEqual(DEFAULT_WINDOW_CONFIGURATION);
        expect(normalizeWindowConfiguration("nonsense")).toEqual(DEFAULT_WINDOW_CONFIGURATION);
    });

    it("keeps the switches the author set", () => {
        expect(normalizeWindowConfiguration({
            resizable: false,
            rememberGeometry: false,
            startFullscreen: true,
        })).toEqual({
            scaleSteps: DEFAULT_WINDOW_CONFIGURATION.scaleSteps,
            resizable: false,
            rememberGeometry: false,
            startFullscreen: true,
        });
    });
});

describe("normalizeWindowScaleSteps", () => {
    it("always offers the design size", () => {
        expect(normalizeWindowScaleSteps([])).toEqual([1]);
        expect(normalizeWindowScaleSteps([0.5])).toEqual([0.5, 1]);
    });

    it("drops sizes this ladder does not have, and orders what is left", () => {
        expect(normalizeWindowScaleSteps([2, 0.63, "1.5", 0.75, 0.75])).toEqual([0.75, 1, 2]);
    });

    it("falls back to the defaults when the field is not a list", () => {
        expect(normalizeWindowScaleSteps("all")).toEqual(DEFAULT_WINDOW_CONFIGURATION.scaleSteps);
    });
});

describe("nearestWindowScaleStep", () => {
    it("answers a size this project does not offer with the closest one it does", () => {
        expect(nearestWindowScaleStep(0.9, [0.5, 1])).toBe(1);
        expect(nearestWindowScaleStep(0.6, [0.5, 1])).toBe(0.5);
        expect(nearestWindowScaleStep(4, [...WINDOW_SCALE_STEPS])).toBe(2);
    });

    it("has the design size to fall back on when nothing is offered", () => {
        expect(nearestWindowScaleStep(0.5, [])).toBe(1);
    });
});
