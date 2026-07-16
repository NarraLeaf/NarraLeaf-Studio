import { describe, expect, it } from "vitest";
import { parseBinaryManifest, patchBinaryManifest } from "./axml";

/**
 * The fixtures are built by a hand-written encoder below (the parser's
 * mirror, independent of the production code) so these tests hold even if
 * the patcher's own pool builder regressed. Golden tests against the real
 * shell template land with the @narraleaf/studio-shell devDependency (S4).
 */

const NO_ENTRY = 0xffffffff;
const ANDROID_NS = "http://schemas.android.com/apk/res/android";

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;

type FixtureOptions = {
    utf8?: boolean;
    packageName?: string;
    versionCode?: number;
    versionName?: string;
    label?: string;
    /** Emit android:label as a resource reference instead of a literal. */
    labelAsReference?: boolean;
};

function encodeString(value: string, utf8: boolean): Buffer {
    if (utf8) {
        const bytes = Buffer.from(value, "utf8");
        const lengths: number[] = [];
        for (const length of [value.length, bytes.length]) {
            if (length > 0x7f) {
                lengths.push(((length >> 8) & 0x7f) | 0x80, length & 0xff);
            } else {
                lengths.push(length);
            }
        }
        return Buffer.concat([Buffer.from(lengths), bytes, Buffer.from([0])]);
    }
    const header = Buffer.alloc(2);
    header.writeUInt16LE(value.length, 0);
    return Buffer.concat([header, Buffer.from(value, "utf16le"), Buffer.from([0, 0])]);
}

function chunk(type: number, headerSize: number, body: Buffer, headerExtra?: Buffer): Buffer {
    const head = Buffer.alloc(8);
    head.writeUInt16LE(type, 0);
    head.writeUInt16LE(headerSize, 2);
    head.writeUInt32LE(8 + (headerExtra?.length ?? 0) + body.length, 4);
    return Buffer.concat([head, ...(headerExtra ? [headerExtra] : []), body]);
}

function buildPool(strings: string[], utf8: boolean): Buffer {
    const encoded = strings.map(value => encodeString(value, utf8));
    const offsets = Buffer.alloc(strings.length * 4);
    let cursor = 0;
    encoded.forEach((piece, index) => {
        offsets.writeUInt32LE(cursor, index * 4);
        cursor += piece.length;
    });
    let data = Buffer.concat(encoded);
    const padding = (4 - (data.length % 4)) % 4;
    if (padding) {
        data = Buffer.concat([data, Buffer.alloc(padding)]);
    }
    const headerExtra = Buffer.alloc(20);
    headerExtra.writeUInt32LE(strings.length, 0);
    headerExtra.writeUInt32LE(0, 4);
    headerExtra.writeUInt32LE(utf8 ? 0x100 : 0, 8);
    headerExtra.writeUInt32LE(28 + offsets.length, 12);
    headerExtra.writeUInt32LE(0, 16);
    return chunk(0x0001, 28, Buffer.concat([offsets, data]), headerExtra);
}

type Attr = { ns: number; name: number; rawValue: number; dataType: number; data: number };

function startElement(nameIndex: number, attrs: Attr[]): Buffer {
    const body = Buffer.alloc(8 + 20 + attrs.length * 20);
    body.writeUInt32LE(1, 0);
    body.writeUInt32LE(NO_ENTRY, 4);
    body.writeUInt32LE(NO_ENTRY, 8);
    body.writeUInt32LE(nameIndex, 12);
    body.writeUInt16LE(20, 16);
    body.writeUInt16LE(20, 18);
    body.writeUInt16LE(attrs.length, 20);
    attrs.forEach((attr, index) => {
        const at = 28 + index * 20;
        body.writeUInt32LE(attr.ns, at);
        body.writeUInt32LE(attr.name, at + 4);
        body.writeUInt32LE(attr.rawValue, at + 8);
        body.writeUInt16LE(8, at + 12);
        body.writeUInt8(0, at + 14);
        body.writeUInt8(attr.dataType, at + 15);
        body.writeUInt32LE(attr.data, at + 16);
    });
    const head = Buffer.alloc(8);
    head.writeUInt16LE(0x0102, 0);
    head.writeUInt16LE(16, 2);
    head.writeUInt32LE(8 + body.length, 4);
    return Buffer.concat([head, body]);
}

const UNKNOWN_CHUNK_PAYLOAD = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x13, 0x37, 0x42, 0x24]);

