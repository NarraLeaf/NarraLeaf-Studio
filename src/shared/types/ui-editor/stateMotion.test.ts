import { describe, expect, it } from "vitest";
import {
    DEFAULT_STATE_MOTION_DURATION_MS,
    MAX_STATE_MOTION_DURATION_MS,
    normalizeStateMotions,
    resolveStateMotionOffset,
    upsertStateMotion,
    type UIStateMotion,
} from "./stateMotion";

const motion: UIStateMotion = {
    state: "on",
    target: "thumb",
    offsetX: 24,
    offsetY: 0,
    durationMs: 180,
    easing: "easeOut",
};

describe("normalizeStateMotions", () => {
    it("keeps only entries that name a state and a target", () => {
        expect(normalizeStateMotions([motion, { state: "on" }, null, "nope"])).toEqual([motion]);
        expect(normalizeStateMotions(undefined)).toEqual([]);
    });

    it("fills in timing a document never wrote and clamps one that runs away", () => {
        const [filled] = normalizeStateMotions([{ state: "on", target: "thumb" }]);
        const [clamped] = normalizeStateMotions([{ ...motion, durationMs: 9_000_000 }]);

        expect(filled).toMatchObject({ offsetX: 0, offsetY: 0, durationMs: DEFAULT_STATE_MOTION_DURATION_MS });
        expect(clamped.durationMs).toBe(MAX_STATE_MOTION_DURATION_MS);
    });
});

describe("resolveStateMotionOffset", () => {
    it("moves the target to the offset of the state it is in", () => {
        expect(resolveStateMotionOffset([motion], "on", "thumb")).toEqual({
            x: 24,
            y: 0,
            durationMs: 180,
            easing: "easeOut",
        });
    });

    it("sends it back on the same timing when no state names it", () => {
        // The way back is the same motion with nowhere to go: without the timing it would snap.
        expect(resolveStateMotionOffset([motion], null, "thumb")).toEqual({
            x: 0,
            y: 0,
            durationMs: 180,
            easing: "easeOut",
        });
    });

    it("says nothing about a target no motion names", () => {
        expect(resolveStateMotionOffset([motion], "on", "track")).toBeNull();
    });
});

describe("upsertStateMotion", () => {
    it("replaces the entry for the same state and target rather than stacking another", () => {
        const next = upsertStateMotion([motion], { ...motion, offsetX: 40 });

        expect(next).toHaveLength(1);
        expect(next[0].offsetX).toBe(40);
    });

    it("keeps entries for other targets", () => {
        const other: UIStateMotion = { ...motion, target: "track", offsetX: 4 };

        expect(upsertStateMotion([motion], other)).toHaveLength(2);
    });
});
