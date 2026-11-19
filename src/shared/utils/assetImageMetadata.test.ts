import { describe, expect, it } from "vitest";
import { readImageDimensions } from "@shared/utils/imageDimensions";
import { stripImageMetadata } from "./assetImageMetadata";

function ascii(value: string): number[] {
    return [...value].map(character => character.charCodeAt(0));
}

function be32(value: number): number[] {
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function be16(value: number): number[] {
    return [(value >>> 8) & 0xff, value & 0xff];
}

/** RIFF counts in little-endian, unlike PNG and JPEG. */
function le32(value: number): number[] {
    return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function chunk(type: string, payload: number[] = []): number[] {
    // Nothing here verifies CRCs, and the stripper never recomputes one, so four
    // zeroes stand in - which is also the assertion that it never needs to.
    return [...be32(payload.length), ...ascii(type), ...payload, 0, 0, 0, 0];
}

function png(extraChunks: number[][] = [], trailingChunks: number[][] = []): Uint8Array {
    return Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...chunk("IHDR", [...be32(64), ...be32(64), 8, 6, 0, 0, 0]),
        ...extraChunks.flat(),
        ...chunk("IDAT", [1, 2, 3, 4]),
        ...trailingChunks.flat(),
        ...chunk("IEND"),
    ]);
}

function pngChunkTypes(bytes: Uint8Array): string[] {
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const types: string[] = [];
    let offset = 8;
    while (offset + 12 <= bytes.length) {
        const length = data.getUint32(offset);
        types.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)));
        offset += length + 12;
    }
    return types;
}

function segment(marker: number, payload: number[]): number[] {
    return [0xff, marker, ...be16(payload.length + 2), ...payload];
}

/**
 * A JPEG carrying the given segments, with a real frame header and scan.
 *
 * The frame header's declared length matches the bytes that follow it, which
 * matters here in a way it does not for a reader that stops at the frame: the
 * stripper walks every segment to the start of scan, so a length that lies about
 * its own segment would have it step over the scan marker.
 */
function jpeg(segments: number[][] = []): Uint8Array {
    // length(2) precision(1) height(2) width(2) components(1) + 3 bytes each.
    const frame = [0x08, ...be16(64), ...be16(64), 0x03, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1];
    return Uint8Array.from([
        0xff, 0xd8,
        ...segments.flat(),
        0xff, 0xc0, ...be16(frame.length + 2), ...frame,
        0xff, 0xda, 0x00, 0x02,
        0x12, 0x34, 0x56, 0x78,
        0xff, 0xd9,
    ]);
}

function riffChunk(fourcc: string, payload: number[]): number[] {
    const padded = payload.length % 2 === 1 ? [...payload, 0] : payload;
    return [...ascii(fourcc), ...le32(payload.length), ...padded];
}

const VP8X_ICC = 0x20;
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

/** An extended-format WebP, whose VP8X flags say what it carries. */
function webp(flags: number, chunks: number[][]): Uint8Array {
    const vp8x = riffChunk("VP8X", [flags, 0, 0, 0, 63, 0, 0, 63, 0, 0]);
    const body = [...ascii("WEBP"), ...vp8x, ...chunks.flat()];
    return Uint8Array.from([...ascii("RIFF"), ...le32(body.length), ...body]);
}

function riffFourccs(bytes: Uint8Array): string[] {
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out: string[] = [];
    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const length = data.getUint32(offset + 4, true);
        out.push(String.fromCharCode(...bytes.subarray(offset, offset + 4)));
        offset += 8 + length + (length % 2);
    }
    return out;
}

/** A TIFF IFD containing a display orientation and an artist name. */
function exifTiff(orientation: number, littleEndian: boolean): number[] {
    const artist = ascii("Private Artist\0");
    const data = new Uint8Array(38 + artist.length);
    const view = new DataView(data.buffer);
    data.set(ascii(littleEndian ? "II" : "MM"));
    view.setUint16(2, 42, littleEndian);
    view.setUint32(4, 8, littleEndian);
    view.setUint16(8, 2, littleEndian);
    view.setUint16(10, 0x0112, littleEndian);
    view.setUint16(12, 3, littleEndian);
    view.setUint32(14, 1, littleEndian);
    view.setUint16(18, orientation, littleEndian);
    view.setUint16(22, 0x013b, littleEndian);
    view.setUint16(24, 2, littleEndian);
    view.setUint32(26, artist.length, littleEndian);
    view.setUint32(30, 38, littleEndian);
    data.set(artist, 38);
    return [...data];
}

/** Read the orientation back from the IFD, regardless of byte order. */
function exifOrientation(bytes: Uint8Array, start: number): number | null {
    if (start < 0 || start + 8 > bytes.length) return null;
    const little = bytes[start] === 0x49 && bytes[start + 1] === 0x49;
    if (!little && !(bytes[start] === 0x4d && bytes[start + 1] === 0x4d)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ifd = start + view.getUint32(start + 4, little);
    if (ifd + 2 > bytes.length) return null;
    const count = view.getUint16(ifd, little);
    for (let i = 0; i < count; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) return null;
        if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
    }
    return null;
}

