import { describe, expect, it } from "vitest";
import {
    clampSliderValue,
    defaultSliderWidgetProps,
    normalizedSliderValueToMapped,
    normalizeSliderProps,
    normalizeSliderRange,
    resolveSliderRuntimeValue,
    sliderValueToNormalized,
} from "./slider";

describe("UI slider helpers", () => {
    it("normalizes default props and invalid ranges", () => {
        expect(normalizeSliderProps(undefined)).toEqual(defaultSliderWidgetProps);
        expect(normalizeSliderRange({ min: 10, max: 4, step: -2 })).toEqual({
            min: 10,
            max: 11,
            step: 0,
        });
    });

    it("clamps and snaps mapped values", () => {
        const range = { min: -10, max: 10, step: 2.5 };

        expect(clampSliderValue(-99, range)).toBe(-10);
        expect(clampSliderValue(99, range)).toBe(10);
        expect(clampSliderValue(3.7, range)).toBe(2.5);
        expect(clampSliderValue(3.7, { ...range, step: 0 })).toBe(3.7);
    });

    it("maps between normalized and authored values", () => {
        const range = { min: 20, max: 60, step: 10 };

        expect(sliderValueToNormalized(40, range)).toBe(0.5);
        expect(normalizedSliderValueToMapped(0.76, range)).toBe(50);
        expect(resolveSliderRuntimeValue({ value: 61, ...range })).toEqual({
            min: 20,
            max: 60,
            step: 10,
            value: 60,
            normalizedValue: 1,
        });
    });
});
