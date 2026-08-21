/**
 * What a font file can actually draw.
 *
 * A font stack is a priority list and the browser resolves it **per character** - so the question
 * that decides whether a line renders or shows tofu is not "which font did the author pick" but
 * "does any font in the list carry this glyph". Nothing in Studio could answer that before this
 * module: `FontAssetMetadata` reports family, style, weight, format and size, none of which say
 * anything about coverage.
 *
 * The answer comes out of the font's own `cmap` table, which is the map from Unicode code point to
 * glyph index that the rasteriser itself uses. A code point the `cmap` sends to glyph 0 is the one
 * that draws a box, so "covered" here means exactly "maps to a glyph that is not `.notdef`".
 *
 * ## Why the vendor's code pages are read as well
 *
 * `cmap` coverage cannot tell Japanese from Simplified Chinese. Han unification gives the two the
 * same code points with different **glyphs**, so a Japanese face and a Simplified Chinese face of
 * the same superfamily have near-identical coverage and picking between them from `cmap` alone is
 * a coin toss. What does distinguish them is `OS/2.ulCodePageRange1`, where the vendor states which
 * legacy code pages the font was drawn for - 932 for JIS, 936 for GBK, 950 for Big5, 949 for
 * Wansung. That is a declaration of intent rather than an inference, which is why it is what
 * `@shared/typography/localeScripts` suggests a language from.
 *
 * ## Ports rather than imports
 *
 * Two container formats are compressed and neither decompressor exists in every host this code runs
 * in: WOFF wraps each table in zlib, WOFF2 wraps the whole file in Brotli, and a renderer has
 * `DecompressionStream("deflate")` but no Brotli at all. So the decompressors arrive as a parameter
 * and the caller supplies whatever its host has - the main process passes `zlib`'s, which is why
 * the probe that answers this question lives there. A container whose decompressor was not supplied
 * answers `needs-decompressor`, never a guess and never an empty coverage: reporting "this font
 * covers nothing" for a file nobody could read would put a false glyph warning on every line of the
 * script.
 *
 * Comments in English per project convention.
 */

/** An inclusive run of code points, `[first, last]`. */
export type CodePointRange = readonly [start: number, end: number];

export type FontCoverage = {
    /** Sorted by `start`, non-overlapping, non-adjacent. */
    readonly ranges: readonly CodePointRange[];
    /** How many code points the ranges hold, together. */
    readonly count: number;
    /**
     * The legacy code pages `OS/2` says this font was drawn for, as their numbers (932, 936, 950,
     * 949, 1252 ...). Empty when the table is absent, too old to carry the field, or says nothing -
     * which is common and is not a failure.
     */
    readonly codePages: readonly number[];
};

/** Why a file produced no coverage. Each arm is a state the caller must not spend as "covers nothing". */
export type FontCoverageFailureReason =
    /** The magic bytes are not a font this module knows. */
    | "not-a-font"
    /** A font without a `cmap` maps no Unicode at all - a bare-CFF or symbol-only file. */
    | "no-cmap"
    /** Structurally a font, but a table offset or length points outside the file. */
    | "malformed"
    /** WOFF or WOFF2, and the host did not supply the decompressor that container needs. */
    | "needs-decompressor"
    /**
     * A TrueType/OpenType **collection**, which nothing in Studio can render.
     *
     * Parsing one is easy and the answer would be worthless: `FontFace` takes one file to mean one
     * typeface and rejects a collection, so a `.ttc` on the project's stack draws nothing at all.
     * Reporting coverage for it would be the one lie this module must not tell - it would let
     * `typography` lint certify text that renders as boxes. Import refuses these
     * (`FileFormatValidator`); this arm is what a library that took one in before that did answers.
     */
    | "unloadable-container";

export type FontCoverageResult =
    | { ok: true; coverage: FontCoverage }
    | { ok: false; reason: FontCoverageFailureReason };

