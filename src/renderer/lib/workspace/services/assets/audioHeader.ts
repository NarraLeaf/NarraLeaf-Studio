/**
 * The sample rate and channel count an audio file declares in its own header.
 *
 * Studio used to report the rate of a fresh `AudioContext` - the output device's, 44.1 or 48 kHz
 * depending on the machine - and two channels for everything. The audio preview then decoded at that
 * rate too, and `decodeAudioData` resamples to it: the same 48 kHz master measured +0.5 dBFS with 286
 * clipped runs on one machine and 0.0 dBFS with one on another. Reading the header is what lets a file
 * be described, and decoded, as what it is.
 *
 * Covers the containers a visual novel's audio arrives in: WAV, MP3, FLAC and Ogg (Vorbis, Opus).
 * Anything else answers `null` and the caller keeps its fallback.
 */

export interface AudioHeaderFacts {
    sampleRate: number;
    channels: number;
}

const ascii = (bytes: Uint8Array, offset: number, text: string): boolean => {
    if (offset + text.length > bytes.length) {
        return false;
    }
    for (let index = 0; index < text.length; index++) {
        if (bytes[offset + index] !== text.charCodeAt(index)) {
            return false;
        }
    }
    return true;
};

const u16le = (bytes: Uint8Array, offset: number): number => bytes[offset] | (bytes[offset + 1] << 8);
const u32le = (bytes: Uint8Array, offset: number): number =>
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

function plausible(facts: AudioHeaderFacts): AudioHeaderFacts | null {
    const { sampleRate, channels } = facts;
    return sampleRate >= 1000 && sampleRate <= 768_000 && channels >= 1 && channels <= 32 ? facts : null;
}

function readWav(bytes: Uint8Array): AudioHeaderFacts | null {
    if (!ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "WAVE")) {
        return null;
    }
    // Chunks follow the 12-byte RIFF header; `fmt ` is usually first but need not be.
    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const size = u32le(bytes, offset + 4);
        if (ascii(bytes, offset, "fmt ") && offset + 16 <= bytes.length) {
            return plausible({ channels: u16le(bytes, offset + 10), sampleRate: u32le(bytes, offset + 12) });
        }
        // Chunks are word-aligned.
        offset += 8 + size + (size % 2);
    }
    return null;
}

function readFlac(bytes: Uint8Array): AudioHeaderFacts | null {
    // "fLaC", then the STREAMINFO block: a 4-byte block header and the rate in the 20 bits at data
    // offset 10, the channel count less one in the 3 bits after it.
    if (!ascii(bytes, 0, "fLaC") || bytes.length < 8 + 13) {
        return null;
    }
    const data = 8;
    const sampleRate = (bytes[data + 10] << 12) | (bytes[data + 11] << 4) | (bytes[data + 12] >> 4);
    const channels = ((bytes[data + 12] >> 1) & 0x07) + 1;
    return plausible({ sampleRate, channels });
}

function readOgg(bytes: Uint8Array): AudioHeaderFacts | null {
    if (!ascii(bytes, 0, "OggS")) {
        return null;
    }
    // The codec's identification header sits in the first page, a little way in.
    const limit = Math.min(bytes.length, 512);
    for (let offset = 0; offset < limit; offset++) {
        if (ascii(bytes, offset, "\u0001vorbis") && offset + 16 <= bytes.length) {
            return plausible({ channels: bytes[offset + 11], sampleRate: u32le(bytes, offset + 12) });
        }
        if (ascii(bytes, offset, "OpusHead") && offset + 10 <= bytes.length) {
            // Opus always decodes at 48 kHz; the header's own rate field is only the source's.
            return plausible({ channels: bytes[offset + 9], sampleRate: 48_000 });
        }
    }
    return null;
}

/** MPEG audio sample rates by version, indexed by the header's two rate bits. */
const MPEG_RATES: Record<number, readonly number[]> = {
    3: [44_100, 48_000, 32_000], // MPEG-1
    2: [22_050, 24_000, 16_000], // MPEG-2
    0: [11_025, 12_000, 8_000], // MPEG-2.5
};

function readMp3(bytes: Uint8Array): AudioHeaderFacts | null {
    let offset = 0;
    // An ID3v2 tag in front of the audio: a 10-byte header whose size is four 7-bit bytes, plus a
    // 10-byte footer when its flag says so.
    if (ascii(bytes, 0, "ID3") && bytes.length >= 10) {
        const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
        offset = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
    }
    // The first frame header after it. Bounded, so a file that is not MPEG audio at all gives up
    // quickly rather than scanning megabytes for a pattern that happens to match.
    const limit = Math.min(bytes.length - 3, offset + 64 * 1024);
    for (; offset < limit; offset++) {
        if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
            continue;
        }
        const version = (bytes[offset + 1] >> 3) & 0x03;
        const layer = (bytes[offset + 1] >> 1) & 0x03;
        const bitrate = bytes[offset + 2] >> 4;
        const rateIndex = (bytes[offset + 2] >> 2) & 0x03;
        if (version === 1 || layer === 0 || bitrate === 0x0f || rateIndex === 3) {
            continue;
        }
        const sampleRate = MPEG_RATES[version]?.[rateIndex];
        if (!sampleRate) {
            continue;
        }
        const channels = ((bytes[offset + 3] >> 6) & 0x03) === 3 ? 1 : 2;
        return { sampleRate, channels };
    }
    return null;
}

export function readAudioHeader(bytes: Uint8Array): AudioHeaderFacts | null {
    return readWav(bytes) ?? readFlac(bytes) ?? readOgg(bytes) ?? readMp3(bytes);
}

