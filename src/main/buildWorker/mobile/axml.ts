/**
 * Binary AndroidManifest.xml (AXML) patcher for the APK repack. Pure:
 * Buffer in → Buffer out, no fs.
 *
 * Strategy: every string reference in the node chunks is an INDEX into the
 * file's string pool, so the patcher never remaps indices — it rewrites the
 * VALUES of existing pool strings and rebuilds only the pool bytes. Node
 * chunks pass through byte-identical, with a single exception: versionCode
 * is a typed integer attribute, patched as a 4-byte in-place write. Unknown
 * chunk types are copied verbatim.
 *
 * The identity attributes are located structurally (walking the elements and
 * resolving android: attributes through the resource map), not by value —
 * and the placeholder package name is additionally replaced pool-wide under
 * an exact + dotted-prefix rule, because aapt2 bakes it into derived strings
 * (provider authorities are the classic case) that must follow the rename or
 * two repacked games collide at install time.
 */

const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_TYPE = 0x0003;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_XML_START_ELEMENT_TYPE = 0x0102;

const UTF8_FLAG = 0x0100;

/** android:* attribute resource ids (fixed by the platform for all time). */
const RES_ID_VERSION_CODE = 0x0101021b;
const RES_ID_VERSION_NAME = 0x0101021c;
const RES_ID_LABEL = 0x01010001;

const NO_ENTRY = 0xffffffff;

/** Typed-value dataType codes (ResValue). */
const TYPE_STRING = 0x03;

type Chunk = {
    type: number;
    /** Absolute offset of the chunk header. */
    start: number;
    headerSize: number;
    size: number;
};

function readChunk(buffer: Buffer, offset: number): Chunk {
    if (offset + 8 > buffer.length) {
        throw new Error("Truncated AXML chunk header");
    }
    const size = buffer.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > buffer.length) {
        throw new Error("AXML chunk size out of bounds");
    }
    return {
        type: buffer.readUInt16LE(offset),
        start: offset,
        headerSize: buffer.readUInt16LE(offset + 2),
        size,
    };
}

/* ------------------------------------------------------------ string pool */

type StringPool = {
    flags: number;
    utf8: boolean;
    strings: string[];
    /** Style spans pass through untouched (they reference string indices). */
    styleData: Buffer;
    styleOffsets: number[];
};

function parseStringPool(buffer: Buffer, chunk: Chunk): StringPool {
    const base = chunk.start;
    const stringCount = buffer.readUInt32LE(base + 8);
    const styleCount = buffer.readUInt32LE(base + 12);
    const flags = buffer.readUInt32LE(base + 16);
    const stringsStart = buffer.readUInt32LE(base + 20);
    const stylesStart = buffer.readUInt32LE(base + 24);
    const utf8 = (flags & UTF8_FLAG) !== 0;

    const strings: string[] = [];
    for (let i = 0; i < stringCount; i++) {
        const offset = base + stringsStart + buffer.readUInt32LE(base + chunk.headerSize + i * 4);
        if (utf8) {
            // Two varint8 lengths: UTF-16 code-unit count, then byte count.
            let cursor = offset;
            let utf16Length = buffer.readUInt8(cursor);
            cursor += utf16Length & 0x80 ? 2 : 1;
            let byteLength = buffer.readUInt8(cursor);
            if (byteLength & 0x80) {
                byteLength = ((byteLength & 0x7f) << 8) | buffer.readUInt8(cursor + 1);
                cursor += 2;
            } else {
                cursor += 1;
            }
            strings.push(buffer.subarray(cursor, cursor + byteLength).toString("utf8"));
        } else {
            let cursor = offset;
            let length = buffer.readUInt16LE(cursor);
            cursor += 2;
            if (length & 0x8000) {
                length = ((length & 0x7fff) << 16) | buffer.readUInt16LE(cursor);
                cursor += 2;
            }
            strings.push(buffer.subarray(cursor, cursor + length * 2).toString("utf16le"));
        }
    }

    let styleData = Buffer.alloc(0);
    const styleOffsets: number[] = [];
    if (styleCount > 0) {
        for (let i = 0; i < styleCount; i++) {
            styleOffsets.push(buffer.readUInt32LE(base + chunk.headerSize + stringCount * 4 + i * 4));
        }
        const stylesEnd = chunk.start + chunk.size;
        styleData = Buffer.from(buffer.subarray(base + stylesStart, stylesEnd));
    }
    return { flags, utf8, strings, styleData, styleOffsets };
}

