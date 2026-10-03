import { createHash } from "crypto";
import zlib from "zlib";

/**
 * A SquashFS 4.0 reader that checks what the kernel and `unsquashfs` check, for the writer's tests.
 *
 * Not used by any build. It exists because "it parses back" is only evidence if the parser is as
 * fussy as the readers that matter: a forgiving reader would accept an image the AppImage runtime
 * refuses. So beyond reading the tree back, it fails on every rule the writer has to keep - table
 * order and exact lengths, header entry limits, sorted names, a directory index that a name lookup
 * can actually use, inode numbers that are unique and agree with the export table, link counts, a
 * zstd frame window the kernel's decompressor can hold.
 *
 * Handles only what the writer produces and what `mksquashfs -no-fragments -no-xattrs` produces:
 * gzip and zstd, no fragments, no xattrs, regular files, directories and symbolic links.
 */

export type ReadEntry = {
    /** `/`-separated, relative to the root; the root itself is "". */
    path: string;
    kind: "directory" | "file" | "symlink";
    mode: number;
    uid: number;
    gid: number;
    mtime: number;
    inodeNumber: number;
    /** Files only: the content, unless the read was asked not to keep it. */
    data?: Buffer;
    /** Files only. */
    size?: number;
    /** Files only, when the content is kept: its sha256, hex. */
    sha256?: string;
    /** Symbolic links only. */
    target?: string;
    /** Directories only: the link count the inode records. */
    nlink?: number;
    /** Which inode form was written: basic (1-3) or extended (8-10). */
    inodeType: number;
};

export type ReadSuperblock = {
    inodeCount: number;
    mtime: number;
    blockSize: number;
    fragments: number;
    compression: number;
    flags: number;
    idCount: number;
    rootInode: bigint;
    bytesUsed: number;
    idTableStart: number;
    xattrTableStart: bigint;
    inodeTableStart: number;
    directoryTableStart: number;
    fragmentTableStart: number;
    exportTableStart: bigint;
};

export type ReadImage = {
    superblock: ReadSuperblock;
    ids: number[];
    entries: ReadEntry[];
    /** How many directories carried an index, to let a test confirm it exercised one. */
    indexedDirectories: number;
};

const METADATA_BLOCK_SIZE = 8192;
const NO_TABLE = 0xffffffffffffffffn;

export type ReadOptions = {
    /**
     * Keep each file's content and its digest on its entry. On by default; off for an image whose
     * files are too large to hold, which then only has every block's length checked.
     */
    keepData?: boolean;
};