/**
 * Independent structural validation of the emitted string pool — deliberately
 * NOT the module's own parser, whose symmetric bugs would otherwise vanish in
 * round-trips (a mutation probe showed dropped NUL terminators keep every
 * round-trip test green while Android's ResStringPool rejects the manifest at
 * install). Checks what AOSP validates: alignment, offset bounds, terminators.
 */
function validatePoolStructure(data: Buffer): void {
    // The pool is the first chunk after the file header.
    const poolStart = data.readUInt16LE(2);
    expect(data.readUInt16LE(poolStart)).toBe(0x0001);
    const headerSize = data.readUInt16LE(poolStart + 2);
    const size = data.readUInt32LE(poolStart + 4);
    expect(size % 4).toBe(0);
    expect(poolStart + size).toBeLessThanOrEqual(data.length);
    const stringCount = data.readUInt32LE(poolStart + 8);
    const styleCount = data.readUInt32LE(poolStart + 12);
    const utf8 = (data.readUInt32LE(poolStart + 16) & 0x100) !== 0;
    const stringsStart = data.readUInt32LE(poolStart + 20);
    expect(stringsStart).toBe(headerSize + 4 * (stringCount + styleCount));

    const dataEnd = poolStart + size;
    for (let i = 0; i < stringCount; i++) {
        const offset = poolStart + stringsStart + data.readUInt32LE(poolStart + headerSize + i * 4);
        expect(offset).toBeGreaterThanOrEqual(poolStart + stringsStart);
        if (utf8) {
            let cursor = offset;
            cursor += data.readUInt8(cursor) & 0x80 ? 2 : 1;
            let byteLength = data.readUInt8(cursor);
            if (byteLength & 0x80) {
                byteLength = ((byteLength & 0x7f) << 8) | data.readUInt8(cursor + 1);
                cursor += 2;
            } else {
                cursor += 1;
            }
            expect(cursor + byteLength).toBeLessThan(dataEnd);
            expect(data.readUInt8(cursor + byteLength)).toBe(0);
        } else {
            let cursor = offset;
            let length = data.readUInt16LE(cursor);
            cursor += 2;
            if (length & 0x8000) {
                length = ((length & 0x7fff) << 16) | data.readUInt16LE(cursor);
                cursor += 2;
            }
            expect(cursor + length * 2 + 2).toBeLessThanOrEqual(dataEnd);
            expect(data.readUInt16LE(cursor + length * 2)).toBe(0);
        }
    }
}

function buildTestManifest(options: FixtureOptions = {}): Buffer {
    const utf8 = options.utf8 ?? false;
    const packageName = options.packageName ?? "com.narraleaf.shell.placeholder";
    const strings = [
        "versionCode",                    // 0 → 0x0101021b
        "versionName",                    // 1 → 0x0101021c
        "label",                          // 2 → 0x01010001
        ANDROID_NS,                       // 3
        "package",                        // 4
        "manifest",                       // 5
        "application",                    // 6
        packageName,                      // 7
        options.versionName ?? "0.0.0",   // 8
        options.label ?? "NarraLeaf Shell", // 9
        `${packageName}.provider`,        // 10 (authority-shaped derived string)
        // 11: a >127-byte derived string, so the two-byte varint length
        // encoding is exercised on both the parse and re-encode sides.
        `${packageName}.${"deeply.nested.".repeat(8)}provider${"x".repeat(64)}`,
    ];
    const pool = buildPool(strings, utf8);

    const resourceIds = Buffer.alloc(12);
    resourceIds.writeUInt32LE(0x0101021b, 0);
    resourceIds.writeUInt32LE(0x0101021c, 4);
    resourceIds.writeUInt32LE(0x01010001, 8);
    const resourceMap = chunk(0x0180, 8, resourceIds);

    const manifestElement = startElement(5, [
        { ns: NO_ENTRY, name: 4, rawValue: 7, dataType: TYPE_STRING, data: 7 },
        { ns: 3, name: 0, rawValue: NO_ENTRY, dataType: TYPE_INT_DEC, data: options.versionCode ?? 1 },
        { ns: 3, name: 1, rawValue: 8, dataType: TYPE_STRING, data: 8 },
    ]);
    const applicationElement = startElement(6, [
        options.labelAsReference
            ? { ns: 3, name: 2, rawValue: NO_ENTRY, dataType: TYPE_REFERENCE, data: 0x7f010001 }
            : { ns: 3, name: 2, rawValue: 9, dataType: TYPE_STRING, data: 9 },
    ]);
    const unknownChunk = chunk(0x7f77, 8, UNKNOWN_CHUNK_PAYLOAD);

    const body = Buffer.concat([pool, resourceMap, manifestElement, applicationElement, unknownChunk]);
    const head = Buffer.alloc(8);
    head.writeUInt16LE(0x0003, 0);
    head.writeUInt16LE(8, 2);
    head.writeUInt32LE(8 + body.length, 4);
    return Buffer.concat([head, body]);
}

