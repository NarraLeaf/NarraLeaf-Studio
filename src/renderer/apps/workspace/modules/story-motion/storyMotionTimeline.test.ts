import { describe, expect, it } from "vitest";
import { easeOut } from "motion/react";
import {
    STORY_MOTION_CORE_PROPERTIES,
    STORY_MOTION_FPS,
    STORY_MOTION_MAX_DURATION_MS,
    STORY_MOTION_PROPERTIES,
    createStoryMotionTemplateTimeline,
    deleteStoryMotionKeyframe,
    deleteStoryMotionTrack,
    ensureStoryMotionTrack,
    formatStoryMotionTime,
    getStoryMotionPropertyMeta,
    getStoryMotionDurationMs,
    resolveStoryMotionEasing,
    sampleStoryMotionPreview,
    sampleStoryMotionTrackValue,
    snapStoryMotionTimeToFrame,
    stepStoryMotionTimeByFrames,
    updateStoryMotionKeyframe,
    upsertStoryMotionKeyframe,
} from "./storyMotionTimeline";
import type { StoryAnimationTimeline } from "@shared/types/story";

function linearTimeline(): StoryAnimationTimeline {
    return {
        tracks: [
            {
                id: "track-opacity",
                property: "opacity",
                keyframes: [
                    { id: "kf-opacity-0", timeMs: 0, value: 0, easing: "linear" },
                    { id: "kf-opacity-420", timeMs: 420, value: 1, easing: "linear" },
                ],
            },
            {
                id: "track-position",
                property: "position",
                keyframes: [
                    { id: "kf-position-0", timeMs: 0, value: { xalign: 0.5, yalign: 0.55, xoffset: -120, yoffset: 0 }, easing: "linear" },
                    { id: "kf-position-420", timeMs: 420, value: { xalign: 0.5, yalign: 0.55, xoffset: 0, yoffset: 0 }, easing: "linear" },
                ],
            },
        ],
    };
}

