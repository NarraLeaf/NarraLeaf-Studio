/**
 * A text shadow with a spread is drawn, as an outline, wherever text is drawn.
 *
 * `text-shadow` takes no spread, and a fourth length does not get ignored: it invalidates the whole
 * declaration, so an outline authored as a spread painted nothing on the canvas or in the game. These
 * pin the value every text paint site now receives: only layers of at most three lengths, which
 * together reach out exactly as far as the spread.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { effectTextShadowStoredToCss } from "./effects";
import { textShadowCssWithSpread, textShadowLayerDataToCss } from "./shadowLayerCodec";

type Copy = { x: number; y: number; blur: number; color: string };

/** Splits a value into layers and reads each one, failing on any layer `text-shadow` would reject. */
function copiesOf(css: string): Copy[] {
    return css.split(/,(?![^(]*\))/).map(raw => {
        const layer = raw.trim();
        const match = layer.match(/^(-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (.+)$/);
        if (!match) {
            throw new Error(`Not a text-shadow layer of three lengths and a colour: "${layer}"`);
        }
        return { x: Number(match[1]), y: Number(match[2]), blur: Number(match[3]), color: match[4]! };
    });
}

describe("text shadow serialisation", () => {
    it("leaves a layer without spread exactly as it was", () => {
        expect(textShadowLayerDataToCss({ offsetX: 1, offsetY: 2, blur: 3, spread: 0, color: "#000000" })).toBe("1px 2px 3px #000000");
    });

    it("draws a spread as copies reaching exactly the spread around the offset", () => {
        const css = textShadowLayerDataToCss({ offsetX: 0, offsetY: 0, blur: 0, spread: 5, color: "#5e5254" });
        const copies = copiesOf(css);

        expect(copies.length).toBeGreaterThan(8);
        expect(copies.every(copy => copy.color === "#5e5254" && copy.blur === 0)).toBe(true);
        const reach = Math.max(...copies.map(copy => Math.hypot(copy.x, copy.y)));
        expect(reach).toBeCloseTo(5, 1);
        // Every direction is covered: the outline is a ring, not a drop shadow.
        expect(Math.min(...copies.map(copy => copy.x))).toBeCloseTo(-5, 1);
        expect(Math.max(...copies.map(copy => copy.y))).toBeCloseTo(5, 1);
        expect(Math.min(...copies.map(copy => copy.y))).toBeCloseTo(-5, 1);
    });

    it("keeps the layer's offset and blur on every copy", () => {
        const copies = copiesOf(textShadowLayerDataToCss({ offsetX: 4, offsetY: -2, blur: 3, spread: 2, color: "rgba(0, 0, 0, 0.5)" }));

        expect(copies.every(copy => copy.blur === 3 && copy.color === "rgba(0, 0, 0, 0.5)")).toBe(true);
        const meanX = copies.reduce((sum, copy) => sum + copy.x, 0) / copies.length;
        const meanY = copies.reduce((sum, copy) => sum + copy.y, 0) / copies.length;
        expect(meanX).toBeCloseTo(4, 1);
        expect(meanY).toBeCloseTo(-2, 1);
    });

    it("drops a negative spread rather than writing a length text cannot take", () => {
        expect(textShadowLayerDataToCss({ offsetX: 0, offsetY: 1, blur: 2, spread: -3, color: "#111111" })).toBe("0px 1px 2px #111111");
    });

    it("rewrites only the layers of a free-form value that carry a spread", () => {
        const css = textShadowCssWithSpread("0 2px 4px rgba(0,0,0,0.4), 0 0 0 3px #fff");
        const copies = copiesOf(css.replace(/^0 2px 4px/, "0px 2px 4px"));

        expect(css.startsWith("0 2px 4px rgba(0,0,0,0.4), ")).toBe(true);
        expect(copies.length).toBeGreaterThan(2);
        expect(copies.slice(1).every(copy => copy.color === "#fff")).toBe(true);
    });

    it("hands a free-form value with no spread back untouched", () => {
        expect(textShadowCssWithSpread("  1px 1px 0 red, -1px -1px 0 blue ")).toBe("1px 1px 0 red, -1px -1px 0 blue");
    });

    it("is what a stored text shadow becomes, in either storage", () => {
        expect(effectTextShadowStoredToCss(null)).toBe("");
        expect(() => copiesOf(effectTextShadowStoredToCss({
            storage: "layer",
            layer: { offsetX: 0, offsetY: 0, blur: 1, spread: 4, color: "#000000" },
        }))).not.toThrow();
        expect(() => copiesOf(effectTextShadowStoredToCss({ storage: "css", css: "0px 0px 0px 2px #000000" }))).not.toThrow();
    });
});
