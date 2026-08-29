import { describe, expect, it } from "vitest";
import { mediaMetadataLikely, readMediaFormat, stripMediaMetadata } from "./assetMediaMetadata";

function bytes(...parts: Array<Uint8Array | number[] | string>): Uint8Array {
    const flat: number[] = [];
    for (const part of parts) {
        if (typeof part === "string") {
            flat.push(...[...part].map(c => c.charCodeAt(0)));
        } else {
            flat.push(...part);
        }
    }
    return Uint8Array.from(flat);
}

function le32(value: number): number[] {
    return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

function be24(value: number): number[] {
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/* --- WAV ------------------------------------------------------------------ */

function riffChunk(id: string, payload: number[]): number[] {
    const pad = payload.length % 2 === 1 ? [0] : [];
    return [...[...id].map(c => c.charCodeAt(0)), ...le32(payload.length), ...payload, ...pad];
}

function wav(chunks: number[][]): Uint8Array {
    const body = chunks.flat();
    return bytes("RIFF", le32(4 + body.length), "WAVE", body);
}

const FMT = riffChunk("fmt ", new Array(16).fill(0));
const DATA = riffChunk("data", new Array(64).fill(7));
/** Loop points. Not provenance, and a looping track is unusable without them. */
const SMPL = riffChunk("smpl", new Array(36).fill(3));

describe("WAV", () => {
    it("drops the studio's notes and keeps everything that plays", () => {
        const source = wav([
            FMT,
            riffChunk("LIST", [...[..."INFO"].map(c => c.charCodeAt(0)), ...riffChunk("IART", [65, 66, 0, 0])]),
            riffChunk("bext", new Array(64).fill(1)),
            SMPL,
            DATA,
        ]);
        const result = stripMediaMetadata(source);
        expect(result.removed).toEqual(["riff-info"]);
        expect(result.bytes.length).toBeLessThan(source.length);
        // Rebuilt from the chunks that survived, in order, with a corrected size.
        expect(result.bytes).toEqual(wav([FMT, SMPL, DATA]));
        const size = new DataView(result.bytes.buffer).getUint32(4, true);
        expect(size).toBe(result.bytes.length - 8);
    });

    it("keeps a LIST that is not an INFO list", () => {
        // `adtl` is where the labels on cue markers live; the chunk id is the same.
        const adtl = riffChunk("LIST", [...[..."adtl"].map(c => c.charCodeAt(0)), 1, 2, 3, 4]);
        const source = wav([FMT, adtl, DATA]);
        expect(stripMediaMetadata(source).bytes).toBe(source);
    });

    it("leaves a file with nothing to remove exactly as it was", () => {
        const source = wav([FMT, SMPL, DATA]);
        const result = stripMediaMetadata(source);
        expect(result.bytes).toBe(source);
        expect(result.bytesRemoved).toBe(0);
    });

    it("does not rewrite a file whose chunk sizes do not add up", () => {
        // A streamed WAV can carry a `data` size of zero or -1. Reading past the
        // end there and rebuilding what it found would be how a build corrupts a
        // file it was only asked to tidy.
        const source = bytes("RIFF", le32(4 + 8 + 64), "WAVE", "data", le32(0xffffffff), new Array(64).fill(7));
        expect(stripMediaMetadata(source).bytes).toBe(source);
    });
});

/* --- FLAC ----------------------------------------------------------------- */

function flacBlock(type: number, payload: number[], last = false): number[] {
    return [(last ? 0x80 : 0) | type, ...be24(payload.length), ...payload];
}

function vorbisField(text: string): number[] {
    const value = [...text].map(c => c.charCodeAt(0));
    return [...le32(value.length), ...value];
}

function vorbisComment(vendor: string, fields: string[]): number[] {
    const vendorBytes = [...vendor].map(c => c.charCodeAt(0));
    return [
        ...le32(vendorBytes.length), ...vendorBytes,
        ...le32(fields.length),
        ...fields.flatMap(vorbisField),
    ];
}

const STREAMINFO = flacBlock(0, new Array(34).fill(9));
const SEEKTABLE = flacBlock(3, new Array(18).fill(2));
const AUDIO = [0xff, 0xf8, 0x69, 0x18, 1, 2, 3, 4];

describe("FLAC", () => {
    it("drops padding and cover art, and keeps the seek table", () => {
        const source = bytes("fLaC", STREAMINFO, SEEKTABLE, flacBlock(1, new Array(64).fill(0)),
            flacBlock(6, new Array(80).fill(4), true), AUDIO);
        const result = stripMediaMetadata(source);
        expect(result.removed.sort()).toEqual(["padding", "picture"]);
        expect(result.bytes).toEqual(bytes("fLaC", STREAMINFO, flacBlock(3, new Array(18).fill(2), true), AUDIO));
    });

    it("moves the last-block flag onto whatever ends up last", () => {
        // The flag went out with the block that carried it. A file without one is
        // a file no decoder reads past.
        const source = bytes("fLaC", STREAMINFO, flacBlock(1, [0, 0, 0], true), AUDIO);
        const result = stripMediaMetadata(source);
        expect(result.bytes[4] & 0x80).toBe(0x80);
        expect(result.bytes).toEqual(bytes("fLaC", flacBlock(0, new Array(34).fill(9), true), AUDIO));
    });

    it("takes named comment fields out and leaves every other one in", () => {
        // The whole discipline of this module in one assertion: ARTIST is a
        // person, LOOPSTART is an instruction, and a key nobody has heard of
        // could be either - so only the first goes.
        const comment = vorbisComment("reference libFLAC 1.4.3", [
            "ARTIST=Someone Real",
            "LOOPSTART=176400",
            "REPLAYGAIN_TRACK_GAIN=-6.5 dB",
            "SOMETHINGNOBODYMEASURED=keep me",
            "encoded-by=A Studio",
        ]);
        const source = bytes("fLaC", STREAMINFO, flacBlock(4, comment, true), AUDIO);
        const result = stripMediaMetadata(source);
        expect(result.removed).toEqual(["vorbis-comment"]);

        const text = String.fromCharCode(...result.bytes);
        expect(text).toContain("LOOPSTART=176400");
        expect(text).toContain("REPLAYGAIN_TRACK_GAIN");
        expect(text).toContain("SOMETHINGNOBODYMEASURED=keep me");
        expect(text).not.toContain("Someone Real");
        expect(text).not.toContain("A Studio");
        // The vendor string names the encoder that wrote the file, and nothing
        // reads it.
        expect(text).not.toContain("libFLAC");
    });

    it("keeps a comment block it cannot parse rather than guessing", () => {
        const truncated = bytes("fLaC", STREAMINFO, flacBlock(4, [...le32(500), 1, 2, 3], true), AUDIO);
        expect(stripMediaMetadata(truncated).bytes).toBe(truncated);
    });

    it("does not rewrite a file whose block list runs off the end", () => {
        const source = bytes("fLaC", [0x00, 0xff, 0xff, 0xff, 1, 2, 3]);
        expect(stripMediaMetadata(source).bytes).toBe(source);
    });
});

/* --- MP3 ------------------------------------------------------------------ */

function syncsafe(value: number): number[] {
    return [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
}

const FRAMES = bytes([0xff, 0xfb, 0x90, 0x00], new Array(64).fill(5));

describe("MP3", () => {
    it("takes the tag off the front, the back, or both", () => {
        const v2 = bytes("ID3", [3, 0, 0], syncsafe(40), new Array(40).fill(1));
        const v1 = bytes("TAG", new Array(125).fill(2));

        expect(stripMediaMetadata(bytes(v2, FRAMES)).bytes).toEqual(FRAMES);
        expect(stripMediaMetadata(bytes(FRAMES, v1)).bytes).toEqual(FRAMES);
        const both = stripMediaMetadata(bytes(v2, FRAMES, v1));
        expect(both.bytes).toEqual(FRAMES);
        expect(both.removed).toEqual(["id3"]);
        expect(both.bytesRemoved).toBe(v2.length + v1.length);
    });

    it("counts the footer an ID3v2 tag may have after it", () => {
        // Bit 4 of the flags. Missing it leaves ten bytes of tag in front of the
        // audio, and some decoders will not resynchronise past them.
        const withFooter = bytes("ID3", [4, 0, 0x10], syncsafe(20), new Array(20).fill(1), new Array(10).fill(3));
        expect(stripMediaMetadata(bytes(withFooter, FRAMES)).bytes).toEqual(FRAMES);
    });

    it("takes an APE tag off the end", () => {
        const ape = bytes("APETAGEX", le32(2000), le32(32), le32(0), le32(0), new Array(8).fill(0));
        expect(stripMediaMetadata(bytes(FRAMES, ape)).bytes).toEqual(FRAMES);
    });

    it("leaves an untagged file alone", () => {
        const result = stripMediaMetadata(FRAMES);
        expect(result.bytes).toBe(FRAMES);
        expect(result.removed).toEqual([]);
    });

    it("refuses a file that is nothing but tag", () => {
        const onlyTag = bytes("ID3", [3, 0, 0], syncsafe(4), [1, 2, 3, 4]);
        expect(stripMediaMetadata(onlyTag).bytes).toBe(onlyTag);
    });
});

/* --- Everything else ------------------------------------------------------ */

describe("what this module will not touch", () => {
    it("returns anything it does not recognise unchanged", () => {
        // MP4, Ogg and Matroska all record byte offsets or checksums that moving
        // a block invalidates, so they are left to a remux by something that
        // knows the container.
        for (const source of [
            bytes([0, 0, 0, 0x18], "ftypM4A ", new Array(16).fill(0)),
            bytes("OggS", new Array(32).fill(0)),
            bytes([0x1a, 0x45, 0xdf, 0xa3], new Array(32).fill(0)),
            bytes([1, 2, 3, 4]),
            new Uint8Array(0),
        ]) {
            const result = stripMediaMetadata(source);
            expect(result.bytes).toBe(source);
            expect(result.removed).toEqual([]);
        }
    });

    it("names the format from the bytes, never from a file name", () => {
        expect(readMediaFormat(wav([FMT, DATA]))).toBe("wav");
        expect(readMediaFormat(bytes("fLaC", STREAMINFO))).toBe("flac");
        expect(readMediaFormat(FRAMES)).toBe("mp3");
        expect(readMediaFormat(bytes("OggS"))).toBeNull();
    });
});

describe("the cheap check that decides whether to read a whole file", () => {
    it("says yes for a tag at either end", () => {
        const head = bytes("ID3", [3, 0, 0], syncsafe(40), new Array(40).fill(1));
        expect(mediaMetadataLikely(head, FRAMES)).toBe(true);
        expect(mediaMetadataLikely(FRAMES, bytes(new Array(64).fill(5), "TAG", new Array(125).fill(2))))
            .toBe(true);
    });

    it("says no for a plain file, which is what makes it worth doing", () => {
        // A fully voiced game is gigabytes of these, and the alternative is
        // reading every one of them on every build.
        expect(mediaMetadataLikely(FRAMES, FRAMES)).toBe(false);
        const clean = wav([FMT, DATA]);
        expect(mediaMetadataLikely(clean, clean)).toBe(false);
    });

    it("says no for a long WAV whose head stops inside the samples", () => {
        // The case that decides whether this check is worth having at all: a
        // one-hour recording is one enormous `data` chunk, and stopping at it has
        // already seen every chunk a tagger writes before the audio.
        const long = wav([FMT, riffChunk("data", new Array(4000).fill(7))]);
        expect(mediaMetadataLikely(long.subarray(0, 64), long.subarray(long.length - 64))).toBe(false);
    });

    it("still says yes for a tag written after the samples", () => {
        const tagged = wav([FMT, riffChunk("data", new Array(4000).fill(7)), riffChunk("ID3 ", [1, 2, 3, 4])]);
        expect(mediaMetadataLikely(tagged.subarray(0, 64), tagged.subarray(tagged.length - 64))).toBe(true);
    });

    it("errs towards yes when it cannot see the whole chunk list", () => {
        // Being wrong this way costs one read. Being wrong the other way ships an
        // author's name.
        const truncated = wav([FMT, DATA]).subarray(0, 20);
        expect(mediaMetadataLikely(truncated, truncated)).toBe(true);
    });
});
