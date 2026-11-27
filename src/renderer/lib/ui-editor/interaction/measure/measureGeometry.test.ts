import { describe, expect, it } from "vitest";
import { formatMeasure, measureBetween, unionScreenRects } from "./measureGeometry";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

describe("formatMeasure", () => {
    it("keeps up to two decimals and drops trailing zeros", () => {
        expect(formatMeasure(120)).toBe("120");
        expect(formatMeasure(120.5)).toBe("120.5");
        expect(formatMeasure(120.256)).toBe("120.26");
        expect(formatMeasure(-0.001)).toBe("0");
    });
});

describe("unionScreenRects", () => {
    it("covers every rect", () => {
        expect(unionScreenRects([rect(10, 10, 10, 10), rect(30, 0, 10, 5)])).toEqual(rect(10, 0, 30, 20));
        expect(unionScreenRects([])).toBeNull();
    });
});

describe("measureBetween", () => {
    it("measures the gap between side-by-side layers through the middle of their overlap", () => {
        const segments = measureBetween(rect(0, 0, 100, 100), rect(150, 50, 100, 100));
        expect(segments).toEqual([{ axis: "x", from: 100, to: 150, at: 75 }]);
    });

    it("measures to a layer on the left as well", () => {
        const segments = measureBetween(rect(200, 0, 50, 50), rect(0, 10, 100, 20));
        expect(segments).toEqual([{ axis: "x", from: 100, to: 200, at: 20 }]);
    });

    it("measures both gaps to a diagonal layer, with leaders out to the lines", () => {
        const segments = measureBetween(rect(0, 0, 100, 100), rect(200, 300, 50, 50));
        expect(segments).toEqual([
            { axis: "x", from: 100, to: 200, at: 50, leader: { at: 200, from: 50, to: 300 } },
            { axis: "y", from: 100, to: 300, at: 50, leader: { at: 300, from: 50, to: 200 } },
        ]);
    });

    it("measures all four sides to the container a layer sits in", () => {
        const segments = measureBetween(rect(20, 30, 60, 40), rect(0, 0, 100, 100));
        expect(segments).toEqual([
            { axis: "x", from: 0, to: 20, at: 50 },
            { axis: "x", from: 80, to: 100, at: 50 },
            { axis: "y", from: 0, to: 30, at: 50 },
            { axis: "y", from: 70, to: 100, at: 50 },
        ]);
    });

    it("leaves out sides that share an edge", () => {
        const segments = measureBetween(rect(0, 30, 60, 40), rect(0, 0, 100, 100));
        expect(segments.map(s => [s.axis, s.from, s.to])).toEqual([
            ["x", 60, 100],
            ["y", 0, 30],
            ["y", 70, 100],
        ]);
    });

    it("draws nothing between layers that only touch", () => {
        expect(measureBetween(rect(0, 0, 100, 100), rect(100, 0, 100, 100))).toEqual([]);
    });
});
