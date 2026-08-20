import { describe, expect, it } from "vitest";
import {
    DEFAULT_GRADIENT_FILL,
    type GradientFill,
    type GradientStop,
} from "@shared/types/ui-editor/gradientFill";
import { gradientToCss, type ResolvedGradientStop } from "./gradientCss";

const BLACK_TO_WHITE: GradientStop[] = [
    { offset: 0, color: "nlbrand:primary" },
    { offset: 1, color: "nlbrand:secondary" },
];

/** What a host hands over once it has run the stored colours through its own `colorUtils`. */
const RESOLVED: ResolvedGradientStop[] = [
    { offset: 0, color: "rgba(0, 0, 0, 1)" },
    { offset: 1, color: "rgba(255, 255, 255, 1)" },
];

function fill(overrides: Partial<GradientFill> = {}): GradientFill {
    return { kind: "linear", stops: BLACK_TO_WHITE, ...overrides };
}

describe("gradientToCss: the three kinds", () => {
    it("emits a linear gradient from the angle alone", () => {
        expect(gradientToCss(fill({ kind: "linear", angle: 45 }), RESOLVED))
            .toBe("linear-gradient(45deg, rgba(0, 0, 0, 1) 0%, rgba(255, 255, 255, 1) 100%)");
    });

    it("emits a radial gradient as a percentage ellipse, so nothing measures the element", () => {
        const css = gradientToCss(
            fill({ kind: "radial", center: { x: 0.25, y: 0.75 }, radius: { x: 0.5, y: 0.25 } }),
            RESOLVED,
        );
        expect(css).toBe(
            "radial-gradient(ellipse 50% 25% at 25% 75%, rgba(0, 0, 0, 1) 0%, rgba(255, 255, 255, 1) 100%)",
        );
    });

    it("emits a conic gradient from the angle and the centre", () => {
        const css = gradientToCss(
            fill({ kind: "conic", angle: 90, center: { x: 0, y: 1 } }),
            RESOLVED,
        );
        expect(css).toBe(
            "conic-gradient(from 90deg at 0% 100%, rgba(0, 0, 0, 1) 0%, rgba(255, 255, 255, 1) 100%)",
        );
    });

    it("carries no vector, no rotation and no interpolation hint - all four are deferred", () => {
        const css = [
            gradientToCss(fill({ kind: "linear" }), RESOLVED),
            gradientToCss(fill({ kind: "radial" }), RESOLVED),
            gradientToCss(fill({ kind: "conic" }), RESOLVED),
        ].join(" ");
        expect(css).not.toContain("repeating-");
        expect(css).not.toContain("in oklab");
        expect(css).not.toContain("px");
        expect(css).not.toContain("rotate");
    });
});

describe("gradientToCss: defaults for absent optionals", () => {
    it("falls back to the default angle, the one DEFAULT_GRADIENT_FILL carries", () => {
        expect(gradientToCss(fill({ kind: "linear" }), RESOLVED))
            .toBe(`linear-gradient(${DEFAULT_GRADIENT_FILL.angle}deg, rgba(0, 0, 0, 1) 0%, rgba(255, 255, 255, 1) 100%)`);
    });

    it("falls back to a centred ellipse that reaches the edges of the box", () => {
        expect(gradientToCss(fill({ kind: "radial" }), RESOLVED))
            .toBe("radial-gradient(ellipse 50% 50% at 50% 50%, rgba(0, 0, 0, 1) 0%, rgba(255, 255, 255, 1) 100%)");
    });

    it("falls back to the same angle and centre for a conic gradient", () => {
        expect(gradientToCss(fill({ kind: "conic" }), RESOLVED))
            .toBe("conic-gradient(from 180deg at 50% 50%, rgba(0, 0, 0, 1) 0%, rgba(255, 255, 255, 1) 100%)");
    });

    it("substitutes a default for an unreadable angle rather than emitting NaN", () => {
        const css = gradientToCss(fill({ kind: "linear", angle: Number.NaN }), RESOLVED);
        expect(css).not.toContain("NaN");
        expect(css).toContain("180deg");
    });
});

describe("gradientToCss: numbers", () => {
    it("rounds an offset to two decimals, because these strings live in a versioned document", () => {
        const css = gradientToCss(fill(), [
            { offset: 0, color: "red" },
            { offset: 1 / 3, color: "green" },
            { offset: 0.5000000000000001, color: "blue" },
        ]);
        expect(css).toBe("linear-gradient(180deg, red 0%, green 33.33%, blue 50%)");
    });

    it("rounds the angle, the centre and the radii too", () => {
        const css = gradientToCss(
            fill({ kind: "radial", center: { x: 1 / 3, y: 2 / 3 }, radius: { x: 1 / 7, y: 0.5 } }),
            RESOLVED,
        );
        expect(css).toContain("ellipse 14.29% 50% at 33.33% 66.67%");
        expect(gradientToCss(fill({ kind: "conic", angle: 12.3456 }), RESOLVED)).toContain("from 12.35deg");
    });

    it("clamps an out-of-range offset instead of emitting it", () => {
        const css = gradientToCss(fill(), [
            { offset: -3, color: "red" },
            { offset: 7, color: "blue" },
        ]);
        expect(css).toBe("linear-gradient(180deg, red 0%, blue 100%)");
    });

    it("leaves the caller's stop order alone - CSS clamps a backwards stop itself", () => {
        const css = gradientToCss(fill(), [
            { offset: 0.8, color: "red" },
            { offset: 0.2, color: "blue" },
        ]);
        expect(css).toBe("linear-gradient(180deg, red 80%, blue 20%)");
    });
});

describe("gradientToCss: degenerate input still answers with a background-image value", () => {
    it("paints nothing, as a gradient, when there are no stops", () => {
        for (const kind of ["linear", "radial", "conic"] as const) {
            expect(gradientToCss(fill({ kind }), [])).toBe("linear-gradient(transparent, transparent)");
        }
    });

    it("paints one stop flat rather than emitting a bare colour", () => {
        const css = gradientToCss(fill(), [{ offset: 0.4, color: "#ff0000" }]);
        expect(css).toBe("linear-gradient(#ff0000, #ff0000)");
    });

    it("paints the last stop flat when a radial gradient has no radius to lay stops along", () => {
        expect(gradientToCss(fill({ kind: "radial", radius: { x: 0, y: 0.5 } }), RESOLVED))
            .toBe("linear-gradient(rgba(255, 255, 255, 1), rgba(255, 255, 255, 1))");
        expect(gradientToCss(fill({ kind: "radial", radius: { x: 0.5, y: 0 } }), RESOLVED))
            .toBe("linear-gradient(rgba(255, 255, 255, 1), rgba(255, 255, 255, 1))");
    });

    it("reads a kind from a later version as linear rather than dropping the stops", () => {
        const unknownKind = { kind: "mesh", stops: BLACK_TO_WHITE } as unknown as GradientFill;
        expect(gradientToCss(unknownKind, RESOLVED))
            .toBe("linear-gradient(180deg, rgba(0, 0, 0, 1) 0%, rgba(255, 255, 255, 1) 100%)");
    });

    it("does not mind a resolved list shorter than the fill's own stops", () => {
        const threeStopFill = fill({
            stops: [...BLACK_TO_WHITE, { offset: 0.5, color: "#888" }],
        });
        expect(gradientToCss(threeStopFill, RESOLVED))
            .toBe("linear-gradient(180deg, rgba(0, 0, 0, 1) 0%, rgba(255, 255, 255, 1) 100%)");
    });
});