export function readSquashfs(image: Buffer, options: ReadOptions = {}): ReadImage {
    const keepData = options.keepData ?? true;
    const sb = readSuperblock(image);
    const decompress = decompressorFor(sb.compression, sb.blockSize);

    const ids = readLookupTable(image, sb.idTableStart, sb.idCount * 4, sb.bytesUsed, decompress, "id");
    const idList = Array.from({ length: sb.idCount }, (_, index) => ids.readUInt32LE(index * 4));
    let nextTable = Number(image.readBigUInt64LE(sb.idTableStart));
    let exportTable: Buffer | null = null;
    if (sb.exportTableStart !== NO_TABLE) {
        exportTable = readLookupTable(image, Number(sb.exportTableStart), sb.inodeCount * 8, nextTable, decompress, "export");
        nextTable = Number(image.readBigUInt64LE(Number(sb.exportTableStart)));
    }
    if (sb.fragments !== 0) {
        throw new Error("fragments are not expected");
    }
    if (sb.fragmentTableStart > nextTable) {
        throw new Error("the fragment table starts after the export table");
    }
    if (sb.directoryTableStart > sb.fragmentTableStart) {
        throw new Error("the directory table starts after the fragment table");
    }
    if (sb.inodeTableStart >= sb.directoryTableStart) {
        throw new Error("the inode table does not come before the directory table");
    }

    const inodes = readMetadataTable(image, sb.inodeTableStart, sb.directoryTableStart, decompress);
    // With no fragments, `unsquashfs` takes the fragment table's start as the directory table's end.
    const directories = readMetadataTable(image, sb.directoryTableStart, sb.fragmentTableStart, decompress);

    const entries: ReadEntry[] = [];
    const seenNumbers = new Map<number, bigint>();
    let indexedDirectories = 0;

    const visit = (ref: bigint, path: string, expectedType: number | null, parentNumber: number | null): ReadEntry => {
        const cursor = inodes.cursor(ref);
        const type = cursor.u16();
        const mode = cursor.u16();
        const uidIndex = cursor.u16();
        const gidIndex = cursor.u16();
        const mtime = cursor.u32();
        const inodeNumber = cursor.u32();
        if (inodeNumber < 1 || inodeNumber > sb.inodeCount) {
            throw new Error(`${path || "/"} has inode number ${inodeNumber}, outside 1..${sb.inodeCount}`);
        }
        if (seenNumbers.has(inodeNumber)) {
            throw new Error(`inode number ${inodeNumber} is used twice`);
        }
        seenNumbers.set(inodeNumber, ref);
        const basicType = type > 7 ? type - 7 : type;
        if (expectedType !== null && basicType !== expectedType) {
            throw new Error(`${path} is listed as type ${expectedType} but its inode is type ${type}`);
        }
        const base = {
            path,
            mode,
            uid: idList[uidIndex],
            gid: idList[gidIndex],
            mtime,
            inodeNumber,
            inodeType: type,
        };
        if (basicType === 2) {
            let blocksStart: number;
            let fileSize: number;
            if (type === 2) {
                blocksStart = cursor.u32();
                const fragment = cursor.u32();
                cursor.u32();
                fileSize = cursor.u32();
                if (fragment !== 0xffffffff) {
                    throw new Error(`${path} uses a fragment`);
                }
            } else {
                blocksStart = Number(cursor.u64());
                fileSize = Number(cursor.u64());
                cursor.u64();
                cursor.u32();
                const fragment = cursor.u32();
                cursor.u32();
                cursor.u32();
                if (fragment !== 0xffffffff) {
                    throw new Error(`${path} uses a fragment`);
                }
            }
            const blockCount = Math.ceil(fileSize / sb.blockSize);
            const pieces: Buffer[] = [];
            const hash = createHash("sha256");
            let at = blocksStart;
            for (let index = 0; index < blockCount; index++) {
                const field = cursor.u32();
                const length = field & 0xffffff;
                const expected = Math.min(sb.blockSize, fileSize - index * sb.blockSize);
                const raw = image.subarray(at, at + length);
                const block = field & (1 << 24) ? Buffer.from(raw) : decompress(raw, true);
                if (block.length !== expected) {
                    throw new Error(`${path} block ${index} is ${block.length} bytes, not ${expected}`);
                }
                if (keepData) {
                    hash.update(block);
                    pieces.push(block);
                }
                at += length;
            }
            const entry: ReadEntry = {
                ...base,
                kind: "file",
                size: fileSize,
                ...(keepData ? { data: Buffer.concat(pieces), sha256: hash.digest("hex") } : {}),
            };
            entries.push(entry);
            return entry;
        }
        if (basicType === 3) {
            cursor.u32();
            const size = cursor.u32();
            const entry: ReadEntry = { ...base, kind: "symlink", target: cursor.bytes(size).toString("utf8") };
            entries.push(entry);
            return entry;
        }
        if (basicType !== 1) {
            throw new Error(`${path} has inode type ${type}`);
        }

        let nlink: number;
        let fileSize: number;
        let block: number;
        let offset: number;
        let parent: number;
        const index: Array<{ offset: number; block: number; name: string }> = [];
        if (type === 1) {
            block = cursor.u32();
            nlink = cursor.u32();
            fileSize = cursor.u16();
            offset = cursor.u16();
            parent = cursor.u32();
        } else {
            nlink = cursor.u32();
            fileSize = cursor.u32();
            block = cursor.u32();
            parent = cursor.u32();
            const indexCount = cursor.u16();
            offset = cursor.u16();
            cursor.u32();
            for (let i = 0; i < indexCount; i++) {
                const indexOffset = cursor.u32();
                const indexBlock = cursor.u32();
                const size = cursor.u32() + 1;
                index.push({ offset: indexOffset, block: indexBlock, name: cursor.bytes(size).toString("utf8") });
            }
            if (indexCount > 0) {
                indexedDirectories++;
            }
        }
        if (parentNumber !== null && parent !== parentNumber) {
            throw new Error(`${path} names inode ${parent} as its parent, not ${parentNumber}`);
        }
        if (parentNumber === null && parent !== sb.inodeCount + 1) {
            throw new Error(`the root names inode ${parent} as its parent`);
        }

        // Read the listing, noting where each header starts.
        const listingLength = fileSize - 3;
        // An empty listing is not looked up at all: the kernel and unsquashfs both skip it, and in an
        // image with nothing in it there is no directory block for it to name.
        const listingStart = listingLength === 0 ? 0 : directories.offsetOf(block) + offset;
        const listing = directories.slice(listingStart, listingLength);
        const headers = new Map<number, string>();
        const children: Array<{ name: string; ref: bigint; type: number; number: number }> = [];
        let at = 0;
        while (at < listing.length) {
            const headerAt = at;
            const count = listing.readUInt32LE(at) + 1;
            const startBlock = listing.readUInt32LE(at + 4);
            const baseNumber = listing.readUInt32LE(at + 8);
            at += 12;
            if (count > 256) {
                throw new Error(`${path || "/"} has a header of ${count} entries`);
            }
            for (let i = 0; i < count; i++) {
                const entryOffset = listing.readUInt16LE(at);
                const delta = listing.readInt16LE(at + 2);
                const entryType = listing.readUInt16LE(at + 4);
                const size = listing.readUInt16LE(at + 6) + 1;
                const name = listing.subarray(at + 8, at + 8 + size).toString("utf8");
                if (i === 0) {
                    headers.set(headerAt, name);
                }
                if (entryOffset >= METADATA_BLOCK_SIZE) {
                    throw new Error(`${name} points past the end of a metadata block`);
                }
                children.push({
                    name,
                    ref: (BigInt(startBlock) << 16n) | BigInt(entryOffset),
                    type: entryType,
                    number: baseNumber + delta,
                });
                at += 8 + size;
            }
        }
        if (at !== listing.length) {
            throw new Error(`${path || "/"} listing overruns its size`);
        }
        for (let i = 1; i < children.length; i++) {
            if (Buffer.compare(Buffer.from(children[i - 1].name), Buffer.from(children[i].name)) >= 0) {
                throw new Error(`${path || "/"} lists "${children[i - 1].name}" before "${children[i].name}"`);
            }
        }
        for (const item of index) {
            const name = headers.get(item.offset);
            if (name !== item.name) {
                throw new Error(`${path || "/"} indexes offset ${item.offset} as "${item.name}", where the header starts with ${name}`);
            }
            if (directories.blockStartOf(listingStart + item.offset) !== item.block) {
                throw new Error(`${path || "/"} indexes offset ${item.offset} in the wrong metadata block`);
            }
        }

        const entry: ReadEntry = { ...base, kind: "directory", nlink };
        entries.push(entry);
        let subdirectories = 0;
        for (const child of children) {
            // Every child must be findable the way the kernel looks a name up: through the index to
            // the last header whose first name is not past it, then forward through the runs.
            if (lookup(listing, index, child.name) !== child.ref) {
                throw new Error(`looking up "${child.name}" in ${path || "/"} does not find it`);
            }
            const found = visit(child.ref, path ? `${path}/${child.name}` : child.name, child.type, inodeNumber);
            if (found.inodeNumber !== child.number) {
                throw new Error(`${found.path} is listed as inode ${child.number} but is ${found.inodeNumber}`);
            }
            if (found.kind === "directory") {
                subdirectories++;
            }
        }
        if (nlink !== subdirectories + 2) {
            throw new Error(`${path || "/"} records ${nlink} links for ${subdirectories} subdirectories`);
        }
        return entry;
    };

    visit(sb.rootInode, "", null, null);
    if (seenNumbers.size !== sb.inodeCount) {
        throw new Error(`the superblock counts ${sb.inodeCount} inodes but the tree has ${seenNumbers.size}`);
    }
    if (exportTable) {
        for (const [number, ref] of seenNumbers) {
            if (exportTable.readBigUInt64LE((number - 1) * 8) !== ref) {
                throw new Error(`the export table entry for inode ${number} does not point at it`);
            }
        }
    }
    return { superblock: sb, ids: idList, entries, indexedDirectories };
}

