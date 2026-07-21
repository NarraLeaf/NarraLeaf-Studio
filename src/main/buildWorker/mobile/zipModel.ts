/**
 * Pure zip data layer for the mobile repack pipeline: central-directory
 * parsing, CRC-32, DOS timestamps and alignment checks. Buffer in →
 * structures out; no fs, no clock, no randomness - everything the golden
 * tests need to be byte-deterministic. The streaming writer lives in
 * zipWriter.ts; the fs-touching orchestration lives in repackApk/repackIpa.
 *
 * Format notes are against APPNOTE.TXT 6.3.9. Multi-disk archives and
 * encryption are deliberately unsupported: neither templates nor payloads
 * ever use them, and rejecting them loudly beats misparsing.
 */

import zlib from "zlib";

export const ZIP_METHOD_STORE = 0;
export const ZIP_METHOD_DEFLATE = 8;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;

const ZIP64_EXTRA_ID = 0x0001;

/** Fixed-size portions of the headers, excluding name/extra/comment. */
export const LOCAL_HEADER_SIZE = 30;
export const CENTRAL_HEADER_SIZE = 46;
export const EOCD_SIZE = 22;

/**
 * Android's alignment extra-field id (zipflinger/zipalign write the padding
 * as a well-formed TLV block under this id, which every parser tolerates -
 * bare zero bytes in the extra field are not valid TLV).
 */
export const ANDROID_ALIGNMENT_EXTRA_ID = 0xd935;

export type ZipIndexEntry = {
    name: string;
    /** ZIP_METHOD_STORE or ZIP_METHOD_DEFLATE (others are passed through raw). */
    method: number;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
    /** Raw DOS time/date words, preserved verbatim for passthrough. */
    dosTime: number;
    dosDate: number;
    generalPurposeFlags: number;
    externalAttributes: number;
    /** Unix permission + file-type bits from the external attributes' high word. */
    unixMode: number;
    isDirectory: boolean;
};

export type ZipIndex = {
    entries: ZipIndexEntry[];
    centralDirectoryOffset: number;
    centralDirectorySize: number;
    /** True when the archive carries a zip64 end-of-central-directory record. */
    zip64: boolean;
};

/* ------------------------------------------------------------------ CRC-32 */

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

/**
 * Incremental CRC-32 (IEEE 802.3, the zip polynomial). `state` is the value
 * returned by the previous call; start from CRC32_INITIAL and finish with
 * crc32Final. Implemented here rather than via zlib.crc32 because that API
 * only exists on newer Node lines and this must run identically everywhere.
 */
export const CRC32_INITIAL = 0xffffffff;

export function crc32Update(state: number, chunk: Buffer): number {
    let c = state >>> 0;
    for (let i = 0; i < chunk.length; i++) {
        c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
    }
    return c >>> 0;
}

export function crc32Final(state: number): number {
    return (state ^ 0xffffffff) >>> 0;
}

/** One-shot CRC-32 of a whole buffer. */
export function crc32(data: Buffer): number {
    return crc32Final(crc32Update(CRC32_INITIAL, data));
}

/* ------------------------------------------------------------ DOS datetime */

/**
 * MS-DOS packed date/time (2-second resolution, epoch 1980). The writer
 * stamps every entry with one injected timestamp so identical inputs produce
 * byte-identical archives. Packed from the UTC fields: a Date is an absolute
 * instant, and using local-time getters would bake the build machine's
 * timezone into every header - the cross-machine determinism the golden
 * tests rely on would quietly break.
 */
export function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
    const year = Math.max(date.getUTCFullYear(), 1980);
    const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
    const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
    return { dosTime, dosDate };
}

/* ------------------------------------------------------------- index parse */

function readUInt64(buffer: Buffer, offset: number): number {
    const value = buffer.readBigUInt64LE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("zip64 value exceeds the safe integer range");
    }
    return Number(value);
}

/**
 * Locate and parse the end-of-central-directory record. The EOCD floats in
 * front of a variable-length comment, so scan backwards over the maximum
 * comment window and accept the candidate whose comment length lands exactly
 * on the end of the file.
 */
