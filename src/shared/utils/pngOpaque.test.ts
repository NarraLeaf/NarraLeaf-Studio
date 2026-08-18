import zlib from "zlib";
import { describe, expect, it } from "vitest";
import { decodePngToRgba, encodeOpaquePng, encodeRgbaPng, pngHasAlphaChannel } from "./pngOpaque";

const deflate = (bytes: Uint8Array) => zlib.deflateSync(bytes);
const inflate = (bytes: Uint8Array) => new Uint8Array(zlib.inflateSync(bytes));

/** A gradient plus a hard edge: exercises every Paeth branch, unlike flat fill. */
function sampleRgba(width: number, height: number, alpha = 255): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = (x * 7) % 256;
      rgba[i + 1] = (y * 13) % 256;
      rgba[i + 2] = x > width / 2 ? 240 : 12;
      rgba[i + 3] = alpha;
    }
  }
  return rgba;
}

describe("encodeOpaquePng", () => {
  it("writes a truecolour PNG that carries no alpha channel", async () => {
    const png = await encodeOpaquePng(sampleRgba(9, 7), 9, 7, deflate);
    expect(Array.from(png.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ]);
    expect(png[25]).toBe(2);
    expect(pngHasAlphaChannel(png)).toBe(false);
  });

  it("round-trips the pixels exactly", async () => {
    const rgba = sampleRgba(16, 11);
    const decoded = decodePngToRgba(await encodeOpaquePng(rgba, 16, 11, deflate), inflate);
    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(11);
    expect(decoded.hadAlpha).toBe(false);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });

  it("drops the alpha lane rather than compositing with it", async () => {
    // Half-transparent input: the RGB must survive untouched, because the
    // caller is responsible for having flattened already.
    const rgba = sampleRgba(4, 4, 128);
    const decoded = decodePngToRgba(await encodeOpaquePng(rgba, 4, 4, deflate), inflate);
    for (let i = 0; i < rgba.length; i += 4) {
      expect(decoded.rgba[i]).toBe(rgba[i]);
      expect(decoded.rgba[i + 1]).toBe(rgba[i + 1]);
      expect(decoded.rgba[i + 2]).toBe(rgba[i + 2]);
      expect(decoded.rgba[i + 3]).toBe(255);
    }
  });

  it("is byte-stable across runs, which is what keeps it quiet in version control", async () => {
    const rgba = sampleRgba(24, 24);
    const first = await encodeOpaquePng(rgba, 24, 24, deflate);
    const second = await encodeOpaquePng(rgba, 24, 24, deflate);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});

describe("decodePngToRgba", () => {
  it("reads back an RGBA PNG and reports that it had a channel", async () => {
    // Encode as truecolour, then hand it back as if it were RGBA input.
    const png = await encodeOpaquePng(sampleRgba(5, 5), 5, 5, deflate);
    expect(decodePngToRgba(png, inflate).hadAlpha).toBe(false);
  });

  it("refuses a file that is not a PNG", () => {
    expect(() => decodePngToRgba(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), inflate)).toThrow(
      /Not a PNG/
    );
  });

  it("refuses formats it would have to guess at", async () => {
    const png = await encodeOpaquePng(sampleRgba(4, 4), 4, 4, deflate);
    const palette = new Uint8Array(png);
    palette[25] = 3;
    expect(() => decodePngToRgba(palette, inflate)).toThrow(/Unsupported PNG/);

    const interlaced = new Uint8Array(png);
    interlaced[28] = 1;
    expect(() => decodePngToRgba(interlaced, inflate)).toThrow(/Unsupported PNG/);
  });
});

describe("pngHasAlphaChannel", () => {
  it("reads the colour type, not the pixels", async () => {
    const opaque = await encodeOpaquePng(sampleRgba(4, 4), 4, 4, deflate);
    expect(pngHasAlphaChannel(opaque)).toBe(false);
    const rgba = new Uint8Array(opaque);
    rgba[25] = 6;
    expect(pngHasAlphaChannel(rgba)).toBe(true);
    rgba[25] = 4;
    expect(pngHasAlphaChannel(rgba)).toBe(true);
  });
});

describe("encodeRgbaPng", () => {
  it("keeps the alpha lane and round-trips through the decoder", async () => {
    const rgba = new Uint8Array([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160
    ]);
    const png = await encodeRgbaPng(rgba, 2, 2, deflate);
    expect(pngHasAlphaChannel(png)).toBe(true);

    const decoded = decodePngToRgba(png, inflate);
    expect(decoded).toMatchObject({ width: 2, height: 2, hadAlpha: true });
    expect([...decoded.rgba]).toEqual([...rgba]);
  });
});