/**
 * The decompressors a host can lend this module.
 *
 * Both are synchronous and both may throw - a corrupt stream is reported as `malformed` rather than
 * escaping, because this is called once per font in a lint sweep that must finish.
 */
export type FontDecompressors = {
    /** zlib (RFC 1950), for WOFF's per-table compression. */
    inflate?: (bytes: Uint8Array) => Uint8Array;
    /** Brotli (RFC 7932), for WOFF2's single whole-file stream. */
    brotli?: (bytes: Uint8Array) => Uint8Array;
};

/** A coverage that draws nothing. Distinct from a failure: this is a real font with an empty `cmap`. */
export const EMPTY_FONT_COVERAGE: FontCoverage = { ranges: [], count: 0, codePages: [] };

/**
 * Read the code points a font can draw, and the code pages it declares.
 *
 * Accepts bare sfnt (`.ttf` / `.otf`), WOFF and WOFF2. A collection is refused rather than read -
 * see {@link FontCoverageFailureReason}.
 */
export function readFontCoverage(bytes: Uint8Array, decompress: FontDecompressors = {}): FontCoverageResult {
    let tables: TableSet;
    try {
        const opened = openFont(bytes, decompress);
        if (!opened.ok) {
            return opened;
        }
        tables = opened.tables;
    } catch {
        // Every parse below is bounds-checked, so a throw here is a decompressor rejecting the
        // stream. Both mean the same thing to the caller: these bytes did not describe a font.
        return { ok: false, reason: "malformed" };
    }

    const cmap = tables.get("cmap");
    if (!cmap) {
        return { ok: false, reason: "no-cmap" };
    }

    let ranges: CodePointRange[];
    try {
        ranges = readCmapRanges(cmap);
    } catch {
        return { ok: false, reason: "malformed" };
    }

    const merged = mergeRanges(ranges);
    return {
        ok: true,
        coverage: {
            ranges: merged,
            count: merged.reduce((total, [start, end]) => total + (end - start + 1), 0),
            codePages: readCodePages(tables.get("OS/2")),
        },
    };
}

/** Whether the font draws this code point. Binary search - the range list of a CJK face is long. */
export function coversCodePoint(coverage: FontCoverage, codePoint: number): boolean {
    const { ranges } = coverage;
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const [start, end] = ranges[mid]!;
        if (codePoint < start) {
            high = mid - 1;
        } else if (codePoint > end) {
            low = mid + 1;
        } else {
            return true;
        }
    }
    return false;
}

/** Whether any font in a stack draws this code point. The question a font stack actually answers. */
export function stackCoversCodePoint(coverages: readonly FontCoverage[], codePoint: number): boolean {
    return coverages.some(coverage => coversCodePoint(coverage, codePoint));
}

// ---------------------------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------------------------

/** The tables this module cares about, already decompressed, keyed by their four-character tag. */
type TableSet = Map<string, Uint8Array>;

type OpenResult =
    | { ok: true; tables: TableSet }
    | { ok: false; reason: FontCoverageFailureReason };

/** Only these are ever extracted. A font is tens of megabytes and all of it but two tables is outlines. */
const WANTED_TABLES: readonly string[] = ["cmap", "OS/2"];

function openFont(bytes: Uint8Array, decompress: FontDecompressors): OpenResult {
    const tag = ascii(bytes, 0, 4);
    if (tag === "wOFF") {
        return openWoff(bytes, decompress);
    }
    if (tag === "wOF2") {
        return openWoff2(bytes, decompress);
    }
    if (tag === "ttcf") {
        return { ok: false, reason: "unloadable-container" };
    }
    if (tag === "OTTO" || tag === "true" || tag === "typ1" || (bytes.length >= 4 && u32(bytes, 0) === 0x00010000)) {
        return openSfnt(bytes, 0);
    }
    return { ok: false, reason: "not-a-font" };
}

