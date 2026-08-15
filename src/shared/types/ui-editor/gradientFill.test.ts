import { describe, expect, it } from "vitest";
import {
    DEFAULT_GRADIENT_ANGLE,
    DEFAULT_GRADIENT_FILL,
    isGradientFill,
    normalizeGradientFill,
    type GradientFill,
} from "./gradientFill";

describe("DEFAULT_GRADIENT_FILL", () => {
    it("is a top-to-bottom linear gradient between the two seeded brand slots", () => {
        expect(DEFAULT_GRADIENT_FILL.kind).toBe("linear");
        expect(DEFAULT_GRADIENT_FILL.angle).toBe(DEFAULT_GRADIENT_ANGLE);
        expect(DEFAULT_GRADIENT_ANGLE).toBe(180);
        expect(DEFAULT_GRADIENT_FILL.stops).toEqual([
            { offset: 0, color: "nlbrand:primary" },
            { offset: 1, color: "nlbrand:secondary" },
        ]);
    });

    it("is itself a valid gradient and survives a round trip through normalize", () => {
        expect(isGradientFill(DEFAULT_GRADIENT_FILL)).toBe(true);
        expect(normalizeGradientFill(DEFAULT_GRADIENT_FILL)).toEqual(DEFAULT_GRADIENT_FILL);
    });
});

describe("normalizeGradientFill: refusals", () => {
    it("refuses anything that is not a gradient", () => {
        for (const junk of [null, undefined, 42, "linear", true, [], {}, { kind: "mesh" }]) {
            expect(normalizeGradientFill(junk)).toBeUndefined();
        }
    });

    it("refuses a kind this build does not know rather than redrawing it as another shape", () => {
        expect(normalizeGradientFill({
            kind: "sweep",
            stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }],
        })).toBeUndefined();
    });

    it("refuses a gradient with no usable stop left", () => {
        expect(normalizeGradientFill({ kind: "linear", stops: [] })).toBeUndefined();
        expect(normalizeGradientFill({ kind: "linear", stops: "red" })).toBeUndefined();
        expect(normalizeGradientFill({
            kind: "linear",
            stops: [{ offset: 0 }, { offset: 1, color: "   " }, null, 7],
        })).toBeUndefined();
    });
});

