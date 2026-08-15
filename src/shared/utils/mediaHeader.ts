/**
 * What a media or font file says about itself in its first few kilobytes.
 *
 * The sibling of {@link import("./imageDimensions").readImageDimensions} and written to the
 * same rule: read a bounded prefix of structure, never hand the bytes to a decoder, and
 * answer `null` rather than guessing. Nothing here spawns a process, touches `fs` or needs a
 * codec - which is what lets it run inside a diff of a revision that exists only in the
 * repository, where there is no file on disk to point ffprobe at.
 *
 * **Every field is optional and an absent one is an answer.** A container that carries its
 * duration at the END of the file (Ogg, and any MP4 whose `moov` was not moved to the front)
 * simply does not report one from its head, and the caller's job is to say nothing rather
 * than to estimate. The one estimate that IS made is a constant-bitrate MP3's, and it is
 * marked as such by requiring the total file size to be passed in.
 *
 * **This is not the media support matrix.** `mediaSupport.ts` decides whether the engine can
 * play a file, from an ffprobe report, on the pair (container, codec of every stream). This
 * reads a header for numbers to show an author. A file can be perfectly described here and
 * still be unplayable, and the two must not be made to agree on anything.
 */

/** Numbers a container header will admit to. Everything optional; see the note above. */
export interface MediaHeader {
    /**
     * The container, as this module names it. Not ffprobe's spelling and not the extension's -
     * it is what the magic bytes turned out to be, which is how a `.mp4` that is really a
     * Matroska file gets described correctly.
     */
    readonly container: "wav" | "flac" | "ogg" | "mp3" | "iso-bmff" | "matroska";
    /** Milliseconds. Absent when the head does not carry it. */
    readonly durationMs?: number;
    readonly width?: number;
    readonly height?: number;
    readonly sampleRate?: number;
    readonly channels?: number;
}

/** What a font's head says about itself. */
export interface FontHeader {
    readonly container: "truetype" | "opentype" | "collection" | "woff" | "woff2" | "embedded-opentype";
    /**
     * The family the author would recognise, when the name table happened to fall inside the
     * bytes handed over.
     *
     * Absent is common and is not a failure: an sfnt's tables may sit in any order, so a large
     * font can carry its glyph outlines ahead of its names and put them past any bounded read.
     * Chasing it would mean a second, seeked read - which the revision side of a comparison
     * cannot do at all, because the backend has no ranged fetch.
     */
    readonly family?: string;
}

/**
 * Read whichever container these bytes turn out to be.
 *
 * `totalSize` is the whole file's length, which the caller knows from the tree or a stat and
 * this buffer usually does not carry. It is used for exactly one thing - a constant-bitrate
 * MP3's duration - and omitting it costs that one number.
 */
export function readMediaHeader(bytes: Uint8Array, totalSize?: number): MediaHeader | null {
    return readWav(bytes)
        ?? readFlac(bytes)
        ?? readOgg(bytes)
        ?? readIsoBmff(bytes)
        ?? readMatroska(bytes)
        ?? readMp3(bytes, totalSize);
}

/* ---------------------------------------------------------------------------------------- */
/* Small readers                                                                              */
/* ---------------------------------------------------------------------------------------- */

function view(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
    if (offset < 0 || offset + length > bytes.length) {
        return "";
    }
    let out = "";
    for (let i = 0; i < length; i += 1) {
        out += String.fromCharCode(bytes[offset + i]);
    }
    return out;
}

/** Milliseconds from a sample count and a rate, or undefined when either is unusable. */
function durationOf(samples: number, sampleRate: number): number | undefined {
    if (!Number.isFinite(samples) || !Number.isFinite(sampleRate) || samples <= 0 || sampleRate <= 0) {
        return undefined;
    }
    return Math.round((samples / sampleRate) * 1000);
}

/* ---------------------------------------------------------------------------------------- */
/* RIFF / WAVE                                                                                */
/* ---------------------------------------------------------------------------------------- */

/**
 * WAVE, which is the one container that carries everything needed in its first hundred bytes.
 *
 * Chunks are walked rather than assumed in order: a file written by a tool that emits `LIST`
 * metadata before `fmt ` is perfectly legal and refusing it would read to the author as "my
 * wav is not a wav".
 */
