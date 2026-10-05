import { describe, expect, it } from "vitest";
import { computeOffPageVeilBands, OFF_PAGE_VEIL_REACH } from "./SurfaceOffPageVeil";

type Band = ReturnType<typeof computeOffPageVeilBands>[number];

function covers(bands: Band[], x: number, y: number): number {
    return bands.filter(b => x >= b.left && x < b.left + b.width && y >= b.top && y < b.top + b.height).length;
}

describe("computeOffPageVeilBands", () => {
    const designSize = { width: 1920, height: 1080 };
    const bands = computeOffPageVeilBands(designSize);

    it("leaves the page itself uncovered", () => {
        for (const [x, y] of [[0, 0], [1919, 0], [0, 1079], [1919, 1079], [960, 540]]) {
            expect(covers(bands, x, y)).toBe(0);
        }
    });

    it("covers every point past each edge and corner exactly once", () => {
        const points = [
            [-1, 540], [1920, 540], [960, -1], [960, 1080],
            [-1, -1], [1920, -1], [-1, 1080], [1920, 1080],
            [960, 1080 + 1500], [-5000, -5000],
        ];
        for (const [x, y] of points) {
            expect(covers(bands, x, y)).toBe(1);
        }
    });

    it("reaches past a window seen at the canvas's smallest zoom", () => {
        // 0.1 is the smallest zoom; a 4K-wide canvas then shows 38 400 design pixels.
        expect(OFF_PAGE_VEIL_REACH * 0.1).toBeGreaterThan(3840);
        expect(covers(bands, -OFF_PAGE_VEIL_REACH + 1, 540)).toBe(1);
    });
});
