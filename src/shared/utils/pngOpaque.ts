/**
 * Reading and writing PNGs that carry no alpha channel.
 *
 * Needed because neither runtime will produce one. The renderer's
 * `canvas.toBlob` always encodes colour type 6, and `nativeImage.toPNG()` in
 * the build does the same - so an icon can be flattened to fully opaque pixels
 * and still be rejected by Apple's asset validator, which objects to the
 * channel's presence rather than to transparency.
 *
 * Both processes share this so the bytes match whichever path produced them:
 * the filter choice is fixed (Paeth on every row) rather than heuristic, which
 * also keeps the baked files quiet in version control.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type Deflate = (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/**
 * Encode RGBA samples as a PNG with colour type 2 (truecolour). The alpha lane
 * is dropped, not composited: callers pass pixels that are already opaque.
 */
export async function encodeOpaquePng(
    rgba: Uint8Array,
    width: number,
    height: number,
    deflate: Deflate,
): Promise<Uint8Array> {
    return encodePng(rgba, width, height, 3, deflate);
}

/**
 * Encode RGBA samples as a PNG with colour type 6, alpha kept.
 *
 * This is the one a baked PSD layer needs: a layer is a transparent cut-out on
 * the document canvas, and dropping its alpha would fill every empty pixel with
 * whatever colour happened to sit in the buffer.
 */
export async function encodeRgbaPng(
    rgba: Uint8Array,
    width: number,
    height: number,
    deflate: Deflate,
): Promise<Uint8Array> {
    return encodePng(rgba, width, height, 4, deflate);
}

async function encodePng(
    rgba: Uint8Array,
    width: number,
    height: number,
    channels: 3 | 4,
    deflate: Deflate,
): Promise<Uint8Array> {
    const stride = width * channels;
    const raw = new Uint8Array((stride + 1) * height);
    const current = new Uint8Array(stride);
    const previous = new Uint8Array(stride);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const source = (y * width + x) * 4;
            const target = x * channels;
            current[target] = rgba[source];
            current[target + 1] = rgba[source + 1];
            current[target + 2] = rgba[source + 2];
            if (channels === 4) {
                current[target + 3] = rgba[source + 3];
            }
        }
        const rowStart = y * (stride + 1);
        raw[rowStart] = 4;
        for (let i = 0; i < stride; i++) {
            const left = i >= channels ? current[i - channels] : 0;
            const up = previous[i];
            const upLeft = i >= channels ? previous[i - channels] : 0;
            raw[rowStart + 1 + i] = (current[i] - paethPredictor(left, up, upLeft)) & 0xff;
        }
        previous.set(current);
    }

    const header = new Uint8Array(13);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, width);
    headerView.setUint32(4, height);
    header[8] = 8;                          // bit depth
    header[9] = channels === 4 ? 6 : 2;     // colour type: truecolour, with or without alpha
    return concatBytes([
        new Uint8Array(SIGNATURE),
        chunk("IHDR", header),
        chunk("IDAT", await deflate(raw)),
        chunk("IEND", new Uint8Array(0)),
    ]);
}

export type DecodedPng = { width: number; height: number; rgba: Uint8Array; hadAlpha: boolean };

/**
 * Decode an 8-bit truecolour PNG (with or without alpha) to RGBA samples.
 * Deliberately narrow: it exists to re-encode Studio's own output, which is
 * always 8-bit non-interlaced, and refuses anything else rather than guessing.
 */
export function decodePngToRgba(bytes: Uint8Array, inflate: (data: Uint8Array) => Uint8Array): DecodedPng {
    for (let i = 0; i < SIGNATURE.length; i++) {
        if (bytes[i] !== SIGNATURE[i]) {
            throw new Error("Not a PNG");
        }
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    const bitDepth = bytes[24];
    const colorType = bytes[25];
    const interlace = bytes[28];
    if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error(`Unsupported PNG (bitDepth ${bitDepth}, colorType ${colorType}, interlace ${interlace})`);
    }

    const channels = colorType === 6 ? 4 : 3;
    const parts: Uint8Array[] = [];
    let offset = 8;
    while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        if (type === "IDAT") {
            parts.push(bytes.subarray(offset + 8, offset + 8 + length));
        }
        offset += 12 + length;
    }

    const raw = inflate(concatBytes(parts));
    const stride = width * channels;
    const planar = new Uint8Array(stride * height);
    let pos = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[pos++];
        const rowStart = y * stride;
        for (let i = 0; i < stride; i++) {
            const left = i >= channels ? planar[rowStart + i - channels] : 0;
            const up = y > 0 ? planar[rowStart - stride + i] : 0;
            const upLeft = y > 0 && i >= channels ? planar[rowStart - stride + i - channels] : 0;
            let value = raw[pos + i];
            if (filter === 1) value += left;
            else if (filter === 2) value += up;
            else if (filter === 3) value += Math.floor((left + up) / 2);
            else if (filter === 4) value += paethPredictor(left, up, upLeft);
            planar[rowStart + i] = value & 0xff;
        }
        pos += stride;
    }

    if (channels === 4) {
        return { width, height, rgba: planar, hadAlpha: true };
    }
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0, j = 0; i < planar.length; i += 3, j += 4) {
        rgba[j] = planar[i];
        rgba[j + 1] = planar[i + 1];
        rgba[j + 2] = planar[i + 2];
        rgba[j + 3] = 255;
    }
    return { width, height, rgba, hadAlpha: false };
}

/** Whether a PNG declares an alpha channel at all, regardless of its pixels. */
export function pngHasAlphaChannel(bytes: Uint8Array): boolean {
    return bytes.length > 25 && (bytes[25] === 4 || bytes[25] === 6);
}

function paethPredictor(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const body = new Uint8Array(4 + data.length);
    for (let i = 0; i < 4; i++) {
        body[i] = type.charCodeAt(i);
    }
    body.set(data, 4);
    const result = new Uint8Array(8 + data.length + 4);
    const view = new DataView(result.buffer);
    view.setUint32(0, data.length);
    result.set(body, 4);
    view.setUint32(result.length - 4, crc32(body));
    return result;
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            }
            crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}
