import { describe, expect, it } from "vitest";
import { normalizeHex, normalizeHexInputDraft, parseColorValue } from "./colorUtils";

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
