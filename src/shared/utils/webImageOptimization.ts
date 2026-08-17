/**
 * Which of a pack's images the web export may re-encode, decided from the bytes
 * themselves.
 *
 * The whole file is about reasons to say no. Re-encoding an image is cheap to
 * get right for the common case and quietly destructive for the uncommon ones,
 * and every exclusion below is a way an asset can look convertible and not be:
 *
 * - an APNG is a still image plus an animation control chunk, and a decoder
 *   asked for "the image" hands back frame one, so a conversion succeeds, passes
 *   a pixel comparison, and silently ships a motionless sprite;
 * - an image carrying an ICC profile means its pixel values are not sRGB, and
 *   the encoder writes no profile, so the same numbers get displayed under a
 *   different interpretation - a colour shift with no decode error anywhere;
 * - a model bundle's textures are named by the model's own manifest, which
 *   Studio deliberately never parses, so renaming one to `.webp` breaks the
 *   character rather than the build.
 *
 * The format is read from the bytes rather than the extension, so a `.png` that
 * is really a JPEG is treated as what it is.
 */

import type { WebOptimizationConfiguration } from "@shared/types/webOptimization";
import { readImageDimensions } from "@shared/utils/imageDimensions";

export type WebImageSkipReason =
    /** Not an image asset, or not a format this pipeline decodes. */
    | "unsupported"
    /** A file inside a model bundle; its name is referenced from the model's own manifest. */
    | "bundle-member"
    /** Multi-frame (APNG). Converting would keep frame one and drop the animation. */
    | "animated"
    /** Carries an embedded ICC profile, so its pixels are not plain sRGB. */
    | "color-managed"
    /** The policy has nothing enabled that applies to this format. */
    | "not-enabled";

export type WebImageTranscodePlan =
    /** Re-encode as lossless WebP, keep the result only if it is smaller and decodes identically. */
    | { action: "lossless" }
    /** Re-encode as lossy WebP at the authored quality, keep the result only if it is smaller. */
    | { action: "lossy" }
    | { action: "skip"; reason: WebImageSkipReason };

export type WebImageCandidate = {
    /**
     * The asset manifest key. A bundle member is keyed `{assetId}/{pathInBundle}`,
     * which is the second signal that it is one.
     */
    manifestKey: string;
    /**
     * The manifest's own asset type ("image", "audio", "model", ...), when the manifest states one.
     *
     * Optional because a shipped manifest is allowed to say nothing about its assets. An absent type
     * is treated as a bundle member below - conservatively, since the cost of being wrong in that
     * direction is a larger export, and the cost of being wrong the other way is a model bundle's
     * entry file rewritten to WebP under a name its own manifest no longer points at.
     */
    assetType?: string;
    bytes: Uint8Array;
};

/**
 * Asset types whose payload is a directory tree rather than a single file, and
 * whose internal file names are therefore load-bearing. Mirrors
 * `BUNDLE_ASSET_TYPES` in the artifact compiler; kept as its own copy because
 * that constant lives in the main process and this module is shared.
 */
const BUNDLE_ASSET_TYPES: ReadonlySet<string> = new Set(["model"]);

export function planWebImageTranscode(
    candidate: WebImageCandidate,
    config: WebOptimizationConfiguration,
): WebImageTranscodePlan {
    if (!candidate.assetType
        || BUNDLE_ASSET_TYPES.has(candidate.assetType)
        || candidate.manifestKey.includes("/")) {
        return { action: "skip", reason: "bundle-member" };
    }
    const format = readImageDimensions(candidate.bytes)?.format;
    // WebP is already the format this pipeline converts *to*; re-encoding it
    // would be a second generation of loss for no size win worth having.
    if (format !== "png" && format !== "jpeg") {
        return { action: "skip", reason: "unsupported" };
    }
    if (format === "png" && pngIsAnimated(candidate.bytes)) {
        return { action: "skip", reason: "animated" };
    }
    if (format === "png" ? pngHasIccProfile(candidate.bytes) : jpegHasIccProfile(candidate.bytes)) {
        return { action: "skip", reason: "color-managed" };
    }
    // Order matters: lossy wins where both apply. An author who turned it on
    // asked for the smaller file, and running the lossless pass first would
    // leave the lossy pass re-encoding an image it had already rewritten.
    if (config.lossyImages) {
        return { action: "lossy" };
    }
    // A JPEG is already an entropy-coded lossy image, and packing those exact
    // pixels losslessly is reliably *larger* than the JPEG was - measured at
    // 1.2x to 1.8x on real backgrounds. The size guard downstream would throw
    // every one of them away, so the work is skipped rather than done and
    // discarded.
    if (config.losslessImages && format === "png") {
        return { action: "lossless" };
    }
    return { action: "skip", reason: "not-enabled" };
}

