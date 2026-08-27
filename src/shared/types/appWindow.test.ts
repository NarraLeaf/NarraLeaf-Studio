import { describe, expect, it } from "vitest";
import {
    DEFAULT_WINDOW_CONFIGURATION,
    nearestWindowScaleStep,
    normalizeWindowConfiguration,
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
            resizable: false,
            rememberGeometry: false,
            startFullscreen: true,
        });
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