/** A plain sfnt: a table directory of 16-byte records pointing into the same buffer. */
function openSfnt(bytes: Uint8Array, offsetTable: number): OpenResult {
    if (offsetTable + 12 > bytes.length) {
        return { ok: false, reason: "malformed" };
    }
    const numTables = u16(bytes, offsetTable + 4);
    const tables: TableSet = new Map();
    for (let i = 0; i < numTables; i += 1) {
        const record = offsetTable + 12 + i * 16;
        if (record + 16 > bytes.length) {
            return { ok: false, reason: "malformed" };
        }
        const name = ascii(bytes, record, 4);
        if (!WANTED_TABLES.includes(name)) {
            continue;
        }
        const start = u32(bytes, record + 8);
        const length = u32(bytes, record + 12);
        if (start + length > bytes.length) {
            return { ok: false, reason: "malformed" };
        }
        tables.set(name, bytes.subarray(start, start + length));
    }
    return { ok: true, tables };
}

/**
 * WOFF: an sfnt whose tables were each zlib-compressed and re-laid-out.
 *
 * `compLength === origLength` is the spec's way of saying a table was stored uncompressed, which is
 * what happens to tables that would have grown - and to very small ones, which `cmap` never is but
 * `OS/2` (86 bytes) frequently is.
 */
function openWoff(bytes: Uint8Array, decompress: FontDecompressors): OpenResult {
    if (bytes.length < 44) {
        return { ok: false, reason: "malformed" };
    }
    const numTables = u16(bytes, 12);
    const tables: TableSet = new Map();
    for (let i = 0; i < numTables; i += 1) {
        const record = 44 + i * 20;
        if (record + 20 > bytes.length) {
            return { ok: false, reason: "malformed" };
        }
        const name = ascii(bytes, record, 4);
        if (!WANTED_TABLES.includes(name)) {
            continue;
        }
        const offset = u32(bytes, record + 4);
        const compLength = u32(bytes, record + 8);
        const origLength = u32(bytes, record + 12);
        if (offset + compLength > bytes.length) {
            return { ok: false, reason: "malformed" };
        }
        const stored = bytes.subarray(offset, offset + compLength);
        if (compLength >= origLength) {
            tables.set(name, stored);
            continue;
        }
        if (!decompress.inflate) {
            return { ok: false, reason: "needs-decompressor" };
        }
        tables.set(name, decompress.inflate(stored));
    }
    return { ok: true, tables };
}

/**
 * The 63 table tags WOFF2 can name by a five-bit index instead of spelling out. Order is the spec's
 * and is not alphabetical; index 63 is the escape that means "a four-character tag follows".
 */
