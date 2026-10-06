import { afterEach, describe, expect, it } from "vitest";
import { setActiveBrandPalette } from "@shared/brand/brandRegistry";
import { BUILTIN_BRAND_COLORS } from "@shared/types/brand";
import { resolveTextPaintColor } from "./textPaintColor";

/**
 * A text's stored colour, as the canvas paints it and as the live dialogue and NVL lines hand it to
 * the engine. Whatever goes in, what comes out is something a browser renders - a string it drops
 * would leave the words in whatever colour the page around them has.
 *
 * The palette is module-level state, so a case that publishes its own puts the seeds back.
 */
describe("resolveTextPaintColor", () => {
    afterEach(() => {
        setActiveBrandPalette(BUILTIN_BRAND_COLORS);
    });

    it("resolves a brand link to the colour the palette gives it, following links between entries", () => {
        // `text.primary` is itself a link to `foreground` in the seeded palette.
        expect(resolveTextPaintColor("nlbrand:text.primary")).toBe("#F2F4F7");
        expect(resolveTextPaintColor("nlbrand:primary")).toBe("#40A8C4");
    });

    it("leaves an ordinary colour as it is", () => {
        expect(resolveTextPaintColor("#40A8C4")).toBe("#40A8C4");
        expect(resolveTextPaintColor("#abc")).toBe("#AABBCC");
        expect(resolveTextPaintColor("rgba(10, 20, 30, 0.5)")).toBe("rgba(10, 20, 30, 0.5)");
    });

    it("keeps a translucent palette entry's opacity, and an alpha the link asks for", () => {
        expect(resolveTextPaintColor("nlbrand:button.shadow")).toBe("rgba(0, 0, 0, 0.35)");
        expect(resolveTextPaintColor("nlbrand:primary/0.5")).toBe("rgba(64, 168, 196, 0.5)");
    });

    it("paints white when the value cannot be read, as the canvas always has", () => {
        expect(resolveTextPaintColor("nlbrand:no.such.entry")).toBe("#FFFFFF");
        expect(resolveTextPaintColor("not a colour")).toBe("#FFFFFF");
        expect(resolveTextPaintColor("")).toBe("#FFFFFF");
        expect(resolveTextPaintColor(undefined)).toBe("#FFFFFF");
    });

    it("answers with the palette as it stands when asked, not as it stood when the value was stored", () => {
        setActiveBrandPalette(
            BUILTIN_BRAND_COLORS.map(entry => (entry.id === "foreground" ? { ...entry, value: "#112233" } : entry)),
        );
        expect(resolveTextPaintColor("nlbrand:text.primary")).toBe("#112233");
    });
});