describe("storyMotionTimeline", () => {
    it("derives template durations from their keyframes", () => {
        const timeline = createStoryMotionTemplateTimeline("Fade in + slide");

        expect(getStoryMotionDurationMs(timeline)).toBe(420);
        expect(timeline.fps).toBeUndefined();
        expect(timeline.tracks.map(track => track.property)).toEqual(["position", "opacity"]);
        expect(STORY_MOTION_FPS).toBe(60);
        expect(formatStoryMotionTime(500)).toBe("0.50s / f30");
    });

    it("does not clamp short animations to a minimum duration", () => {
        expect(getStoryMotionDurationMs(createStoryMotionTemplateTimeline("Center pop"))).toBe(360);
        expect(getStoryMotionDurationMs(createStoryMotionTemplateTimeline("Flash"))).toBe(280);

        const single = upsertStoryMotionKeyframe({ tracks: [] }, "opacity", 200, 1);
        expect(getStoryMotionDurationMs(single)).toBe(200);
    });

    it("ignores stored durationMs metadata", () => {
        const timeline = upsertStoryMotionKeyframe({ durationMs: 9999, tracks: [] }, "opacity", 100, 1);
        expect(getStoryMotionDurationMs(timeline)).toBe(100);
    });

    it("samples linear keyframes for preview", () => {
        const preview = sampleStoryMotionPreview(linearTimeline(), 210);

        expect(preview.opacity).toBeCloseTo(0.5);
        expect(preview.position.xoffset).toBeCloseTo(-60);
        expect(preview.position.xalign).toBeCloseTo(0.5);
    });

    it("applies the arriving keyframe's easing when sampling", () => {
        const timeline = createStoryMotionTemplateTimeline("Fade in + slide");
        const preview = sampleStoryMotionPreview(timeline, 210);

        expect(preview.opacity).toBeCloseTo(easeOut(0.5));
        expect(preview.position.xoffset).toBeCloseTo(-120 * (1 - easeOut(0.5)));
    });

    it("preserves easing overshoot instead of clamping the output", () => {
        const timeline: StoryAnimationTimeline = {
            tracks: [
                {
                    id: "track-opacity",
                    property: "opacity",
                    keyframes: [
                        { id: "kf-0", timeMs: 0, value: 0, easing: "linear" },
                        { id: "kf-100", timeMs: 100, value: 1, easing: "backOut" },
                    ],
                },
            ],
        };

        const value = sampleStoryMotionTrackValue(timeline.tracks[0], 80);
        expect(typeof value).toBe("number");
        expect(value as number).toBeGreaterThan(1);
    });

    it("holds the first keyframe value before its time", () => {
        const timeline: StoryAnimationTimeline = {
            tracks: [
                {
                    id: "track-opacity",
                    property: "opacity",
                    keyframes: [
                        { id: "kf-200", timeMs: 200, value: 0.25, easing: "easeOut" },
                    ],
                },
            ],
        };

        expect(sampleStoryMotionTrackValue(timeline.tracks[0], 0)).toBe(0.25);
        expect(sampleStoryMotionTrackValue(timeline.tracks[0], 100)).toBe(0.25);
    });

    it("snaps and steps timeline times by frame at 60fps", () => {
        expect(snapStoryMotionTimeToFrame(0)).toBe(0);
        expect(snapStoryMotionTimeToFrame(10)).toBe(17); // frame 1 = 1000/60 rounded
        expect(snapStoryMotionTimeToFrame(200)).toBe(200); // frame 12 = 200
        expect(stepStoryMotionTimeByFrames(200, 1)).toBe(217);
        expect(stepStoryMotionTimeByFrames(200, -1)).toBe(183);
        expect(stepStoryMotionTimeByFrames(0, -1)).toBe(0); // clamped at 0
    });

    it("resolves easing names, bezier arrays, and fallbacks", () => {
        expect(resolveStoryMotionEasing("linear")(0.3)).toBeCloseTo(0.3);
        expect(resolveStoryMotionEasing("easeOut")(0.5)).toBeCloseTo(easeOut(0.5));
        expect(resolveStoryMotionEasing("not-a-real-easing")(0.3)).toBeCloseTo(0.3);
        expect(resolveStoryMotionEasing([0.42, 0, 0.58, 1])(0.5)).toBeCloseTo(0.5);
        expect(resolveStoryMotionEasing("cubic-bezier(0.42, 0, 0.58, 1)")(0.5)).toBeCloseTo(0.5);
        expect(resolveStoryMotionEasing(undefined)(0.5)).toBeCloseTo(easeOut(0.5));
    });

    it("samples visual effect strings into the preview state", () => {
        const timeline: StoryAnimationTimeline = {
            tracks: [
                {
                    id: "track-filter",
                    property: "filter",
                    keyframes: [
                        { id: "kf-0", timeMs: 0, value: "brightness(1)", easing: "linear" },
                        { id: "kf-200", timeMs: 200, value: "brightness(2)", easing: "linear" },
                    ],
                },
            ],
        };

        expect(sampleStoryMotionPreview(timeline, 0).effects.filter).toBe("brightness(1)");
        expect(sampleStoryMotionPreview(timeline, 100).effects.filter).toBe("brightness(1)");
        expect(sampleStoryMotionPreview(timeline, 200).effects.filter).toBe("brightness(2)");
        expect(sampleStoryMotionPreview(timeline, 0).effects.clipPath).toBeUndefined();
    });

    it("upserts keyframes by property and time", () => {
        const timeline: StoryAnimationTimeline = {
            durationMs: 300,
            tracks: [],
        };

        const withKeyframe = upsertStoryMotionKeyframe(timeline, "rotation", 120, 8, "easeOut");
        const updated = upsertStoryMotionKeyframe(withKeyframe, "rotation", 120, 12, "linear");

        expect(updated.tracks).toHaveLength(1);
        expect(updated.tracks[0].keyframes).toHaveLength(1);
        expect(updated.tracks[0].keyframes[0]).toEqual(expect.objectContaining({
            timeMs: 120,
            value: 12,
            easing: "linear",
        }));
    });

    it("preserves existing easing when upserting without one", () => {
        const timeline = upsertStoryMotionKeyframe({ tracks: [] }, "rotation", 120, 8, "backOut");
        const updated = upsertStoryMotionKeyframe(timeline, "rotation", 120, 12);

        expect(updated.tracks[0].keyframes[0]).toEqual(expect.objectContaining({
            value: 12,
            easing: "backOut",
        }));

        const fresh = upsertStoryMotionKeyframe({ tracks: [] }, "rotation", 60, 4);
        expect(fresh.tracks[0].keyframes[0].easing).toBe("easeOut");
    });

    it("creates tracks with their first keyframe at the requested time", () => {
        const timeline = ensureStoryMotionTrack({ tracks: [] }, "opacity", 300);

        expect(timeline.tracks[0].keyframes).toHaveLength(1);
        expect(timeline.tracks[0].keyframes[0].timeMs).toBe(300);
        expect(timeline.tracks[0].keyframes[0].value).toBe(1);

        const textTrack = ensureStoryMotionTrack({ tracks: [] }, "filter", 0);
        expect(textTrack.tracks[0].keyframes[0].value).toBe("");
    });

    it("covers every transform sequence property with core props first", () => {
        expect(STORY_MOTION_CORE_PROPERTIES.map(item => item.property)).toEqual([
            "position",
            "scaleX",
            "scaleY",
            "zoom",
            "rotation",
            "opacity",
        ]);
        expect(STORY_MOTION_PROPERTIES.map(item => item.property)).toEqual([
            "position",
            "scaleX",
            "scaleY",
            "zoom",
            "rotation",
            "opacity",
            "fontColor",
            "maskImage",
            "maskSize",
            "maskPosition",
            "maskRepeat",
            "maskMode",
            "clipPath",
            "filter",
            "backdropFilter",
            "mixBlendMode",
        ]);
        expect(getStoryMotionPropertyMeta("zoom").label).toBe("Zoom");
        expect(getStoryMotionPropertyMeta("filter").valueKind).toBe("text");
    });

    it("clamps keyframe edits to the 300 second timeline limit", () => {
        const timeline: StoryAnimationTimeline = {
            durationMs: 300,
            tracks: [],
        };
        const withKeyframe = upsertStoryMotionKeyframe(timeline, "rotation", STORY_MOTION_MAX_DURATION_MS + 5000, 8);
        const keyframeId = withKeyframe.tracks[0].keyframes[0].id;
        const updated = updateStoryMotionKeyframe(withKeyframe, keyframeId, keyframe => ({
            ...keyframe,
            timeMs: STORY_MOTION_MAX_DURATION_MS + 2500,
        }));

        expect(updated.tracks[0].keyframes[0].timeMs).toBe(STORY_MOTION_MAX_DURATION_MS);
        expect(getStoryMotionDurationMs(updated)).toBe(STORY_MOTION_MAX_DURATION_MS);
    });

    it("deletes empty tracks with their final keyframe", () => {
        const timeline = upsertStoryMotionKeyframe({
            durationMs: 300,
            tracks: [],
        }, "opacity", 100, 0.5);
        const keyframeId = timeline.tracks[0].keyframes[0].id;

        const updated = deleteStoryMotionKeyframe(timeline, keyframeId);

        expect(updated.tracks).toEqual([]);
        expect(getStoryMotionDurationMs(updated)).toBe(420);
    });

    it("deletes a whole track without touching other properties", () => {
        const timeline = createStoryMotionTemplateTimeline("Fade in + slide");

        const updated = deleteStoryMotionTrack(timeline, "track-position");

        expect(updated.tracks.map(track => track.property)).toEqual(["opacity"]);
        expect(getStoryMotionDurationMs(updated)).toBe(420);
    });
});
