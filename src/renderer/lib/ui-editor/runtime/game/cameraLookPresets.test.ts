import { describe, expect, it } from "vitest";
import { storyInspector as storyInspectorEn } from "@shared/i18n/catalog/en/storyInspector";
import { storyInspector as storyInspectorZh } from "@shared/i18n/catalog/zh/storyInspector";
import { storyInspector as storyInspectorJa } from "@shared/i18n/catalog/ja/storyInspector";
import {
    getStoryCameraLookPreset,
    resolveStoryCameraLook,
    resolveStoryCameraLookOscillation,
    storyCameraLookSways,
    STORY_CAMERA_LOOK_DEFAULT_PRESET_ID,
    STORY_CAMERA_LOOK_MAX_INTENSITY,
    STORY_CAMERA_LOOK_PRESETS,
} from "./cameraLookPresets";

/**
 * The recipes, pinned.
 *
 * These six strings were rendered on a real sprite and looked at before they were written down, and
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
    // Carries a no-op `hue-rotate(0deg)` it does not need, so its resting grade lists the same
    // functions its sway does. See `matchesFunctionList` below for what breaks without it.
    hangover: "blur(2.4px) saturate(0.8) brightness(0.93) contrast(0.94) hue-rotate(0deg)",
};

/** The filter functions a string calls, in order — the thing a browser matches on to interpolate. */
function functionList(filter: string): string[] {
    return [...filter.matchAll(/([a-z-]+)\(/g)].map(match => match[1]);
}

/**
 * How far a rotation may swing without a `grayscale(1) sepia(1)` flatten in front of it.
 *
 * Past roughly this the swing stops reading as the room moving and starts re-mapping the picture's
 * own colours, which is the trap the library's header describes.
 */
const UNFLATTENED_HUE_LIMIT_DEG = 20;

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
                // A sway's steps are filters the browser parses too, and one invalid term there costs
                // the whole sway. `hue-rotate` is exempt because a negative angle is the point of it.
                for (const step of preset.oscillate?.(intensity, 600)?.steps ?? []) {
                    expect(step.replace(/hue-rotate\([^)]*\)/g, ""), `${preset.id} sway @ ${intensity}`)
                        .not.toMatch(/\(-/);
                }
            }
            expect(preset.build(Number.NaN), preset.id).toBe("none");
        }
    });

    it("never rotates a hue far without flattening first", () => {
        // The trap this library exists to avoid: `hue-rotate` on an image that still has its own
        // colours rotates every one of them, so blue hair lands on khaki and skin on yellow-brown.
        // Only a `grayscale(1) sepia(1)` prefix makes the angle operate on one known colour.
        //
        // A SMALL swing either side of neutral is the documented exception, and it is a different
        // move: it is not trying to land on a colour, so nothing has to be flattened for it to mean
        // what it says. The limit is the point at which that stops being true, and it is asserted so
        // that opening `hangover`'s angle up has to come back here and argue for it.
        const strings = STORY_CAMERA_LOOK_PRESETS.flatMap(preset => [0.1, 0.5, 1, 2].flatMap(intensity => [
            { id: preset.id, filter: preset.build(intensity) },
            ...(preset.oscillate?.(intensity, 600)?.steps ?? []).map(step => ({ id: `${preset.id} sway`, filter: step })),
        ]));
        for (const { id, filter } of strings) {
            const angle = /hue-rotate\((-?[\d.]+)deg\)/.exec(filter);
            if (!angle) {
                expect(filter, id).not.toContain("hue-rotate");
                continue;
            }
            if (Math.abs(Number(angle[1])) <= UNFLATTENED_HUE_LIMIT_DEG) {
                continue;
            }
            expect(filter, id).toMatch(/^grayscale\(1\) sepia\(1\) hue-rotate\(/);
        }
    });

    it("gives every preset its own tempo, and only a moving one spends it", () => {
        // A still grade lands in one frame, so its tempo is carried but never read; the sway is the
        // one grade the duration reaches. `storyCameraLookSways` is what every surface asks, so the
        // library and the UI cannot disagree about which grades own a timing field.
        for (const preset of STORY_CAMERA_LOOK_PRESETS) {
            expect(storyCameraLookSways(preset.id), preset.id).toBe(Boolean(preset.oscillate));
            expect(preset.defaultDurationMs, preset.id).toBeGreaterThan(0);
            expect(Number.isFinite(preset.defaultDurationMs), preset.id).toBe(true);
            expect(preset.defaultEasing, preset.id).toBeTruthy();
        }
        // `mono` is a cut and `faint` is a slide; if these ever converge the library has lost the
        // half of each preset that is not colour.
        expect(getStoryCameraLookPreset("mono")!.defaultDurationMs)
            .toBeLessThan(getStoryCameraLookPreset("faint")!.defaultDurationMs);
        expect(STORY_CAMERA_LOOK_PRESETS.filter(p => storyCameraLookSways(p.id)).map(p => p.id))
            .toEqual(["hangover"]);
    });

    it("sways only where a sway is declared, and always finitely", () => {
        const moving = STORY_CAMERA_LOOK_PRESETS.filter(preset => preset.oscillate);
        expect(moving.map(preset => preset.id)).toEqual(["hangover"]);

        for (const preset of moving) {
            // Intensity 0 is no grade at all, so there is nothing to sway.
            expect(preset.oscillate!(0, 600), preset.id).toBeNull();

            const sway = preset.oscillate!(1, 600)!;
            expect(sway.steps.length, preset.id).toBeGreaterThan(1);
            // A `Transform` is awaited by the row that plays it. An endless sway does not loop under
            // the dialogue, it hangs the scene on that row - so this is the assertion that keeps the
            // library's one moving preset from becoming a deadlock.
            expect(Number.isFinite(sway.cycles), preset.id).toBe(true);
            expect(sway.cycles, preset.id).toBeGreaterThan(0);
            expect(sway.stepMs, preset.id).toBe(600);
            expect(sway.settleMs, preset.id).toBeGreaterThan(0);
        }
    });

    it("keeps a sway on the same filter functions as the grade it settles onto", () => {
        // The failure this catches is the one that looks like nothing: a browser interpolates two
        // filter lists only when they name the same functions in the same order, so a mismatched pair
        // SNAPS. Every value would be correct and the stage would simply not move - which is
        // indistinguishable, from the outside, from the feature not being wired up at all.
        for (const preset of STORY_CAMERA_LOOK_PRESETS) {
            if (!preset.oscillate) {
                continue;
            }
            for (const intensity of [0.4, 1, 2]) {
                const resting = functionList(preset.build(intensity));
                for (const step of preset.oscillate(intensity, 600)!.steps) {
                    expect(functionList(step), `${preset.id} @ ${intensity}`).toEqual(resting);
                }
            }
        }
    });

    it("swings a sway to both sides of neutral", () => {
        // A clamp that quietly floored the negative half would leave the room lurching one way and
        // then sitting still, which reads as a timing bug rather than as a lost minus sign.
        const steps = getStoryCameraLookPreset("hangover")!.oscillate!(1, 600)!.steps;
        const angles = steps.map(step => Number(/hue-rotate\((-?[\d.]+)deg\)/.exec(step)![1]));
        expect(Math.min(...angles)).toBeLessThan(0);
        expect(Math.max(...angles)).toBeGreaterThan(0);
    });

    it("resolves a sway only for the preset that declares one", () => {
        expect(resolveStoryCameraLookOscillation("memory", 1, 600)).toBeNull();
        expect(resolveStoryCameraLookOscillation("sunset", 1, 600)).toBeNull();
        expect(resolveStoryCameraLookOscillation("hangover", 1, 600)?.stepMs).toBe(600);
        // A row asking for an instant sway is not asking for a still grade: it falls back to the
        // preset's own tempo rather than compiling to something that does not move.
        expect(resolveStoryCameraLookOscillation("hangover", 1, 0)?.stepMs)
            .toBe(getStoryCameraLookPreset("hangover")!.defaultDurationMs);
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
