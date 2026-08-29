import { describe, expect, it } from "vitest";
import {
    DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
    DEFAULT_ASSET_QUALITY,
    type AssetCompressionConfiguration,
} from "@shared/types/assetCompression";
import {
    jpegHasIccProfile,
    planAssetImageTranscode,
    pngHasIccProfile,
    pngIsAnimated,
    assetImageWorthKeeping,
} from "./assetImageOptimization";

function ascii(value: string): number[] {
    return [...value].map(character => character.charCodeAt(0));
}

function be32(value: number): number[] {
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function be16(value: number): number[] {
    return [(value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, payload: number[] = []): number[] {
    // The CRC is never checked by these readers, so four zeroes stand in for it.
    return [...be32(payload.length), ...ascii(type), ...payload, 0, 0, 0, 0];
}

/** A PNG whose header chunks are whatever the caller names, then IHDR and IDAT. */
function png(extraChunks: number[][] = []): Uint8Array {
    return Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...chunk("IHDR", [...be32(64), ...be32(64), 8, 6, 0, 0, 0]),
        ...extraChunks.flat(),
        ...chunk("IDAT", [1, 2, 3, 4]),
        ...chunk("IEND"),
    ]);
}

/** A JPEG with the given APP segments ahead of the frame header. */
function jpeg(segments: number[][] = []): Uint8Array {
    return Uint8Array.from([
        0xff, 0xd8,
        ...segments.flat(),
        0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(64), ...be16(64), 0x03,
        0xff, 0xda, 0x00, 0x02,
        0xff, 0xd9,
    ]);
}

function app2(identifier: string): number[] {
    const payload = [...ascii(identifier), 0, 1, 1];
    return [0xff, 0xe2, ...be16(payload.length + 2), ...payload];
}

function webp(): Uint8Array {
    const body = [...ascii("WEBP"), ...ascii("VP8L"), ...be32(16), 0x2f, 0, 0, 0, 0];
    const bytes = [...ascii("RIFF"), ...be32(body.length), ...body];
    while (bytes.length < 40) {
        bytes.push(0);
    }
    return Uint8Array.from(bytes);
}

const LOSSY: AssetCompressionConfiguration = { ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION, compressImages: true };

/** Manifest keys for ordinary assets are UUIDs, so a "/" only ever means a bundle member. */
const ASSET_ID = "3f2a1c04-5b6d-4e7f-8a9b-0c1d2e3f4a5b";

function candidate(bytes: Uint8Array, overrides: { manifestKey?: string; assetType?: string } = {}) {
    return {
        manifestKey: overrides.manifestKey ?? ASSET_ID,
        assetType: overrides.assetType ?? "image",
        bytes,
    };
}

describe("pngIsAnimated", () => {
    it("finds the acTL chunk an APNG declares its frames in", () => {
        expect(pngIsAnimated(png([chunk("acTL", [...be32(4), ...be32(0)])]))).toBe(true);
    });

    it("says no for an ordinary PNG", () => {
        expect(pngIsAnimated(png())).toBe(false);
    });

    it("stops at the image data rather than scanning the whole file", () => {
        // An "acTL" that only appears *after* IDAT is not an APNG declaration;
        // reading it as one would misclassify any image whose pixel bytes happen
        // to spell the chunk name.
        const bytes = Uint8Array.from([...png(), ...chunk("acTL", [...be32(4), ...be32(0)])]);
        expect(pngIsAnimated(bytes)).toBe(false);
    });

    it("says no for bytes that are not a PNG at all", () => {
        expect(pngIsAnimated(webp())).toBe(false);
        expect(pngIsAnimated(Uint8Array.from([1, 2, 3]))).toBe(false);
    });

    it("does not loop forever on a chunk length that overruns the buffer", () => {
        const bytes = Uint8Array.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            ...be32(0xfffffff0), ...ascii("tEXt"), 1, 2, 3, 4,
        ]);
        expect(pngIsAnimated(bytes)).toBe(false);
    });
});

describe("ICC profile detection", () => {
    it("finds a PNG iCCP chunk", () => {
        expect(pngHasIccProfile(png([chunk("iCCP", ascii("Display P3"))]))).toBe(true);
    });

    it("treats an sRGB chunk as no profile", () => {
        expect(pngHasIccProfile(png([chunk("sRGB", [0])]))).toBe(false);
    });

    it("finds an ICC_PROFILE APP2 segment in a JPEG", () => {
        expect(jpegHasIccProfile(jpeg([app2("ICC_PROFILE")]))).toBe(true);
    });

    it("ignores an APP2 segment that is not an ICC profile", () => {
        expect(jpegHasIccProfile(jpeg([app2("MPF\0\0\0\0\0\0\0\0")]))).toBe(false);
    });

    it("says no for a plain JPEG", () => {
        expect(jpegHasIccProfile(jpeg())).toBe(false);
    });
});

