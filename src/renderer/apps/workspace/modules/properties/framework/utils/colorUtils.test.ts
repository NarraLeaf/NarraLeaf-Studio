import { describe, expect, it } from "vitest";
import { normalizeHex, normalizeHexInputDraft, parseColorValue } from "./colorUtils";
import { formatBrandLink } from "@shared/brand/brandLink";

describe("colorUtils", () => {
    it("normalizes complete hex colors", () => {
        expect(normalizeHex("#abc")).toBe("#AABBCC");
        expect(normalizeHex("12ef9a")).toBe("#12EF9A");
    });

    it("rejects incomplete or invalid hex colors", () => {
        expect(normalizeHex("#12")).toBeNull();
        expect(normalizeHex("#1234")).toBeNull();
        expect(normalizeHex("#zzzzzz")).toBeNull();
    });

    it("keeps editable hex drafts without requiring a complete color", () => {
        expect(normalizeHexInputDraft("a")).toBe("#A");
        expect(normalizeHexInputDraft("#12")).toBe("#12");
        expect(normalizeHexInputDraft("00ccff")).toBe("#00CCFF");
        expect(normalizeHexInputDraft("#12x34yz56")).toBe("#123456");
    });

    it("falls back for invalid parsed colors", () => {
        const fallback = { hex: "#000000", alpha: 1 };
        expect(parseColorValue("#zzzzzz", fallback)).toEqual(fallback);
    });
});

/**
 * The safety net the brand rollout stands on, from this side.
 *
 * A `nlbrand:` link is stored in colour fields long before each of them has been taught to resolve
 * one, so what matters is that an unadopted field falls through to its own fallback rather than
 * painting something wrong. Two of the three parsers that could have mistaken a link for a colour
 * live in this file - the hex reader and the `rgb()`/`rgba()` regex behind `parseColorValue` - and
 * this is where they are pinned. The third is asserted in `@shared/brand/brandLink.test.ts`.
 *
 * Weaken either of these and a half-adopted project paints black where a button used to be.
 */
describe("colorUtils does not mistake a brand link for a color", () => {
    it("rejects it as hex", () => {
        expect(normalizeHex(formatBrandLink("primary"))).toBeNull();
        expect(normalizeHex(formatBrandLink("button.border", 0.5))).toBeNull();
    });

    it("hands back the caller's fallback rather than a color of its own", () => {
        const fallback = { hex: "#123456", alpha: 1 };

        expect(parseColorValue(formatBrandLink("primary"), fallback)).toBe(fallback);
        expect(parseColorValue(formatBrandLink("container.background", 0.35), fallback)).toBe(fallback);
    });
});
