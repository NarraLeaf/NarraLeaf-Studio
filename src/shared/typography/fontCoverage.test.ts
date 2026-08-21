import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
    coversCodePoint,
    readFontCoverage,
    stackCoversCodePoint,
    type FontCoverage,
} from "./fontCoverage";

/**
 * Fonts are built here rather than checked in as fixtures.
 *
 * A real `.ttf` small enough to commit is a real `.ttf` whose `cmap` says whatever its designer's
 * tooling decided, and the cases worth asserting - a segment with a hole in it, an `OS/2` too old to
 * carry code pages, a table whose offset runs off the end - are exactly the ones no shipping font
 * has. Building the bytes states each case in one place and makes the layout arithmetic the code
 * under test performs visible in the test.
 */

type Segment = {
    start: number;
    end: number;
    delta?: number;
    /** Glyph ids for the segment, when it maps through `glyphIdArray`; a 0 is a hole. */
    glyphs?: number[];
};

function u16(value: number): number[] {
    return [(value >> 8) & 0xff, value & 0xff];
}

function u32(value: number): number[] {
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function tag(text: string): number[] {
    return [...text].map(character => character.charCodeAt(0));
}

/** WOFF2's UIntBase128: seven bits a byte, high bit set on all but the last. */
function base128(value: number): number[] {
    const out: number[] = [];
    let remaining = value;
    do {
        out.unshift(remaining & 0x7f);
        remaining = Math.floor(remaining / 128);
    } while (remaining > 0);
    for (let i = 0; i < out.length - 1; i += 1) {
        out[i]! |= 0x80;
    }
    return out;
}

/**
 * Assemble a `cmap`: encoding records first, then the subtables they point at, laid out in order.
 *
 * Kept apart from the subtable builders because the interesting cases are about the *records* - a
 * platform that is not Unicode, or two records whose coverage has to be unioned.
 */
function cmap(entries: { platform: number; encoding: number; subtable: number[] }[]): number[] {
    const records: number[] = [];
    const body: number[] = [];
    const start = 4 + entries.length * 8;
    for (const entry of entries) {
        records.push(...u16(entry.platform), ...u16(entry.encoding), ...u32(start + body.length));
        body.push(...entry.subtable);
    }
    return [...u16(0), ...u16(entries.length), ...records, ...body];
}

/** One Windows-Unicode-BMP `cmap`, which is what nearly every font actually has. */
function cmapFormat4(segments: Segment[]): number[] {
    return cmap([{ platform: 3, encoding: 1, subtable: subtableFormat4(segments) }]);
}

/** One Windows-Unicode-full `cmap`. */
function cmapFormat12(groups: { start: number; end: number; startGlyph: number }[]): number[] {
    return cmap([{ platform: 3, encoding: 10, subtable: subtableFormat12(groups) }]);
}

/** A format 4 subtable, terminator segment included as the spec requires. */
function subtableFormat4(segments: Segment[]): number[] {
    const all = [...segments, { start: 0xffff, end: 0xffff, delta: 1 }];
    const segCount = all.length;
    const glyphArray: number[] = [];
    const idRangeOffsets: number[] = [];

    all.forEach((segment, index) => {
        if (!segment.glyphs) {
            idRangeOffsets.push(0);
            return;
        }
        // Distance in bytes from this segment's own idRangeOffset slot to where its glyphs begin:
        // the rest of the idRangeOffset array, then whatever earlier segments already queued.
        const remaining = (segCount - index) * 2;
        idRangeOffsets.push(remaining + glyphArray.length * 2);
        glyphArray.push(...segment.glyphs);
    });

    return [
        ...u16(4),
        ...u16(16 + segCount * 8 + glyphArray.length * 2),
        ...u16(0),
        ...u16(segCount * 2),
        ...u16(0), ...u16(0), ...u16(0),
        ...all.flatMap(segment => u16(segment.end)),
        ...u16(0),
        ...all.flatMap(segment => u16(segment.start)),
        ...all.flatMap(segment => u16(segment.delta ?? 0)),
        ...idRangeOffsets.flatMap(u16),
        ...glyphArray.flatMap(u16),
    ];
}

/** A format 12 subtable: groups of contiguous code points, no BMP ceiling. */
function subtableFormat12(groups: { start: number; end: number; startGlyph: number }[]): number[] {
    return [
        ...u16(12),
        ...u16(0),
        ...u32(16 + groups.length * 12),
        ...u32(0),
        ...u32(groups.length),
        ...groups.flatMap(group => [...u32(group.start), ...u32(group.end), ...u32(group.startGlyph)]),
    ];
}

/** An `OS/2` of the given version, 86 bytes, with `ulCodePageRange1` set from the bits named. */
function os2(version: number, codePageBits: number[]): number[] {
    const table = new Array(86).fill(0);
    table.splice(0, 2, ...u16(version));
    let word = 0;
    for (const bit of codePageBits) {
        word |= 1 << bit;
    }
    table.splice(78, 4, ...u32(word));
    return table;
}

/**
 * Wrap tables in a bare sfnt, four-byte aligned the way a real one is.
 *
 * `base` is where this offset table will sit in the finished file. It is zero for a bare font and
 * non-zero inside a collection, where every table offset is measured from the start of the *file*
 * and not from the face's own directory.
 */
function sfnt(tables: { name: string; data: number[] }[], base = 0): Uint8Array {
    const directory = base + 12 + tables.length * 16;
    const records: number[] = [];
    const body: number[] = [];
    for (const table of tables) {
        const offset = directory + body.length;
        records.push(...tag(table.name), ...u32(0), ...u32(offset), ...u32(table.data.length));
        body.push(...table.data);
        while (body.length % 4 !== 0) {
            body.push(0);
        }
    }
    return new Uint8Array([
        ...u32(0x00010000),
        ...u16(tables.length),
        ...u16(0), ...u16(0), ...u16(0),
        ...records,
        ...body,
    ]);
}

/**
 * A WOFF carrying one `cmap` table, stored as `data`.
 *
 * `origLength` above `data.length` is the spec's marker for "this table was compressed"; equal is
 * how a table that would not have shrunk is stored.
 */
function woff(data: number[], origLength: number): Uint8Array {
    const dataStart = 44 + 20;
    return new Uint8Array([
        ...tag("wOFF"), ...u32(0x00010000), ...u32(dataStart + data.length), ...u16(1), ...u16(0),
        ...u32(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0),
        ...tag("cmap"), ...u32(dataStart), ...u32(data.length), ...u32(origLength), ...u32(0),
        ...data,
    ]);
}

function coverageOf(file: Uint8Array): FontCoverage {
    const result = readFontCoverage(file);
    if (!result.ok) {
        throw new Error(`expected coverage, got ${result.reason}`);
    }
    return result.coverage;
}

describe("readFontCoverage / containers", () => {
    it("refuses bytes that are not a font", () => {
        expect(readFontCoverage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual({
            ok: false,
            reason: "not-a-font",
        });
    });

    it("reports a font with no cmap rather than an empty coverage", () => {
        expect(readFontCoverage(sfnt([{ name: "OS/2", data: os2(4, [0]) }]))).toEqual({
            ok: false,
            reason: "no-cmap",
        });
    });

    it("reports a truncated table as malformed", () => {
        const file = sfnt([{ name: "cmap", data: cmapFormat4([{ start: 0x41, end: 0x5a, delta: 1 }]) }]);
        // Push the cmap's length past the end of the file: offset 12 + 8 is the record's length field.
        file.set(u32(0xffff), 12 + 12);
        expect(readFontCoverage(file)).toEqual({ ok: false, reason: "malformed" });
    });

    it("asks for a decompressor rather than guessing at a compressed WOFF table", () => {
        expect(readFontCoverage(woff([0xaa, 0xbb], 400))).toEqual({
            ok: false,
            reason: "needs-decompressor",
        });
    });

    it("asks for a decompressor rather than guessing at a WOFF2", () => {
        const woff2 = new Uint8Array(48);
        woff2.set(tag("wOF2"), 0);
        expect(readFontCoverage(woff2)).toEqual({ ok: false, reason: "needs-decompressor" });
    });

    it("reads a WOFF whose cmap was stored uncompressed", () => {
        const data = cmapFormat4([{ start: 0x41, end: 0x5a, delta: 1 }]);
        expect(coverageOf(woff(data, data.length)).ranges).toEqual([[0x41, 0x5a]]);
    });

    it("inflates a WOFF cmap that was compressed", () => {
        const data = cmapFormat4([{ start: 0x41, end: 0x5a, delta: 1 }]);
        const stored = [0xaa, 0xbb];
        const result = readFontCoverage(woff(stored, data.length), {
            inflate: input => {
                expect([...input]).toEqual(stored);
                return new Uint8Array(data);
            },
        });
        expect(result.ok && result.coverage.ranges).toEqual([[0x41, 0x5a]]);
    });

    it("reads a WOFF2 through a real Brotli round trip", () => {
        // The two tables this module wants, plus a transformed `glyf` ahead of them - the case that
        // catches a running offset computed from original rather than stream lengths.
        const glyf = [1, 2, 3, 4, 5, 6, 7];
        const data = cmapFormat4([{ start: 0x41, end: 0x5a, delta: 1 }]);
        const os2Table = os2(4, [17]);
        const stream = brotliCompressSync(Buffer.from([...glyf, ...data, ...os2Table]));

        const directory = [
            // `glyf` is known tag 10, transform version 0 - which for glyf means transformed, so a
            // transformLength follows the original length.
            10 | (0 << 6), ...base128(999), ...base128(glyf.length),
            // `cmap` is known tag 0, `OS/2` is known tag 6; neither has a transform.
            0, ...base128(data.length),
            6, ...base128(os2Table.length),
        ];
        const file = new Uint8Array([
            // 48-byte header: signature, flavor, length, numTables, reserved, totalSfntSize,
            // totalCompressedSize, major/minor, then meta and priv block offsets and lengths.
            ...tag("wOF2"), ...u32(0x00010000), ...u32(0), ...u16(3), ...u16(0),
            ...u32(0), ...u32(stream.length), ...u16(0), ...u16(0),
            ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0),
            ...directory,
            ...stream,
        ]);

        const result = readFontCoverage(file, { brotli: input => brotliDecompressSync(input) });
        expect(result.ok && result.coverage.ranges).toEqual([[0x41, 0x5a]]);
        expect(result.ok && result.coverage.codePages).toEqual([932]);
    });

    /**
     * Not "cannot parse" - the bytes below are a perfectly good collection and reading the first
     * face would be a few lines. It is refused because nothing downstream can render one, and a
     * coverage answer for a font that draws nothing is what would let lint certify tofu.
     */
    it("refuses a collection rather than describing a face nothing can load", () => {
        const header = [...tag("ttcf"), ...u32(0x00010000), ...u32(1), ...u32(16)];
        const inner = sfnt([{ name: "cmap", data: cmapFormat4([{ start: 0x61, end: 0x7a, delta: 1 }]) }], 16);
        expect(readFontCoverage(new Uint8Array([...header, ...inner]))).toEqual({
            ok: false,
            reason: "unrenderable",
        });
    });

    it("refuses a collection wrapped in WOFF2, before decompressing anything", () => {
        const woff2 = new Uint8Array(48);
        woff2.set(tag("wOF2"), 0);
        woff2.set(tag("ttcf"), 4);
        expect(readFontCoverage(woff2, { brotli: () => { throw new Error("must not be reached"); } }))
            .toEqual({ ok: false, reason: "unrenderable" });
    });
});

describe("readFontCoverage / cmap", () => {
    it("reads a format 4 segment whose glyphs come from the delta", () => {
        const coverage = coverageOf(sfnt([
            { name: "cmap", data: cmapFormat4([{ start: 0x41, end: 0x5a, delta: 1 }]) },
        ]));
        expect(coverage.ranges).toEqual([[0x41, 0x5a]]);
        expect(coverage.count).toBe(26);
    });

    it("leaves the holes in a format 4 segment uncovered", () => {
        // "AB_D": the third code point maps to .notdef and must not be reported as drawable.
        const coverage = coverageOf(sfnt([
            { name: "cmap", data: cmapFormat4([{ start: 0x41, end: 0x44, glyphs: [5, 6, 0, 8] }]) },
        ]));
        expect(coverage.ranges).toEqual([[0x41, 0x42], [0x44, 0x44]]);
        expect(coversCodePoint(coverage, 0x43)).toBe(false);
    });

    it("does not report the 0xFFFF terminator segment as coverage", () => {
        const coverage = coverageOf(sfnt([
            { name: "cmap", data: cmapFormat4([{ start: 0x41, end: 0x41, delta: 1 }]) },
        ]));
        expect(coverage.ranges).toEqual([[0x41, 0x41]]);
    });

    it("reads format 12 groups whole, past the BMP", () => {
        const coverage = coverageOf(sfnt([
            {
                name: "cmap",
                data: cmapFormat12([
                    { start: 0x4e00, end: 0x9fff, startGlyph: 1 },
                    { start: 0x20000, end: 0x2a6df, startGlyph: 20000 },
                    // A group beginning at .notdef maps its whole run to nothing.
                    { start: 0xe000, end: 0xe100, startGlyph: 0 },
                ]),
            },
        ]));
        expect(coverage.ranges).toEqual([[0x4e00, 0x9fff], [0x20000, 0x2a6df]]);
        expect(coversCodePoint(coverage, 0x20001)).toBe(true);
        expect(coversCodePoint(coverage, 0xe050)).toBe(false);
    });

    it("reads a format 6 dense run", () => {
        const subtable = [...u16(6), ...u16(14), ...u16(0), ...u16(0x41), ...u16(3), ...u16(7), ...u16(0), ...u16(9)];
        const data = cmap([{ platform: 3, encoding: 1, subtable }]);
        expect(coverageOf(sfnt([{ name: "cmap", data }])).ranges).toEqual([[0x41, 0x41], [0x43, 0x43]]);
    });

    it("skips subtables that are not indexed by Unicode", () => {
        // Platform 1 is Macintosh: its byte values are not code points, so reading the subtable
        // would claim coverage of whatever they collide with.
        const subtable = [...u16(6), ...u16(10), ...u16(0), ...u16(0x41), ...u16(1), ...u16(7)];
        const data = cmap([{ platform: 1, encoding: 0, subtable }]);
        expect(coverageOf(sfnt([{ name: "cmap", data }])).ranges).toEqual([]);
    });

    it("unions two subtables and merges the runs where they meet", () => {
        const data = cmap([
            { platform: 3, encoding: 1, subtable: subtableFormat4([{ start: 0x41, end: 0x5a, delta: 1 }]) },
            { platform: 3, encoding: 10, subtable: subtableFormat12([{ start: 0x5b, end: 0x60, startGlyph: 40 }]) },
        ]);
        expect(coverageOf(sfnt([{ name: "cmap", data }])).ranges).toEqual([[0x41, 0x60]]);
    });
});

describe("readFontCoverage / OS/2", () => {
    it("reads the code pages the vendor declared", () => {
        const coverage = coverageOf(sfnt([
            { name: "cmap", data: cmapFormat4([{ start: 0x41, end: 0x41, delta: 1 }]) },
            { name: "OS/2", data: os2(4, [0, 17]) },
        ]));
        expect(coverage.codePages).toEqual([932, 1252]);
    });

    it("says nothing for an OS/2 too old to carry the field", () => {
        const coverage = coverageOf(sfnt([
            { name: "cmap", data: cmapFormat4([{ start: 0x41, end: 0x41, delta: 1 }]) },
            { name: "OS/2", data: os2(0, [17]) },
        ]));
        expect(coverage.codePages).toEqual([]);
    });

    it("says nothing when there is no OS/2 at all", () => {
        const coverage = coverageOf(sfnt([
            { name: "cmap", data: cmapFormat4([{ start: 0x41, end: 0x41, delta: 1 }]) },
        ]));
        expect(coverage.codePages).toEqual([]);
    });
});

describe("stackCoversCodePoint", () => {
    it("answers for the stack, not for any one font", () => {
        const latin = coverageOf(sfnt([
            { name: "cmap", data: cmapFormat4([{ start: 0x41, end: 0x5a, delta: 1 }]) },
        ]));
        const kanji = coverageOf(sfnt([
            { name: "cmap", data: cmapFormat12([{ start: 0x4e00, end: 0x9fff, startGlyph: 1 }]) },
        ]));
        expect(stackCoversCodePoint([latin, kanji], 0x65e5)).toBe(true);
        expect(stackCoversCodePoint([latin], 0x65e5)).toBe(false);
        expect(stackCoversCodePoint([], 0x41)).toBe(false);
    });
});

describe("coversCodePoint", () => {
    it("finds a code point in the middle of a long range list", () => {
        const ranges = Array.from({ length: 200 }, (_, i) => [i * 10, i * 10 + 4] as const);
        const coverage: FontCoverage = { ranges, count: 1000, codePages: [] };
        expect(coversCodePoint(coverage, 1002)).toBe(true);
        expect(coversCodePoint(coverage, 1007)).toBe(false);
        expect(coversCodePoint(coverage, -1)).toBe(false);
        expect(coversCodePoint(coverage, 99999)).toBe(false);
    });
});
