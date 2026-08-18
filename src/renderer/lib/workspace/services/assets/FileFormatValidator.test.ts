import { describe, expect, it } from "vitest";
import { ASSET_CATEGORY_EXTENSIONS, AssetCategory, AssetExtensions, AssetType } from "./assetTypes";
import {
  FORMAT_EXTENSIONS,
  FileFormatValidator,
  UNDECODABLE_EXTENSIONS
} from "./FileFormatValidator";

/**
 * A buffer that starts with the given signature and is long enough to clear the length guards in
 * every detector (the audio one refuses anything under 12 bytes outright).
 */
function bytes(...head: number[]): Uint8Array {
  const buffer = new Uint8Array(Math.max(32, head.length));
  buffer.set(head, 0);
  return buffer;
}

/** `ftyp` sits at offset 4, after the box size; the four bytes that follow are the brand. */
function isoBmff(brand: string): Uint8Array {
  return bytes(
    0x00,
    0x00,
    0x00,
    0x20,
    0x66,
    0x74,
    0x79,
    0x70,
    ...[...brand].map((character) => character.charCodeAt(0))
  );
}

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const TIFF = bytes(0x49, 0x49, 0x2a, 0x00);
const OGG = bytes(0x4f, 0x67, 0x67, 0x53);
/** ADTS AAC: 12-bit sync, then the layer field reading 0b00. */
const ADTS = bytes(0xff, 0xf1, 0x50, 0x80);
/** MPEG audio Layer III frame header: same 11-bit sync, layer field reading 0b01. */
const MP3_FRAME = bytes(0xff, 0xfb, 0x90, 0x00);
const ID3 = bytes(0x49, 0x44, 0x33, 0x03);
const FLAC = bytes(0x66, 0x4c, 0x61, 0x43);
const WAVE = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45);
const AVI = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20);
const EBML = bytes(0x1a, 0x45, 0xdf, 0xa3);
const AIFF = bytes(0x46, 0x4f, 0x52, 0x4d, 0x00, 0x00, 0x00, 0x20, 0x41, 0x49, 0x46, 0x46);

const validator = new FileFormatValidator();

function validate(type: AssetType, name: string, buffer: Uint8Array) {
  return validator.validateFileFormat(type, `D:\\project\\assets\\${name}`, buffer);
}

async function expectAccepted(type: AssetType, name: string, buffer: Uint8Array): Promise<void> {
  const result = await validate(type, name, buffer);
  expect(result.error ?? null, `${name} should import`).toBeNull();
  expect(result.success).toBe(true);
}

async function expectRejected(type: AssetType, name: string, buffer: Uint8Array): Promise<string> {
  const result = await validate(type, name, buffer);
  expect(result.success, `${name} should be refused`).toBe(false);
  return result.error ?? "";
}

describe("FileFormatValidator: formats Chromium plays are importable", () => {
  it("accepts an APNG, which is a PNG wearing a different name", async () => {
    await expectAccepted(AssetType.Image, "a.apng", PNG);
  });

  it("accepts progressive-JPEG extensions", async () => {
    await expectAccepted(AssetType.Image, "a.pjp", JPEG);
    await expectAccepted(AssetType.Image, "a.pjpeg", JPEG);
    await expectAccepted(AssetType.Image, "a.jpe", JPEG);
  });

  it("accepts Opus, which ships inside an Ogg container", async () => {
    await expectAccepted(AssetType.Audio, "a.opus", OGG);
  });

  it("accepts raw ADTS AAC instead of calling it a misnamed MP3", async () => {
    await expectAccepted(AssetType.Audio, "a.aac", ADTS);
  });

  it("accepts the ISO-BMFF relatives of MP4", async () => {
    await expectAccepted(AssetType.Video, "a.3gp", isoBmff("3gp4"));
    await expectAccepted(AssetType.Video, "a.m4b", isoBmff("M4B "));
    await expectAccepted(AssetType.Video, "a.3g2", isoBmff("3g2a"));
    await expectAccepted(AssetType.Video, "a.m4r", isoBmff("M4A "));
  });

  it("still accepts what already worked", async () => {
    await expectAccepted(AssetType.Image, "a.png", PNG);
    await expectAccepted(AssetType.Image, "a.jpg", JPEG);
    await expectAccepted(AssetType.Image, "a.gif", GIF);
    await expectAccepted(AssetType.Audio, "a.mp3", ID3);
    await expectAccepted(AssetType.Audio, "a.mp3", MP3_FRAME);
    await expectAccepted(AssetType.Audio, "a.wav", WAVE);
    await expectAccepted(AssetType.Audio, "a.flac", FLAC);
    await expectAccepted(AssetType.Audio, "a.m4a", isoBmff("M4A "));
    await expectAccepted(AssetType.Video, "a.mp4", isoBmff("isom"));
    await expectAccepted(AssetType.Video, "a.m4v", isoBmff("M4V "));
    await expectAccepted(AssetType.Video, "a.mov", isoBmff("qt  "));
    await expectAccepted(AssetType.Video, "a.webm", EBML);
  });

  it("does not accept MP3 bytes under an .aac name, or the reverse", async () => {
    expect(await expectRejected(AssetType.Audio, "a.aac", MP3_FRAME)).toContain("MP3");
    expect(await expectRejected(AssetType.Audio, "a.mp3", ADTS)).toContain("AAC");
  });

  it("sniffs raw AAC bytes as .aac", () => {
    expect(validator.sniffExtension(AssetType.Audio, ADTS)).toBe("aac");
    expect(validator.sniffExtension(AssetType.Audio, MP3_FRAME)).toBe("mp3");
    // The first entry of each list is the conventional extension, not merely the first accepted one.
    expect(validator.sniffExtension(AssetType.Image, PNG)).toBe("png");
    expect(validator.sniffExtension(AssetType.Image, JPEG)).toBe("jpg");
    expect(validator.sniffExtension(AssetType.Audio, OGG)).toBe("ogg");
    expect(validator.sniffExtension(AssetType.Video, isoBmff("3gp4"))).toBe("mp4");
  });
});