function encodeVarint8(value: number): Buffer {
    if (value > 0x7fff) {
        throw new Error("String too long for the AXML UTF-8 length encoding");
    }
    if (value > 0x7f) {
        return Buffer.from([((value >> 8) & 0x7f) | 0x80, value & 0xff]);
    }
    return Buffer.from([value]);
}

function encodePoolString(value: string, utf8: boolean): Buffer {
    if (utf8) {
        const bytes = Buffer.from(value, "utf8");
        // UTF-16 code-unit count, per the format (surrogate pairs count 2).
        const utf16Length = value.length;
        return Buffer.concat([encodeVarint8(utf16Length), encodeVarint8(bytes.length), bytes, Buffer.from([0])]);
    }
    const bytes = Buffer.from(value, "utf16le");
    const length = value.length;
    if (length > 0x7fff) {
        const header = Buffer.alloc(4);
        header.writeUInt16LE(((length >> 16) & 0x7fff) | 0x8000, 0);
        header.writeUInt16LE(length & 0xffff, 2);
        return Buffer.concat([header, bytes, Buffer.from([0, 0])]);
    }
    const header = Buffer.alloc(2);
    header.writeUInt16LE(length, 0);
    return Buffer.concat([header, bytes, Buffer.from([0, 0])]);
}

function buildStringPool(pool: StringPool): Buffer {
    const encoded = pool.strings.map(value => encodePoolString(value, pool.utf8));
    const offsets: number[] = [];
    let cursor = 0;
    for (const piece of encoded) {
        offsets.push(cursor);
        cursor += piece.length;
    }
    let stringData = Buffer.concat(encoded);
    // Chunk sizes are 4-byte aligned; pad the string data tail.
    const stringPadding = (4 - (stringData.length % 4)) % 4;
    if (stringPadding > 0) {
        stringData = Buffer.concat([stringData, Buffer.alloc(stringPadding)]);
    }

    const headerSize = 28;
    const offsetsSize = offsets.length * 4 + pool.styleOffsets.length * 4;
    const stringsStart = headerSize + offsetsSize;
    const stylesStart = pool.styleOffsets.length > 0 ? stringsStart + stringData.length : 0;
    const size = stringsStart + stringData.length + pool.styleData.length;

    const header = Buffer.alloc(headerSize + offsetsSize);
    header.writeUInt16LE(RES_STRING_POOL_TYPE, 0);
    header.writeUInt16LE(headerSize, 2);
    header.writeUInt32LE(size, 4);
    header.writeUInt32LE(pool.strings.length, 8);
    header.writeUInt32LE(pool.styleOffsets.length, 12);
    header.writeUInt32LE(pool.flags, 16);
    header.writeUInt32LE(stringsStart, 20);
    header.writeUInt32LE(stylesStart, 24);
    offsets.forEach((offset, index) => {
        header.writeUInt32LE(offset, headerSize + index * 4);
    });
    pool.styleOffsets.forEach((offset, index) => {
        header.writeUInt32LE(offset, headerSize + offsets.length * 4 + index * 4);
    });
    return Buffer.concat([header, stringData, pool.styleData]);
}

/* -------------------------------------------------------------- attributes */

type AttributeRef = {
    /** Absolute offset of the 20-byte attribute struct. */
    offset: number;
    nameIndex: number;
    rawValueIndex: number;
    dataType: number;
    data: number;
};

type ElementRef = {
    nameIndex: number;
    attributes: AttributeRef[];
};

function parseStartElement(buffer: Buffer, chunk: Chunk): ElementRef {
    const ext = chunk.start + chunk.headerSize;
    const nameIndex = buffer.readUInt32LE(ext + 4);
    const attributeStart = buffer.readUInt16LE(ext + 8);
    const attributeSize = buffer.readUInt16LE(ext + 10);
    const attributeCount = buffer.readUInt16LE(ext + 12);
    const attributes: AttributeRef[] = [];
    for (let i = 0; i < attributeCount; i++) {
        const offset = ext + attributeStart + i * attributeSize;
        attributes.push({
            offset,
            nameIndex: buffer.readUInt32LE(offset + 4),
            rawValueIndex: buffer.readUInt32LE(offset + 8),
            dataType: buffer.readUInt8(offset + 15),
            data: buffer.readUInt32LE(offset + 16),
        });
    }
    return { nameIndex, attributes };
}

