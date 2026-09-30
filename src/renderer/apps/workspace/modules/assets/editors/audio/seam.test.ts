import { describe, expect, it } from "vitest";
import { EMPTY_LOOP } from "./loopHistory";
import { planSeamAudition, resolveLoopSeam, seamDragMarker } from "./seam";
import { playbackPosition, resolvePlaybackGeometry } from "./transport";

const RATE = 1000;
const TOTAL = 10_000;

describe("resolveLoopSeam", () => {
    it("runs the end of the file into its head when nothing is marked", () => {
        expect(resolveLoopSeam(EMPTY_LOOP, TOTAL, RATE)).toEqual({
            end: TOTAL,
            start: 0,
            endSource: "clipEnd",
            startSource: "clipStart",
        });
    });

    it("returns to the loop point ahead of the in point", () => {
        const seam = resolveLoopSeam({ inMs: 1000, loopStartMs: 2000, outMs: 8000 }, TOTAL, RATE);
        expect(seam).toMatchObject({ end: 8000, start: 2000, endSource: "out", startSource: "loop" });
    });

    it("falls back to the in point when there is no loop point", () => {
        const seam = resolveLoopSeam({ inMs: 1500, loopStartMs: null, outMs: null }, TOTAL, RATE);
        expect(seam).toMatchObject({ end: TOTAL, start: 1500, endSource: "clipEnd", startSource: "in" });
    });

    it("clamps markers the file has since grown shorter than", () => {
        const seam = resolveLoopSeam({ inMs: null, loopStartMs: null, outMs: 60_000 }, TOTAL, RATE);
        expect(seam?.end).toBe(TOTAL);
    });

    it("describes nothing when the markers leave no loop", () => {
        expect(resolveLoopSeam({ inMs: null, loopStartMs: 12_000, outMs: null }, TOTAL, RATE)).toBeNull();
        expect(resolveLoopSeam(EMPTY_LOOP, 0, RATE)).toBeNull();
    });
});

describe("seamDragMarker", () => {
    it("moves the marker that placed each side", () => {
        const seam = resolveLoopSeam({ inMs: 1000, loopStartMs: null, outMs: 8000 }, TOTAL, RATE)!;
        expect(seamDragMarker(seam, "end")).toBe("out");
        expect(seamDragMarker(seam, "start")).toBe("in");
    });

    it("sets a loop point, not an in point, for the head of an unmarked file", () => {
        const seam = resolveLoopSeam(EMPTY_LOOP, TOTAL, RATE)!;
        expect(seamDragMarker(seam, "start")).toBe("loop");
        expect(seamDragMarker(seam, "end")).toBe("out");
    });
});

describe("planSeamAudition", () => {
    it("plays the tail, turns around at the seam and plays the head", () => {
        const seam = resolveLoopSeam({ inMs: null, loopStartMs: 2000, outMs: 8000 }, TOTAL, RATE)!;
        const plan = planSeamAudition(seam, RATE, 3);
        expect(plan.from).toBe(5000);
        expect(plan.seconds).toBe(6);

        // Played through the transport's own model, the run crosses the seam exactly once.
        const geometry = resolvePlaybackGeometry({ from: plan.from, range: plan.range, totalSamples: TOTAL, looping: true });
        expect(playbackPosition(geometry, 2999)).toBe(7999);
        expect(playbackPosition(geometry, 3000)).toBe(2000);
        expect(playbackPosition(geometry, 6000)).toBe(5000);
    });

    it("starts at the head of the file when the seam is closer than the run-up", () => {
        const seam = resolveLoopSeam({ inMs: null, loopStartMs: null, outMs: 1200 }, TOTAL, RATE)!;
        const plan = planSeamAudition(seam, RATE, 3);
        expect(plan.from).toBe(0);
        expect(plan.seconds).toBeCloseTo(4.2, 6);
    });
});
