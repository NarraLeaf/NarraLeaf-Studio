import { describe, expect, it } from "vitest";
import { isUnrenderableFontFormat, sniffFontFormat } from "./fontFormats";

/** A buffer whose first four bytes are `tag`, padded to a plausible header length. */
function header(tag: string | readonly number[]): Uint8Array {
    const bytes = new Uint8Array(16);
    const head = typeof tag === "string" ? [...tag].map(c => c.charCodeAt(0)) : tag;
    bytes.set(head, 0);
    return bytes;
}

describe("sniffFontFormat", () => {
    it("reads a TrueType-outline sfnt from its version field", () => {
        expect(sniffFontFormat(header([0x00, 0x01, 0x00, 0x00]))).toBe("ttf");
    });

    it("reads the other sfnt spellings", () => {
        expect(sniffFontFormat(header("true"))).toBe("ttf");
        expect(sniffFontFormat(header("typ1"))).toBe("ttf");
        expect(sniffFontFormat(header("OTTO"))).toBe("otf");
    });

    it("reads both WOFF containers", () => {
        expect(sniffFontFormat(header("wOFF"))).toBe("woff");
        expect(sniffFontFormat(header("wOF2"))).toBe("woff2");
    });

    it("names a collection rather than hiding it, so the caller can refuse it by name", () => {
        expect(sniffFontFormat(header("ttcf"))).toBe("ttc");
        expect(isUnrenderableFontFormat(sniffFontFormat(header("ttcf")))).toBe(true);
    });

    it("answers null for anything it does not recognise, so the name can still answer", () => {
        expect(sniffFontFormat(header("%PDF"))).toBeNull();
        expect(sniffFontFormat(new Uint8Array([0x00, 0x01]))).toBeNull();
        expect(sniffFontFormat(undefined)).toBeNull();
        expect(sniffFontFormat(null)).toBeNull();
    });

    // The state a migrated or generated library arrives in: no `ext`, no dot in the name. The name
    // route answers "unknown" there, which downstream reads as a format nothing can draw.
    it("answers for a font whose record carries no extension at all", () => {
        const truetype = header([0x00, 0x01, 0x00, 0x00]);
        expect(sniffFontFormat(truetype)).toBe("ttf");
        expect(isUnrenderableFontFormat(sniffFontFormat(truetype))).toBe(false);
    });
});