function readSuperblock(image: Buffer): ReadSuperblock {
    if (image.readUInt32LE(0) !== 0x73717368) {
        throw new Error("not a squashfs image");
    }
    if (image.readUInt16LE(28) !== 4 || image.readUInt16LE(30) !== 0) {
        throw new Error("not squashfs 4.0");
    }
    const blockSize = image.readUInt32LE(12);
    if (1 << image.readUInt16LE(22) !== blockSize) {
        throw new Error("block size and block log disagree");
    }
    const sb: ReadSuperblock = {
        inodeCount: image.readUInt32LE(4),
        mtime: image.readUInt32LE(8),
        blockSize,
        fragments: image.readUInt32LE(16),
        compression: image.readUInt16LE(20),
        flags: image.readUInt16LE(24),
        idCount: image.readUInt16LE(26),
        rootInode: image.readBigUInt64LE(32),
        bytesUsed: Number(image.readBigUInt64LE(40)),
        idTableStart: Number(image.readBigUInt64LE(48)),
        xattrTableStart: image.readBigUInt64LE(56),
        inodeTableStart: Number(image.readBigUInt64LE(64)),
        directoryTableStart: Number(image.readBigUInt64LE(72)),
        fragmentTableStart: Number(image.readBigUInt64LE(80)),
        exportTableStart: image.readBigUInt64LE(88),
    };
    if (sb.xattrTableStart !== NO_TABLE) {
        throw new Error("xattrs are not expected");
    }
    if (sb.flags & 0x0400) {
        throw new Error("compressor options are not expected");
    }
    return sb;
}

