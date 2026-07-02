import { describe, expect, it } from "vitest";
import {
    STORY_MOTION_FPS,
    STORY_MOTION_MAX_DURATION_MS,
    STORY_MOTION_PROPERTIES,
    createStoryMotionTemplateTimeline,
    deleteStoryMotionKeyframe,
    deleteStoryMotionTrack,
    formatStoryMotionTime,
    getStoryMotionPropertyMeta,
    getStoryMotionDurationMs,
    sampleStoryMotionPreview,
    updateStoryMotionKeyframe,
    upsertStoryMotionKeyframe,
} from "./storyMotionTimeline";
import type { StoryAnimationTimeline } from "@shared/types/story";

describe("storyMotionTimeline", () => {
    it("creates template timelines with a stable minimum duration", () => {
        const timeline = createStoryMotionTemplateTimeline("Fade in + slide");

        expect(getStoryMotionDurationMs(timeline)).toBe(420);
        expect(timeline.fps).toBeUndefined();
        expect(timeline.tracks.map(track => track.property)).toEqual(["position", "opacity"]);
        expect(STORY_MOTION_FPS).toBe(60);
        expect(formatStoryMotionTime(500)).toBe("0.50s / f30");
    });

    it("samples numeric and position keyframes for preview", () => {
        const timeline = createStoryMotionTemplateTimeline("Fade in + slide");
        const preview = sampleStoryMotionPreview(timeline, 210);

        expect(preview.opacity).toBeCloseTo(0.5);
        expect(preview.position.xoffset).toBeCloseTo(-60);
        expect(preview.position.xalign).toBeCloseTo(0.5);
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

    it("lists the Story Motion transform property whitelist without editor-only groups", () => {
        expect(STORY_MOTION_PROPERTIES.map(item => item.property)).toEqual([
            "position",
            "scaleX",
            "scaleY",
            "zoom",
            "rotation",
            "opacity",
        ]);
        expect(getStoryMotionPropertyMeta("zoom").label).toBe("Zoom");
        expect(STORY_MOTION_PROPERTIES.every(item => !("group" in item))).toBe(true);
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
