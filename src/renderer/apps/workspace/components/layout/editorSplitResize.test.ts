import { describe, expect, it } from "vitest";
import {
    EDITOR_MIN_PANE_PX,
    leadingPaneBasis,
    nudgeSplitRatio,
    resolveSplitRatio,
} from "./editorSplitResize";

describe("resolveSplitRatio", () => {
    it("tracks the pointer in the middle of the range", () => {
        expect(resolveSplitRatio(1000, 300)).toBeCloseTo(0.3);
        expect(resolveSplitRatio(1000, 500)).toBeCloseTo(0.5);
    });

    it("stops short of collapsing either pane", () => {
        expect(resolveSplitRatio(1000, 0)).toBeCloseTo(EDITOR_MIN_PANE_PX / 1000);
        expect(resolveSplitRatio(1000, 1000)).toBeCloseTo(1 - EDITOR_MIN_PANE_PX / 1000);
    });

    it("clamps a pointer dragged past the container entirely", () => {
        expect(resolveSplitRatio(1000, -500)).toBeCloseTo(EDITOR_MIN_PANE_PX / 1000);
        expect(resolveSplitRatio(1000, 5000)).toBeCloseTo(1 - EDITOR_MIN_PANE_PX / 1000);
    });

    it("splits evenly when the container cannot fit two minimum panes", () => {
        // 120px cannot hold 2x80px, so there is no position that satisfies the clamp.
        expect(resolveSplitRatio(120, 10)).toBe(0.5);
        expect(resolveSplitRatio(0, 10)).toBe(0.5);
    });

    it("honours a caller-supplied minimum", () => {
        expect(resolveSplitRatio(1000, 0, 250)).toBeCloseTo(0.25);
    });
});

describe("nudgeSplitRatio", () => {
    it("moves the sash by a pixel delta", () => {
        expect(nudgeSplitRatio(0.5, 1000, 100)).toBeCloseTo(0.6);
        expect(nudgeSplitRatio(0.5, 1000, -100)).toBeCloseTo(0.4);
    });

    it("stops at the same minimum a drag does", () => {
        expect(nudgeSplitRatio(0.1, 1000, -1000)).toBeCloseTo(EDITOR_MIN_PANE_PX / 1000);
    });

    it("leaves the ratio alone when the container has no size yet", () => {
        expect(nudgeSplitRatio(0.42, 0, 100)).toBe(0.42);
    });
});

describe("leadingPaneBasis", () => {
    it("gives back half the gutter so the two panes plus sash fit exactly", () => {
        expect(leadingPaneBasis(0.5, 4)).toBe("calc(50% - 2px)");
    });
});