type Decompress = (raw: Buffer, isData: boolean) => Buffer;

function decompressorFor(compression: number, blockSize: number): Decompress {
    if (compression === 1) {
        return raw => zlib.inflateSync(raw);
    }
    if (compression === 6) {
        // The kernel sizes one decompressor for both kinds of block, by the larger of the two.
        return raw => {
            checkZstdWindow(raw, Math.max(blockSize, METADATA_BLOCK_SIZE));
            return zlib.zstdDecompressSync(raw);
        };
    }
    throw new Error(`compression ${compression} is not expected`);
}

/**
 * Refuse a zstd frame whose window is larger than the block it holds.
 *
 * The kernel's squashfs zstd decompressor is sized for the block size, and fails a frame that
 * declares a larger window - which a frame compressed without knowing its own size does.
 */
function checkZstdWindow(frame: Buffer, limit: number): void {
    if (frame.readUInt32LE(0) !== 0xfd2fb528) {
        throw new Error("not a zstd frame");
    }
    const descriptor = frame[4];
    const singleSegment = (descriptor >> 5) & 1;
    if (singleSegment) {
        return;
    }
    const windowDescriptor = frame[5];
    const exponent = windowDescriptor >> 3;
    const mantissa = windowDescriptor & 7;
    const windowBase = 2 ** (10 + exponent);
    const window = windowBase + (windowBase / 8) * mantissa;
    if (window > Math.max(limit, 1 << 10)) {
        throw new Error(`a zstd frame asks for a ${window}-byte window, more than the ${limit}-byte block it holds`);
    }
}

/**
 * A lookup table's entries, read through its index, checking the index ends exactly at `end` - the
 * kernel's own check, and the one that fails an image whose trailing tables are out of place.
 */
function readLookupTable(image: Buffer, indexStart: number, length: number, end: number, decompress: Decompress, what: string): Buffer {
    const blocks = Math.ceil(length / METADATA_BLOCK_SIZE);
    if (indexStart + blocks * 8 !== end) {
        throw new Error(`the ${what} table index is ${blocks * 8} bytes but ${end - indexStart} lie between it and what follows`);
    }
    const pieces: Buffer[] = [];
    for (let i = 0; i < blocks; i++) {
        const start = Number(image.readBigUInt64LE(indexStart + i * 8));
        if (start >= indexStart) {
            throw new Error(`the ${what} table's block ${i} starts after its index`);
        }
        pieces.push(readMetadataBlock(image, start, decompress).data);
    }
    return Buffer.concat(pieces).subarray(0, length);
}