/**
 * Whether keeping the re-encoded bytes is actually a win.
 *
 * The floor is not zero: an image that saves a handful of bytes still costs a
 * changed manifest entry and an extension that no longer matches what the author
 * has on disk, and "the export mysteriously renamed my files" is a worse trade
 * than 40 bytes. One percent, or 1 KiB, whichever is met first.
 */
export function webImageWorthKeeping(originalBytes: number, encodedBytes: number): boolean {
    if (encodedBytes <= 0 || encodedBytes >= originalBytes) {
        return false;
    }
    const saved = originalBytes - encodedBytes;
    return saved >= 1024 || saved / originalBytes >= 0.01;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Walk PNG chunks until the first `IDAT`, calling back with each type.
 *
 * Stopping at `IDAT` is not an optimization, it is the spec: both chunks this
 * module looks for (`acTL`, `iCCP`) are required to appear before the image
 * data, so anything after it cannot change the answer, and walking a 30 MB
 * image's data chunks to find that out would be pure cost.
 */
function walkPngChunksBeforeData(bytes: Uint8Array, visit: (type: string) => boolean): boolean {
    if (bytes.length < 12 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
        return false;
    }
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    while (offset + 8 <= bytes.length) {
        const length = data.getUint32(offset);
        let type = "";
        for (let i = 0; i < 4; i += 1) {
            type += String.fromCharCode(bytes[offset + 4 + i]);
        }
        if (type === "IDAT" || type === "IEND") {
            return false;
        }
        if (visit(type)) {
            return true;
        }
        // A length that overflows the buffer means truncated or malformed bytes;
        // stop rather than wrap around into a wrong answer.
        const next = offset + length + 12;
        if (next <= offset || next > bytes.length) {
            return false;
        }
        offset = next;
    }
    return false;
}

/** APNG: an `acTL` chunk ahead of the image data declares the frame count. */
export function pngIsAnimated(bytes: Uint8Array): boolean {
    return walkPngChunksBeforeData(bytes, type => type === "acTL");
}

export function pngHasIccProfile(bytes: Uint8Array): boolean {
    return walkPngChunksBeforeData(bytes, type => type === "iCCP");
}

/**
 * JPEG: an ICC profile rides in one or more `APP2` segments introduced by the
 * `ICC_PROFILE\0` identifier.
 *
 * Walks only as far as the start of scan (`SOS`), after which the entropy-coded
 * data begins and marker parsing stops meaning anything.
 */
export function jpegHasIccProfile(bytes: Uint8Array): boolean {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        return false;
    }
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        let marker = bytes[offset + 1];
        // Runs of 0xFF are legal padding ahead of the marker byte.
        while (marker === 0xff && offset + 2 < bytes.length) {
            offset += 1;
            marker = bytes[offset + 1];
        }
        offset += 2;
        // Start of scan, end of image: nothing parseable follows.
        if (marker === 0xda || marker === 0xd9) {
            return false;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
            continue;
        }
        if (offset + 2 > bytes.length) {
            return false;
        }
        const segmentLength = data.getUint16(offset);
        if (segmentLength < 2) {
            return false;
        }
        if (marker === 0xe2) {
            let identifier = "";
            for (let i = 0; i < 11 && offset + 2 + i < bytes.length; i += 1) {
                identifier += String.fromCharCode(bytes[offset + 2 + i]);
            }
            if (identifier === "ICC_PROFILE") {
                return true;
            }
        }
        offset += segmentLength;
    }
    return false;
}