const FULL_PATCH = {
    packageName: "com.acme.mygame",
    label: "My Game",
    versionCode: 1_002_003,
    versionName: "1.2.3",
};

describe("parseBinaryManifest", () => {
    it("reads the identity attributes from the fixture", () => {
        const manifest = buildTestManifest({ versionCode: 7 });
        expect(parseBinaryManifest(manifest)).toEqual({
            packageName: "com.narraleaf.shell.placeholder",
            versionCode: 7,
            versionName: "0.0.0",
            label: "NarraLeaf Shell",
        });
    });

    it("rejects non-AXML input", () => {
        expect(() => parseBinaryManifest(Buffer.from("not axml at all"))).toThrow();
    });
});

describe("patchBinaryManifest", () => {
    for (const utf8 of [false, true]) {
        const poolKind = utf8 ? "UTF-8" : "UTF-16";
        it(`rewrites the identity in a ${poolKind} pool and reads it back`, () => {
            const { data, previous } = patchBinaryManifest(buildTestManifest({ utf8 }), FULL_PATCH);
            expect(previous.packageName).toBe("com.narraleaf.shell.placeholder");
            expect(parseBinaryManifest(data)).toEqual({
                packageName: "com.acme.mygame",
                versionCode: 1_002_003,
                versionName: "1.2.3",
                label: "My Game",
            });
            validatePoolStructure(data);
        });
    }

    it("renames dotted-prefix derived strings (provider authorities)", () => {
        const { data } = patchBinaryManifest(buildTestManifest(), FULL_PATCH);
        // The authority string index is not part of the identity read-back;
        // assert on the encoded bytes instead.
        expect(data.includes(Buffer.from("com.acme.mygame.provider", "utf16le"))).toBe(true);
        expect(data.includes(Buffer.from("com.narraleaf.shell.placeholder", "utf16le"))).toBe(false);
    });

    it("passes unknown chunks through byte-identically", () => {
        const { data } = patchBinaryManifest(buildTestManifest(), FULL_PATCH);
        expect(data.includes(UNKNOWN_CHUNK_PAYLOAD)).toBe(true);
    });

    it("is idempotent", () => {
        const once = patchBinaryManifest(buildTestManifest(), FULL_PATCH).data;
        const twice = patchBinaryManifest(once, FULL_PATCH).data;
        expect(twice.equals(once)).toBe(true);
    });

    for (const utf8 of [false, true]) {
        const poolKind = utf8 ? "UTF-8" : "UTF-16";
        it(`keeps the versionCode slot correct when a ${poolKind} pool grows and shrinks`, () => {
            const longer = patchBinaryManifest(buildTestManifest({ utf8 }), {
                ...FULL_PATCH,
                packageName: "com.a-very-long-organization-name.an-even-longer-game-identifier",
                // >127 chars, forcing the long length encoding on the write side.
                label: `My Game — ${"subtitle ".repeat(18)}`,
            });
            expect(parseBinaryManifest(longer.data).versionCode).toBe(1_002_003);
            validatePoolStructure(longer.data);
            const shorter = patchBinaryManifest(buildTestManifest({ utf8 }), { ...FULL_PATCH, packageName: "a.b" });
            expect(parseBinaryManifest(shorter.data).versionCode).toBe(1_002_003);
            validatePoolStructure(shorter.data);
        });
    }

    it("patches a subset of fields, leaving the rest untouched", () => {
        const { data } = patchBinaryManifest(buildTestManifest({ versionCode: 9 }), { versionCode: 42 });
        expect(parseBinaryManifest(data)).toEqual({
            packageName: "com.narraleaf.shell.placeholder",
            versionCode: 42,
            versionName: "0.0.0",
            label: "NarraLeaf Shell",
        });
    });

    it("refuses to patch a label that is a resource reference (template contract)", () => {
        const manifest = buildTestManifest({ labelAsReference: true });
        expect(() => patchBinaryManifest(manifest, { label: "My Game" }))
            .toThrow(/literal string/);
    });
});