describe("normalizeGradientFill: repairs", () => {
    it("clamps offsets and sorts the stops", () => {
        const fill = normalizeGradientFill({
            kind: "linear",
            stops: [
                { offset: 4, color: "#fff" },
                { offset: 0.5, color: "#888" },
                { offset: -2, color: "#000" },
            ],
        });
        expect(fill?.stops).toEqual([
            { offset: 0, color: "#000" },
            { offset: 0.5, color: "#888" },
            { offset: 1, color: "#fff" },
        ]);
    });

    it("keeps a stop whose offset is unreadable, at 0, because the colour is the part that matters", () => {
        const fill = normalizeGradientFill({
            kind: "linear",
            stops: [
                { offset: 1, color: "#fff" },
                { offset: "middle", color: "nlbrand:primary" },
            ],
        });
        expect(fill?.stops).toEqual([
            { offset: 0, color: "nlbrand:primary" },
            { offset: 1, color: "#fff" },
        ]);
    });

    it("keeps the written order of two stops at the same offset, which is how a hard stop is spelled", () => {
        const fill = normalizeGradientFill({
            kind: "linear",
            stops: [
                { offset: 0, color: "#aaa" },
                { offset: 0.5, color: "#bbb" },
                { offset: 0.5, color: "#ccc" },
                { offset: 1, color: "#ddd" },
            ],
        });
        expect(fill?.stops.map((s) => s.color)).toEqual(["#aaa", "#bbb", "#ccc", "#ddd"]);
    });

    it("pads a lone stop to the pair CSS needs", () => {
        const fill = normalizeGradientFill({ kind: "radial", stops: [{ offset: 0.25, color: "#f00" }] });
        expect(fill?.stops).toEqual([
            { offset: 0.25, color: "#f00" },
            { offset: 0.25, color: "#f00" },
        ]);
        expect(fill?.stops[0]).not.toBe(fill?.stops[1]);
    });

    it("trims a stop colour so two authors writing the same colour store the same bytes", () => {
        const fill = normalizeGradientFill({
            kind: "linear",
            stops: [{ offset: 0, color: "  nlbrand:primary  " }, { offset: 1, color: "#fff" }],
        });
        expect(fill?.stops[0].color).toBe("nlbrand:primary");
    });

    it("clamps the centre and the radii", () => {
        const fill = normalizeGradientFill({
            kind: "radial",
            stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }],
            center: { x: -1, y: 9 },
            radius: { x: 0.25, y: 40 },
        });
        expect(fill?.center).toEqual({ x: 0, y: 1 });
        expect(fill?.radius).toEqual({ x: 0.25, y: 1 });
    });

    it("drops an unreadable angle, centre or radius so the documented default stands in", () => {
        const fill = normalizeGradientFill({
            kind: "conic",
            stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }],
            angle: Number.NaN,
            center: { x: "half", y: 0.5 },
            radius: null,
        });
        expect(fill).toBeDefined();
        expect(fill?.angle).toBeUndefined();
        expect(fill?.center).toBeUndefined();
        expect(fill?.radius).toBeUndefined();
    });

    it("leaves an absent optional absent rather than writing a field the kind does not use", () => {
        const fill = normalizeGradientFill({
            kind: "linear",
            stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }],
            angle: 45,
        });
        expect(fill).toEqual({
            kind: "linear",
            angle: 45,
            stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }],
        });
        expect(Object.keys(fill!)).not.toContain("center");
        expect(Object.keys(fill!)).not.toContain("radius");
    });

    it("keeps an angle outside 0..360, which CSS reads as a rotation", () => {
        const fill = normalizeGradientFill({
            kind: "linear",
            stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }],
            angle: -450,
        });
        expect(fill?.angle).toBe(-450);
    });

    it("hands back fresh objects so a caller cannot edit the document through them", () => {
        const stored = {
            kind: "linear" as const,
            stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }],
            center: { x: 0.5, y: 0.5 },
        };
        const fill = normalizeGradientFill(stored)!;
        expect(fill).not.toBe(stored);
        expect(fill.stops).not.toBe(stored.stops);
        expect(fill.stops[0]).not.toBe(stored.stops[0]);
        expect(fill.center).not.toBe(stored.center);
    });

    it("always answers with something isGradientFill accepts", () => {
        const repaired = normalizeGradientFill({ kind: "conic", stops: [{ offset: 5, color: "#0f0" }] });
        expect(repaired).toBeDefined();
        expect(isGradientFill(repaired)).toBe(true);
    });
});

describe("isGradientFill", () => {
    it("accepts a well-formed gradient of each kind", () => {
        const stops = [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }];
        const kinds: GradientFill[] = [
            { kind: "linear", stops, angle: 90 },
            { kind: "radial", stops, center: { x: 0.5, y: 0.5 }, radius: { x: 0.5, y: 0.5 } },
            { kind: "conic", stops, angle: 0, center: { x: 0.2, y: 0.8 } },
        ];
        for (const fill of kinds) {
            expect(isGradientFill(fill)).toBe(true);
        }
    });

    it("rejects junk, a bad kind, a short stop list and a broken optional", () => {
        const stops = [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }];
        expect(isGradientFill(null)).toBe(false);
        expect(isGradientFill(42)).toBe(false);
        expect(isGradientFill({})).toBe(false);
        expect(isGradientFill({ kind: "mesh", stops })).toBe(false);
        expect(isGradientFill({ kind: "linear", stops: [stops[0]] })).toBe(false);
        expect(isGradientFill({ kind: "linear", stops: [{ offset: 0, color: 7 }, stops[1]] })).toBe(false);
        expect(isGradientFill({ kind: "linear", stops, angle: "90" })).toBe(false);
        expect(isGradientFill({ kind: "radial", stops, center: { x: 0.5 } })).toBe(false);
        expect(isGradientFill({ kind: "radial", stops, radius: "half" })).toBe(false);
    });

    it("does not reject an image fill by accident, which is the union it has to narrow", () => {
        expect(isGradientFill({ mode: "cover", assetId: "asset-1" })).toBe(false);
    });
});
