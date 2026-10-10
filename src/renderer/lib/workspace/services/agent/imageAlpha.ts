/**
 * Whether an image can be transparent, read from its header bytes.
 *
 * Asked for one reason: a character sprite drawn from a picture with no alpha channel stands on the
 * stage as a rectangle, background and all, and nothing in the game or the editor says why. Authors
 * hand over flat exports (a PNG saved as RGB, a JPEG) more often than one would think, and an agent
 * that imports them has no eyes to notice - so the import and the pose tools say so.
 *
 * Read from the container's own header rather than by decoding pixels, because the question is
 * "can this file carry transparency at all", which the header answers in a few bytes, and because a
 * decode would cost a full image per pose for an answer the format already states. An RGBA PNG whose
 * every pixel happens to be opaque is still reported as able to be transparent: that is an artwork
 * question, not a format one, and it is rare enough not to be worth a decode.
 *
 * Comments in English per project convention.
 */

export type ImageAlphaFacts = {
    format: "png" | "jpeg" | "webp" | "unknown";
    /** Pixel size from the header, when the format states one where this reader looks. */
    width?: number;
    height?: number;
    /**
     * `true` when the file can carry transparency, `false` when it cannot (no alpha channel and no
     * transparent colour key), `null` when this reader does not know (GIF, AVIF, SVG, anything else).
     */
    alpha: boolean | null;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, offset: number, length: number): string {
    let out = "";
    for (let index = 0; index < length && offset + index < bytes.length; index += 1) {
        out += String.fromCharCode(bytes[offset + index]);
    }
    return out;
}

function u32be(bytes: Uint8Array, offset: number): number {
    return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function u16be(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] << 8) | bytes[offset + 1];
}

function u24le(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

/**
 * PNG: colour types 4 (grey + alpha) and 6 (RGBA) carry an alpha channel. Types 0 (grey), 2 (RGB)
 * and 3 (palette) carry transparency only through a `tRNS` chunk, which the format requires to come
 * before the first `IDAT` - so the walk stops there and never touches image data.
 */
function readPng(bytes: Uint8Array): ImageAlphaFacts {
    if (bytes.length < 33 || ascii(bytes, 12, 4) !== "IHDR") {
        return { format: "png", alpha: null };
    }
    const width = u32be(bytes, 16);
    const height = u32be(bytes, 20);
    const colourType = bytes[25];
    if (colourType === 4 || colourType === 6) {
        return { format: "png", width, height, alpha: true };
    }
    let offset = 8;
    while (offset + 8 <= bytes.length) {
        const length = u32be(bytes, offset);
        const type = ascii(bytes, offset + 4, 4);
        if (type === "tRNS") {
            return { format: "png", width, height, alpha: true };
        }
        if (type === "IDAT" || type === "IEND") {
            return { format: "png", width, height, alpha: false };
        }
        offset += 12 + length;
    }
    // Truncated before the image data: the header said no alpha channel and nothing seen added one.
    return { format: "png", width, height, alpha: false };
}

/** JPEG has no alpha channel, ever. The size is in the first start-of-frame marker. */
function readJpeg(bytes: Uint8Array): ImageAlphaFacts {
    let offset = 2;
    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = bytes[offset + 1];
        if (marker === 0xff) {
            offset += 1;
            continue;
        }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
            offset += 2;
            continue;
        }
        const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isFrame) {
            return { format: "jpeg", height: u16be(bytes, offset + 5), width: u16be(bytes, offset + 7), alpha: false };
        }
        if (marker === 0xda || marker === 0xd9) {
            break;
        }
        offset += 2 + u16be(bytes, offset + 2);
    }
    return { format: "jpeg", alpha: false };
}

/**
 * WebP: the extended header (`VP8X`) has an alpha flag; a lossless stream (`VP8L`) has an
 * alpha-is-used bit; a plain lossy stream (`VP8 `) has no alpha at all.
 */
function readWebp(bytes: Uint8Array): ImageAlphaFacts {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8X" && bytes.length >= 30) {
        return {
            format: "webp",
            width: 1 + u24le(bytes, 24),
            height: 1 + u24le(bytes, 27),
            alpha: (bytes[20] & 0x10) !== 0,
        };
    }
    if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
        const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
        return {
            format: "webp",
            width: 1 + (bits & 0x3fff),
            height: 1 + ((bits >>> 14) & 0x3fff),
            alpha: ((bits >>> 28) & 1) === 1,
        };
    }
    if (chunk === "VP8 " && bytes.length >= 30) {
        return {
            format: "webp",
            width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
            height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
            alpha: false,
        };
    }
    return { format: "webp", alpha: null };
}

export function readImageAlpha(bytes: Uint8Array): ImageAlphaFacts {
    if (bytes.length >= 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
        return readPng(bytes);
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return readJpeg(bytes);
    }
    if (bytes.length >= 16 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
        return readWebp(bytes);
    }
    return { format: "unknown", alpha: null };
}

/**
 * The warning an agent is shown for a picture that cannot be transparent. One wording for both
 * tools, so an agent that met it on import recognises it on the pose.
 */
export function opaqueImageWarning(assetName: string, facts: ImageAlphaFacts): string {
    const what = facts.format === "jpeg" ? "a JPEG (no transparency)" : `a ${facts.format.toUpperCase()} with no alpha channel`;
    return `"${assetName}" is ${what}: as a character sprite it shows as a rectangle, background and all. `
        + "Ask the author for a PNG with a transparent background (or cut it out) before using it as a pose.";
}