function readWav(bytes: Uint8Array): MediaHeader | null {
    if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
        return null;
    }
    const data = view(bytes);
    let offset = 12;
    let sampleRate: number | undefined;
    let channels: number | undefined;
    let byteRate = 0;
    let dataBytes = 0;

    while (offset + 8 <= bytes.length) {
        const id = ascii(bytes, offset, 4);
        const size = data.getUint32(offset + 4, true);
        if (id === "fmt " && offset + 24 <= bytes.length) {
            channels = data.getUint16(offset + 10, true);
            sampleRate = data.getUint32(offset + 12, true);
            byteRate = data.getUint32(offset + 16, true);
        } else if (id === "data") {
            // The chunk's declared length, not what is present: the payload is exactly what a
            // header-only read does not have.
            dataBytes = size;
            break;
        }
        // Chunks are word-aligned. The header's own 8 bytes are always added, so a zero-length
        // chunk still advances the walk.
        offset += 8 + size + (size % 2);
    }

    if (sampleRate === undefined) {
        return null;
    }
    return {
        container: "wav",
        sampleRate,
        ...(channels ? { channels } : {}),
        ...(byteRate > 0 && dataBytes > 0 ? { durationMs: Math.round((dataBytes / byteRate) * 1000) } : {}),
    };
}

/* ---------------------------------------------------------------------------------------- */
/* FLAC                                                                                       */
/* ---------------------------------------------------------------------------------------- */

/**
 * FLAC's STREAMINFO block, which is required to be the first metadata block.
 *
 * It holds the total sample count outright, so the duration is exact rather than derived -
 * the only lossy container in this file that can say that.
 */
function readFlac(bytes: Uint8Array): MediaHeader | null {
    if (ascii(bytes, 0, 4) !== "fLaC" || bytes.length < 42) {
        return null;
    }
    // 4 magic + 4 block header, then: 16+16+24+24 bits of block sizes and frame sizes.
    const body = 8 + 10;
    const data = view(bytes);
    // 20 bits sample rate, 3 bits (channels - 1), 5 bits (bits per sample - 1), 36 bits samples.
    const packed = data.getUint32(body);
    const sampleRate = packed >>> 12;
    const channels = ((packed >>> 9) & 0x07) + 1;
    // The sample count's top 4 bits are the low nibble of the same word; the rest is the next.
    const samples = (packed & 0x0f) * 2 ** 32 + data.getUint32(body + 4);

    if (sampleRate <= 0) {
        return null;
    }
    const durationMs = durationOf(samples, sampleRate);
    return {
        container: "flac",
        sampleRate,
        channels,
        ...(durationMs === undefined ? {} : { durationMs }),
    };
}

/* ---------------------------------------------------------------------------------------- */
/* Ogg                                                                                        */
/* ---------------------------------------------------------------------------------------- */

/**
 * Ogg's first page, which carries the codec's identification header.
 *
 * **No duration, ever.** An Ogg stream's length is the granule position of its LAST page, and
 * nothing at the front of the file knows it. Estimating one from the bitrate hint in the
 * Vorbis header would be a number that is wrong for every VBR file, which is most of them.
 */
function readOgg(bytes: Uint8Array): MediaHeader | null {
    if (ascii(bytes, 0, 4) !== "OggS" || bytes.length < 28) {
        return null;
    }
    const data = view(bytes);
    const segments = bytes[26];
    const payload = 27 + segments;

    if (ascii(bytes, payload + 1, 6) === "vorbis" && payload + 16 <= bytes.length) {
        return {
            container: "ogg",
            channels: bytes[payload + 11],
            sampleRate: data.getUint32(payload + 12, true),
        };
    }
    if (ascii(bytes, payload, 8) === "OpusHead" && payload + 16 <= bytes.length) {
        return {
            container: "ogg",
            channels: bytes[payload + 9],
            // Opus always decodes at 48 kHz whatever it was encoded from, so that - and not the
            // original rate in the next field - is the rate the engine will play it at.
            sampleRate: 48000,
        };
    }
    return { container: "ogg" };
}

/* ---------------------------------------------------------------------------------------- */
/* ISO base media (MP4, MOV, M4A)                                                             */
/* ---------------------------------------------------------------------------------------- */

