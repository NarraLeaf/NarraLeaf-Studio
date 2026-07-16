import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import zlib from "zlib";
import {
    ANDROID_ALIGNMENT_EXTRA_ID,
    CRC32_INITIAL,
    crc32,
    crc32Final,
    crc32Update,
    LOCAL_HEADER_SIZE,
    toDosDateTime,
    ZIP_METHOD_DEFLATE,
    ZIP_METHOD_STORE,
} from "./zipModel";

/**
 * Streaming zip writer for the mobile repack pipeline. Entry data is never
 * buffered whole: sources stream through (optionally via deflate) into the
 * output, and the few header fields that are only known afterwards (CRC,
 * deflated size) are patched in place — which is why the output interface
 * has random-access `patch` instead of the writer using data descriptors
 * (Android tooling and the later v2 signing step both prefer descriptor-free
 * archives).
 *
 * Determinism: every entry is stamped with the caller-injected `mtime` and
 * entries are written in caller order, so identical inputs produce
 * byte-identical archives — the property the golden-template tests pin.
 *
 * No fs in this module: file-backed outputs/sources are supplied by the
 * repack orchestration layer (and by tests, which use in-memory ones).
 */

const MAX_UINT32 = 0xffffffff;
const MAX_UINT16 = 0xffff;

const ZIP64_EXTRA_ID = 0x0001;

/** Byte sink the writer emits into. `patch` must not move `position`. */
export interface ZipOutput {
    readonly position: number;
    write(chunk: Buffer): Promise<void> | void;
    patch(offset: number, data: Buffer): Promise<void> | void;
}

/** In-memory output for tests and small archives. */
export class BufferZipOutput implements ZipOutput {
    private readonly chunks: Buffer[] = [];
    private readonly patches: { offset: number; data: Buffer }[] = [];
    private bytes = 0;

    public get position(): number {
        return this.bytes;
    }

    public write(chunk: Buffer): void {
        this.chunks.push(chunk);
        this.bytes += chunk.length;
    }

    public patch(offset: number, data: Buffer): void {
        this.patches.push({ offset, data });
    }

    public toBuffer(): Buffer {
        const buffer = Buffer.concat(this.chunks);
        for (const { offset, data } of this.patches) {
            data.copy(buffer, offset);
        }
        return buffer;
    }
}

export type ZipEntrySource =
    | { kind: "buffer"; data: Buffer }
    | {
        /** Streamed source of uncompressed bytes; `size` must be exact. */
        kind: "stream";
        size: number;
        open: () => AsyncIterable<Buffer> | NodeJS.ReadableStream;
    }
    | {
        /**
         * Verbatim passthrough of an already-encoded entry (template repack):
         * the bytes stream through untouched, so a deflated template entry is
         * never re-inflated. Metadata comes from the source archive's central
         * directory.
         */
        kind: "raw";
        method: number;
        crc32: number;
        compressedSize: number;
        uncompressedSize: number;
        open: () => AsyncIterable<Buffer> | NodeJS.ReadableStream;
    };

export type ZipWriteEntry = {
    /** Forward-slash path; a trailing "/" makes it a directory (source null). */
    name: string;
    source: ZipEntrySource | null;
    /** Ignored for raw sources; defaults to defaultMethodForName(name). */
    method?: "store" | "deflate";
    /** Unix permission bits (0o644/0o755); the writer adds the file-type bits. */
    unixMode?: number;
    /**
     * Align this entry's data start regardless of the archive-wide stored
     * alignment — resources.arsc needs 4 even if it were compressed-eligible.
     */
    forceAlign?: number;
};

export type ZipWriteOptions = {
    /** Timestamp stamped on every entry (reproducible output). */
    mtime: Date;
    /**
     * Align every stored file entry's data to this boundary (4 = zipalign
     * for APKs). Omit for archives with no alignment contract (ipa).
     */
    alignStoredEntries?: number;
    /**
     * Allow zip64 records (ipa). When false, an archive that would need them
     * fails loudly instead — Android's installer does not read zip64, so an
     * APK crossing 4 GiB (or 65535 entries) must be an error, not a corrupt
     * artifact.
     */
    allowZip64: boolean;
};

export type ZipWriteResult = {
    entryCount: number;
    centralDirectoryOffset: number;
    centralDirectorySize: number;
    /** Total archive size, EOCD included. */
    size: number;
    zip64: boolean;
};

