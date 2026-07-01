import { describe, expect, it } from "vitest";
import {
    createStoryMotionTemplateTimeline,
    deleteStoryMotionKeyframe,
    getStoryMotionDurationMs,
    sampleStoryMotionPreview,
    upsertStoryMotionKeyframe,
} from "./storyMotionTimeline";
import type { StoryAnimationTimeline } from "@shared/types/story";

describe("storyMotionTimeline", () => {
    it("creates template timelines with a stable minimum duration", () => {
        const timeline = createStoryMotionTemplateTimeline("Fade in + slide");

        expect(getStoryMotionDurationMs(timeline)).toBe(420);
        expect(timeline.tracks.map(track => track.property)).toEqual(["position", "opacity"]);
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
            fps: 30,
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

    it("deletes empty tracks with their final keyframe", () => {
        const timeline = upsertStoryMotionKeyframe({
            fps: 30,
            durationMs: 300,
            tracks: [],
        }, "opacity", 100, 0.5);
        const keyframeId = timeline.tracks[0].keyframes[0].id;

        const updated = deleteStoryMotionKeyframe(timeline, keyframeId);

        expect(updated.tracks).toEqual([]);
        expect(getStoryMotionDurationMs(updated)).toBe(420);
    });
});
