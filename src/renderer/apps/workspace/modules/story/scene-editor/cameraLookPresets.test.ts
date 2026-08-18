import { describe, expect, it } from "vitest";
import { storyInspector as storyInspectorEn } from "@shared/i18n/catalog/en/storyInspector";
import { storyInspector as storyInspectorZh } from "@shared/i18n/catalog/zh/storyInspector";
import { storyInspector as storyInspectorJa } from "@shared/i18n/catalog/ja/storyInspector";
import {
    getStoryCameraLookPreset,
    resolveStoryCameraLook,
    STORY_CAMERA_LOOK_DEFAULT_PRESET_ID,
    STORY_CAMERA_LOOK_MAX_INTENSITY,
    STORY_CAMERA_LOOK_PRESETS,
} from "./cameraLookPresets";

/**
 * The recipes, pinned.
 *
 * These five strings were rendered on a real sprite and looked at before they were written down, and
 * that is the only way a colour grade can be verified - `saturate(4)` reads as night and
 * `saturate(1.8)` reads as dull grey, and nothing about either string says which. So the exact output
 * is the test: a "harmless" tidy-up of one coefficient has to come back here and be looked at again.
 */
const RECIPES_AT_NOMINAL: Record<string, string> = {
    memory: "saturate(0.35) sepia(0.4) brightness(1.1) contrast(0.9) blur(1px)",
    monologue: "saturate(0.5) brightness(0.82) contrast(1.08)",
    mono: "grayscale(1) brightness(0.9) contrast(1.15)",
    moonlight: "grayscale(1) sepia(1) hue-rotate(185deg) saturate(4) brightness(0.55)",
    faint: "blur(5px) brightness(0.75) saturate(0.7)",
};

describe("cameraLookPresets", () => {
    it("builds the verified recipe at intensity 1", () => {
        for (const preset of STORY_CAMERA_LOOK_PRESETS) {
            expect(preset.build(1), preset.id).toBe(RECIPES_AT_NOMINAL[preset.id]);
        }
        expect(Object.keys(RECIPES_AT_NOMINAL).sort()).toEqual(STORY_CAMERA_LOOK_PRESETS.map(preset => preset.id).sort());
    });

    it("is a no-op at intensity 0 and never emits a negative term", () => {
        for (const preset of STORY_CAMERA_LOOK_PRESETS) {
            expect(preset.build(0), preset.id).toBe("none");
            // Past the cap the subtractive terms would run below zero, and ONE invalid function makes
            // the browser drop the whole declaration - so the grade would vanish rather than weaken.
            for (const intensity of [0.25, 0.5, 1, 1.5, STORY_CAMERA_LOOK_MAX_INTENSITY, 99]) {
                expect(preset.build(intensity), `${preset.id} @ ${intensity}`).not.toMatch(/\(-/);
            }
            expect(preset.build(Number.NaN), preset.id).toBe("none");
        }
    });

    it("never rotates a hue without flattening first", () => {
        // The trap this library exists to avoid: `hue-rotate` on an image that still has its own
        // colours rotates every one of them, so blue hair lands on khaki and skin on yellow-brown.
        // Only a `grayscale(1) sepia(1)` prefix makes the angle operate on one known colour.
        for (const preset of STORY_CAMERA_LOOK_PRESETS) {
            for (const intensity of [0.1, 0.5, 1, 2]) {
                const filter = preset.build(intensity);
                if (!filter.includes("hue-rotate")) {
                    continue;
                }
                expect(filter, `${preset.id} @ ${intensity}`).toMatch(/^grayscale\(1\) sepia\(1\) hue-rotate\(/);
            }
        }
    });

    it("holds the tint angle constant while the intensity moves", () => {
        // Fading a tint by walking its angle toward 0 does not weaken it, it drags it through every
        // wrong colour on the way. `moonlight` fades through saturate/brightness instead.
        const angles = new Set([0.2, 0.6, 1, 1.8].map(intensity =>
            /hue-rotate\(([^)]*)\)/.exec(resolveStoryCameraLook("moonlight", intensity) ?? "")?.[1]));
        expect(angles).toEqual(new Set(["185deg"]));
    });

    it("resolves a row to null rather than substituting a different grade", () => {
        expect(resolveStoryCameraLook(undefined, 1)).toBeNull();
        expect(resolveStoryCameraLook("sunset", 1)).toBeNull();
        expect(resolveStoryCameraLook("moonlight", undefined)).toBe(RECIPES_AT_NOMINAL.moonlight);
    });

    it("names every preset in all three catalogues", () => {
        expect(getStoryCameraLookPreset(STORY_CAMERA_LOOK_DEFAULT_PRESET_ID)).toBeDefined();
        for (const preset of STORY_CAMERA_LOOK_PRESETS) {
            for (const catalog of [storyInspectorEn, storyInspectorZh, storyInspectorJa]) {
                const label = (catalog.cameraLook as Record<string, string | undefined>)[preset.id];
                expect(label, preset.id).toBeTruthy();
                // A label that is the id is the id shown to an author, which the UI rules forbid.
                expect(label, preset.id).not.toBe(preset.id);
            }
        }
    });
});
