import { describe, expect, it } from "vitest";
import type { StoryAnimationTimeline } from "@shared/types/story";
import {
    adjacentStoryMotionKeyframeTime,
    clampStoryMotionKeyframeDelta,
    copyStoryMotionKeyframes,
    deleteStoryMotionKeyframes,
    insertStoryMotionKeyframes,
    keyableTrackValue,
    listStoryMotionKeyframeTimes,
    moveStoryMotionKeyframes,
    pasteStoryMotionKeyframes,
    positionForWrite,
    setStoryMotionKeyframesEasing,
    snapStoryMotionTime,
    storyMotionKeyframesInRange,
} from "./storyMotionEditing";
import { ensureStoryMotionTrack } from "./storyMotionTimeline";

function timeline(): StoryAnimationTimeline {
    return {
        tracks: [
            {
                id: "track-opacity",
                property: "opacity",
                keyframes: [
                    { id: "o0", timeMs: 0, value: 0, easing: "linear" },
                    { id: "o300", timeMs: 300, value: 1, easing: "easeOut" },
                ],
            },
            {
                id: "track-position",
                property: "position",
                keyframes: [
                    { id: "p0", timeMs: 0, value: { xoffset: -120 } },
                    { id: "p500", timeMs: 500, value: { xoffset: 0 } },
                ],
            },
        ],
    };
}

const ids = (...values: string[]) => new Set(values);

