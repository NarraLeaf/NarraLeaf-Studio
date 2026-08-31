import { describe, expect, it } from "vitest";
import {
    APPEARANCE_PREVIEW_HEIGHT_DEFAULT,
    APPEARANCE_PREVIEW_HEIGHTS,
    resolveAppearancePreviewHeight,
    stepAppearancePreviewHeight,
} from "./appearancePreviewOptions";

/**
 * The ladder the appearance preview walks.
 *
 * Worth pinning because both ends of it are read from persisted state that nobody validates on the
 * way in: a stored height survives a downgrade, and the rungs may be re-cut. A resolver that let a
 * junk value through would hand a `style={{ height }}` a `NaN`, and a stepper that ran off the end
 * would leave the buttons doing nothing with no way to tell that from a disabled one.
 */
describe("appearance preview height", () => {
    it("falls back to the default for anything that is not a number", () => {
        for (const stored of [undefined, null, "288", NaN, Infinity, {}]) {
            expect(resolveAppearancePreviewHeight(stored)).toBe(APPEARANCE_PREVIEW_HEIGHT_DEFAULT);
        }
    });

    it("snaps a stored height to the nearest rung rather than discarding it", () => {
        const largest = APPEARANCE_PREVIEW_HEIGHTS[APPEARANCE_PREVIEW_HEIGHTS.length - 1];
        // An author who asked for the largest size keeps the largest size even if the ladder moves.
        expect(resolveAppearancePreviewHeight(largest + 400)).toBe(largest);
        expect(resolveAppearancePreviewHeight(0)).toBe(APPEARANCE_PREVIEW_HEIGHTS[0]);
        expect(resolveAppearancePreviewHeight(APPEARANCE_PREVIEW_HEIGHTS[1] + 1)).toBe(APPEARANCE_PREVIEW_HEIGHTS[1]);
    });

    it("steps one rung at a time and stops at both ends", () => {
        const [smallest] = APPEARANCE_PREVIEW_HEIGHTS;
        const largest = APPEARANCE_PREVIEW_HEIGHTS[APPEARANCE_PREVIEW_HEIGHTS.length - 1];
        expect(stepAppearancePreviewHeight(smallest, -1)).toBe(smallest);
        expect(stepAppearancePreviewHeight(largest, 1)).toBe(largest);
        expect(stepAppearancePreviewHeight(smallest, 1)).toBe(APPEARANCE_PREVIEW_HEIGHTS[1]);
        expect(stepAppearancePreviewHeight(APPEARANCE_PREVIEW_HEIGHTS[1], -1)).toBe(smallest);
    });

    it("offers the default as one of the rungs", () => {
        expect(APPEARANCE_PREVIEW_HEIGHTS).toContain(APPEARANCE_PREVIEW_HEIGHT_DEFAULT);
    });
});
