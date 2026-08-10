import { afterEach, describe, expect, it } from "vitest";
import { colorValueToCss, normalizeHex, parseColorValue, serializeColorValue } from "./colorUtils";
import { formatBrandLink } from "@shared/brand/brandLink";
import { setActiveBrandPalette } from "@shared/brand/brandRegistry";
import { BUILTIN_BRAND_COLORS } from "@shared/types/brand";

/**
 * The runtime host's half of the colour contract.
 *
 * These are the same cases as
 * `src/renderer/apps/workspace/modules/properties/framework/utils/colorUtils.test.ts`, asserted
 * against the other copy of the module. The duplication is the point: the editor and the shipped
 * game read the same stored strings out of two separate implementations, and nothing else compares
 * them. A divergence here surfaces in a built game, on someone else's machine, long after the edit.
 *
 * Comments in English per project convention.
 */
describe("runtime colorUtils resolves brand links the same way the editor does", () => {
    afterEach(() => {
        setActiveBrandPalette(BUILTIN_BRAND_COLORS);
    });

    const fallback = { hex: "#123456", alpha: 1 };

    it("still refuses to read a link as a hex colour", () => {
        expect(normalizeHex(formatBrandLink("primary"))).toBeNull();
        expect(normalizeHex(formatBrandLink("button.border", 0.5))).toBeNull();
    });

    it("resolves a link to the colour it names, and keeps the id", () => {
        expect(parseColorValue(formatBrandLink("primary"), fallback)).toEqual({
            hex: "#40A8C4",
            alpha: 1,
            link: "primary",
        });
    });

    it("follows a link that points at another entry", () => {
        expect(parseColorValue(formatBrandLink("button.primary"), fallback)).toEqual({
            hex: "#40A8C4",
            alpha: 1,
            link: "button.primary",
        });
    });

    it("keeps the palette entry's own alpha when the link does not override it", () => {
        expect(parseColorValue(formatBrandLink("button.shadow"), fallback)).toEqual({
            hex: "#000000",
            alpha: 0.35,
            link: "button.shadow",
        });
    });

    it("takes the link's alpha as final rather than compounding it with the entry's", () => {
        // 0.5, not 0.5 * 0.35.
        expect(parseColorValue(formatBrandLink("button.shadow", 0.5), fallback)).toEqual({
            hex: "#000000",
            alpha: 0.5,
            link: "button.shadow",
        });
    });

    it("applies the link's alpha to the literal a chain ends at", () => {
        expect(parseColorValue(formatBrandLink("button.primary", 0.5), fallback)).toEqual({
            hex: "#40A8C4",
            alpha: 0.5,
            link: "button.primary",
        });
    });

    it("takes the stored value's alpha over one written inside the palette, not the product", () => {
        setActiveBrandPalette([
            { id: "primary", value: "#40A8C4" },
            { id: "a", value: "nlbrand:primary/0.5" },
        ]);

        // 0.8, not 0.8 * 0.5 = 0.4.
        expect(parseColorValue("nlbrand:a/0.8", fallback)).toEqual({
            hex: "#40A8C4",
            alpha: 0.8,
            link: "a",
        });
        expect(parseColorValue("nlbrand:a", fallback)).toEqual({
            hex: "#40A8C4",
            alpha: 0.5,
            link: "a",
        });
        expect(colorValueToCss({ hex: "#FF0000", alpha: 0.8, link: "a" })).toBe("rgba(64, 168, 196, 0.8)");
        expect(serializeColorValue(parseColorValue("nlbrand:a/0.8", fallback))).toBe("nlbrand:a/0.8");
        expect(serializeColorValue(parseColorValue("nlbrand:a", fallback))).toBe("nlbrand:a");
    });

    it("hands back the caller's own fallback for an id nothing defines", () => {
        expect(parseColorValue(formatBrandLink("nosuchcolor"), fallback)).toBe(fallback);
    });

    it("hands back the caller's own fallback for a ring", () => {
        setActiveBrandPalette([
            { id: "primary", value: "nlbrand:secondary" },
            { id: "secondary", value: "nlbrand:primary" },
        ]);

        expect(parseColorValue(formatBrandLink("primary"), fallback)).toBe(fallback);
    });

    it("paints the palette's colour even when the caller is holding a stale hex", () => {
        expect(colorValueToCss({ hex: "#FF0000", alpha: 1, link: "primary" })).toBe("#40A8C4");
        expect(colorValueToCss({ hex: "#FF0000", alpha: 0.5, link: "primary" })).toBe("rgba(64, 168, 196, 0.5)");
    });

    it("paints the value's own hex when the link resolves to nothing", () => {
        expect(colorValueToCss({ hex: "#FF0000", alpha: 1, link: "nosuchcolor" })).toBe("#FF0000");
    });

    it("stores the link rather than the colour it resolved to", () => {
        expect(serializeColorValue({ hex: "#40A8C4", alpha: 1, link: "primary" })).toBe("nlbrand:primary");
        expect(serializeColorValue({ hex: "#40A8C4", alpha: 0.5, link: "primary" })).toBe("nlbrand:primary/0.5");
    });

    it("does not pin an alpha the author never chose", () => {
        const read = parseColorValue(formatBrandLink("button.shadow"), fallback);
        expect(serializeColorValue(read)).toBe("nlbrand:button.shadow");
        expect(serializeColorValue({ ...read, alpha: 0.5 })).toBe("nlbrand:button.shadow/0.5");
    });

    it("lets the opacity slider reach 100% on a translucent brand colour", () => {
        const read = parseColorValue(formatBrandLink("button.shadow"), fallback);
        const opaque = serializeColorValue({ ...read, alpha: 1 });
        expect(opaque).toBe("nlbrand:button.shadow/1");
        expect(parseColorValue(opaque, fallback).alpha).toBe(1);
    });

    it("stores an ordinary colour exactly as it always did", () => {
        expect(serializeColorValue({ hex: "#40A8C4", alpha: 1 })).toBe("#40A8C4");
        expect(serializeColorValue({ hex: "#40A8C4", alpha: 0.5 })).toBe("rgba(64, 168, 196, 0.5)");
    });

    it("survives a round trip through the picker unchanged", () => {
        for (const stored of [
            "nlbrand:primary",
            "nlbrand:button.primary",
            "nlbrand:button.shadow",
            "nlbrand:primary/0.5",
            "nlbrand:button.shadow/0.5",
            "nlbrand:button.primary/0.5",
        ]) {
            expect(serializeColorValue(parseColorValue(stored, fallback))).toBe(stored);
        }
    });
});