/* ------------------------------------------------------------------ public */

export type BinaryManifestPatch = {
    packageName?: string;
    label?: string;
    versionCode?: number;
    versionName?: string;
};

export type BinaryManifestIdentity = {
    packageName: string;
    label?: string;
    versionCode?: number;
    versionName?: string;
};

type ParsedManifest = {
    chunks: Chunk[];
    pool: StringPool;
    poolChunk: Chunk;
    resourceIdByPoolIndex: Map<number, number>;
    elements: { chunk: Chunk; element: ElementRef }[];
};

function parseManifest(axml: Buffer): ParsedManifest {
    const root = readChunk(axml, 0);
    if (root.type !== RES_XML_TYPE) {
        throw new Error("Not a binary AndroidManifest.xml (missing RES_XML header)");
    }
    const chunks: Chunk[] = [];
    let cursor = root.headerSize;
    while (cursor < root.size) {
        const chunk = readChunk(axml, cursor);
        chunks.push(chunk);
        cursor += chunk.size;
    }

    const poolChunk = chunks.find(chunk => chunk.type === RES_STRING_POOL_TYPE);
    if (!poolChunk || chunks.indexOf(poolChunk) !== 0) {
        throw new Error("AXML string pool missing or not the first chunk");
    }
    const pool = parseStringPool(axml, poolChunk);

    const resourceIdByPoolIndex = new Map<number, number>();
    const mapChunk = chunks.find(chunk => chunk.type === RES_XML_RESOURCE_MAP_TYPE);
    if (mapChunk) {
        const count = (mapChunk.size - mapChunk.headerSize) / 4;
        for (let i = 0; i < count; i++) {
            resourceIdByPoolIndex.set(i, axml.readUInt32LE(mapChunk.start + mapChunk.headerSize + i * 4));
        }
    }

    const elements = chunks
        .filter(chunk => chunk.type === RES_XML_START_ELEMENT_TYPE)
        .map(chunk => ({ chunk, element: parseStartElement(axml, chunk) }));

    return { chunks, pool, poolChunk, resourceIdByPoolIndex, elements };
}

function findAttribute(
    parsed: ParsedManifest,
    elementName: string,
    match: { resourceId?: number; name?: string },
): AttributeRef | undefined {
    for (const { element } of parsed.elements) {
        if (parsed.pool.strings[element.nameIndex] !== elementName) {
            continue;
        }
        for (const attribute of element.attributes) {
            if (match.resourceId !== undefined
                && parsed.resourceIdByPoolIndex.get(attribute.nameIndex) === match.resourceId) {
                return attribute;
            }
            if (match.name !== undefined
                && parsed.resourceIdByPoolIndex.get(attribute.nameIndex) === undefined
                && parsed.pool.strings[attribute.nameIndex] === match.name) {
                return attribute;
            }
        }
    }
    return undefined;
}

/** Read the identity attributes back out — the repack self-check and tests. */
export function parseBinaryManifest(axml: Buffer): BinaryManifestIdentity {
    const parsed = parseManifest(axml);
    const strings = parsed.pool.strings;

    const packageAttribute = findAttribute(parsed, "manifest", { name: "package" });
    if (!packageAttribute || packageAttribute.rawValueIndex === NO_ENTRY) {
        throw new Error("Manifest has no package attribute");
    }
    const versionCodeAttribute = findAttribute(parsed, "manifest", { resourceId: RES_ID_VERSION_CODE });
    const versionNameAttribute = findAttribute(parsed, "manifest", { resourceId: RES_ID_VERSION_NAME });
    const labelAttribute = findAttribute(parsed, "application", { resourceId: RES_ID_LABEL });

    return {
        packageName: strings[packageAttribute.rawValueIndex],
        versionCode: versionCodeAttribute?.data,
        ...(versionNameAttribute && versionNameAttribute.dataType === TYPE_STRING
            ? { versionName: strings[versionNameAttribute.data] }
            : {}),
        ...(labelAttribute && labelAttribute.dataType === TYPE_STRING
            ? { label: strings[labelAttribute.data] }
            : {}),
    };
}