/**
 * Already-compressed formats ship stored: deflating them again wastes build
 * time for ~0 gain, and stored media is what the shells' Range serving reads
 * without inflation. Everything else (text, code, json, fonts) deflates.
 */
const STORED_EXTENSIONS = new Set([
    "png", "jpg", "jpeg", "webp", "gif", "avif",
    "mp4", "m4v", "webm", "mkv", "mov",
    "mp3", "m4a", "aac", "ogg", "oga", "opus", "flac",
    "woff", "woff2",
    "zip", "jar", "apk", "ipa",
    "so", "arsc",
]);

export function defaultMethodForName(name: string): "store" | "deflate" {
    const dot = name.lastIndexOf(".");
    const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
    return STORED_EXTENSIONS.has(extension) ? "store" : "deflate";
}

function assertSafeEntryName(name: string): void {
    if (!name || name.startsWith("/") || name.includes("\\")) {
        throw new Error(`Unsafe zip entry name: "${name}"`);
    }
    for (const segment of name.split("/")) {
        if (segment === "." || segment === "..") {
            throw new Error(`Unsafe zip entry name: "${name}"`);
        }
    }
}

function toIterable(opened: AsyncIterable<Buffer> | NodeJS.ReadableStream): AsyncIterable<Buffer> {
    return opened as AsyncIterable<Buffer>;
}

/** Pump an iterable into the output with backpressure, tracking CRC + size. */
async function pumpData(
    output: ZipOutput,
    data: AsyncIterable<Buffer>,
    deflate: boolean,
): Promise<{ crc32: number; uncompressedSize: number; compressedSize: number }> {
    let crcState = CRC32_INITIAL;
    let uncompressedSize = 0;
    let compressedSize = 0;
    async function* tapped(): AsyncIterable<Buffer> {
        for await (const raw of data) {
            const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            crcState = crc32Update(crcState, chunk);
            uncompressedSize += chunk.length;
            yield chunk;
        }
    }
    const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
            compressedSize += chunk.length;
            Promise.resolve(output.write(chunk)).then(() => callback(), callback);
        },
    });
    if (deflate) {
        await pipeline(Readable.from(tapped()), zlib.createDeflateRaw(), sink);
    } else {
        await pipeline(Readable.from(tapped()), sink);
    }
    return { crc32: crc32Final(crcState), uncompressedSize, compressedSize };
}

/** zip64 extra-field block carrying the given (already saturated) values. */
function zip64Extra(fields: number[]): Buffer {
    const block = Buffer.alloc(4 + fields.length * 8);
    block.writeUInt16LE(ZIP64_EXTRA_ID, 0);
    block.writeUInt16LE(fields.length * 8, 2);
    fields.forEach((value, index) => {
        block.writeBigUInt64LE(BigInt(value), 4 + index * 8);
    });
    return block;
}

/**
 * Alignment padding as Android's 0xd935 extra block. This is not merely
 * padding: apksig reads the FIRST uint16 of the payload as the entry's
 * "alignment multiple" and re-aligns entries by it when a later re-sign
 * (standard `apksigner`, the documented route to release signing) rewrites
 * the archive — a zero or missing multiple means "never re-align", which
 * turns an offset shift from META-INF changes into a misaligned
 * resources.arsc and an install rejection on Android 11+. So the block
 * always carries the multiple and is grown (by whole alignment strides,
 * preserving the target residue) until it can: apksig's minimum block is
 * 6 bytes — id + length + the uint16 multiple.
 */
function alignmentPadding(dataStartWithoutPad: number, alignment: number): Buffer {
    const pad = (alignment - (dataStartWithoutPad % alignment)) % alignment;
    if (pad === 0) {
        // Already aligned: no block. apksig's fallback for entries without
        // one is filename-based (4, or page size for .so) — correct here.
        return Buffer.alloc(0);
    }
    let total = pad + 4;
    while (total < 6) {
        total += alignment;
    }
    const block = Buffer.alloc(total);
    block.writeUInt16LE(ANDROID_ALIGNMENT_EXTRA_ID, 0);
    block.writeUInt16LE(total - 4, 2);
    block.writeUInt16LE(alignment, 4);
    return block;
}

type CentralRecord = {
    nameBytes: Buffer;
    flags: number;
    method: number;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
    externalAttributes: number;
};