const ISO_BRANDS: ReadonlySet<string> = new Set(["ftyp", "styp"]);

/**
 * MP4 and its relatives, as far as the head reaches.
 *
 * **`moov` is only sometimes at the front.** A file written without a faststart pass puts its
 * index after the media data, which on a real video is hundreds of megabytes away, so the
 * honest answer for one of those is the container name and nothing else. That is why every
 * number below is conditional rather than defaulted.
 */
function readIsoBmff(bytes: Uint8Array): MediaHeader | null {
    if (bytes.length < 12 || !ISO_BRANDS.has(ascii(bytes, 4, 4))) {
        return null;
    }
    const found: { durationMs?: number; width?: number; height?: number } = {};
    walkBoxes(bytes, 0, bytes.length, (type, start, end) => {
        if (type === "moov" || type === "trak") {
            return true;
        }
        if (type === "mvhd") {
            const ms = movieDuration(bytes, start);
            if (ms !== undefined) found.durationMs = ms;
        } else if (type === "tkhd") {
            const size = trackDimensions(bytes, start, end);
            // The largest track wins: a file can carry a small cover-art track beside the video,
            // and the video is the one whose size an author recognises.
            if (size && size.width * size.height > (found.width ?? 0) * (found.height ?? 0)) {
                found.width = size.width;
                found.height = size.height;
            }
        }
        return false;
    });
    return { container: "iso-bmff", ...found };
}

/**
 * Walk a box list, asking the visitor whether to descend into each one.
 *
 * Bounded by the buffer rather than by the declared sizes, because a truncated head is the
 * ordinary case here: the last box in the window is half there and its declared end is past
 * what was read.
 */
function walkBoxes(
    bytes: Uint8Array,
    from: number,
    to: number,
    visit: (type: string, bodyStart: number, bodyEnd: number) => boolean,
    depth = 0,
): void {
    if (depth > 8) {
        return;
    }
    const data = view(bytes);
    let offset = from;
    while (offset + 8 <= to && offset + 8 <= bytes.length) {
        let size = data.getUint32(offset);
        const type = ascii(bytes, offset + 4, 4);
        let body = offset + 8;
        if (size === 1) {
            if (offset + 16 > bytes.length) return;
            // 64-bit largesize. Read as two halves; the high word is zero for anything real.
            size = data.getUint32(offset + 8) * 2 ** 32 + data.getUint32(offset + 12);
            body = offset + 16;
        } else if (size === 0) {
            size = to - offset;
        }
        if (size < body - offset) {
            return;
        }
        const end = Math.min(offset + size, to);
        if (visit(type, body, end)) {
            walkBoxes(bytes, body, end, visit, depth + 1);
        }
        offset += size;
    }
}

/** `mvhd`: the movie's timescale and duration, in whichever of the two layouts it uses. */
function movieDuration(bytes: Uint8Array, body: number): number | undefined {
    if (body + 4 > bytes.length) {
        return undefined;
    }
    const data = view(bytes);
    const version = bytes[body];
    if (version === 1) {
        if (body + 32 > bytes.length) return undefined;
        const timescale = data.getUint32(body + 20);
        const duration = data.getUint32(body + 24) * 2 ** 32 + data.getUint32(body + 28);
        return durationOf(duration, timescale);
    }
    if (body + 20 > bytes.length) return undefined;
    const timescale = data.getUint32(body + 12);
    const duration = data.getUint32(body + 16);
    // 0xFFFFFFFF is the "unknown" sentinel a fragmented file writes.
    return duration === 0xffffffff ? undefined : durationOf(duration, timescale);
}

/**
 * `tkhd`: a track's presentation size, as 16.16 fixed point.
 *
 * Zero for a sound track, which is how an `.m4a` is told from a video without reading its
 * sample descriptions.
 */
function trackDimensions(bytes: Uint8Array, body: number, end: number): { width: number; height: number } | null {
    if (body + 4 > bytes.length) {
        return null;
    }
    // version+flags(4), then the version-dependent block, then 52 bytes to the size pair.
    const offset = body + 4 + (bytes[body] === 1 ? 32 : 20) + 52;
    if (offset + 8 > Math.min(end, bytes.length)) {
        return null;
    }
    const data = view(bytes);
    const width = Math.round(data.getUint32(offset) / 65536);
    const height = Math.round(data.getUint32(offset + 4) / 65536);
    return width > 0 && height > 0 ? { width, height } : null;
}