const WOFF2_KNOWN_TAGS: readonly string[] = [
    "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
    "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
    "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
    "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
    "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
    "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
    "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
    "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

/**
 * WOFF2: one Brotli stream holding every table end to end, described by a variable-length directory.
 *
 * The directory gives each table's length *in the stream*, which is not its original length when the
 * table was transformed. Only `glyf`, `loca` and `hmtx` have transforms, so neither table this module
 * wants is ever transformed - but the running offset still has to be computed from the stream
 * lengths of **every** table, transformed ones included, or `cmap` is read from the wrong place.
 */
function openWoff2(bytes: Uint8Array, decompress: FontDecompressors): OpenResult {
    if (bytes.length < 48) {
        return { ok: false, reason: "malformed" };
    }
    if (!decompress.brotli) {
        return { ok: false, reason: "needs-decompressor" };
    }
    // Wrapping a collection in WOFF2 does not make it loadable; refused before the stream is even
    // decompressed, for the reason a bare `ttcf` is.
    if (ascii(bytes, 4, 4) === "ttcf") {
        return { ok: false, reason: "unloadable-container" };
    }
    const numTables = u16(bytes, 12);
    const totalCompressedSize = u32(bytes, 20);

    let cursor = 48;
    const entries: { name: string; offset: number; length: number }[] = [];
    let streamOffset = 0;
    for (let i = 0; i < numTables; i += 1) {
        if (cursor >= bytes.length) {
            return { ok: false, reason: "malformed" };
        }
        const flags = bytes[cursor]!;
        cursor += 1;
        const known = flags & 0x3f;
        let name: string;
        if (known === 0x3f) {
            if (cursor + 4 > bytes.length) {
                return { ok: false, reason: "malformed" };
            }
            name = ascii(bytes, cursor, 4);
            cursor += 4;
        } else {
            name = WOFF2_KNOWN_TAGS[known] ?? "";
        }
        const origLength = readUIntBase128(bytes, cursor);
        if (!origLength) {
            return { ok: false, reason: "malformed" };
        }
        cursor = origLength.next;

        // `glyf` and `loca` invert the convention: for them version 0 is the transform and version 3
        // is the null one, while every other table is transformed only when the version is non-zero.
        const version = (flags >> 6) & 0x03;
        const transformed = name === "glyf" || name === "loca" ? version === 0 : version !== 0;
        let length = origLength.value;
        if (transformed) {
            const transformLength = readUIntBase128(bytes, cursor);
            if (!transformLength) {
                return { ok: false, reason: "malformed" };
            }
            cursor = transformLength.next;
            length = transformLength.value;
        }
        entries.push({ name, offset: streamOffset, length });
        streamOffset += length;
    }

    if (cursor + totalCompressedSize > bytes.length) {
        return { ok: false, reason: "malformed" };
    }
    const stream = decompress.brotli(bytes.subarray(cursor, cursor + totalCompressedSize));

    const tables: TableSet = new Map();
    for (const entry of entries) {
        if (!WANTED_TABLES.includes(entry.name)) {
            continue;
        }
        if (entry.offset + entry.length > stream.length) {
            return { ok: false, reason: "malformed" };
        }
        tables.set(entry.name, stream.subarray(entry.offset, entry.offset + entry.length));
    }
    return { ok: true, tables };
}

// ---------------------------------------------------------------------------------------------
// cmap
// ---------------------------------------------------------------------------------------------

/**
 * Every Unicode subtable, unioned.
 *
 * Unioned rather than "pick the best one" because the question is what the font can draw at all, and
 * a face that carries both a format 4 BMP subtable and a format 12 full-repertoire one draws the
 * union of them. Choosing one would under-report by whatever the other adds, and under-reporting is
 * the direction that invents warnings about text that renders perfectly.
 *
 * Macintosh (platform 1) and Windows Symbol (3, 0) subtables are skipped: neither is indexed by
 * Unicode, so reading them as if they were would claim coverage of whatever code points their
 * byte values happen to collide with.
 */
function readCmapRanges(cmap: Uint8Array): CodePointRange[] {
    if (cmap.length < 4) {
        return [];
    }
    const numTables = u16(cmap, 2);
    const ranges: CodePointRange[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < numTables; i += 1) {
        const record = 4 + i * 8;
        if (record + 8 > cmap.length) {
            break;
        }
        const platform = u16(cmap, record);
        const encoding = u16(cmap, record + 2);
        const offset = u32(cmap, record + 4);
        const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
        if (!unicode || offset + 4 > cmap.length || seen.has(offset)) {
            continue;
        }
        seen.add(offset);
        readCmapSubtable(cmap, offset, ranges);
    }
    return ranges;
}

function readCmapSubtable(cmap: Uint8Array, offset: number, out: CodePointRange[]): void {
    switch (u16(cmap, offset)) {
        case 0:
            readCmapFormat0(cmap, offset, out);
            return;
        case 4:
            readCmapFormat4(cmap, offset, out);
            return;
        case 6:
            readCmapFormat6(cmap, offset, out);
            return;
        // 13 is "many code points to one glyph" - a last-resort font. Its group layout is byte for
        // byte format 12's, and coverage is the same question for both.
        case 12:
        case 13:
            readCmapFormat12(cmap, offset, out);
            return;
        default:
            // Formats 2 (high-byte mapping for legacy CJK encodings) and 14 (variation sequences)
            // are deliberately not read: neither maps Unicode code points to glyphs on its own.
            return;
    }
}

/** Format 0: a 256-entry byte array indexed by the code point itself. */
function readCmapFormat0(cmap: Uint8Array, offset: number, out: CodePointRange[]): void {
    const glyphs = offset + 6;
    if (glyphs + 256 > cmap.length) {
        return;
    }
    collectRuns(0, 255, code => cmap[glyphs + code] !== 0, out);
}

/**
 * Format 4: segmented BMP coverage, the subtable nearly every font has.
 *
 * A segment is not simply "covered from start to end": when `idRangeOffset` is non-zero the segment
 * indexes into `glyphIdArray`, and an entry there may be 0, which is a hole. Fonts use exactly that
 * to cover a scattered set of code points with one segment, so treating a segment as solid would
 * claim glyphs the font does not have.
 */
function readCmapFormat4(cmap: Uint8Array, offset: number, out: CodePointRange[]): void {
    const segCountX2 = u16(cmap, offset + 6);
    const segCount = segCountX2 >> 1;
    const endCodes = offset + 14;
    const startCodes = endCodes + segCountX2 + 2; // + reservedPad
    const idDeltas = startCodes + segCountX2;
    const idRangeOffsets = idDeltas + segCountX2;
    if (idRangeOffsets + segCountX2 > cmap.length) {
        return;
    }

    for (let seg = 0; seg < segCount; seg += 1) {
        const end = u16(cmap, endCodes + seg * 2);
        const start = u16(cmap, startCodes + seg * 2);
        if (start > end) {
            continue;
        }
        // The final segment is the spec-mandated 0xFFFF..0xFFFF terminator and maps nothing.
        if (start === 0xffff) {
            continue;
        }
        const delta = u16(cmap, idDeltas + seg * 2);
        const rangeOffsetAt = idRangeOffsets + seg * 2;
        const rangeOffset = u16(cmap, rangeOffsetAt);
        if (rangeOffset === 0) {
            collectRuns(start, end, code => ((code + delta) & 0xffff) !== 0, out);
            continue;
        }
        collectRuns(start, end, code => {
            const at = rangeOffsetAt + rangeOffset + (code - start) * 2;
            if (at + 2 > cmap.length) {
                return false;
            }
            return u16(cmap, at) !== 0;
        }, out);
    }
}

/** Format 6: a dense run of glyph ids starting at one code point. */
function readCmapFormat6(cmap: Uint8Array, offset: number, out: CodePointRange[]): void {
    const first = u16(cmap, offset + 6);
    const count = u16(cmap, offset + 8);
    const glyphs = offset + 10;
    if (glyphs + count * 2 > cmap.length) {
        return;
    }
    collectRuns(first, first + count - 1, code => u16(cmap, glyphs + (code - first) * 2) !== 0, out);
}

/**
 * Format 12: groups of contiguous code points, the only subtable that reaches past the BMP.
 *
 * Groups are taken whole rather than walked code point by code point - a full-repertoire CJK font
 * has groups tens of thousands of code points wide and they are contiguous by construction.
 */
function readCmapFormat12(cmap: Uint8Array, offset: number, out: CodePointRange[]): void {
    const numGroups = u32(cmap, offset + 12);
    const groups = offset + 16;
    for (let i = 0; i < numGroups; i += 1) {
        const record = groups + i * 12;
        if (record + 12 > cmap.length) {
            return;
        }
        const start = u32(cmap, record);
        const end = u32(cmap, record + 4);
        const startGlyph = u32(cmap, record + 8);
        // A group whose glyphs begin at `.notdef` maps the whole run to nothing.
        if (startGlyph === 0 || start > end || end > 0x10ffff) {
            continue;
        }
        out.push([start, end]);
    }
}

/** Walk `[from, to]` and push each maximal run the predicate accepts. */
function collectRuns(
    from: number,
    to: number,
    covered: (code: number) => boolean,
    out: CodePointRange[],
): void {
    let runStart = -1;
    for (let code = from; code <= to; code += 1) {
        if (covered(code)) {
            if (runStart < 0) {
                runStart = code;
            }
        } else if (runStart >= 0) {
            out.push([runStart, code - 1]);
            runStart = -1;
        }
    }
    if (runStart >= 0) {
        out.push([runStart, to]);
    }
}

/** Sort, then fold overlapping and adjacent runs together so the binary search has one entry per run. */
function mergeRanges(ranges: CodePointRange[]): CodePointRange[] {
    if (ranges.length === 0) {
        return [];
    }
    const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: CodePointRange[] = [];
    let [start, end] = sorted[0]!;
    for (let i = 1; i < sorted.length; i += 1) {
        const [nextStart, nextEnd] = sorted[i]!;
        if (nextStart <= end + 1) {
            end = Math.max(end, nextEnd);
        } else {
            merged.push([start, end]);
            [start, end] = [nextStart, nextEnd];
        }
    }
    merged.push([start, end]);
    return merged;
}

// ---------------------------------------------------------------------------------------------
// OS/2
// ---------------------------------------------------------------------------------------------

/**
 * `ulCodePageRange1` bit -> the code page it stands for.
 *
 * Only the first word is read, and only the bits that name a writing system. The second word is
 * historical IBM code pages, and bits 29-31 of the first (Macintosh, OEM, Symbol) say nothing about
 * a language.
 */
const CODE_PAGE_BITS: Readonly<Record<number, number>> = {
    0: 1252, // Latin 1
    1: 1250, // Latin 2, Central European
    2: 1251, // Cyrillic
    3: 1253, // Greek
    4: 1254, // Turkish
    5: 1255, // Hebrew
    6: 1256, // Arabic
    7: 1257, // Baltic
    8: 1258, // Vietnamese
    16: 874, // Thai
    17: 932, // JIS / Japan
    18: 936, // Simplified Chinese, GBK
    19: 949, // Korean, Wansung
    20: 950, // Traditional Chinese, Big5
    21: 1361, // Korean, Johab
};

/**
 * The code pages the vendor declared, or nothing.
 *
 * The field arrived in `OS/2` version 1, so a version 0 table has no opinion - and neither does a
 * font whose vendor left the word zero, which is common in display faces. Both answer empty, and an
 * empty answer must be read as "did not say" rather than "said no".
 */
function readCodePages(os2: Uint8Array | undefined): number[] {
    if (!os2 || os2.length < 86 || u16(os2, 0) < 1) {
        return [];
    }
    const word = u32(os2, 78);
    const pages: number[] = [];
    for (const [bit, page] of Object.entries(CODE_PAGE_BITS)) {
        if (word & (1 << Number(bit))) {
            pages.push(page);
        }
    }
    return pages.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

function u16(bytes: Uint8Array, at: number): number {
    return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u32(bytes: Uint8Array, at: number): number {
    return (
        ((bytes[at] ?? 0) * 0x1000000)
        + ((bytes[at + 1] ?? 0) << 16)
        + ((bytes[at + 2] ?? 0) << 8)
        + (bytes[at + 3] ?? 0)
    );
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
    if (at + length > bytes.length) {
        return "";
    }
    let out = "";
    for (let i = 0; i < length; i += 1) {
        out += String.fromCharCode(bytes[at + i]!);
    }
    return out;
}

/**
 * WOFF2's UIntBase128: seven bits per byte, high bit set on every byte but the last.
 *
 * Null for the three encodings the spec rejects outright - a leading zero byte, more than five
 * bytes, or a value past 2^32 - because each of them is a way to write the same number two ways,
 * and a directory that used one is not a directory this should keep reading.
 */
function readUIntBase128(bytes: Uint8Array, at: number): { value: number; next: number } | null {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
        const byte = bytes[at + i];
        if (byte === undefined) {
            return null;
        }
        if (i === 0 && byte === 0x80) {
            return null;
        }
        if (value > 0x01ffffff) {
            return null;
        }
        value = value * 128 + (byte & 0x7f);
        if ((byte & 0x80) === 0) {
            return { value, next: at + i + 1 };
        }
    }
    return null;
}

