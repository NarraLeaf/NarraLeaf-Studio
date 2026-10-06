import { describe, expect, it } from "vitest";
import { computeGridScreenLines } from "@/lib/ui-editor/snapping/gridSnap";
import { layoutGridDots, type OverlayFrame } from "./SurfaceGridOverlay";

function frame(partial: Partial<OverlayFrame>): OverlayFrame {
    return { width: 400, height: 300, dpr: 1, deviceLeft: 0, deviceTop: 0, ...partial };
}

function linesFor(overlay: OverlayFrame, viewport = { scale: 1, offsetX: 0, offsetY: 0 }) {
    const lines = computeGridScreenLines({
        spacing: 20,
        viewport,
        designSize: { width: 100, height: 60 },
        overlaySize: { width: overlay.width, height: overlay.height },
    });
    if (!lines) {
        throw new Error("page out of view");
    }
    return lines;
}

describe("layoutGridDots", () => {
    it("puts a dot on every grid point, two device pixels square at 100%", () => {
        const overlay = frame({});
        const layout = layoutGridDots(linesFor(overlay), overlay);

        expect(layout.size).toBe(2);
        expect(layout.xs).toEqual([0, 20, 40, 60, 80, 100]);
        expect(layout.ys).toEqual([0, 20, 40, 60]);
        expect(layout.css).toEqual({ left: 0, top: 0, width: 400, height: 300 });
        expect([layout.pixelWidth, layout.pixelHeight]).toEqual([400, 300]);
    });

    it("grows the dot with the display's pixel ratio and centres an odd one on the line's pixel", () => {
        const overlay = frame({ dpr: 2 });
        const layout = layoutGridDots(linesFor(overlay), overlay);

        expect(layout.size).toBe(3);
        // The line for x = 20 is device column 40; a three-pixel dot covers 39-41.
        expect(layout.xs[1]).toBe(39);
        expect([layout.pixelWidth, layout.pixelHeight]).toEqual([800, 600]);
    });

    it("shifts the canvas onto whole device pixels when the overlay does not start on one", () => {
        // 1.25x display, overlay's left edge at 101.3 CSS px = 126.625 device px.
        const overlay = frame({ dpr: 1.25, deviceLeft: 126.625, deviceTop: 50 });
        const layout = layoutGridDots(linesFor(overlay, { scale: 1, offsetX: 10, offsetY: 0 }), overlay);

        expect(layout.css.left).toBeCloseTo(-0.5, 10);
        expect(layout.css.left * 1.25 + 126.625).toBe(126);
        // The x = 0 line sits at overlay x 10, device 139.125, which is column 139 = canvas pixel 13.
        expect(layout.xs[0]).toBe(13);
        expect(layout.xs.every(Number.isInteger)).toBe(true);
        expect(layout.ys.every(Number.isInteger)).toBe(true);
    });
});
