import { describe, expect, it } from "vitest";
import { readImageDimensions } from "./imageDimensions";

/** PNG signature + an IHDR chunk carrying the given dimensions. */
function png(width: number, height: number, { leadingChunk = false } = {}): Uint8Array {
  const chunks: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (leadingChunk) {
    // A 4-byte "cLLi" chunk ahead of IHDR: legal to skip, and real tools emit one.
    chunks.push(0, 0, 0, 4, ...ascii("cLLi"), 1, 2, 3, 4, 0, 0, 0, 0);
  }
  chunks.push(
    0,
    0,
    0,
    13,
    ...ascii("IHDR"),
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0
  );
  return Uint8Array.from(chunks);
}

/** SOI, an APP0 segment to skip over, then an SOF0 frame header. */
function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x06,
    0x4a,
    0x46,
    0x49,
    0x46,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    ...be16(height),
    ...be16(width),
    0x03,
    0xff,
    0xd9
  ]);
}

function webp(chunk: string, payload: number[]): Uint8Array {
  const body = [...ascii("WEBP"), ...ascii(chunk), ...le32(payload.length), ...payload];
  const bytes = [...ascii("RIFF"), ...le32(body.length), ...body];
  // The reader wants at least a full RIFF + VP8X-sized prefix before it looks.
  while (bytes.length < 40) {
    bytes.push(0);
  }
  return Uint8Array.from(bytes);
}

function ascii(value: string): number[] {
  return [...value].map((character) => character.charCodeAt(0));
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function be16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function le32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

describe("readImageDimensions", () => {
  it("reads PNG dimensions from IHDR", () => {
    expect(readImageDimensions(png(512, 512))).toEqual({ format: "png", width: 512, height: 512 });
  });

  it("reads PNG dimensions past a chunk that precedes IHDR", () => {
    expect(readImageDimensions(png(256, 128, { leadingChunk: true }))).toEqual({
      format: "png",
      width: 256,
      height: 128
    });
  });

  it("reads JPEG dimensions from the start-of-frame marker", () => {
    expect(readImageDimensions(jpeg(300, 200))).toEqual({
      format: "jpeg",
      width: 300,
      height: 200
    });
  });

  it("reads lossy WebP dimensions", () => {
    const payload = [0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x02, 0x00, 0x02];
    expect(readImageDimensions(webp("VP8 ", payload))).toEqual({
      format: "webp",
      width: 512,
      height: 512
    });
  });

  it("reads lossless WebP dimensions", () => {
    // 14 bits of (width - 1) then 14 bits of (height - 1), little-endian.
    const bits = (511 & 0x3fff) | ((255 & 0x3fff) << 14);
    expect(readImageDimensions(webp("VP8L", [0x2f, ...le32(bits >>> 0)]))).toEqual({
      format: "webp",
      width: 512,
      height: 256
    });
  });

  it("reads extended WebP canvas dimensions", () => {
    const payload = [0, 0, 0, 0, 0xff, 0x01, 0x00, 0xff, 0x01, 0x00];
    expect(readImageDimensions(webp("VP8X", payload))).toEqual({
      format: "webp",
      width: 512,
      height: 512
    });
  });

  it("returns null for bytes that are not a readable image", () => {
    expect(
      readImageDimensions(Uint8Array.from(ascii('<svg xmlns="http://www.w3.org/2000/svg" />')))
    ).toBeNull();
    expect(readImageDimensions(new Uint8Array(0))).toBeNull();
  });

  it("returns null for a PNG truncated inside IHDR", () => {
    expect(readImageDimensions(png(512, 512).slice(0, 20))).toBeNull();
  });
});