describe("planAssetImageTranscode", () => {
    // The lossless arm answers to nothing in the configuration, which is the whole reason it is
    // not a setting: there is no policy under which a PNG is left as it is.
    it("converts a plain PNG losslessly, with nothing in the policy turned on", () => {
        expect(planAssetImageTranscode(candidate(png()), DEFAULT_ASSET_COMPRESSION_CONFIGURATION))
            .toEqual({ action: "lossless" });
    });

    it("leaves a JPEG alone unless lossy is on, because lossless WebP of one is bigger", () => {
        expect(planAssetImageTranscode(candidate(jpeg()), DEFAULT_ASSET_COMPRESSION_CONFIGURATION))
            .toEqual({ action: "skip", reason: "not-enabled" });
    });

    it("converts both PNG and JPEG once lossy is turned on", () => {
        // The plan carries the quality rather than leaving the caller to read it back out of the
        // configuration, so that nothing downstream has to know whether it came from the shared
        // scale or from an author who typed it.
        const expected = { action: "lossy", quality: DEFAULT_ASSET_QUALITY, resizeTo: null };
        expect(planAssetImageTranscode(candidate(png()), LOSSY)).toEqual(expected);
        expect(planAssetImageTranscode(candidate(jpeg()), LOSSY)).toEqual(expected);
    });

    it("reads the WebP quality an advanced project set, and the scale otherwise", () => {
        const advanced: AssetCompressionConfiguration = { ...LOSSY, imageMode: "advanced", imageWebpQuality: 55 };
        expect(planAssetImageTranscode(candidate(png()), advanced)).toMatchObject({ quality: 55 });
        expect(planAssetImageTranscode(candidate(png()), { ...LOSSY, imageQuality: 40 }))
            .toMatchObject({ quality: 40 });
    });

    it("shrinks an image past the cap, and leaves one inside it alone", () => {
        // The fixture is 64x64. Enlarging would spend bytes on pixels no artist drew, so the cap
        // only ever works downwards.
        const capped: AssetCompressionConfiguration = { ...LOSSY, imageMode: "advanced", imageMaxDimension: 32 };
        expect(planAssetImageTranscode(candidate(png()), capped))
            .toMatchObject({ resizeTo: { width: 32, height: 32 } });
        expect(planAssetImageTranscode(candidate(png()), { ...capped, imageMaxDimension: 512 }))
            .toMatchObject({ resizeTo: null });
        // Auto has no cap at all: a build cannot tell art drawn at twice the stage size from art
        // that is meant to be that size.
        expect(planAssetImageTranscode(candidate(png()), { ...LOSSY, imageMaxDimension: 32 }))
            .toMatchObject({ resizeTo: null });
    });

    it("refuses an APNG even when it would otherwise qualify", () => {
        const apng = png([chunk("acTL", [...be32(4), ...be32(0)])]);
        expect(planAssetImageTranscode(candidate(apng), LOSSY)).toEqual({ action: "skip", reason: "animated" });
    });

    it("refuses a colour-managed image in either mode", () => {
        const managed = png([chunk("iCCP", ascii("Display P3"))]);
        expect(planAssetImageTranscode(candidate(managed), DEFAULT_ASSET_COMPRESSION_CONFIGURATION))
            .toEqual({ action: "skip", reason: "color-managed" });
        expect(planAssetImageTranscode(candidate(jpeg([app2("ICC_PROFILE")])), LOSSY))
            .toEqual({ action: "skip", reason: "color-managed" });
    });

    it("refuses a model bundle member, by type and by key shape", () => {
        expect(planAssetImageTranscode(candidate(png(), { assetType: "model" }), LOSSY))
            .toEqual({ action: "skip", reason: "bundle-member" });
        expect(planAssetImageTranscode(candidate(png(), { manifestKey: `${ASSET_ID}/texture_00.png` }), LOSSY))
            .toEqual({ action: "skip", reason: "bundle-member" });
    });

    it("still converts a baked character avatar, whose id is synthetic but slash-free", () => {
        expect(planAssetImageTranscode(candidate(png(), { manifestKey: "character-avatar:yuki:a1%2Bb2" }), LOSSY))
            .toMatchObject({ action: "lossy" });
    });

    it("refuses a format it does not convert, including WebP itself", () => {
        expect(planAssetImageTranscode(candidate(webp()), LOSSY)).toEqual({ action: "skip", reason: "unsupported" });
        expect(planAssetImageTranscode(candidate(Uint8Array.from([1, 2, 3, 4])), LOSSY))
            .toEqual({ action: "skip", reason: "unsupported" });
    });

    it("goes by the bytes, not the manifest type", () => {
        // An audio asset cannot be a PNG, but the type is authored metadata and
        // the bytes are the truth; a mislabelled entry must not be transcoded.
        expect(planAssetImageTranscode(candidate(Uint8Array.from(ascii("ID3")), { assetType: "image" }), LOSSY))
            .toEqual({ action: "skip", reason: "unsupported" });
    });
});

describe("assetImageWorthKeeping", () => {
    it("keeps a real saving", () => {
        expect(assetImageWorthKeeping(1_000_000, 500_000)).toBe(true);
    });

    it("rejects a larger or equal result", () => {
        expect(assetImageWorthKeeping(1000, 1000)).toBe(false);
        expect(assetImageWorthKeeping(1000, 1200)).toBe(false);
        expect(assetImageWorthKeeping(1000, 0)).toBe(false);
    });

    it("rejects a saving too small to be worth renaming the file over", () => {
        // 0.5% of a 100 KB image is ~500 bytes: under both floors.
        expect(assetImageWorthKeeping(100_000, 99_500)).toBe(false);
    });

    it("accepts a small-percentage saving once it is a kilobyte in absolute terms", () => {
        expect(assetImageWorthKeeping(10_000_000, 9_998_000)).toBe(true);
    });
});