describe("storyMotionEditing", () => {
    it("lists keyframe times once each, optionally for some tracks", () => {
        expect(listStoryMotionKeyframeTimes(timeline())).toEqual([0, 300, 500]);
        expect(listStoryMotionKeyframeTimes(timeline(), ids("track-opacity"))).toEqual([0, 300]);
    });

    it("finds the neighbouring keyframe and moves on from one it stands on", () => {
        expect(adjacentStoryMotionKeyframeTime(timeline(), 0, 1)).toBe(300);
        expect(adjacentStoryMotionKeyframeTime(timeline(), 300, 1)).toBe(500);
        expect(adjacentStoryMotionKeyframeTime(timeline(), 300, -1)).toBe(0);
        expect(adjacentStoryMotionKeyframeTime(timeline(), 500, 1)).toBeNull();
        expect(adjacentStoryMotionKeyframeTime(timeline(), 0, -1)).toBeNull();
        expect(adjacentStoryMotionKeyframeTime(timeline(), 400, 1, ids("track-opacity"))).toBeNull();
    });

    it("moves a set of keyframes together and keeps their spacing at the start", () => {
        const moved = moveStoryMotionKeyframes(timeline(), ids("o0", "o300"), 100);
        expect(moved.tracks[0].keyframes.map(keyframe => keyframe.timeMs)).toEqual([100, 400]);
        expect(moved.tracks[1].keyframes.map(keyframe => keyframe.timeMs)).toEqual([0, 500]);
        expect(moved.durationMs).toBe(500);

        // The earliest selected keyframe stops at zero; the other one keeps its distance.
        expect(clampStoryMotionKeyframeDelta(timeline(), ids("o300", "p500"), -400)).toBe(-300);
        const clamped = moveStoryMotionKeyframes(timeline(), ids("o300", "p500"), -400);
        expect(clamped.tracks[0].keyframes.map(keyframe => keyframe.timeMs)).toEqual([0]);
        expect(clamped.tracks[1].keyframes.map(keyframe => keyframe.timeMs)).toEqual([0, 200]);
    });

    it("lets a moved keyframe replace the one it lands on", () => {
        const moved = moveStoryMotionKeyframes(timeline(), ids("o300"), -300);
        expect(moved.tracks[0].keyframes).toEqual([{ id: "o300", timeMs: 0, value: 1, easing: "easeOut" }]);
    });

    it("deletes several keyframes and drops a track left empty", () => {
        const next = deleteStoryMotionKeyframes(timeline(), ids("o0", "o300", "p0"));
        expect(next.tracks.map(track => track.property)).toEqual(["position"]);
        expect(next.tracks[0].keyframes.map(keyframe => keyframe.id)).toEqual(["p500"]);
        expect(next.durationMs).toBe(500);
    });

    it("copies keyframes relative to the earliest and pastes them at a time", () => {
        const clipboard = copyStoryMotionKeyframes(timeline(), ids("o300", "p500"));
        expect(clipboard?.items).toEqual([
            { property: "opacity", offsetMs: 0, value: 1, easing: "easeOut" },
            { property: "position", offsetMs: 200, value: { xoffset: 0 } },
        ]);

        const pasted = pasteStoryMotionKeyframes({ tracks: [] }, clipboard!, 1000);
        expect(pasted.timeline.tracks.map(track => [track.property, track.keyframes.map(keyframe => keyframe.timeMs)]))
            .toEqual([["opacity", [1000]], ["position", [1200]]]);
        expect(pasted.ids).toHaveLength(2);
        expect(pasted.timeline.durationMs).toBe(1200);

        // Pasting over an existing keyframe gives it the pasted value rather than doubling it.
        const over = pasteStoryMotionKeyframes(timeline(), clipboard!, 0);
        expect(over.timeline.tracks[0].keyframes.filter(keyframe => keyframe.timeMs === 0)).toHaveLength(1);
        expect(over.timeline.tracks[0].keyframes.find(keyframe => keyframe.timeMs === 0)?.value).toBe(1);
    });

    it("pastes a copy, never the copied object itself", () => {
        const source = timeline();
        const clipboard = copyStoryMotionKeyframes(source, ids("p0"))!;
        const pasted = pasteStoryMotionKeyframes({ tracks: [] }, clipboard, 0);
        (pasted.timeline.tracks[0].keyframes[0].value as { xoffset: number }).xoffset = 99;
        expect(clipboard.items[0].value).toEqual({ xoffset: -120 });
        expect(source.tracks[1].keyframes[0].value).toEqual({ xoffset: -120 });
    });

    it("sets one easing on several keyframes, and clears it back to the default", () => {
        const eased = setStoryMotionKeyframesEasing(timeline(), ids("o0", "p500"), "backOut");
        expect(eased.tracks[0].keyframes.map(keyframe => keyframe.easing)).toEqual(["backOut", "easeOut"]);
        expect(eased.tracks[1].keyframes[1].easing).toBe("backOut");

        const cleared = setStoryMotionKeyframesEasing(eased, ids("o0"), undefined);
        expect(Object.keys(cleared.tracks[0].keyframes[0])).not.toContain("easing");
    });

    it("keys tracks at a time with the value they already have there", () => {
        const inserted = insertStoryMotionKeyframes(timeline(), ids("track-opacity", "track-position"), 150);
        const opacity = inserted.timeline.tracks.find(track => track.property === "opacity")!;
        expect(opacity.keyframes.map(keyframe => keyframe.timeMs)).toEqual([0, 150, 300]);
        expect(inserted.ids).toHaveLength(2);

        // The position keyframe carries offsets only: the track never wrote an align axis.
        const position = inserted.timeline.tracks.find(track => track.property === "position")!;
        expect(Object.keys(position.keyframes[1].value as object).sort()).toEqual(["xoffset", "yoffset"]);

        // A keyframe already at the time is left as it is, and still reported.
        const again = insertStoryMotionKeyframes(timeline(), ids("track-opacity"), 300);
        expect(again.timeline.tracks[0].keyframes).toEqual(timeline().tracks[0].keyframes);
        expect(again.ids).toEqual(["o300"]);
    });

    it("finds the keyframes a marquee covers", () => {
        expect(storyMotionKeyframesInRange(timeline(), ids("track-opacity", "track-position"), 250, 0).sort())
            .toEqual(["o0", "p0"]);
        expect(storyMotionKeyframesInRange(timeline(), ids("track-position"), 0, 600)).toEqual(["p0", "p500"]);
    });

    it("snaps to the nearest candidate within a distance measured on screen", () => {
        // 0.2 px per ms: 6 px is 30 ms.
        expect(snapStoryMotionTime(320, [0, 300, 500], 6, 0.2)).toBe(300);
        expect(snapStoryMotionTime(340, [0, 300, 500], 6, 0.2)).toBeNull();
        expect(snapStoryMotionTime(410, [400, 420], 6, 0.2)).toBe(400);
    });

    it("writes position with only the axes the track writes", () => {
        const track = timeline().tracks[1];
        const sampled = { xalign: 0.5, yalign: 0.55, xoffset: 12.345, yoffset: -3 };
        expect(positionForWrite(track, sampled, {})).toEqual({ xoffset: 12.35, yoffset: -3 });
        expect(positionForWrite(track, sampled, { xalign: 0.25 })).toEqual({ xalign: 0.25, xoffset: 12.35, yoffset: -3 });

        const aligned = { ...track, keyframes: [{ id: "a", timeMs: 0, value: { xalign: 0.2 } }] };
        expect(positionForWrite(aligned, sampled, { yoffset: 40 })).toEqual({ xalign: 0.5, xoffset: 12.35, yoffset: 40 });

        const linear = { ...track, keyframes: track.keyframes.map(keyframe => ({ ...keyframe, easing: "linear" })) };
        expect(keyableTrackValue(linear, 250)).toEqual({ xoffset: -60, yoffset: 0 });
    });

    it("starts a new position track at the target's own place", () => {
        const next = ensureStoryMotionTrack({ tracks: [] }, "position", 0);
        expect(next.tracks[0].keyframes[0].value).toEqual({ xoffset: 0, yoffset: 0 });
    });
});
