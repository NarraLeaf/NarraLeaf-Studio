import { describe, expect, it } from "vitest";
import { motion as motionEn } from "@shared/i18n/catalog/en/motion";
import { motion as motionZh } from "@shared/i18n/catalog/zh/motion";
import { timelineToNlrTransformSequences } from "@/lib/ui-editor/runtime/game/storyTransformProps";
import { getStoryMotionDurationMs, sampleStoryMotionPreview, storyMotionSignatureTimeMs } from "./storyMotionTimeline";
import {
    STORY_MOTION_DEFAULT_PRESET_ID,
    STORY_MOTION_PRESETS,
    STORY_MOTION_PRESET_CATEGORIES,
    createStoryMotionPresetTimeline,
    getStoryMotionPreset,
    storyMotionPresetCategoriesForTargetKind,
    storyMotionPresetsForTargetKind,
} from "./storyMotionPresets";

/** The library's longest move; anything past this is a mistake, not a slow pan. */
const MAX_PRESET_DURATION_MS = 6000;

describe("storyMotionPresets", () => {
    it("gives every preset a non-empty, bounded timeline", () => {
        for (const preset of STORY_MOTION_PRESETS) {
            const timeline = preset.build();
            const durationMs = getStoryMotionDurationMs(timeline);
            expect(timeline.tracks.length, preset.id).toBeGreaterThan(0);
            expect(durationMs, preset.id).toBeGreaterThan(0);
            expect(durationMs, preset.id).toBeLessThanOrEqual(MAX_PRESET_DURATION_MS);
            for (const track of timeline.tracks) {
                expect(track.keyframes.length, `${preset.id}/${track.property}`).toBeGreaterThanOrEqual(2);
            }
        }
    });

    it("keeps ids and generated keyframe ids unique, and builds value-stably", () => {
        const ids = STORY_MOTION_PRESETS.map(preset => preset.id);
        expect(new Set(ids).size).toBe(ids.length);

        for (const preset of STORY_MOTION_PRESETS) {
            const timeline = preset.build();
            const trackIds = timeline.tracks.map(track => track.id);
            expect(new Set(trackIds).size, preset.id).toBe(trackIds.length);
            for (const track of timeline.tracks) {
                const keyframeIds = track.keyframes.map(keyframe => keyframe.id);
                expect(new Set(keyframeIds).size, `${preset.id}/${track.property}`).toBe(keyframeIds.length);
                expect(keyframeIds.every(id => id.length > 0), preset.id).toBe(true);
            }
            // Two builds are deep-equal: the gallery memoizes on the built timeline, and the tests
            // below pin exact shapes.
            expect(preset.build()).toEqual(timeline);
        }
    });

    /**
     * The rule that makes the library safe on a real stage: a preset moves a target *relative* to
     * where it stands. A keyframe carrying `xalign`/`yalign` sets an absolute stage position, so a
     * shake authored that way would yank a sprite the author had placed on the left into the centre
     * before shaking it — and the same mistake on a camera preset would cut the framing.
     */
    it("never writes absolute alignment — only offsets", () => {
        for (const preset of STORY_MOTION_PRESETS) {
            for (const track of preset.build().tracks) {
                if (track.property !== "position") {
                    continue;
                }
                for (const keyframe of track.keyframes) {
                    expect(typeof keyframe.value, preset.id).toBe("object");
                    expect(Object.keys(keyframe.value as object).sort().join(",")).toMatch(/^(xoffset|yoffset|xoffset,yoffset)$/);
                }
            }
        }
    });

    it("emits offset-only positions all the way through to NLR transform props", () => {
        // Guards the layer that could still undo the rule above: the timeline → Transform conversion
        // must not fill in the missing axes, or NLR would receive a complete AlignPosition.
        const sequences = timelineToNlrTransformSequences(createStoryMotionPresetTimeline("shake"));
        const positions = sequences
            .map(sequence => sequence.props.position as Record<string, unknown> | undefined)
            .filter((position): position is Record<string, unknown> => Boolean(position));

        expect(positions.length).toBeGreaterThan(0);
        for (const position of positions) {
            expect(Object.keys(position)).toEqual(["xoffset"]);
        }
    });

    it("gives every looping preset a finite repeat count", () => {
        // A transform action is awaited and `Transform.repeat` is a number: an endless idle motion
        // would hang the row it sits on.
        for (const preset of STORY_MOTION_PRESETS) {
            const repeat = preset.config?.repeat;
            if (repeat === undefined) {
                continue;
            }
            expect(Number.isFinite(repeat), preset.id).toBe(true);
            expect(repeat, preset.id).toBeGreaterThan(0);
        }
        expect(getStoryMotionPreset("breathe")?.config?.repeat).toBe(3);
    });

    it("splits camera shots from displayable moves", () => {
        const cameraPresets = storyMotionPresetsForTargetKind("camera");
        const imagePresets = storyMotionPresetsForTargetKind("image");

        expect(cameraPresets.length).toBeGreaterThan(0);
        expect(imagePresets.length).toBeGreaterThan(0);
        expect(cameraPresets.every(preset => preset.scope === "camera")).toBe(true);
        expect(imagePresets.every(preset => preset.scope === "displayable")).toBe(true);
        // Disjoint: no preset is offered on both, so neither list is padded with moves scaled for the
        // other subject.
        expect(cameraPresets.filter(preset => imagePresets.includes(preset))).toEqual([]);
        // Every displayable kind sees the same library.
        expect(storyMotionPresetsForTargetKind("character")).toEqual(imagePresets);
        expect(storyMotionPresetsForTargetKind("text")).toEqual(imagePresets);
        expect(storyMotionPresetsForTargetKind("layer")).toEqual(imagePresets);
    });

    it("offers only the categories that have presets for the target", () => {
        expect(storyMotionPresetCategoriesForTargetKind("camera")).toEqual(["camera"]);
        const displayableCategories = storyMotionPresetCategoriesForTargetKind("image");
        expect(displayableCategories).not.toContain("camera");
        expect(displayableCategories).toEqual(
            STORY_MOTION_PRESET_CATEGORIES.filter(category => displayableCategories.includes(category)),
        );
    });

    it("names every category, and files every preset under a named one", () => {
        for (const preset of STORY_MOTION_PRESETS) {
            expect(STORY_MOTION_PRESET_CATEGORIES, preset.id).toContain(preset.category);
        }
        for (const category of STORY_MOTION_PRESET_CATEGORIES) {
            expect(STORY_MOTION_PRESETS.some(preset => preset.category === category), category).toBe(true);
        }
    });

    /**
     * The type of `StoryMotionPresetId` already forces a `motion.preset.<id>` key to exist at compile
     * time, and `i18n` parity forces en/zh to agree — but neither catches the reverse: a preset
     * removed from the table leaving a dead name behind in both catalogues.
     */
    it("keeps the catalogues and the table in exact correspondence", () => {
        const ids = STORY_MOTION_PRESETS.map(preset => preset.id).sort();
        expect(Object.keys(motionEn.preset).sort()).toEqual(ids);
        expect(Object.keys(motionZh.preset).sort()).toEqual(ids);
        expect(Object.keys(motionEn.presetCategory).sort()).toEqual([...STORY_MOTION_PRESET_CATEGORIES].sort());
        expect(Object.keys(motionZh.presetCategory).sort()).toEqual([...STORY_MOTION_PRESET_CATEGORIES].sort());
    });

    it("falls back to the first preset for an unknown id", () => {
        expect(createStoryMotionPresetTimeline("not-a-preset")).toEqual(STORY_MOTION_PRESETS[0].build());
        expect(getStoryMotionPreset(STORY_MOTION_DEFAULT_PRESET_ID)).toBeDefined();
    });

    /**
     * The gallery parks each card on this frame. If it resolved to 0 the grid would be two dozen
     * identical squares — every preset starts from rest — so "not 0, and not the resting frame" is
     * the property that makes the library browsable at a glance.
     */
    it("parks every preset on a pose that is both off-neutral and visible", () => {
        // Compared against NEUTRAL, not against frame 0: an entrance's extreme frame legitimately IS
        // frame 0. And the visibility half is the other trap — "furthest from neutral" picks the fully
        // transparent frame of a fade unless opacity weights the score, which parked `fadeInSlide` on
        // an empty square.
        const neutral = sampleStoryMotionPreview(undefined, 0);
        for (const preset of STORY_MOTION_PRESETS) {
            const timeline = preset.build();
            const signature = storyMotionSignatureTimeMs(timeline);
            const parked = sampleStoryMotionPreview(timeline, signature);
            const moved = parked.zoom !== neutral.zoom
                || parked.rotation !== neutral.rotation
                || parked.opacity !== neutral.opacity
                || parked.scaleX !== neutral.scaleX
                || parked.scaleY !== neutral.scaleY
                || parked.position.xoffset !== neutral.position.xoffset
                || parked.position.yoffset !== neutral.position.yoffset;
            expect(moved, `${preset.id} parks at neutral (t=${signature})`).toBe(true);
            expect(parked.opacity, `${preset.id} parks at an invisible frame (t=${signature})`).toBeGreaterThan(0.15);
        }
    });

    it("picks the extreme frame, not merely a late one", () => {
        // `cameraPushIn` ends at its extreme; `shake` peaks mid-move and returns to rest, so the last
        // keyframe would be the worst possible thumbnail. Its two peaks (-10 at 60ms, +10 at 120ms)
        // score identically and the earlier one wins — an arbitrary but stable tie-break.
        expect(storyMotionSignatureTimeMs(createStoryMotionPresetTimeline("cameraPushIn"))).toBe(1600);
        expect(storyMotionSignatureTimeMs(createStoryMotionPresetTimeline("shake"))).toBe(60);
        // The entrance case: a frame inside the slide, not the transparent first one.
        const fadeIn = storyMotionSignatureTimeMs(createStoryMotionPresetTimeline("fadeInSlide"));
        expect(fadeIn).toBeGreaterThan(0);
        expect(fadeIn).toBeLessThan(420);
    });

    it("pins the two moves the request named", () => {
        // 摇晃 / 震动: a shake stays on one axis and returns to rest; an impact rings out on both axes
        // plus rotation, with a decaying amplitude.
        const shake = createStoryMotionPresetTimeline("shake");
        expect(shake.tracks.map(track => track.property)).toEqual(["position"]);
        expect(shake.tracks[0].keyframes.at(-1)?.value).toEqual({ xoffset: 0 });

        const impact = createStoryMotionPresetTimeline("impactShake");
        expect(impact.tracks.map(track => track.property)).toEqual(["position", "rotation"]);
        const amplitudes = impact.tracks[0].keyframes
            .map(keyframe => Math.abs((keyframe.value as { xoffset: number }).xoffset))
            .slice(1, -1);
        expect(amplitudes).toEqual([...amplitudes].sort((left, right) => right - left));
        expect(impact.tracks[0].keyframes.at(-1)?.value).toEqual({ xoffset: 0, yoffset: 0 });
    });
});
