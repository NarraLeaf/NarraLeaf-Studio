import { describe, expect, it } from "vitest";
import { resolveSnapGuideSpans } from "./guideSpans";

const designSize = { width: 1000, height: 800 };
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe("resolveSnapGuideSpans", () => {
    it("runs a left-edge guide from the layer above to the subject and labels the gap", () => {
        const spans = resolveSnapGuideSpans({
            guides: { surfaceId: "s", vertical: [{ value: 100, kind: "element-edge" }], horizontal: [] },
            subject: box(100, 300, 50, 50),
            candidates: [box(100, 100, 200, 80), box(500, 100, 10, 10)],
            designSize,
        });
        expect(spans).toEqual([
            { axis: "vertical", value: 100, kind: "element-edge", from: 100, to: 350, gap: { from: 180, to: 300 } },
        ]);
    });

    it("labels the nearest of several aligned layers and spans them all", () => {
        const spans = resolveSnapGuideSpans({
            guides: { surfaceId: "s", vertical: [], horizontal: [{ value: 50, kind: "element-center" }] },
            subject: box(400, 25, 100, 50),
            candidates: [box(0, 0, 100, 100), box(300, 40, 50, 20), box(800, 30, 100, 40)],
            designSize,
        });
        expect(spans).toEqual([
            { axis: "horizontal", value: 50, kind: "element-center", from: 0, to: 900, gap: { from: 350, to: 400 } },
        ]);
    });

    it("draws no gap to a layer the subject overlaps along the guide", () => {
        const spans = resolveSnapGuideSpans({
            guides: { surfaceId: "s", vertical: [{ value: 100, kind: "element-edge" }], horizontal: [] },
            subject: box(100, 120, 50, 50),
            candidates: [box(0, 100, 100, 100)],
            designSize,
        });
        expect(spans[0]).toEqual({ axis: "vertical", value: 100, kind: "element-edge", from: 100, to: 200 });
    });

    it("runs a canvas guide the canvas's length, and past it for a subject hanging over", () => {
        const spans = resolveSnapGuideSpans({
            guides: { surfaceId: "s", vertical: [{ value: 500, kind: "surface-center" }], horizontal: [] },
            subject: box(450, 700, 100, 200),
            candidates: [],
            designSize,
        });
        expect(spans).toEqual([{ axis: "vertical", value: 500, kind: "surface-center", from: 0, to: 900 }]);
    });
});