describe("FileFormatValidator: containers Chromium cannot demux are refused with a target format", () => {
  it("refuses AIFF and MP2 audio", async () => {
    for (const name of ["a.aiff", "a.aif", "a.aifc"]) {
      const error = await expectRejected(AssetType.Audio, name, AIFF);
      expect(error).toContain("NarraLeaf cannot play");
      expect(error).toContain(".mp3 or .wav");
    }
    expect(await expectRejected(AssetType.Audio, "a.mp2", MP3_FRAME)).toContain(".mp3 or .wav");
  });

  it("refuses AVI and the MPEG-family video containers", async () => {
    const error = await expectRejected(AssetType.Video, "a.avi", AVI);
    expect(error).toContain("NarraLeaf cannot play .avi files");
    expect(error).toContain(".mp4 or .webm");
    for (const name of [
      "a.flv",
      "a.wmv",
      "a.asf",
      "a.mpg",
      "a.mpeg",
      "a.mpe",
      "a.mpv",
      "a.m2v",
      "a.ts",
      "a.m2ts",
      "a.mts",
      "a.m2t",
      "a.vob"
    ]) {
      expect(await expectRejected(AssetType.Video, name, bytes(0x00))).toContain(".mp4 or .webm");
    }
  });

  it("refuses TIFF and XBM images", async () => {
    for (const name of ["a.tif", "a.tiff"]) {
      const error = await expectRejected(AssetType.Image, name, TIFF);
      // "display", not "play" — the verb follows the asset type. An image that "cannot be
      // played" reads as a broken sentence, and only shows up by importing one for real.
      expect(error).toContain("NarraLeaf cannot display");
      expect(error).toContain(".png or .webp");
    }
    expect(await expectRejected(AssetType.Image, "a.xbm", bytes(0x23, 0x64))).toContain(
      ".png or .webp"
    );
  });

  it("keeps refusal out of the formats that were measured playing", async () => {
    await expectAccepted(AssetType.Video, "a.mkv", EBML);
    await expectAccepted(AssetType.Audio, "a.mka", EBML);
    await expectAccepted(AssetType.Video, "a.qt", isoBmff("qt  "));
  });

  it("leaves the refused extensions in the picker's list", () => {
    for (const extension of ["avi", "wmv", "vob"]) {
      expect(AssetExtensions[AssetType.Video]).toContain(extension);
    }
    expect(AssetExtensions[AssetType.Audio]).toContain("aiff");
    expect(AssetExtensions[AssetType.Image]).toContain("tiff");
  });

  it("does not second-guess the bytes of an Other asset", async () => {
    await expectAccepted(AssetType.Other, "a.avi", AVI);
  });
});

describe("FileFormatValidator: non-media extensions are gone", () => {
  const removed: [AssetType, string][] = [
    [AssetType.Audio, "a.m3u"],
    [AssetType.Audio, "a.m3u8"],
    [AssetType.Audio, "a.pls"],
    [AssetType.Audio, "a.mid"],
    [AssetType.Audio, "a.midi"],
    [AssetType.Video, "a.av1"],
    [AssetType.Video, "a.m4p"]
  ];

  it.each(removed)("refuses %s files named %s at the extension gate", async (type, name) => {
    expect(await expectRejected(type, name, bytes(0x00))).toContain("is not allowed");
  });

  it("drops them from the category extension list the picker is given", () => {
    for (const [, name] of removed) {
      expect(ASSET_CATEGORY_EXTENSIONS[AssetCategory.Media]).not.toContain(name.slice(2));
    }
  });
});

describe("FileFormatValidator: the two extension tables agree", () => {
  /**
   * A format map entry naming an extension the type does not allow is dead code at best: the
   * extension gate runs first and rejects the file before any byte is read. At worst it hides the
   * asymmetry that made `.apng`, `.opus` and `.pjp` unimportable while looking supported.
   */
  it("names no extension that AssetExtensions does not allow", () => {
    const drift: string[] = [];
    for (const type of Object.values(AssetType)) {
      const allowed = AssetExtensions[type];
      if (allowed.includes("*")) {
        continue;
      }
      for (const [format, extensions] of Object.entries(FORMAT_EXTENSIONS[type])) {
        for (const extension of extensions) {
          if (!allowed.includes(extension)) {
            drift.push(`${type}/${format}: .${extension}`);
          }
        }
      }
    }
    expect(drift).toEqual([]);
  });

  it("refuses nothing it does not also offer in the picker", () => {
    const drift: string[] = [];
    for (const [type, table] of Object.entries(UNDECODABLE_EXTENSIONS)) {
      for (const extension of Object.keys(table ?? {})) {
        if (!AssetExtensions[type as AssetType].includes(extension)) {
          drift.push(`${type}: .${extension}`);
        }
      }
    }
    expect(drift).toEqual([]);
  });
});