/**
 * Rewrite the manifest's identity. Returns the patched bytes plus what the
 * template previously carried (callers log/verify against the contract).
 *
 * The label must be a literal string in the template (a resource reference
 * would live in resources.arsc, out of this patcher's reach) — the template
 * CI asserts that shape; this throws if it ever regresses.
 */
export function patchBinaryManifest(
    axml: Buffer,
    patch: BinaryManifestPatch,
): { data: Buffer; previous: BinaryManifestIdentity } {
    const parsed = parseManifest(axml);
    const previous = parseBinaryManifest(axml);
    const strings = [...parsed.pool.strings];

    // Index-targeted value rewrites for the located attributes.
    if (patch.packageName !== undefined) {
        const attribute = findAttribute(parsed, "manifest", { name: "package" })!;
        strings[attribute.rawValueIndex] = patch.packageName;
        if (attribute.dataType === TYPE_STRING) {
            strings[attribute.data] = patch.packageName;
        }
    }
    if (patch.versionName !== undefined) {
        const attribute = findAttribute(parsed, "manifest", { resourceId: RES_ID_VERSION_NAME });
        if (!attribute) {
            throw new Error("Manifest has no android:versionName attribute to patch");
        }
        if (attribute.rawValueIndex !== NO_ENTRY) {
            strings[attribute.rawValueIndex] = patch.versionName;
        }
        if (attribute.dataType === TYPE_STRING && attribute.data !== attribute.rawValueIndex) {
            strings[attribute.data] = patch.versionName;
        }
    }
    if (patch.label !== undefined) {
        const attribute = findAttribute(parsed, "application", { resourceId: RES_ID_LABEL });
        if (!attribute || attribute.dataType !== TYPE_STRING) {
            throw new Error(
                "The template's android:label is not a literal string; the shell template contract requires it",
            );
        }
        strings[attribute.data] = patch.label;
        const raw = attribute.rawValueIndex;
        if (raw !== NO_ENTRY && raw !== attribute.data) {
            strings[raw] = patch.label;
        }
    }

    // Pool-wide exact + dotted-prefix rename, catching derived strings such
    // as provider authorities ("<package>.androidx-startup").
    if (patch.packageName !== undefined && previous.packageName !== patch.packageName) {
        const from = previous.packageName;
        const prefix = `${from}.`;
        for (let i = 0; i < strings.length; i++) {
            if (strings[i] === from) {
                strings[i] = patch.packageName;
            } else if (strings[i].startsWith(prefix)) {
                strings[i] = `${patch.packageName}.${strings[i].slice(prefix.length)}`;
            }
        }
    }

    const newPool = buildStringPool({ ...parsed.pool, strings });

    // Reassemble: original file header (size re-stamped) + new pool + every
    // other chunk byte-identical.
    const root = readChunk(axml, 0);
    const pieces: Buffer[] = [Buffer.from(axml.subarray(0, root.headerSize))];
    for (const chunk of parsed.chunks) {
        pieces.push(chunk === parsed.poolChunk
            ? newPool
            : Buffer.from(axml.subarray(chunk.start, chunk.start + chunk.size)));
    }
    const data = Buffer.concat(pieces);
    data.writeUInt32LE(data.length, 4);

    if (patch.versionCode !== undefined) {
        const versionCodeAttribute = findAttribute(parsed, "manifest", { resourceId: RES_ID_VERSION_CODE });
        if (!versionCodeAttribute) {
            throw new Error("Manifest has no android:versionCode attribute to patch");
        }
        // The pool precedes every element chunk, so the attribute moved by
        // exactly the pool's size delta; the typed value's data word sits 16
        // bytes into the 20-byte attribute struct.
        const shift = newPool.length - parsed.poolChunk.size;
        data.writeUInt32LE(patch.versionCode >>> 0, versionCodeAttribute.offset + shift + 16);
    }
    return { data, previous };
}