/* ---------------------------------------------------------------------------------------- */
/* Matroska / WebM                                                                            */
/* ---------------------------------------------------------------------------------------- */

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

/** Elements descended into rather than skipped. Everything else is read as a leaf. */
const EBML_MASTERS: ReadonlySet<number> = new Set([
    0x18538067, // Segment
    0x1549a966, // Info
    0x1654ae6b, // Tracks
    0xae,       // TrackEntry
    0xe0,       // Video
    0xe1,       // Audio
]);

function readMatroska(bytes: Uint8Array): MediaHeader | null {
    if (bytes.length < 4 || EBML_MAGIC.some((byte, index) => bytes[index] !== byte)) {
        return null;
    }
    // Matroska's default, and the one every real file uses: timecodes are in nanoseconds.
    let timecodeScale = 1_000_000;
    let scaledDuration: number | undefined;
    const found: { width?: number; height?: number; sampleRate?: number; channels?: number } = {};

    walkEbml(bytes, 0, bytes.length, (id, start, end) => {
        switch (id) {
            case 0x2ad7b1: timecodeScale = ebmlUint(bytes, start, end) || timecodeScale; break;
            case 0x4489: scaledDuration = ebmlFloat(bytes, start, end); break;
            case 0xb0: found.width = ebmlUint(bytes, start, end) || found.width; break;
            case 0xba: found.height = ebmlUint(bytes, start, end) || found.height; break;
            case 0x9f: found.channels = ebmlUint(bytes, start, end) || found.channels; break;
            case 0xb5: {
                const rate = ebmlFloat(bytes, start, end);
                if (rate) found.sampleRate = Math.round(rate);
                break;
            }
        }
    });

    return {
        container: "matroska",
        ...(scaledDuration === undefined
            ? {}
            : { durationMs: Math.round((scaledDuration * timecodeScale) / 1_000_000) }),
        ...found,
    };
}

/**
 * Walk EBML, descending only into the six masters above.
 *
 * An element whose size is "unknown" - every VINT_DATA bit set, which is what a streaming
 * muxer writes for Segment - is treated as running to the end of what was read. Refusing
 * those would mean reporting nothing about every live-recorded WebM.
 */
function walkEbml(
    bytes: Uint8Array,
    from: number,
    to: number,
    visit: (id: number, start: number, end: number) => void,
    depth = 0,
): void {
    if (depth > 6) {
        return;
    }
    let offset = from;
    while (offset < to && offset < bytes.length) {
        const id = readVint(bytes, offset, true);
        if (!id) return;
        const size = readVint(bytes, offset + id.length, false);
        if (!size) return;
        const start = offset + id.length + size.length;
        const end = size.unknown ? to : Math.min(start + size.value, to);
        if (end < start) return;

        if (EBML_MASTERS.has(id.value)) {
            walkEbml(bytes, start, end, visit, depth + 1);
        } else {
            visit(id.value, start, Math.min(end, bytes.length));
        }
        // A zero-width element is legal; without this the loop would never advance past one.
        offset = end > offset ? end : offset + 1;
    }
}

/**
 * One variable-length integer.
 *
 * `keepMarker` is the difference between an element ID and a size: an ID is compared as the
 * bytes written down, marker bit and all (`0xAE` is TrackEntry), while a size is the value
 * with the marker stripped.
 */
function readVint(
    bytes: Uint8Array,
    offset: number,
    keepMarker: boolean,
): { value: number; length: number; unknown: boolean } | null {
    if (offset >= bytes.length) {
        return null;
    }
    const first = bytes[offset];
    if (first === 0) {
        // A leading zero byte means a length past 8, which no real file uses and which would
        // overflow a double anyway.
        return null;
    }
    let length = 1;
    let mask = 0x80;
    while ((first & mask) === 0) {
        mask >>= 1;
        length += 1;
    }
    if (offset + length > bytes.length) {
        return null;
    }
    let value = keepMarker ? first : first & (mask - 1);
    let allOnes = (first & (mask - 1)) === mask - 1;
    for (let i = 1; i < length; i += 1) {
        value = value * 256 + bytes[offset + i];
        allOnes = allOnes && bytes[offset + i] === 0xff;
    }
    return { value, length, unknown: !keepMarker && allOnes };
}