function findEocd(buffer: Buffer): number {
    const lowest = Math.max(0, buffer.length - EOCD_SIZE - 0xffff);
    for (let offset = buffer.length - EOCD_SIZE; offset >= lowest; offset--) {
        if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) {
            continue;
        }
        const commentLength = buffer.readUInt16LE(offset + 20);
        if (offset + EOCD_SIZE + commentLength === buffer.length) {
            return offset;
        }
    }
    throw new Error("Not a zip archive: no end-of-central-directory record found");
}

/** Pull zip64 replacement values out of a central-directory extra field. */
function applyZip64Extra(
    extra: Buffer,
    values: { uncompressedSize: number; compressedSize: number; localHeaderOffset: number },
): void {
    let offset = 0;
    while (offset + 4 <= extra.length) {
        const id = extra.readUInt16LE(offset);
        const size = extra.readUInt16LE(offset + 2);
        if (id === ZIP64_EXTRA_ID) {
            // Fields appear in a fixed order, each present only when its
            // 32-bit counterpart is saturated.
            let cursor = offset + 4;
            if (values.uncompressedSize === 0xffffffff) {
                values.uncompressedSize = readUInt64(extra, cursor);
                cursor += 8;
            }
            if (values.compressedSize === 0xffffffff) {
                values.compressedSize = readUInt64(extra, cursor);
                cursor += 8;
            }
            if (values.localHeaderOffset === 0xffffffff) {
                values.localHeaderOffset = readUInt64(extra, cursor);
                cursor += 8;
            }
            return;
        }
        offset += 4 + size;
    }
}

/**
 * Parse an archive's central directory into entry metadata. The central
 * directory is authoritative (local headers may carry zeroed sizes when the
 * producer streamed with data descriptors), which is why spans for raw
 * passthrough are computed from these values plus the local header's own
 * name/extra lengths (see readLocalEntryDataSpan).
 */
export function parseZipIndex(buffer: Buffer): ZipIndex {
    const eocdOffset = findEocd(buffer);
    let entryCount = buffer.readUInt16LE(eocdOffset + 10);
    let centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
    let centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    let zip64 = false;

    const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
    if (diskNumber !== 0 && diskNumber !== 0xffff) {
        throw new Error("Multi-disk zip archives are not supported");
    }

    const locatorOffset = eocdOffset - 20;
    if (
        (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff || centralDirectorySize === 0xffffffff)
        || (locatorOffset >= 0 && buffer.readUInt32LE(locatorOffset) === ZIP64_LOCATOR_SIGNATURE)
    ) {
        if (locatorOffset < 0 || buffer.readUInt32LE(locatorOffset) !== ZIP64_LOCATOR_SIGNATURE) {
            throw new Error("Saturated EOCD fields without a zip64 locator");
        }
        const zip64EocdOffset = readUInt64(buffer, locatorOffset + 8);
        if (buffer.readUInt32LE(zip64EocdOffset) !== ZIP64_EOCD_SIGNATURE) {
            throw new Error("zip64 end-of-central-directory signature mismatch");
        }
        entryCount = readUInt64(buffer, zip64EocdOffset + 32);
        centralDirectorySize = readUInt64(buffer, zip64EocdOffset + 40);
        centralDirectoryOffset = readUInt64(buffer, zip64EocdOffset + 48);
        zip64 = true;
    }

    const entries: ZipIndexEntry[] = [];
    let cursor = centralDirectoryOffset;
    for (let i = 0; i < entryCount; i++) {
        if (buffer.readUInt32LE(cursor) !== CENTRAL_HEADER_SIGNATURE) {
            throw new Error(`Central directory entry ${i} has a bad signature`);
        }
        const generalPurposeFlags = buffer.readUInt16LE(cursor + 8);
        if (generalPurposeFlags & 0x0001) {
            throw new Error("Encrypted zip entries are not supported");
        }
        const method = buffer.readUInt16LE(cursor + 10);
        const dosTime = buffer.readUInt16LE(cursor + 12);
        const dosDate = buffer.readUInt16LE(cursor + 14);
        const entryCrc = buffer.readUInt32LE(cursor + 16);
        const values = {
            compressedSize: buffer.readUInt32LE(cursor + 20),
            uncompressedSize: buffer.readUInt32LE(cursor + 24),
            localHeaderOffset: buffer.readUInt32LE(cursor + 42),
        };
        const nameLength = buffer.readUInt16LE(cursor + 28);
        const extraLength = buffer.readUInt16LE(cursor + 30);
        const commentLength = buffer.readUInt16LE(cursor + 32);
        const externalAttributes = buffer.readUInt32LE(cursor + 38);
        const name = buffer.subarray(cursor + CENTRAL_HEADER_SIZE, cursor + CENTRAL_HEADER_SIZE + nameLength).toString("utf8");
        const extra = buffer.subarray(
            cursor + CENTRAL_HEADER_SIZE + nameLength,
            cursor + CENTRAL_HEADER_SIZE + nameLength + extraLength,
        );
        applyZip64Extra(extra, values);
        entries.push({
            name,
            method,
            crc32: entryCrc,
            compressedSize: values.compressedSize,
            uncompressedSize: values.uncompressedSize,
            localHeaderOffset: values.localHeaderOffset,
            dosTime,
            dosDate,
            generalPurposeFlags,
            externalAttributes,
            unixMode: (externalAttributes >>> 16) & 0xffff,
            isDirectory: name.endsWith("/"),
        });
        cursor += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
    }
    return { entries, centralDirectoryOffset, centralDirectorySize, zip64 };
}