export async function writeZip(
    output: ZipOutput,
    entries: Iterable<ZipWriteEntry> | AsyncIterable<ZipWriteEntry>,
    options: ZipWriteOptions,
): Promise<ZipWriteResult> {
    const { dosTime, dosDate } = toDosDateTime(options.mtime);
    const records: CentralRecord[] = [];
    const seenNames = new Set<string>();
    let needsZip64 = false;

    const requireZip64 = (why: string) => {
        if (!options.allowZip64) {
            throw new Error(`Archive needs zip64 (${why}), which this target does not support`);
        }
        needsZip64 = true;
    };

    for await (const entry of entries as AsyncIterable<ZipWriteEntry>) {
        assertSafeEntryName(entry.name);
        if (seenNames.has(entry.name)) {
            throw new Error(`Duplicate zip entry name: "${entry.name}"`);
        }
        seenNames.add(entry.name);
        const isDirectory = entry.name.endsWith("/");
        if (isDirectory !== (entry.source === null)) {
            throw new Error(`Entry "${entry.name}" ${isDirectory ? "must not" : "must"} have a source`);
        }

        const nameBytes = Buffer.from(entry.name, "utf8");
        if (nameBytes.length > MAX_UINT16) {
            throw new Error(`Entry name too long: "${entry.name.slice(0, 80)}…"`);
        }
        // Bit 11 marks the name as UTF-8; only set when it matters, matching
        // what the Android template producers emit for their ASCII names.
        const flags = /[^\x20-\x7e]/.test(entry.name) ? 0x0800 : 0;

        // Resolve method and what is known before the data streams through.
        // Sources are opened LAZILY (a thunk, called only after every guard
        // has passed and the header is written): opening eagerly would leak
        // the file descriptor behind a fs-backed open() on any of the error
        // paths between here and the pump.
        const source = entry.source;
        let method: number;
        let knownCrc: number | undefined;
        let knownCompressedSize: number | undefined;
        let uncompressedSize: number;
        let openData: (() => AsyncIterable<Buffer>) | null;
        if (source === null) {
            method = ZIP_METHOD_STORE;
            knownCrc = 0;
            knownCompressedSize = 0;
            uncompressedSize = 0;
            openData = null;
        } else if (source.kind === "raw") {
            method = source.method;
            knownCrc = source.crc32;
            knownCompressedSize = source.compressedSize;
            uncompressedSize = source.uncompressedSize;
            openData = () => toIterable(source.open());
        } else if (source.kind === "buffer") {
            const wantsDeflate = (entry.method ?? defaultMethodForName(entry.name)) === "deflate";
            uncompressedSize = source.data.length;
            knownCrc = crc32(source.data);
            // Buffer sources are small (manifests, html, patched binaries):
            // encode them up front so the header needs no patching.
            const encoded = wantsDeflate ? zlib.deflateRawSync(source.data) : source.data;
            method = wantsDeflate ? ZIP_METHOD_DEFLATE : ZIP_METHOD_STORE;
            knownCompressedSize = encoded.length;
            openData = async function* () {
                yield encoded;
            };
        } else {
            const wantsDeflate = (entry.method ?? defaultMethodForName(entry.name)) === "deflate";
            uncompressedSize = source.size;
            if (wantsDeflate) {
                if (source.size >= MAX_UINT32) {
                    // The deflated size is patched into a 32-bit field after
                    // streaming; a source this large must be stored instead.
                    throw new Error(`"${entry.name}" is too large to deflate; store it`);
                }
                method = ZIP_METHOD_DEFLATE;
            } else {
                method = ZIP_METHOD_STORE;
                knownCompressedSize = source.size;
            }
            openData = () => toIterable(source.open());
        }

        // Local-header zip64 extra when a known size saturates its field.
        const sizesNeedZip64 = uncompressedSize >= MAX_UINT32
            || (knownCompressedSize !== undefined && knownCompressedSize >= MAX_UINT32);
        if (sizesNeedZip64) {
            requireZip64(`entry "${entry.name}" exceeds 4 GiB`);
        }
        const localZip64 = sizesNeedZip64
            ? zip64Extra([uncompressedSize, knownCompressedSize ?? 0])
            : Buffer.alloc(0);

        const localHeaderOffset = output.position;
        if (localHeaderOffset >= MAX_UINT32) {
            requireZip64("archive exceeds 4 GiB");
        }

        const alignment = entry.forceAlign
            ?? (method === ZIP_METHOD_STORE && !isDirectory ? options.alignStoredEntries : undefined);
        const padding = alignment
            ? alignmentPadding(
                localHeaderOffset + LOCAL_HEADER_SIZE + nameBytes.length + localZip64.length,
                alignment,
            )
            : Buffer.alloc(0);
        const extra = Buffer.concat([localZip64, padding]);

        const header = Buffer.alloc(LOCAL_HEADER_SIZE);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(sizesNeedZip64 ? 45 : 20, 4);
        header.writeUInt16LE(flags, 6);
        header.writeUInt16LE(method, 8);
        header.writeUInt16LE(dosTime, 10);
        header.writeUInt16LE(dosDate, 12);
        header.writeUInt32LE(knownCrc ?? 0, 14);
        header.writeUInt32LE(sizesNeedZip64 ? MAX_UINT32 : (knownCompressedSize ?? 0), 18);
        header.writeUInt32LE(sizesNeedZip64 ? MAX_UINT32 : (uncompressedSize >>> 0), 22);
        header.writeUInt16LE(nameBytes.length, 26);
        header.writeUInt16LE(extra.length, 28);
        await output.write(header);
        await output.write(nameBytes);
        if (extra.length > 0) {
            await output.write(extra);
        }

        let finalCrc = knownCrc ?? 0;
        let finalCompressedSize = knownCompressedSize ?? 0;
        if (openData) {
            // Only a stream source still needs encoding here; raw and buffer
            // sources already carry encoded bytes (and their pumped CRC would
            // be of the encoded form — meaningless, so it is ignored).
            const deflateWhilePumping = source !== null && source.kind === "stream" && method === ZIP_METHOD_DEFLATE;
            const pumped = await pumpData(output, openData(), deflateWhilePumping);
            if (source !== null && source.kind === "stream") {
                if (pumped.uncompressedSize !== uncompressedSize) {
                    throw new Error(
                        `"${entry.name}": source produced ${pumped.uncompressedSize} bytes, expected ${uncompressedSize}`,
                    );
                }
                if (deflateWhilePumping && pumped.compressedSize >= MAX_UINT32) {
                    throw new Error(`"${entry.name}" deflated past 4 GiB; store it instead`);
                }
                finalCrc = pumped.crc32;
                finalCompressedSize = pumped.compressedSize;
            } else if (pumped.compressedSize !== knownCompressedSize) {
                throw new Error(
                    `"${entry.name}": source produced ${pumped.compressedSize} bytes, expected ${knownCompressedSize}`,
                );
            }
        }

        // Patch the fields that were unknown before streaming. When the entry
        // uses a zip64 local extra its 32-bit size fields hold the 0xFFFFFFFF
        // marker and must not be overwritten (only streams with pre-known
        // sizes can be zip64, so at most the CRC needs fixing up there).
        if (knownCrc === undefined || knownCompressedSize === undefined) {
            const crcFixup = Buffer.alloc(4);
            crcFixup.writeUInt32LE(finalCrc, 0);
            await output.patch(localHeaderOffset + 14, crcFixup);
            if (knownCompressedSize === undefined && !sizesNeedZip64) {
                const sizeFixup = Buffer.alloc(4);
                sizeFixup.writeUInt32LE(finalCompressedSize >>> 0, 0);
                await output.patch(localHeaderOffset + 18, sizeFixup);
            }
        }

        const unixMode = entry.unixMode ?? (isDirectory ? 0o755 : 0o644);
        const fileType = isDirectory ? 0o040000 : 0o100000;
        // Unix mode in the high word, the MS-DOS directory bit in the low
        // byte. The final >>> 0 matters: every 32-bit operator in JS returns
        // a SIGNED value, and a negative number blows up writeUInt32LE.
        const externalAttributes = (((fileType | unixMode) << 16) | (isDirectory ? 0x10 : 0)) >>> 0;

        records.push({
            nameBytes,
            flags,
            method,
            crc32: finalCrc,
            compressedSize: finalCompressedSize,
            uncompressedSize,
            localHeaderOffset,
            externalAttributes,
        });
    }

    const centralDirectoryOffset = output.position;
    for (const record of records) {
        const zip64Fields: number[] = [];
        const saturatedUncompressed = record.uncompressedSize >= MAX_UINT32;
        const saturatedCompressed = record.compressedSize >= MAX_UINT32;
        const saturatedOffset = record.localHeaderOffset >= MAX_UINT32;
        if (saturatedUncompressed) {
            zip64Fields.push(record.uncompressedSize);
        }
        if (saturatedCompressed) {
            zip64Fields.push(record.compressedSize);
        }
        if (saturatedOffset) {
            zip64Fields.push(record.localHeaderOffset);
        }
        if (zip64Fields.length > 0) {
            requireZip64("central directory needs 64-bit fields");
        }
        const extra = zip64Fields.length > 0 ? zip64Extra(zip64Fields) : Buffer.alloc(0);

        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50, 0);
        header.writeUInt16LE((3 << 8) | 20, 4);
        header.writeUInt16LE(zip64Fields.length > 0 ? 45 : 20, 6);
        header.writeUInt16LE(record.flags, 8);
        header.writeUInt16LE(record.method, 10);
        header.writeUInt16LE(dosTime, 12);
        header.writeUInt16LE(dosDate, 14);
        header.writeUInt32LE(record.crc32, 16);
        header.writeUInt32LE(saturatedCompressed ? MAX_UINT32 : record.compressedSize, 20);
        header.writeUInt32LE(saturatedUncompressed ? MAX_UINT32 : record.uncompressedSize, 24);
        header.writeUInt16LE(record.nameBytes.length, 28);
        header.writeUInt16LE(extra.length, 30);
        header.writeUInt16LE(0, 32);
        header.writeUInt16LE(0, 34);
        header.writeUInt16LE(0, 36);
        header.writeUInt32LE(record.externalAttributes, 38);
        header.writeUInt32LE(saturatedOffset ? MAX_UINT32 : record.localHeaderOffset, 42);
        await output.write(header);
        await output.write(record.nameBytes);
        if (extra.length > 0) {
            await output.write(extra);
        }
    }
    const centralDirectorySize = output.position - centralDirectoryOffset;

    // >= rather than >: 0xFFFF is the zip64 sentinel, so an archive with
    // exactly 65535 entries already needs the real count in a zip64 record —
    // otherwise the EOCD alone is ambiguous and readers (including our own
    // parser) reject it.
    if (records.length >= MAX_UINT16 || centralDirectoryOffset >= MAX_UINT32 || centralDirectorySize >= MAX_UINT32) {
        requireZip64(records.length >= MAX_UINT16 ? "65535 or more entries" : "archive exceeds 4 GiB");
    }

    if (needsZip64) {
        const zip64EocdOffset = output.position;
        const eocd64 = Buffer.alloc(56);
        eocd64.writeUInt32LE(0x06064b50, 0);
        eocd64.writeBigUInt64LE(BigInt(44), 4);
        eocd64.writeUInt16LE((3 << 8) | 45, 12);
        eocd64.writeUInt16LE(45, 14);
        eocd64.writeUInt32LE(0, 16);
        eocd64.writeUInt32LE(0, 20);
        eocd64.writeBigUInt64LE(BigInt(records.length), 24);
        eocd64.writeBigUInt64LE(BigInt(records.length), 32);
        eocd64.writeBigUInt64LE(BigInt(centralDirectorySize), 40);
        eocd64.writeBigUInt64LE(BigInt(centralDirectoryOffset), 48);
        await output.write(eocd64);

        const locator = Buffer.alloc(20);
        locator.writeUInt32LE(0x07064b50, 0);
        locator.writeUInt32LE(0, 4);
        locator.writeBigUInt64LE(BigInt(zip64EocdOffset), 8);
        locator.writeUInt32LE(1, 16);
        await output.write(locator);
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(Math.min(records.length, MAX_UINT16), 8);
    eocd.writeUInt16LE(Math.min(records.length, MAX_UINT16), 10);
    eocd.writeUInt32LE(Math.min(centralDirectorySize, MAX_UINT32), 12);
    eocd.writeUInt32LE(Math.min(centralDirectoryOffset, MAX_UINT32), 16);
    eocd.writeUInt16LE(0, 20);
    await output.write(eocd);

    return {
        entryCount: records.length,
        centralDirectoryOffset,
        centralDirectorySize,
        size: output.position,
        zip64: needsZip64,
    };
}
