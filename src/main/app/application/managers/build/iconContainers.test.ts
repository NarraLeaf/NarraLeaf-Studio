import { describe, expect, it } from "vitest";
import {
    ICNS_MINIMUM_EDGE,
    ICNS_SIZES,
    ICO_MINIMUM_EDGE,
    ICO_SIZES,
    encodeIcns,
    encodeIco,
    iconSizesFor,
    type IconImage,
} from "./iconContainers";

/**
 * A stand-in for one rendered square: PNG bytes that are only recognisable, and
 * samples whose values encode their own position so a row order or a channel
 * swap shows up as a wrong number rather than as a picture nobody is looking at.
 */
function image(size: number): IconImage {
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const at = (y * size + x) * 4;
            rgba[at] = x;
            rgba[at + 1] = y;
            rgba[at + 2] = 200;
            rgba[at + 3] = 255;
        }
    }
    return { size, png: Buffer.from(`png-${size}`), rgba };
}

/** The directory of an .ico, read back the way electron-builder and the shell read it. */
function readIcoDirectory(ico: Buffer): Array<{ width: number; height: number; bytes: number; offset: number }> {
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    return Array.from({ length: count }, (_unused, index) => {
        const at = 6 + index * 16;
        return {
            // A zero byte means 256; the format has no other way to say it.
            width: ico[at] || 256,
            height: ico[at + 1] || 256,
            bytes: ico.readUInt32LE(at + 8),
            offset: ico.readUInt32LE(at + 12),
        };
    });
}

/** Every chunk of an .icns, in file order. */
function readIcnsChunks(icns: Buffer): Array<{ type: string; data: Buffer }> {
    expect(icns.toString("ascii", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    const chunks: Array<{ type: string; data: Buffer }> = [];
    for (let offset = 8; offset + 8 <= icns.length;) {
        const type = icns.toString("ascii", offset, offset + 4);
        const length = icns.readUInt32BE(offset + 4);
        chunks.push({ type, data: icns.subarray(offset + 8, offset + length) });
        offset += length;
    }
    return chunks;
}

describe("iconSizesFor", () => {
    it("takes every size the source can fill", () => {
        expect(iconSizesFor(ICO_SIZES, 1024, ICO_MINIMUM_EDGE)).toEqual([...ICO_SIZES]);
        expect(iconSizesFor(ICNS_SIZES, 1024, ICNS_MINIMUM_EDGE)).toEqual([...ICNS_SIZES]);
    });

    it("stops at the source's own size rather than upscaling past it", () => {
        expect(iconSizesFor(ICNS_SIZES, 512, ICNS_MINIMUM_EDGE)).toEqual([32, 64, 128, 256, 512]);
    });

    it("still reaches the container's floor when the source is smaller", () => {
        // The .ico floor is what electron-builder refuses below, so a 128-pixel
        // source has to be upscaled to 256 rather than leaving the file short.
        expect(iconSizesFor(ICO_SIZES, 128, ICO_MINIMUM_EDGE)).toContain(256);
        expect(iconSizesFor(ICNS_SIZES, 128, ICNS_MINIMUM_EDGE)).toContain(512);
    });
});

describe("encodeIco", () => {
    const sizes = [16, 48, 256];
    const ico = encodeIco(sizes.map(image));
    const directory = readIcoDirectory(ico);

    it("declares one entry per image, at 32 bits", () => {
        expect(directory.map(entry => entry.width)).toEqual(sizes);
        expect(directory.map(entry => entry.height)).toEqual(sizes);
        for (let index = 0; index < sizes.length; index++) {
            expect(ico.readUInt16LE(6 + index * 16 + 4)).toBe(1);
            expect(ico.readUInt16LE(6 + index * 16 + 6)).toBe(32);
        }
    });

    it("lays the images out end to end after the directory, with no gap or overlap", () => {
        let expected = 6 + directory.length * 16;
        for (const entry of directory) {
            expect(entry.offset).toBe(expected);
            expected += entry.bytes;
        }
        expect(expected).toBe(ico.length);
    });

    it("stores the 256 square as the PNG it was given", () => {
        const entry = directory[2];
        expect(ico.subarray(entry.offset, entry.offset + entry.bytes)).toEqual(Buffer.from("png-256"));
    });

    it("stores a small square as a bottom-up BGRA bitmap with a mask under it", () => {
        const entry = directory[0];
        const data = ico.subarray(entry.offset, entry.offset + entry.bytes);
        expect(data.readUInt32LE(0)).toBe(40);
        expect(data.readInt32LE(4)).toBe(16);
        // Double the height: the colour bitmap and the AND mask share the field.
        expect(data.readInt32LE(8)).toBe(32);
        const maskStride = 4;
        expect(data.length).toBe(40 + 16 * 16 * 4 + maskStride * 16);

        // The first bitmap row is the image's last row, and the samples arrive
        // as B, G, R, A rather than R, G, B, A.
        const firstPixel = 40;
        expect([...data.subarray(firstPixel, firstPixel + 4)]).toEqual([200, 15, 0, 255]);
        const secondPixel = firstPixel + 4;
        expect([...data.subarray(secondPixel, secondPixel + 4)]).toEqual([200, 15, 1, 255]);
    });

    it("refuses a set that would fail the packager's own 256 check", () => {
        expect(() => encodeIco([16, 48].map(image))).toThrow(/at least 256x256/);
        expect(() => encodeIco([])).toThrow(/at least one image/);
    });
});

describe("encodeIcns", () => {
    it("writes a chunk per declared type whose size was rendered", () => {
        const icns = encodeIcns([32, 64, 128, 256, 512].map(image));
        const chunks = readIcnsChunks(icns);
        // No ic10: nothing rendered a 1024 square, so the chunk is simply absent.
        expect(chunks.map(chunk => chunk.type)).toEqual(["ic11", "ic12", "ic07", "ic08", "ic13", "ic09", "ic14"]);
    });

    it("fills a 1x chunk and its retina twin from the one square they share", () => {
        const chunks = readIcnsChunks(encodeIcns([256].map(image)));
        expect(chunks.map(chunk => chunk.type)).toEqual(["ic08", "ic13"]);
        for (const chunk of chunks) {
            expect(chunk.data).toEqual(Buffer.from("png-256"));
        }
    });

    it("refuses a set with no size it can carry", () => {
        expect(() => encodeIcns([image(48)])).toThrow(/at least one image/);
    });
});