/**
 * Where an entry's (still compressed) data bytes live. The local header's
 * own name/extra lengths decide the data start - they legitimately differ
 * from the central directory's (alignment padding lives only in the local
 * extra) - while the length comes from the authoritative central directory.
 */
export function readLocalEntryDataSpan(buffer: Buffer, entry: ZipIndexEntry): { start: number; end: number } {
    const offset = entry.localHeaderOffset;
    if (buffer.readUInt32LE(offset) !== LOCAL_HEADER_SIGNATURE) {
        throw new Error(`Local header signature mismatch for "${entry.name}"`);
    }
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const start = offset + LOCAL_HEADER_SIZE + nameLength + extraLength;
    return { start, end: start + entry.compressedSize };
}

/**
 * The decompressed bytes of an entry - for the repack to read a template's
 * AndroidManifest.xml / resources.arsc / Info.plist, which may be stored or
 * deflated. Only the two methods a real template uses are handled; anything
 * else is rejected rather than returned wrong.
 */
export function readEntryBytes(buffer: Buffer, entry: ZipIndexEntry): Buffer {
    const { start, end } = readLocalEntryDataSpan(buffer, entry);
    const raw = buffer.subarray(start, end);
    if (entry.method === ZIP_METHOD_STORE) {
        return Buffer.from(raw);
    }
    if (entry.method === ZIP_METHOD_DEFLATE) {
        return zlib.inflateRawSync(raw);
    }
    throw new Error(`Unsupported compression method ${entry.method} for "${entry.name}"`);
}

/**
 * The zipalign invariant the writer must uphold: every stored (uncompressed)
 * file entry's data begins on an `alignment` boundary. Returns the offenders
 * so tests can name them.
 */
export function findMisalignedStoredEntries(
    buffer: Buffer,
    alignment: number,
): { name: string; dataOffset: number }[] {
    const misaligned: { name: string; dataOffset: number }[] = [];
    for (const entry of parseZipIndex(buffer).entries) {
        if (entry.method !== ZIP_METHOD_STORE || entry.isDirectory) {
            continue;
        }
        const { start } = readLocalEntryDataSpan(buffer, entry);
        if (start % alignment !== 0) {
            misaligned.push({ name: entry.name, dataOffset: start });
        }
    }
    return misaligned;
}