describe("stripImageMetadata", () => {
    it("hands back the very same bytes when there is nothing to remove", () => {
        const clean = png();
        const result = stripImageMetadata(clean);

        // Identity, not equality: a build that rewrites every image it looks at
        // would invalidate the optimizer's content-addressed cache for no reason.
        expect(result.bytes).toBe(clean);
        expect(result.removed).toEqual([]);
        expect(result.bytesRemoved).toBe(0);
    });

    it("leaves bytes it cannot identify alone rather than guessing", () => {
        const notAnImage = Uint8Array.from(ascii("ID3\x00artist name"));

        expect(stripImageMetadata(notAnImage).bytes).toBe(notAnImage);
    });

    it("keeps the display orientation while removing the artist from PNG, JPEG and WebP", () => {
        for (const orientation of [2, 3, 4, 5, 6, 7, 8]) {
            const tiff = exifTiff(orientation, orientation % 2 === 0);
            const sources = [
                { bytes: png([chunk("eXIf", tiff)]), marker: "eXIf", offset: 4 },
                { bytes: jpeg([segment(0xe1, [...ascii("Exif\0\0"), ...tiff])]), marker: "Exif\0\0", offset: 6 },
                {
                    bytes: webp(VP8X_EXIF | VP8X_XMP, [
                        riffChunk("VP8 ", [0, 1, 2, 3, 4, 5]),
                        riffChunk("EXIF", [...ascii("Exif\0\0"), ...tiff]),
                        riffChunk("XMP ", ascii("private xmp")),
                    ]),
                    marker: "Exif\0\0", offset: 6, webp: true,
                },
            ];
            for (const source of sources) {
                const result = stripImageMetadata(source.bytes);
                const marker = Buffer.from(result.bytes).indexOf(Buffer.from(source.marker));
                expect(marker).toBeGreaterThanOrEqual(0);
                expect(exifOrientation(result.bytes, marker + source.offset)).toBe(orientation);
                expect(Buffer.from(result.bytes).includes(Buffer.from("Private Artist"))).toBe(false);
                expect(result.removed).toContain("exif");
                if (source.webp) {
                    expect(result.bytes[20] & (VP8X_EXIF | VP8X_XMP)).toBe(VP8X_EXIF);
                }
                expect(stripImageMetadata(result.bytes).bytes).toBe(result.bytes);
            }
        }
    });

    it("drops EXIF when the orientation is the default", () => {
        const source = png([chunk("eXIf", exifTiff(1, true))]);
        const result = stripImageMetadata(source);
        expect(pngChunkTypes(result.bytes)).not.toContain("eXIf");
        expect(Buffer.from(result.bytes).includes(Buffer.from("Private Artist"))).toBe(false);
    });

    describe("PNG", () => {
        it("removes the text, EXIF and time chunks", () => {
            const source = png([
                chunk("tEXt", ascii("Software\x00Adobe Photoshop 25.0")),
                chunk("zTXt", ascii("Comment\x00")),
                chunk("iTXt", ascii("XML:com.adobe.xmp\x00\x00\x00\x00\x00<x:xmpmeta/>")),
                chunk("eXIf", [0x49, 0x49, 0x2a, 0]),
                chunk("tIME", [0x07, 0xe8, 1, 1, 0, 0, 0]),
            ]);

            const result = stripImageMetadata(source);

            expect(pngChunkTypes(result.bytes)).toEqual(["IHDR", "IDAT", "IEND"]);
            expect(result.removed.sort()).toEqual(["exif", "text", "timestamp", "xmp"]);
            expect(result.bytesRemoved).toBe(source.length - result.bytes.length);
            expect(result.bytesRemoved).toBeGreaterThan(0);
        });

        it("keeps the colour profile and everything that draws", () => {
            const source = png([
                chunk("iCCP", ascii("sRGB\x00\x00")),
                chunk("acTL", [...be32(2), ...be32(0)]),
                chunk("pHYs", [...be32(2835), ...be32(2835), 1]),
                chunk("gAMA", be32(45455)),
                chunk("tEXt", ascii("Author\x00someone")),
            ]);

            const result = stripImageMetadata(source);

            expect(pngChunkTypes(result.bytes)).toEqual(["IHDR", "iCCP", "acTL", "pHYs", "gAMA", "IDAT", "IEND"]);
            expect(result.removed).toEqual(["text"]);
        });

        it("removes a text chunk written after the image data", () => {
            // The reason this walks past IDAT: the checks in the transcode
            // planner stop there because the chunks they look for must precede
            // it, and text chunks have no such rule. Editors do write them last.
            const source = png([], [chunk("tEXt", ascii("Software\x00an editor"))]);

            const result = stripImageMetadata(source);

            expect(pngChunkTypes(result.bytes)).toEqual(["IHDR", "IDAT", "IEND"]);
            expect(result.removed).toEqual(["text"]);
        });

        it("stops at a chunk length that runs off the end without dropping the tail", () => {
            const truncated = Uint8Array.from([
                ...png([chunk("tEXt", ascii("Software\x00x"))]).subarray(0, 33),
                ...be32(0xfffffff0), ...ascii("tEXt"), 1, 2, 3,
            ]);

            const result = stripImageMetadata(truncated);

            // Whatever it could not parse is still there: this is not a validator,
            // and an image Studio cannot read is still the author's file.
            expect(result.bytes.length).toBeGreaterThanOrEqual(truncated.length - 30);
        });
    });

    describe("JPEG", () => {
        const EXIF = segment(0xe1, [...ascii("Exif"), 0, 0, 0x49, 0x49, 0x2a, 0]);
        const XMP = segment(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), 0, ...ascii("<x:xmpmeta/>")]);
        const PHOTOSHOP = segment(0xed, [...ascii("Photoshop 3.0"), 0, ...ascii("8BIM")]);
        const COMMENT = segment(0xfe, ascii("Created with an editor"));
        const ICC = segment(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1, 0, 0]);
        const ADOBE = segment(0xee, [...ascii("Adobe"), 0, 100, 0, 0, 0, 0, 2]);
        const JFIF = segment(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

        function markers(bytes: Uint8Array): number[] {
            const out: number[] = [];
            let offset = 2;
            const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
                const marker = bytes[offset + 1];
                out.push(marker);
                if (marker === 0xda || marker === 0xd9) {
                    break;
                }
                offset += 2 + data.getUint16(offset + 2);
            }
            return out;
        }

        it("removes EXIF, XMP, the Photoshop resource block and comments", () => {
            const source = jpeg([JFIF, EXIF, XMP, PHOTOSHOP, COMMENT]);

            const result = stripImageMetadata(source);

            expect(markers(result.bytes)).toEqual([0xe0, 0xc0, 0xda]);
            expect(result.removed.sort()).toEqual(["exif", "photoshop", "text", "xmp"]);
        });

        it("keeps the ICC profile and the Adobe colour-transform marker", () => {
            // APP14 looks like editor residue and is not: without it a decoder
            // can read a three-component JPEG as RGB instead of YCbCr, which
            // shows up as an inverted-looking image rather than as an error.
            const source = jpeg([ICC, ADOBE, EXIF]);

            const result = stripImageMetadata(source);

            expect(markers(result.bytes)).toEqual([0xe2, 0xee, 0xc0, 0xda]);
            expect(result.removed).toEqual(["exif"]);
        });

        it("copies the entropy-coded scan through untouched", () => {
            const source = jpeg([EXIF]);
            const result = stripImageMetadata(source);

            const scan = result.bytes.subarray(result.bytes.length - 6);
            expect([...scan]).toEqual([0x12, 0x34, 0x56, 0x78, 0xff, 0xd9]);
        });

        it("leaves a stripped JPEG readable", () => {
            const result = stripImageMetadata(jpeg([EXIF, XMP, COMMENT]));

            expect(readImageDimensions(result.bytes)).toEqual({ format: "jpeg", width: 64, height: 64 });
        });
    });

    describe("WebP", () => {
        const ICCP = riffChunk("ICCP", [1, 2, 3, 4]);
        const VP8 = riffChunk("VP8 ", [0, 1, 2, 3, 4, 5]);
        const EXIF = riffChunk("EXIF", [0x49, 0x49, 0x2a, 0]);
        const XMP = riffChunk("XMP ", ascii("<x:xmpmeta/>"));

        it("removes the EXIF and XMP chunks and keeps the profile", () => {
            const source = webp(VP8X_ICC | VP8X_EXIF | VP8X_XMP, [ICCP, VP8, EXIF, XMP]);

            const result = stripImageMetadata(source);

            expect(riffFourccs(result.bytes)).toEqual(["VP8X", "ICCP", "VP8 "]);
            expect(result.removed.sort()).toEqual(["exif", "xmp"]);
        });

        it("clears the flags that promise the chunks it removed", () => {
            // A reader that trusts the flags and then cannot find the chunk they
            // announce is entitled to reject the file, so leaving them set turns
            // a metadata strip into a corrupt image.
            const source = webp(VP8X_ICC | VP8X_EXIF | VP8X_XMP, [ICCP, VP8, EXIF, XMP]);

            const flags = stripImageMetadata(source).bytes[20];

            expect(flags & VP8X_EXIF).toBe(0);
            expect(flags & VP8X_XMP).toBe(0);
            expect(flags & VP8X_ICC).toBe(VP8X_ICC);
        });

        it("corrects the RIFF size", () => {
            const source = webp(VP8X_ICC | VP8X_EXIF, [ICCP, VP8, EXIF]);

            const result = stripImageMetadata(source);
            const declared = new DataView(
                result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength,
            ).getUint32(4, true);

            expect(declared).toBe(result.bytes.length - 8);
        });

        it("leaves a WebP with no metadata exactly as it was", () => {
            const clean = webp(VP8X_ICC, [ICCP, VP8]);

            expect(stripImageMetadata(clean).bytes).toBe(clean);
        });

        it("leaves a stripped WebP readable", () => {
            const result = stripImageMetadata(webp(VP8X_EXIF, [VP8, EXIF]));

            expect(readImageDimensions(result.bytes)).toEqual({ format: "webp", width: 64, height: 64 });
        });
    });
});