function ebmlUint(bytes: Uint8Array, start: number, end: number): number {
    let value = 0;
    for (let i = start; i < end && i < bytes.length; i += 1) {
        value = value * 256 + bytes[i];
    }
    return value;
}

/** EBML floats are IEEE, 4 or 8 bytes. Any other width is not a number this can read. */
function ebmlFloat(bytes: Uint8Array, start: number, end: number): number | undefined {
    const width = Math.min(end, bytes.length) - start;
    const data = view(bytes);
    if (width === 4) return data.getFloat32(start);
    if (width === 8) return data.getFloat64(start);
    return undefined;
}

/* ---------------------------------------------------------------------------------------- */
/* MPEG audio                                                                                 */
/* ---------------------------------------------------------------------------------------- */

/** Bitrates in kbit/s by index, for MPEG 1 Layer III and MPEG 2/2.5 Layer III. */
const MP3_BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
/** Sample rates by index, indexed again by the version field. */
const MP3_RATES: Readonly<Record<number, readonly number[]>> = {
    3: [44100, 48000, 32000],  // MPEG 1
    2: [22050, 24000, 16000],  // MPEG 2
    0: [11025, 12000, 8000],   // MPEG 2.5
};

/**
 * The first MPEG audio frame, plus a Xing header if the encoder wrote one.
 *
 * Two ways to a duration and they are not equally good. A Xing/Info header states the frame
 * count outright, which is exact for a variable-bitrate file. Without one the only route is
 * bytes divided by bitrate, which is exact for constant bitrate and wrong for VBR - so it is
 * taken only when `totalSize` was passed, making the estimate the caller's decision rather
 * than a silent one.
 */
function readMp3(bytes: Uint8Array, totalSize?: number): MediaHeader | null {
    let offset = 0;
    if (ascii(bytes, 0, 3) === "ID3" && bytes.length >= 10) {
        // Syncsafe: seven bits per byte, so a tag length can never look like a frame sync.
        const tag = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
        offset = 10 + tag;
    }
    if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
        return null;
    }

    const version = (bytes[offset + 1] >> 3) & 0x03;
    const layer = (bytes[offset + 1] >> 1) & 0x03;
    const rates = MP3_RATES[version];
    const rateIndex = (bytes[offset + 2] >> 2) & 0x03;
    // version 1 and layer 0 are the reserved encodings; a file using them is not MPEG audio.
    if (!rates || layer === 0 || rateIndex === 3) {
        return null;
    }
    const sampleRate = rates[rateIndex];
    const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
    const bitrate = (version === 3 ? MP3_BITRATES_V1 : MP3_BITRATES_V2)[bitrateIndex];
    const mode = (bytes[offset + 3] >> 6) & 0x03;
    // Mode 3 is single channel; the other three are all two-channel encodings.
    const channels = mode === 3 ? 1 : 2;
    // Layer I frames hold 384 samples; Layer II and MPEG-1 Layer III hold 1152, MPEG-2/2.5
    // Layer III half that.
    const perFrame = layer === 3 ? 384 : version === 3 || layer === 2 ? 1152 : 576;

    const durationMs = xingDuration(bytes, offset, version, mode, perFrame, sampleRate)
        // Only Layer III, because only its bitrate table is written down above - reading a
        // Layer I file's index out of it would produce a confident wrong number rather than
        // no number.
        ?? (totalSize && bitrate > 0 && layer === 1
            ? Math.round(((totalSize - offset) * 8) / bitrate)
            : undefined);

    return {
        container: "mp3",
        sampleRate,
        channels,
        ...(durationMs === undefined ? {} : { durationMs }),
    };
}