function readMetadataBlock(image: Buffer, at: number, decompress: Decompress): { data: Buffer; next: number } {
    const header = image.readUInt16LE(at);
    const length = header & 0x7fff;
    const raw = image.subarray(at + 2, at + 2 + length);
    const data = header & 0x8000 ? Buffer.from(raw) : decompress(raw, false);
    if (data.length > METADATA_BLOCK_SIZE) {
        throw new Error("a metadata block holds more than 8 KiB");
    }
    return { data, next: at + 2 + length };
}

type MetadataTable = {
    cursor(ref: bigint): Cursor;
    offsetOf(block: number): number;
    blockStartOf(uncompressedOffset: number): number;
    slice(start: number, length: number): Buffer;
};

/** A whole metadata table, decompressed, with the map from compressed block starts into it. */
function readMetadataTable(image: Buffer, start: number, end: number, decompress: Decompress): MetadataTable {
    const pieces: Buffer[] = [];
    const starts = new Map<number, number>();
    const blockStarts: number[] = [];
    let at = start;
    let uncompressed = 0;
    while (at < end) {
        starts.set(at - start, uncompressed);
        blockStarts.push(at - start);
        const { data, next } = readMetadataBlock(image, at, decompress);
        if (next < end && data.length !== METADATA_BLOCK_SIZE) {
            throw new Error("a metadata block other than the last is short");
        }
        pieces.push(data);
        uncompressed += data.length;
        at = next;
    }
    if (at !== end) {
        throw new Error("a metadata table overruns the structure after it");
    }
    const table = Buffer.concat(pieces);
    const offsetOf = (block: number): number => {
        const offset = starts.get(block);
        if (offset === undefined) {
            throw new Error(`no metadata block starts at ${block}`);
        }
        return offset;
    };
    return {
        offsetOf,
        blockStartOf: uncompressedOffset => blockStarts[Math.floor(uncompressedOffset / METADATA_BLOCK_SIZE)],
        slice: (from, length) => {
            if (from + length > table.length) {
                throw new Error("a reference runs past the end of its table");
            }
            return table.subarray(from, from + length);
        },
        cursor: ref => new Cursor(table, offsetOf(Number(ref >> 16n)) + Number(ref & 0xffffn)),
    };
}

class Cursor {
    constructor(private readonly buffer: Buffer, private at: number) {}

    u16(): number {
        const value = this.buffer.readUInt16LE(this.at);
        this.at += 2;
        return value;
    }

    u32(): number {
        const value = this.buffer.readUInt32LE(this.at);
        this.at += 4;
        return value;
    }

    u64(): bigint {
        const value = this.buffer.readBigUInt64LE(this.at);
        this.at += 8;
        return value;
    }

    bytes(length: number): Buffer {
        const value = this.buffer.subarray(this.at, this.at + length);
        this.at += length;
        return value;
    }
}

/**
 * Find a name in a listing the way the kernel's `squashfs_lookup` does: the index first, then the
 * runs forward from the header it lands on, stopping at the first name past the one wanted.
 */
function lookup(listing: Buffer, index: ReadonlyArray<{ offset: number; name: string }>, wanted: string): bigint | null {
    const target = Buffer.from(wanted);
    let at = 0;
    for (const item of index) {
        if (Buffer.compare(Buffer.from(item.name), target) > 0) {
            break;
        }
        at = item.offset;
    }
    while (at < listing.length) {
        const count = listing.readUInt32LE(at) + 1;
        const startBlock = listing.readUInt32LE(at + 4);
        at += 12;
        for (let i = 0; i < count; i++) {
            const entryOffset = listing.readUInt16LE(at);
            const size = listing.readUInt16LE(at + 6) + 1;
            const name = listing.subarray(at + 8, at + 8 + size);
            const order = Buffer.compare(name, target);
            if (order === 0) {
                return (BigInt(startBlock) << 16n) | BigInt(entryOffset);
            }
            if (order > 0) {
                return null;
            }
            at += 8 + size;
        }
    }
    return null;
}
