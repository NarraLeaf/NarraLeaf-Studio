import { describe, expect, it } from "vitest";
import { estimateFrameRate, formatFrameRate, frameCount, frameIndexAt, frameSeekTime, readVideoTiming } from "./frameRate";

const readFrameRate = (bytes: Uint8Array) => readVideoTiming(bytes)?.rate ?? null;

// ---- ISO-BMFF builders --------------------------------------------------------

function u32(value: number): number[] {
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function box(type: string, ...payload: number[][]): number[] {
    const body = payload.flat();
    return [...u32(8 + body.length), ...[...type].map(char => char.charCodeAt(0)), ...body];
}

function hdlr(handler: string): number[] {
    return box("hdlr", u32(0), u32(0), [...handler].map(char => char.charCodeAt(0)), u32(0), u32(0), u32(0), [0]);
}

function mdhd(timescale: number): number[] {
    return box("mdhd", u32(0), u32(0), u32(0), u32(timescale), u32(0), u32(0));
}

function stts(entries: [count: number, delta: number][]): number[] {
    return box("stts", u32(0), u32(entries.length), ...entries.map(([count, delta]) => [...u32(count), ...u32(delta)]));
}

function track(handler: string, timescale: number, entries: [number, number][], trackId = 1): number[] {
    return box(
        "trak",
        box("tkhd", u32(0), u32(0), u32(0), u32(trackId), u32(0), u32(0)),
        box("mdia", mdhd(timescale), hdlr(handler), box("minf", box("stbl", stts(entries)))),
    );
}

function mp4(...tracks: number[][]): Uint8Array {
    return new Uint8Array([...box("ftyp", [..."isom"].map(c => c.charCodeAt(0)), u32(0)), ...box("moov", ...tracks)]);
}

// ---- Matroska builders ----------------------------------------------------------

function ebml(id: number[], payload: number[]): number[] {
    // Sizes up to 126 fit a one-byte vint; the fixtures stay well under that.
    return [...id, 0x80 | payload.length, ...payload];
}

function matroska(trackEntries: number[][]): Uint8Array {
    const header = ebml([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x86, 0x81, 0x01]);
    const tracks = ebml([0x16, 0x54, 0xae, 0x6b], trackEntries.flat());
    // An unknown-size Segment, the way a live muxer writes one.
    return new Uint8Array([...header, 0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...tracks]);
}

function trackEntry(type: number, defaultDurationNs?: number): number[] {
    const fields = [...ebml([0x83], [type])];
    if (defaultDurationNs !== undefined) {
        fields.push(...ebml([0x23, 0xe3, 0x83], u32(defaultDurationNs)));
    }
    return ebml([0xae], fields);
}

describe("readFrameRate", () => {
    it("averages the video track's sample durations in an MP4", () => {
        expect(readFrameRate(mp4(track("vide", 30000, [[300, 1001]])))).toBeCloseTo(29.97, 2);
        expect(readFrameRate(mp4(track("vide", 12800, [[250, 512]])))).toBeCloseTo(25, 5);
    });

    it("counts the picture track's frames, not the file's duration times the rate", () => {
        expect(readVideoTiming(mp4(track("vide", 30000, [[239, 1001]])))?.frames).toBe(239);
        expect(readVideoTiming(matroska([trackEntry(1, 40_000_000)]))?.frames).toBeNull();
    });

    it("skips the sound track to find the picture", () => {
        const bytes = mp4(track("soun", 48000, [[100, 1024]]), track("vide", 24000, [[48, 1000]], 2));
        expect(readFrameRate(bytes)).toBeCloseTo(24, 5);
    });

    it("answers null when the track states no samples and no default", () => {
        expect(readFrameRate(mp4(track("vide", 30000, [])))).toBeNull();
    });

    it("reads a WebM's DefaultDuration", () => {
        expect(readFrameRate(matroska([trackEntry(2), trackEntry(1, 16_666_667)])) ?? 0).toBeCloseTo(60, 2);
    });

    it("answers null for a WebM that does not state its rate", () => {
        expect(readFrameRate(matroska([trackEntry(1)]))).toBeNull();
    });

    it("answers null for bytes that are neither container", () => {
        expect(readFrameRate(new Uint8Array(64))).toBeNull();
        expect(readFrameRate(new Uint8Array([1, 2, 3]))).toBeNull();
    });

    it("stops at a box that claims more bytes than its parent has", () => {
        const bytes = mp4(track("vide", 30000, [[300, 1000]]));
        // Corrupt the moov size so it runs past the end of the file.
        const moovAt = 16;
        bytes.set(u32(0xffff), moovAt);
        expect(readFrameRate(bytes)).toBeNull();
    });
});

describe("estimateFrameRate", () => {
    it("waits for enough intervals", () => {
        expect(estimateFrameRate([1 / 30, 1 / 30])).toBeNull();
    });

    it("takes the median, so one late frame does not move it", () => {
        const intervals = [...Array(12).fill(1 / 30), 2 / 30];
        expect(estimateFrameRate(intervals)).toBeCloseTo(30, 5);
    });

    it("snaps to a broadcast rate", () => {
        expect(estimateFrameRate(Array(10).fill(0.033367))).toBeCloseTo(30000 / 1001, 6);
        expect(estimateFrameRate(Array(10).fill(0.033333))).toBeCloseTo(30, 6);
    });
});

describe("frame arithmetic", () => {
    it("counts frames from zero", () => {
        expect(frameIndexAt(0, 30)).toBe(0);
        expect(frameIndexAt(1, 30)).toBe(30);
        expect(frameIndexAt(81 * (1001 / 30000), 30000 / 1001)).toBe(81);
        // A presented frame's time, as the player reports it: rounded to the microsecond.
        expect(frameIndexAt(0.066733, 30000 / 1001)).toBe(2);
        expect(frameIndexAt(0.100100, 30000 / 1001)).toBe(3);
    });

    it("seeks to the middle of a frame and clamps to the clip", () => {
        expect(frameSeekTime(0, 25, 250)).toBeCloseTo(0.02, 6);
        expect(frameSeekTime(-3, 25, 250)).toBeCloseTo(0.02, 6);
        expect(frameSeekTime(999, 25, 250)).toBeCloseTo(9.98, 6);
        expect(frameCount(10, 25)).toBe(250);
    });

    it("formats a rate the way a status bar shows it", () => {
        expect(formatFrameRate(30000 / 1001)).toBe("29.97");
        expect(formatFrameRate(30)).toBe("30");
        expect(formatFrameRate(24000 / 1001)).toBe("23.98");
    });
});
