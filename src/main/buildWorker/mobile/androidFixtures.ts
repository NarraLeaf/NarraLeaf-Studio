/**
 * Builders for synthetic Android binary fixtures - a minimal binary
 * AndroidManifest.xml and resources.arsc - used by the repack tests.
 *
 * Deliberately hand-encoded rather than produced by the patchers under test:
 * a fixture built with the production encoder would hide any symmetric
 * encoder/decoder bug (a mutation probe proved exactly that during review).
 * Only tests import this; it never reaches the shipped bundle.
 *
 * These are the *shape* aapt2 emits, not full fidelity: enough chunks for the
 * patchers to locate and rewrite the identity. The real-template golden tests
 * arrive with the @narraleaf/studio-shell dependency (S4).
 */

const NO_ENTRY = 0xffffffff;
const ANDROID_NS = "http://schemas.android.com/apk/res/android";

const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;

function encodePoolString(value: string, utf8: boolean): Buffer {
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
    const encoded = strings.map(value => encodePoolString(value, utf8));
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

export type BinaryManifestFixtureOptions = {
    utf8?: boolean;
    packageName?: string;
    label?: string;
    versionCode?: number;
    versionName?: string;
};

/** A minimal binary AndroidManifest.xml carrying the placeholder identity. */
export function buildBinaryManifestFixture(options: BinaryManifestFixtureOptions = {}): Buffer {
    const utf8 = options.utf8 ?? false;
    const packageName = options.packageName ?? "com.narraleaf.shell.placeholder";
    const strings = [
        "versionCode",                      // 0 → 0x0101021b
        "versionName",                      // 1 → 0x0101021c
        "label",                            // 2 → 0x01010001
        ANDROID_NS,                         // 3
        "package",                          // 4
        "manifest",                         // 5
        "application",                      // 6
        packageName,                        // 7
        options.versionName ?? "0.0.0",     // 8
        options.label ?? "NarraLeaf Shell", // 9
        `${packageName}.provider`,          // 10 - authority-shaped derived string
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
        { ns: 3, name: 2, rawValue: 9, dataType: TYPE_STRING, data: 9 },
    ]);

    const body = Buffer.concat([pool, resourceMap, manifestElement, applicationElement]);
    const head = Buffer.alloc(8);
    head.writeUInt16LE(0x0003, 0);
    head.writeUInt16LE(8, 2);
    head.writeUInt32LE(8 + body.length, 4);
    return Buffer.concat([head, body]);
}

/** A minimal resources.arsc with a single package chunk. */
export function buildArscFixture(packageName = "com.narraleaf.shell.placeholder"): Buffer {
    const headerSize = 288;
    const payload = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x01, 0x02, 0x03, 0x04]);
    const pkg = Buffer.alloc(headerSize + payload.length);
    pkg.writeUInt16LE(0x0200, 0);
    pkg.writeUInt16LE(headerSize, 2);
    pkg.writeUInt32LE(pkg.length, 4);
    pkg.writeUInt32LE(0x7f, 8);
    pkg.write(packageName, 12, "utf16le");
    pkg.writeUInt32LE(headerSize, 268);
    pkg.writeUInt32LE(headerSize, 276);
    payload.copy(pkg, headerSize);

    const stringPool = Buffer.alloc(28);
    stringPool.writeUInt16LE(0x0001, 0);
    stringPool.writeUInt16LE(28, 2);
    stringPool.writeUInt32LE(28, 4);
    stringPool.writeUInt32LE(28, 20);

    const body = Buffer.concat([stringPool, pkg]);
    const header = Buffer.alloc(12);
    header.writeUInt16LE(0x0002, 0);
    header.writeUInt16LE(12, 2);
    header.writeUInt32LE(12 + body.length, 4);
    header.writeUInt32LE(1, 8);
    return Buffer.concat([header, body]);
}
