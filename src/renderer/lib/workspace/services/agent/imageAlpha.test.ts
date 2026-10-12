import { describe, expect, it } from "vitest";
import { opaqueImageWarning, readImageAlpha } from "./imageAlpha";

function chunk(type: string, data: number[]): number[] {
    const length = data.length;
    // The CRC is never checked by the reader, so zeros stand in for it.
    return [(length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255, ...[...type].map(c => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
}

function png(colourType: number, extra: number[][] = [], width = 700, height = 1000): Uint8Array {
    const ihdr = [
        (width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255,
        (height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255,
        8, colourType, 0, 0, 0,
    ];
    return new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...chunk("IHDR", ihdr),
        ...extra.flat(),
        ...chunk("IDAT", [1, 2, 3]),
        ...chunk("IEND", []),
    ]);
}

describe("readImageAlpha", () => {
    it("reads an RGB PNG without tRNS as opaque, with its size", () => {
        expect(readImageAlpha(png(2))).toEqual({ format: "png", width: 700, height: 1000, alpha: false });
        expect(readImageAlpha(png(0)).alpha).toBe(false);
        expect(readImageAlpha(png(3, [chunk("PLTE", [0, 0, 0])])).alpha).toBe(false);
    });

    it("reads RGBA / grey+alpha PNGs and colour-keyed ones as transparent", () => {
        expect(readImageAlpha(png(6)).alpha).toBe(true);
        expect(readImageAlpha(png(4)).alpha).toBe(true);
        expect(readImageAlpha(png(2, [chunk("tRNS", [0, 0, 0, 0, 0, 0])])).alpha).toBe(true);
        expect(readImageAlpha(png(3, [chunk("PLTE", [0, 0, 0]), chunk("tRNS", [0])])).alpha).toBe(true);
    });

    it("reads a JPEG as opaque and finds its size in the frame header", () => {
        const jpeg = new Uint8Array([
            0xff, 0xd8,
            0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0, 2 bytes of payload
            0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0xe8, 0x02, 0xbc, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]);
        expect(readImageAlpha(jpeg)).toEqual({ format: "jpeg", width: 700, height: 1000, alpha: false });
    });

    it("reads the WebP alpha flag", () => {
        const header = (fourcc: string, body: number[]) => new Uint8Array([
            ...[..."RIFF"].map(c => c.charCodeAt(0)), 0, 0, 0, 0,
            ...[..."WEBP"].map(c => c.charCodeAt(0)),
            ...[...fourcc].map(c => c.charCodeAt(0)), 0, 0, 0, 0,
            ...body,
        ]);
        // VP8X: flags, 3 reserved, width-1 and height-1 as 24-bit little endian.
        const vp8x = (flags: number) => header("VP8X", [flags, 0, 0, 0, 0xbb, 0x02, 0x00, 0xe7, 0x03, 0x00]);
        expect(readImageAlpha(vp8x(0x10))).toEqual({ format: "webp", width: 700, height: 1000, alpha: true });
        expect(readImageAlpha(vp8x(0)).alpha).toBe(false);
    });

    it("does not guess for formats it does not read", () => {
        expect(readImageAlpha(new TextEncoder().encode("GIF89a........")).alpha).toBeNull();
        expect(readImageAlpha(new Uint8Array([1, 2, 3])).alpha).toBeNull();
    });

    it("words the warning for sprites", () => {
        expect(opaqueImageWarning("lin_normal", readImageAlpha(png(2)))).toMatch(/"lin_normal" is a PNG with no alpha channel: as a character sprite it shows as a rectangle/);
    });
});
