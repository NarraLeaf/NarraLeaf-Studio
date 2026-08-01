/**
 * Pixel dimensions straight out of an image's header.
 *
 * Header-only on purpose: this runs on files Studio has not decided to trust
 * yet (a plugin package from the store, a folder the user pointed at), so it
 * reads a bounded prefix of structure and never hands the bytes to a decoder.
 * It also reports which format the bytes actually are, which is how a `.png`
 * that is really something else gets caught.
 */

export type ImageFormat = "png" | "jpeg" | "webp";

export type ImageDimensions = {
    format: ImageFormat;
    width: number;
    height: number;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Dimensions and format, or `null` when the bytes are not one of the formats
 * this reads (or are truncated past repair).
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
    return readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
}

function view(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
    if (offset + length > bytes.length) {
        return "";
    }
    let out = "";
    for (let i = 0; i < length; i += 1) {
        out += String.fromCharCode(bytes[offset + i]);
    }
    return out;
}

/**
 * IHDR is walked to rather than assumed to be first: the spec requires it to
 * lead, but tools do emit a signature chunk ahead of it, and refusing those
 * would read to the author as "my PNG is not a PNG".
 */
function readPng(bytes: Uint8Array): ImageDimensions | null {
    if (bytes.length < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
        return null;
    }
    const data = view(bytes);
    let offset = 8;
    while (offset + 8 <= bytes.length) {
        const length = data.getUint32(offset);
        if (ascii(bytes, offset + 4, 4) === "IHDR") {
            if (offset + 16 > bytes.length) {
                return null;
            }
            return {
                format: "png",
                width: data.getUint32(offset + 8),
                height: data.getUint32(offset + 12),
            };
        }
        // length + the 4-byte length field + the 4-byte type + the 4-byte CRC.
        offset += length + 12;
    }
    return null;
}

/** Start-of-frame markers. C4/C8/CC share the range but are tables, not frames. */
function isStartOfFrame(marker: number): boolean {
    return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readJpeg(bytes: Uint8Array): ImageDimensions | null {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        return null;
    }
    const data = view(bytes);
    let offset = 2;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        // Runs of 0xFF are legal padding ahead of the marker byte.
        let marker = bytes[offset + 1];
        while (marker === 0xff && offset + 2 < bytes.length) {
            offset += 1;
            marker = bytes[offset + 1];
        }
        offset += 2;
        if (marker === 0xd9) {
            return null;
        }
        // Standalone markers carry no length field to skip over.
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
            continue;
        }
        if (offset + 2 > bytes.length) {
            return null;
        }
        if (isStartOfFrame(marker)) {
            // length(2) precision(1) height(2) width(2)
            if (offset + 7 > bytes.length) {
                return null;
            }
            return {
                format: "jpeg",
                height: data.getUint16(offset + 3),
                width: data.getUint16(offset + 5),
            };
        }
        const segmentLength = data.getUint16(offset);
        if (segmentLength < 2) {
            return null;
        }
        offset += segmentLength;
    }
    return null;
}

function readWebp(bytes: Uint8Array): ImageDimensions | null {
    if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
        return null;
    }
    const data = view(bytes);
    const chunk = ascii(bytes, 12, 4);
    const payload = 20;

    if (chunk === "VP8X") {
        // Canvas size, stored as three little-endian bytes of (value - 1).
        const width = (bytes[payload + 4] | (bytes[payload + 5] << 8) | (bytes[payload + 6] << 16)) + 1;
        const height = (bytes[payload + 7] | (bytes[payload + 8] << 8) | (bytes[payload + 9] << 16)) + 1;
        return { format: "webp", width, height };
    }
    if (chunk === "VP8 ") {
        // 3-byte frame tag, then the 9D 01 2A sync code, then 14-bit dimensions.
        if (bytes[payload + 3] !== 0x9d || bytes[payload + 4] !== 0x01 || bytes[payload + 5] !== 0x2a) {
            return null;
        }
        return {
            format: "webp",
            width: data.getUint16(payload + 6, true) & 0x3fff,
            height: data.getUint16(payload + 8, true) & 0x3fff,
        };
    }
    if (chunk === "VP8L") {
        if (bytes[payload] !== 0x2f) {
            return null;
        }
        const bits = data.getUint32(payload + 1, true);
        return {
            format: "webp",
            width: (bits & 0x3fff) + 1,
            height: ((bits >>> 14) & 0x3fff) + 1,
        };
    }
    return null;
}
