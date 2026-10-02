import { describe, expect, it } from "vitest";
import { resolveSurfaceListLayout } from "./surfaceListLayout";

/**
 * Content widths the list actually gets: the rail's width less its border, the list's `px-2` and the
 * scrollbar's lane. Measured in the dev app at the rail's minimum, default and the widest the
 * editor's floor allowed in a 1400px window.
 */
const AT_MINIMUM_RAIL = 214;
const AT_DEFAULT_RAIL = 294;
const AT_WIDE_RAIL = 478;

describe("resolveSurfaceListLayout", () => {
    it("lists rows with a thumbnail when two tiles do not fit", () => {
        expect(resolveSurfaceListLayout(AT_MINIMUM_RAIL)).toEqual({ mode: "rows" });
        expect(resolveSurfaceListLayout(279)).toEqual({ mode: "rows" });
    });

    it("lays two columns of tiles out at the rail's default width", () => {
        expect(resolveSurfaceListLayout(AT_DEFAULT_RAIL)).toEqual({ mode: "tiles", columns: 2, previewHeight: 70 });
    });

    it("adds a column whenever another one fits", () => {
        expect(resolveSurfaceListLayout(AT_WIDE_RAIL)).toMatchObject({ mode: "tiles", columns: 3 });
        expect(resolveSurfaceListLayout(900)).toMatchObject({ mode: "tiles", columns: 6 });
    });

    it("sizes a tile's preview to a 16:9 picture as wide as the tile, within bounds", () => {
        const layout = resolveSurfaceListLayout(AT_WIDE_RAIL);
        expect(layout.mode === "tiles" && layout.previewHeight).toBe(77);
        for (const width of [280, 400, 640, 2000]) {
            const next = resolveSurfaceListLayout(width);
            if (next.mode === "tiles") {
                expect(next.previewHeight).toBeGreaterThanOrEqual(56);
                expect(next.previewHeight).toBeLessThanOrEqual(160);
            }
        }
    });

    it("draws rows before the list has been measured", () => {
        expect(resolveSurfaceListLayout(0)).toEqual({ mode: "rows" });
        expect(resolveSurfaceListLayout(Number.NaN)).toEqual({ mode: "rows" });
    });
});