/** The Xing/Info frame count, which sits in the first frame's side-information area. */
function xingDuration(
    bytes: Uint8Array,
    frame: number,
    version: number,
    mode: number,
    perFrame: number,
    sampleRate: number,
): number | undefined {
    const sideInfo = version === 3 ? (mode === 3 ? 17 : 32) : (mode === 3 ? 9 : 17);
    const tag = frame + 4 + sideInfo;
    const name = ascii(bytes, tag, 4);
    if (name !== "Xing" && name !== "Info") {
        return undefined;
    }
    if (tag + 12 > bytes.length) {
        return undefined;
    }
    const data = view(bytes);
    const flags = data.getUint32(tag + 4);
    if ((flags & 0x01) === 0) {
        return undefined;
    }
    return durationOf(data.getUint32(tag + 8) * perFrame, sampleRate);
}

/* ---------------------------------------------------------------------------------------- */
/* Fonts                                                                                      */
/* ---------------------------------------------------------------------------------------- */

/** Typographic family, preferred over the legacy family because it is the unstyled name. */
const NAME_ID_TYPOGRAPHIC_FAMILY = 16;
const NAME_ID_FAMILY = 1;

/**
 * A font's flavour, and its family when the name table is within reach.
 *
 * WOFF and WOFF2 answer with a flavour and nothing else on purpose: their tables are
 * compressed, and inflating one to read a string would be handing a decompressor to bytes
 * that came out of a repository - the exact thing the header-only rule exists to avoid.
 */
export function readFontHeader(bytes: Uint8Array): FontHeader | null {
    const tag = ascii(bytes, 0, 4);
    if (tag === "wOFF") return { container: "woff" };
    if (tag === "wOF2") return { container: "woff2" };
    if (bytes.length >= 4 && view(bytes).getUint32(0) === 0x00020001) return { container: "embedded-opentype" };

    let start = 0;
    let container: FontHeader["container"];
    if (tag === "ttcf") {
        if (bytes.length < 16) return null;
        container = "collection";
        // Offset table of the first font in the collection.
        start = view(bytes).getUint32(12);
    } else if (tag === "OTTO") {
        container = "opentype";
    } else if (bytes.length >= 4 && (view(bytes).getUint32(0) === 0x00010000 || tag === "true")) {
        container = "truetype";
    } else {
        return null;
    }

    const family = readSfntFamily(bytes, start);
    return { container, ...(family ? { family } : {}) };
}

/** The `name` table's family string, or undefined when the table is not inside these bytes. */
function readSfntFamily(bytes: Uint8Array, offsetTable: number): string | undefined {
    if (offsetTable + 12 > bytes.length) {
        return undefined;
    }
    const data = view(bytes);
    const tables = data.getUint16(offsetTable + 4);
    let nameOffset = -1;
    for (let i = 0; i < tables; i += 1) {
        const record = offsetTable + 12 + i * 16;
        if (record + 16 > bytes.length) {
            return undefined;
        }
        if (ascii(bytes, record, 4) === "name") {
            nameOffset = data.getUint32(record + 8);
            break;
        }
    }
    if (nameOffset < 0 || nameOffset + 6 > bytes.length) {
        return undefined;
    }

    const count = data.getUint16(nameOffset + 2);
    const strings = nameOffset + data.getUint16(nameOffset + 4);
    let best: { rank: number; text: string } | undefined;
    for (let i = 0; i < count; i += 1) {
        const record = nameOffset + 6 + i * 12;
        if (record + 12 > bytes.length) {
            break;
        }
        const platform = data.getUint16(record);
        const nameId = data.getUint16(record + 6);
        if (nameId !== NAME_ID_FAMILY && nameId !== NAME_ID_TYPOGRAPHIC_FAMILY) {
            continue;
        }
        const length = data.getUint16(record + 8);
        const at = strings + data.getUint16(record + 10);
        if (at + length > bytes.length) {
            continue;
        }
        // Platform 1 is Macintosh and its strings are single-byte; 0 and 3 are UTF-16BE.
        const text = platform === 1
            ? ascii(bytes, at, length)
            : utf16be(bytes, at, length);
        if (!text) {
            continue;
        }
        const rank = nameId === NAME_ID_TYPOGRAPHIC_FAMILY ? 2 : 1;
        if (!best || rank > best.rank) {
            best = { rank, text };
        }
    }
    return best?.text;
}

function utf16be(bytes: Uint8Array, offset: number, length: number): string {
    let out = "";
    for (let i = 0; i + 1 < length; i += 2) {
        out += String.fromCharCode((bytes[offset + i] << 8) | bytes[offset + i + 1]);
    }
    return out;
}
