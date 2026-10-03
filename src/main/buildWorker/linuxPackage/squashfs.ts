import type { FileHandle } from "fs/promises";
import os from "os";
import { promisify } from "util";
import zlib from "zlib";
import { DIRECTORY_MODE } from "./unixModes";

/**
 * A SquashFS 4.0 image writer, for the AppImage a Windows host cannot get from electron-builder.
 *
 * electron-builder makes an AppImage by running `mksquashfs` over a staging folder, and ships that
 * tool only for Linux and macOS. Nor would a Windows build of it help: the staging folder would be on
 * NTFS, which cannot hold the execute bits and symbolic links the image has to contain. So the image
 * is written here instead, from a list of entries that carry their own modes, without ever being a
 * folder on disk.
 *
 * ## What it writes
 *
 * The image `mksquashfs -all-root -no-xattrs -no-fragments` writes, which is how electron-builder
 * calls it for an AppImage:
 *
 * - Every inode owned by root (uid and gid 0, one entry in the id table), no extended attributes.
 * - No fragments: every file is whole blocks of {@link SQUASHFS_BLOCK_SIZE}, its last block short.
 *   A fragment table packs the tails of small files together; leaving it out costs a few hundred
 *   kilobytes on an Electron app and keeps every file readable on its own.
 * - The NFS export table, which `mksquashfs` writes unless told not to. Nothing an AppImage does
 *   reads it; it is here so the image is the one a reader expects from this tool's flags.
 * - Padding to a 4 KiB boundary after the filesystem, as `mksquashfs` pads unless told not to.
 *
 * Two things `mksquashfs` does that this does not, both size optimisations that leave the image
 * equally valid: it stores one copy of files with identical contents, and it writes an all-zero
 * block as a hole. Electron apps have neither in any quantity worth the complication.
 *
 * ## How it is laid out, and why that order
 *
 * Superblock, file data, inode table, directory table, (empty) fragment table, export table, id
 * table. The superblock's fields are positions in everything after it, so it is written last, over
 * the placeholder that holds its place - which is why a sink has to be able to write at a position
 * as well as at the end. Everything else is written once, front to back: file data streams through
 * as it is compressed, and the tables after it, which are a few kilobytes per thousand files, are
 * built in memory.
 *
 * Inodes are written children first, so a directory's listing can name the inodes it holds and
 * the directory's own inode can name where its listing is. Readers - the kernel, `squashfuse`
 * inside the AppImage runtime, `unsquashfs` - check more than the format strictly needs, and the
 * order of the trailing tables and their exact lengths are among the things they check; see
 * {@link writeLookupTable}.
 */

/** Data block size. `mksquashfs`'s default, and electron-builder passes no `-b` for an AppImage. */
export const SQUASHFS_BLOCK_SIZE = 128 * 1024;
const BLOCK_LOG = 17;

/** Every metadata block holds this much before compression. Fixed by the format. */
const METADATA_BLOCK_SIZE = 8192;

/**
 * The compressions this writes. Both are ones the AppImage static runtime can mount - its squashfuse
 * is built with zlib and zstd and nothing else.
 *
 * - `zstd` is what electron-builder uses for an AppImage built against the static runtime with
 *   Studio's `compression: "maximum"`, and what to use whenever {@link squashfsZstdAvailable}.
 * - `gzip` (zlib-wrapped deflate, as the format means by it) is for a Node without zstd.
 */
export type SquashfsCompression = "zstd" | "gzip";

/**
 * What a file holds: its bytes, or a way to read them.
 *
 * A function rather than a stream so a file is opened only when its turn comes - an image of a few
 * thousand files would otherwise hold a few thousand descriptors open from the start. A
 * `fs.createReadStream` is an async iterable of buffers, so `() => fs.createReadStream(path)` is
 * the usual value.
 */
export type SquashfsFileContent = Uint8Array | (() => AsyncIterable<Uint8Array>);

/**
 * One thing in the image, at a `/`-separated path relative to its root.
 *
 * Directories a path passes through need no entry of their own; they are made with
 * {@link DIRECTORY_MODE}. An entry with the empty path is the root directory itself, for a caller
 * that wants it some other mode. Symbolic links get 0777, as Linux gives every symbolic link.
 */
export type SquashfsEntry =
    | { kind: "directory"; path: string; mode: number }
    | { kind: "file"; path: string; mode: number; content: SquashfsFileContent }
    | { kind: "symlink"; path: string; target: string };

/**
 * Where an image goes. Positions count from the first byte of the image, whatever comes before it in
 * the file - an AppImage puts its runtime there.
 */
export interface SquashfsSink {
    /** Append after everything written so far. */
    write(chunk: Uint8Array): Promise<void>;
    /** Overwrite bytes already written. Used once, for the superblock. */
    writeAt(position: number, chunk: Uint8Array): Promise<void>;
}

export type SquashfsOptions = {
    /** Default `zstd`. */
    compression?: SquashfsCompression;
    /**
     * Modification time of every inode and of the image itself, in seconds since the epoch.
     * Defaults to now. One value for everything because the entries come from a staging area whose
     * own timestamps say when it was staged, which is the same thing.
     */
    mtime?: number;
    /** How many data blocks may be compressing at once. Defaults to the machine's parallelism. */
    concurrency?: number;
};

export type SquashfsResult = {
    /** The filesystem's own length, as its superblock records it. */
    bytesUsed: number;
    /** What was written, padding included. */
    imageSize: number;
    inodeCount: number;
};

/** Whether this Node can write {@link SquashfsCompression} `zstd`; Node 22.15 and later can. */
export function squashfsZstdAvailable(): boolean {
    return typeof zlib.zstdCompress === "function" && typeof zlib.zstdCompressSync === "function";
}

/**
 * A sink writing into an open file, the image starting `base` bytes in.
 *
 * Positional writes throughout, so nothing depends on the handle's own file position - an AppImage
 * writes its runtime at the front of the same file first.
 */
export function fileHandleSink(handle: FileHandle, base = 0): SquashfsSink {
    let end = base;
    const writeFully = async (chunk: Uint8Array, position: number): Promise<void> => {
        let done = 0;
        while (done < chunk.length) {
            const { bytesWritten } = await handle.write(chunk, done, chunk.length - done, position + done);
            done += bytesWritten;
        }
    };
    return {
        async write(chunk) {
            await writeFully(chunk, end);
            end += chunk.length;
        },
        async writeAt(position, chunk) {
            await writeFully(chunk, base + position);
        },
    };
}

/** Write the image of `entries` to `sink`. */
export async function writeSquashfs(
    entries: Iterable<SquashfsEntry>,
    sink: SquashfsSink,
    options: SquashfsOptions = {},
): Promise<SquashfsResult> {
    const compression = options.compression ?? "zstd";
    const compressor = compressorFor(compression);
    const mtime = options.mtime ?? Math.floor(Date.now() / 1000);
    if (!Number.isInteger(mtime) || mtime < 0 || mtime > 0xffffffff) {
        throw new Error(`a squashfs timestamp is 32 unsigned bits of seconds; ${mtime} is not one`);
    }
    const concurrency = Math.max(1, options.concurrency ?? Math.min(8, os.availableParallelism?.() ?? os.cpus().length));

    const root = buildTree(entries);
    const order = [...postOrder(root, null)];
    // Numbered in the order the inodes are written, so the children of one directory get numbers
    // close together - a directory header stores one number and each entry a 16-bit distance from it.
    order.forEach(({ node }, index) => {
        node.inodeNumber = index + 1;
    });
    const inodeCount = order.length;

    await sink.write(Buffer.alloc(SUPERBLOCK_SIZE));
    const data = new DataWriter(sink, compressor, concurrency, SUPERBLOCK_SIZE);
    for (const { node } of order) {
        if (node.kind === "file") {
            await data.writeFile(node);
        }
    }
    await data.flush();

    const inodeTable = new MetadataWriter(compressor);
    const directoryTable = new MetadataWriter(compressor);
    for (const { node, parent } of order) {
        const at = inodeTable.locate(inodeTable.tell());
        if (node.kind === "directory") {
            // The root has no parent; `mksquashfs` records one past the last inode number there.
            const parentNumber = parent ? parent.inodeNumber : inodeCount + 1;
            inodeTable.append(directoryInode(node, parentNumber, directoryTable, mtime));
        } else if (node.kind === "file") {
            inodeTable.append(fileInode(node, mtime));
        } else {
            inodeTable.append(symlinkInode(node, mtime));
        }
        node.ref = at;
    }

    let position = data.position;
    const inodeTableStart = position;
    const inodeBytes = inodeTable.finish();
    await sink.write(inodeBytes);
    position += inodeBytes.length;

    const directoryTableStart = position;
    const directoryBytes = directoryTable.finish();
    await sink.write(directoryBytes);
    position += directoryBytes.length;

    // No fragments, so no fragment table - but readers take its start as the end of the directory
    // table, so it is recorded as exactly that.
    const fragmentTableStart = position;

    const exportEntries = Buffer.alloc(8 * inodeCount);
    for (const { node } of order) {
        exportEntries.writeBigUInt64LE(inodeReference(node.ref!), 8 * (node.inodeNumber - 1));
    }
    const exportTable = writeLookupTable(exportEntries, compressor, position);
    await sink.write(exportTable.bytes);
    position += exportTable.bytes.length;

    // One id, 0, which every inode's uid and gid index into.
    const idTable = writeLookupTable(Buffer.alloc(4), compressor, position);
    await sink.write(idTable.bytes);
    position += idTable.bytes.length;

    const bytesUsed = position;
    const padding = (PAD_TO - (bytesUsed % PAD_TO)) % PAD_TO;
    if (padding > 0) {
        await sink.write(Buffer.alloc(padding));
    }

    await sink.writeAt(0, superblock({
        inodeCount,
        mtime,
        compressionId: COMPRESSION_IDS[compression],
        rootInode: inodeReference(root.ref!),
        bytesUsed,
        idTableStart: idTable.indexStart,
        inodeTableStart,
        directoryTableStart,
        fragmentTableStart,
        exportTableStart: exportTable.indexStart,
    }));

    return { bytesUsed, imageSize: bytesUsed + padding, inodeCount };
}

// ---------------------------------------------------------------------------------------------
// The tree

type MetadataPosition = {
    /** Where the metadata block starts, relative to the start of its table, compressed. */
    block: number;
    /** Where in that block, uncompressed. */
    offset: number;
};

type NodeBase = {
    name: string;
    nameBytes: Buffer;
    /** Assigned once the tree is complete. */
    inodeNumber: number;
    /** Assigned when the inode is written. */
    ref: MetadataPosition | null;
};

type DirectoryNode = NodeBase & {
    kind: "directory";
    mode: number;
    /** Whether an entry named it, as opposed to it being implied by a path through it. */
    declared: boolean;
    children: Map<string, TreeNode>;
};

type FileNode = NodeBase & {
    kind: "file";
    mode: number;
    content: SquashfsFileContent;
    size: number;
    blocksStart: number;
    blockSizes: number[];
};

type SymlinkNode = NodeBase & {
    kind: "symlink";
    target: Buffer;
};

type TreeNode = DirectoryNode | FileNode | SymlinkNode;

function nodeBase(name: string): NodeBase {
    return { name, nameBytes: Buffer.from(name, "utf8"), inodeNumber: 0, ref: null };
}

function newDirectory(name: string, mode: number, declared: boolean): DirectoryNode {
    return { ...nodeBase(name), kind: "directory", mode, declared, children: new Map() };
}

/**
 * The entries as a tree, refusing anything a filesystem could not hold.
 *
 * Strict about paths on purpose. The entries come from a Windows folder, and a backslash, an empty
 * component or a `..` in one is a path that was assembled wrong - written into the image as
 * given, it would be a file with a backslash in its name, or one outside the tree.
 */
function buildTree(entries: Iterable<SquashfsEntry>): DirectoryNode {
    const root = newDirectory("", DIRECTORY_MODE, false);
    for (const entry of entries) {
        const parts = splitPath(entry.path);
        if (parts.length === 0) {
            if (entry.kind !== "directory") {
                throw new Error("the empty path is the root directory, and only a directory can be it");
            }
            if (root.declared) {
                throw new Error("the root directory is listed twice");
            }
            root.mode = checkedMode(entry.mode, "the root directory");
            root.declared = true;
            continue;
        }
        let directory = root;
        for (let index = 0; index < parts.length - 1; index++) {
            const part = parts[index];
            const existing = directory.children.get(part);
            if (!existing) {
                const created = newDirectory(part, DIRECTORY_MODE, false);
                directory.children.set(part, created);
                directory = created;
            } else if (existing.kind === "directory") {
                directory = existing;
            } else {
                throw new Error(`"${entry.path}" is inside "${parts.slice(0, index + 1).join("/")}", which is not a directory`);
            }
        }
        const name = parts[parts.length - 1];
        const existing = directory.children.get(name);
        if (entry.kind === "directory") {
            const mode = checkedMode(entry.mode, entry.path);
            if (!existing) {
                directory.children.set(name, newDirectory(name, mode, true));
            } else if (existing.kind === "directory" && !existing.declared) {
                existing.mode = mode;
                existing.declared = true;
            } else {
                throw new Error(`"${entry.path}" is listed twice`);
            }
            continue;
        }
        if (existing) {
            throw new Error(`"${entry.path}" is listed twice`);
        }
        if (entry.kind === "file") {
            directory.children.set(name, {
                ...nodeBase(name),
                kind: "file",
                mode: checkedMode(entry.mode, entry.path),
                content: entry.content,
                size: 0,
                blocksStart: 0,
                blockSizes: [],
            });
        } else {
            const target = Buffer.from(entry.target, "utf8");
            if (target.length === 0 || target.includes(0)) {
                throw new Error(`"${entry.path}" is a symbolic link to "${entry.target}", which is not a path`);
            }
            directory.children.set(name, { ...nodeBase(name), kind: "symlink", target });
        }
    }
    return root;
}

/** The longest name a directory entry can hold. */
const MAX_NAME_BYTES = 256;

function splitPath(entryPath: string): string[] {
    if (entryPath === "") {
        return [];
    }
    if (entryPath.includes("\\")) {
        throw new Error(`"${entryPath}" uses a backslash; image paths are separated by "/"`);
    }
    const parts = entryPath.split("/");
    for (const part of parts) {
        if (part === "" || part === "." || part === ".." || part.includes("\0")) {
            throw new Error(`"${entryPath}" is not a relative path made of plain names`);
        }
        if (Buffer.byteLength(part, "utf8") > MAX_NAME_BYTES) {
            throw new Error(`"${part}" in "${entryPath}" is longer than the ${MAX_NAME_BYTES} bytes a squashfs name can be`);
        }
    }
    return parts;
}

function checkedMode(mode: number, what: string): number {
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) {
        throw new Error(`${what} has mode ${mode}, which is not permission bits`);
    }
    return mode;
}

/** Children in the order a directory lists them: by the bytes of their names. */
function sortedChildren(directory: DirectoryNode): TreeNode[] {
    return [...directory.children.values()].sort((a, b) => Buffer.compare(a.nameBytes, b.nameBytes));
}

/** Every node, each directory after everything beneath it, the root last. */
function* postOrder(directory: DirectoryNode, parent: DirectoryNode | null): Generator<{ node: TreeNode; parent: DirectoryNode | null }> {
    for (const child of sortedChildren(directory)) {
        if (child.kind === "directory") {
            yield* postOrder(child, directory);
        } else {
            yield { node: child, parent: directory };
        }
    }
    yield { node: directory, parent };
}

// ---------------------------------------------------------------------------------------------
// Compression

type Compressor = {
    /** For data blocks, on the thread pool, several at once. */
    compress(block: Uint8Array): Promise<Buffer>;
    /** For metadata blocks, which are 8 KiB and come one at a time. */
    compressSync(block: Uint8Array): Buffer;
};

const COMPRESSION_IDS: Readonly<Record<SquashfsCompression, number>> = { gzip: 1, zstd: 6 };

/**
 * `mksquashfs`'s default zstd level. Kept rather than tuned so the image needs no compressor-options
 * block: a level other than the default has to be recorded in one, and it is the image
 * electron-builder makes - default level, no options - that this is matched against.
 */
const ZSTD_LEVEL = 15;

/** Likewise `mksquashfs`'s default for gzip, with the default 32 KiB window. */
const GZIP_LEVEL = 9;

function compressorFor(compression: SquashfsCompression): Compressor {
    if (compression === "zstd") {
        if (!squashfsZstdAvailable()) {
            throw new Error(`this Node (${process.version}) has no zstd; write the image with gzip instead`);
        }
        // Every frame has to declare a window no larger than a data block. The kernel sizes its
        // decompressor by the block size and refuses a frame that asks for more; squashfuse would
        // read either, but an AppImage can be loop-mounted too.
        //
        // The asynchronous API does not tell zstd how much input is coming, and left to itself
        // zstd then plans for an unbounded stream: a 4 MiB window, and level-15 match tables sized
        // for it - tens of megabytes allocated per block, which is slow, and which a few blocks in
        // flight at once turn into an allocation failure. `pledgedSrcSize` (Node 22.15 and later,
        // absent from the typings) gives it the size, so it picks the parameters for a 128 KiB
        // input - those `mksquashfs` gets from zstd's one-shot call - and writes a frame that
        // records its content size. The window log is pinned as well, so a Node that ignored the
        // pledge would still write frames a kernel can read.
        const params = {
            [zlib.constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL,
            [zlib.constants.ZSTD_c_windowLog]: BLOCK_LOG,
        };
        const optionsFor = (block: Uint8Array): zlib.ZstdOptions => ({ params, pledgedSrcSize: block.length } as zlib.ZstdOptions);
        const zstdCompress = promisify(zlib.zstdCompress) as (buffer: zlib.InputType, options: zlib.ZstdOptions) => Promise<Buffer>;
        return {
            compress: block => zstdCompress(block, optionsFor(block)),
            compressSync: block => zlib.zstdCompressSync(block, optionsFor(block)),
        };
    }
    const options: zlib.ZlibOptions = { level: GZIP_LEVEL };
    const deflate = promisify(zlib.deflate) as (buffer: zlib.InputType, options: zlib.ZlibOptions) => Promise<Buffer>;
    return {
        compress: block => deflate(block, options),
        compressSync: block => zlib.deflateSync(block, options),
    };
}

// ---------------------------------------------------------------------------------------------
// File data

/** Bit 24 of a block's size: the block is stored as it is, because compressing it did not help. */
const UNCOMPRESSED_DATA_BLOCK = 1 << 24;

type StoredBlock = { bytes: Uint8Array; sizeField: number };

async function storeDataBlock(compressor: Compressor, block: Uint8Array): Promise<StoredBlock> {
    const packed = await compressor.compress(block);
    return packed.length < block.length
        ? { bytes: packed, sizeField: packed.length }
        : { bytes: block, sizeField: block.length | UNCOMPRESSED_DATA_BLOCK };
}

/**
 * Compresses blocks several at a time and writes them in order.
 *
 * Compression is the whole cost of an image - zstd at its default squashfs level runs at tens of
 * megabytes a second on one core - so blocks go to the thread pool as they are read and are written
 * as each one at the head of the queue finishes. The queue's length bounds memory: a few blocks in
 * flight, never the file.
 */
class DataWriter {
    private readonly queue: Array<{ file: FileNode; pending: Promise<StoredBlock> }> = [];

    constructor(
        private readonly sink: SquashfsSink,
        private readonly compressor: Compressor,
        private readonly concurrency: number,
        public position: number,
    ) {}

    async writeFile(file: FileNode): Promise<void> {
        for await (const block of blocksOf(file.content)) {
            file.size += block.length;
            const pending = storeDataBlock(this.compressor, block);
            // Awaited in turn below; this only keeps a failure that arrives while an earlier block is
            // being awaited from being reported as unhandled before its turn comes.
            pending.catch(() => undefined);
            this.queue.push({ file, pending });
            if (this.queue.length >= this.concurrency) {
                await this.writeNext();
            }
        }
    }

    async flush(): Promise<void> {
        while (this.queue.length > 0) {
            await this.writeNext();
        }
    }

    private async writeNext(): Promise<void> {
        const { file, pending } = this.queue.shift()!;
        const stored = await pending;
        // Blocks leave the queue in the order they entered it, so the first of a file to be written
        // is its first block, and where it lands is where the file's data starts.
        if (file.blockSizes.length === 0) {
            file.blocksStart = this.position;
        }
        file.blockSizes.push(stored.sizeField);
        await this.sink.write(stored.bytes);
        this.position += stored.bytes.length;
    }
}

/** A file's content cut into data blocks, every one full but the last. */
async function* blocksOf(content: SquashfsFileContent): AsyncGenerator<Uint8Array> {
    if (content instanceof Uint8Array) {
        for (let at = 0; at < content.length; at += SQUASHFS_BLOCK_SIZE) {
            yield content.subarray(at, at + SQUASHFS_BLOCK_SIZE);
        }
        return;
    }
    // Copied into blocks of its own rather than sliced from the chunks a stream yields: a block is
    // still being compressed after the loop has moved on, and a source is free to reuse its buffers.
    let block = Buffer.allocUnsafe(SQUASHFS_BLOCK_SIZE);
    let fill = 0;
    for await (const chunk of content()) {
        let at = 0;
        while (at < chunk.length) {
            const take = Math.min(SQUASHFS_BLOCK_SIZE - fill, chunk.length - at);
            block.set(chunk.subarray(at, at + take), fill);
            fill += take;
            at += take;
            if (fill === SQUASHFS_BLOCK_SIZE) {
                yield block;
                block = Buffer.allocUnsafe(SQUASHFS_BLOCK_SIZE);
                fill = 0;
            }
        }
    }
    if (fill > 0) {
        yield block.subarray(0, fill);
    }
}

// ---------------------------------------------------------------------------------------------
// Metadata

/** Bit 15 of a metadata block's header: stored as it is. The low 15 bits are its length either way. */
const UNCOMPRESSED_METADATA_BLOCK = 1 << 15;

/**
 * A metadata table being written: a stream of bytes cut into 8 KiB blocks, each compressed and
 * stored after a two-byte header.
 *
 * What refers into a table refers by the compressed position of a block and an offset inside it,
 * and a block's compressed position is known from the moment it is begun - it is wherever the
 * previous one ended. So {@link locate} can answer for any byte already appended, including ones in
 * the block still being filled.
 */
class MetadataWriter {
    private readonly chunks: Buffer[] = [];
    private compressedLength = 0;
    private readonly block = Buffer.alloc(METADATA_BLOCK_SIZE);
    private fill = 0;
    private appended = 0;
    /** Compressed start of each block begun so far, by block number. */
    private readonly blockStarts: number[] = [0];

    constructor(private readonly compressor: Compressor) {}

    /** The uncompressed offset the next appended byte will have. */
    tell(): number {
        return this.appended;
    }

    /** Where an uncompressed offset already reached sits, as a reference into this table. */
    locate(offset: number): MetadataPosition {
        const block = this.blockStarts[Math.floor(offset / METADATA_BLOCK_SIZE)];
        if (block === undefined || offset > this.appended) {
            throw new Error(`metadata offset ${offset} has not been written yet`);
        }
        return { block, offset: offset % METADATA_BLOCK_SIZE };
    }

    append(bytes: Uint8Array): void {
        let at = 0;
        while (at < bytes.length) {
            const take = Math.min(METADATA_BLOCK_SIZE - this.fill, bytes.length - at);
            this.block.set(bytes.subarray(at, at + take), this.fill);
            this.fill += take;
            at += take;
            this.appended += take;
            if (this.fill === METADATA_BLOCK_SIZE) {
                this.flushBlock();
            }
        }
    }

    /** The table's bytes, its last block flushed short. */
    finish(): Buffer {
        if (this.fill > 0) {
            this.flushBlock();
        }
        return Buffer.concat(this.chunks);
    }

    private flushBlock(): void {
        const raw = this.block.subarray(0, this.fill);
        const packed = this.compressor.compressSync(raw);
        const stored = packed.length < raw.length ? packed : Buffer.from(raw);
        const header = Buffer.alloc(2);
        header.writeUInt16LE(stored === packed ? packed.length : raw.length | UNCOMPRESSED_METADATA_BLOCK);
        this.chunks.push(header, stored);
        this.compressedLength += 2 + stored.length;
        this.blockStarts.push(this.compressedLength);
        this.fill = 0;
    }
}

/** A metadata position packed the way the superblock, the export table and directory headers store it. */
function inodeReference(position: MetadataPosition): bigint {
    return (BigInt(position.block) << 16n) | BigInt(position.offset);
}

/**
 * A lookup table - the export table, the id table - written at `position`: its entries as metadata
 * blocks, then an index of where each block starts. The superblock points at the index.
 *
 * Readers check the layout exactly. The kernel computes each index's length from the number of
 * entries and refuses the image unless it ends precisely where the next structure begins (for the
 * id table, the end of the filesystem), and it takes the first index entry as the end of the table
 * before it. So these are written back to back, blocks then index, with nothing between.
 */
function writeLookupTable(entries: Buffer, compressor: Compressor, position: number): { bytes: Buffer; indexStart: number } {
    const blocks: Buffer[] = [];
    const index: Buffer[] = [];
    let at = position;
    for (let offset = 0; offset < entries.length; offset += METADATA_BLOCK_SIZE) {
        const raw = entries.subarray(offset, offset + METADATA_BLOCK_SIZE);
        const packed = compressor.compressSync(raw);
        const compressed = packed.length < raw.length;
        const header = Buffer.alloc(2);
        header.writeUInt16LE(compressed ? packed.length : raw.length | UNCOMPRESSED_METADATA_BLOCK);
        const stored = compressed ? packed : Buffer.from(raw);
        const pointer = Buffer.alloc(8);
        pointer.writeBigUInt64LE(BigInt(at));
        index.push(pointer);
        blocks.push(header, stored);
        at += 2 + stored.length;
    }
    return { bytes: Buffer.concat([...blocks, ...index]), indexStart: at };
}

// ---------------------------------------------------------------------------------------------
// Inodes and directories

const INODE_DIRECTORY = 1;
const INODE_FILE = 2;
const INODE_SYMLINK = 3;
const INODE_EXTENDED_DIRECTORY = 8;
const INODE_EXTENDED_FILE = 9;

const NO_FRAGMENT = 0xffffffff;
const NO_XATTR = 0xffffffff;

function inodeHeader(type: number, mode: number, mtime: number, inodeNumber: number): Buffer {
    const header = Buffer.alloc(16);
    header.writeUInt16LE(type, 0);
    header.writeUInt16LE(mode, 2);
    // uid and gid are indexes into the id table, whose one entry is root.
    header.writeUInt16LE(0, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt32LE(mtime, 8);
    header.writeUInt32LE(inodeNumber, 12);
    return header;
}

/**
 * A regular file's inode. The basic form holds 32-bit sizes and positions; past 4 GiB in either the
 * extended one is needed, and is otherwise avoided because it is 24 bytes longer.
 */
function fileInode(file: FileNode, mtime: number): Buffer {
    const blocks = Buffer.alloc(4 * file.blockSizes.length);
    file.blockSizes.forEach((size, index) => blocks.writeUInt32LE(size, 4 * index));
    if (file.size < 2 ** 32 && file.blocksStart < 2 ** 32) {
        const body = Buffer.alloc(16);
        body.writeUInt32LE(file.blocksStart, 0);
        body.writeUInt32LE(NO_FRAGMENT, 4);
        body.writeUInt32LE(0, 8);
        body.writeUInt32LE(file.size, 12);
        return Buffer.concat([inodeHeader(INODE_FILE, file.mode, mtime, file.inodeNumber), body, blocks]);
    }
    const body = Buffer.alloc(40);
    body.writeBigUInt64LE(BigInt(file.blocksStart), 0);
    body.writeBigUInt64LE(BigInt(file.size), 8);
    body.writeBigUInt64LE(0n, 16); // bytes saved by sparse blocks: none are written
    body.writeUInt32LE(1, 24);
    body.writeUInt32LE(NO_FRAGMENT, 28);
    body.writeUInt32LE(0, 32);
    body.writeUInt32LE(NO_XATTR, 36);
    return Buffer.concat([inodeHeader(INODE_EXTENDED_FILE, file.mode, mtime, file.inodeNumber), body, blocks]);
}

function symlinkInode(link: SymlinkNode, mtime: number): Buffer {
    const body = Buffer.alloc(8);
    body.writeUInt32LE(1, 0);
    body.writeUInt32LE(link.target.length, 4);
    return Buffer.concat([inodeHeader(INODE_SYMLINK, 0o777, mtime, link.inodeNumber), body, link.target]);
}

/**
 * Write a directory's listing into the directory table and return its inode.
 *
 * Its children's inodes are already written, which is what lets the listing name them.
 */
function directoryInode(directory: DirectoryNode, parentNumber: number, table: MetadataWriter, mtime: number): Buffer {
    const children = sortedChildren(directory);
    const listing = directoryListing(children);
    const startOffset = table.tell();
    const start = table.locate(startOffset);
    table.append(listing.bytes);
    const subdirectories = children.filter(child => child.kind === "directory").length;
    const nlink = 2 + subdirectories;
    // The stored size counts the "." and ".." entries a reader adds, which are not in the listing.
    const fileSize = listing.bytes.length + 3;

    if (listing.index.length === 0 && fileSize <= 0xffff) {
        const body = Buffer.alloc(16);
        body.writeUInt32LE(start.block, 0);
        body.writeUInt32LE(nlink, 4);
        body.writeUInt16LE(fileSize, 8);
        body.writeUInt16LE(start.offset, 10);
        body.writeUInt32LE(parentNumber, 12);
        return Buffer.concat([inodeHeader(INODE_DIRECTORY, directory.mode, mtime, directory.inodeNumber), body]);
    }

    const body = Buffer.alloc(24);
    body.writeUInt32LE(nlink, 0);
    body.writeUInt32LE(fileSize, 4);
    body.writeUInt32LE(start.block, 8);
    body.writeUInt32LE(parentNumber, 12);
    body.writeUInt16LE(listing.index.length, 16);
    body.writeUInt16LE(start.offset, 18);
    body.writeUInt32LE(NO_XATTR, 20);
    const index = listing.index.map(entry => {
        const fixed = Buffer.alloc(12);
        fixed.writeUInt32LE(entry.offset, 0);
        // The block the indexed header falls in, which the listing may have carried into a later
        // block than the one it started in.
        fixed.writeUInt32LE(table.locate(startOffset + entry.offset).block, 4);
        fixed.writeUInt32LE(entry.name.length - 1, 8);
        return Buffer.concat([fixed, entry.name]);
    });
    return Buffer.concat([inodeHeader(INODE_EXTENDED_DIRECTORY, directory.mode, mtime, directory.inodeNumber), body, ...index]);
}

type DirectoryListing = {
    bytes: Buffer;
    /** Headers a lookup can jump to: their offset in the listing and the first name under each. */
    index: Array<{ offset: number; name: Buffer }>;
};

/**
 * A directory's entries in the on-disk form: runs of entries, each run after a header naming the
 * inode block and base inode number its entries are relative to.
 *
 * A run ends - and a new header starts - when it reaches 256 entries, when the next child's inode is
 * in a different metadata block, or when its inode number is too far from the header's for the
 * 16-bit distance an entry stores. Those are the format's own limits.
 *
 * The fourth reason is the index: once more than a metadata block's worth of listing has gone by
 * since the last indexed header, a new header starts and is indexed. A lookup reads the index to
 * skip straight to the run a name would be in instead of reading the whole listing, which is the
 * difference between a large directory costing one block read and costing all of them. This is
 * `mksquashfs`'s own rule, kept as it is so a large directory is indexed the way readers are used to.
 */
function directoryListing(children: readonly TreeNode[]): DirectoryListing {
    const parts: Buffer[] = [];
    const index: DirectoryListing["index"] = [];
    let length = 0;
    let header: Buffer | null = null;
    let headerCount = 0;
    let headerBlock = 0;
    let headerInode = 0;
    let lastIndexed = 0;
    for (const child of children) {
        const ref = child.ref!;
        const name = child.nameBytes;
        const entryLength = 8 + name.length;
        const distance = child.inodeNumber - headerInode;
        const needsIndex = header !== null && length + entryLength - lastIndexed > METADATA_BLOCK_SIZE;
        if (
            header === null
            || headerCount === MAX_ENTRIES_PER_HEADER
            || ref.block !== headerBlock
            || needsIndex
            || distance > 32767
            || distance < -32768
        ) {
            if (header !== null) {
                if (needsIndex) {
                    index.push({ offset: length, name });
                    lastIndexed = length;
                }
                header.writeUInt32LE(headerCount - 1, 0);
            }
            header = Buffer.alloc(12);
            headerBlock = ref.block;
            headerInode = child.inodeNumber;
            headerCount = 0;
            header.writeUInt32LE(headerBlock, 4);
            header.writeUInt32LE(headerInode, 8);
            parts.push(header);
            length += 12;
        }
        const entry = Buffer.alloc(8);
        entry.writeUInt16LE(ref.offset, 0);
        entry.writeInt16LE(child.inodeNumber - headerInode, 2);
        // Always the basic type, even for an inode written in its extended form.
        entry.writeUInt16LE(child.kind === "directory" ? INODE_DIRECTORY : child.kind === "file" ? INODE_FILE : INODE_SYMLINK, 4);
        entry.writeUInt16LE(name.length - 1, 6);
        parts.push(entry, name);
        length += entryLength;
        headerCount++;
    }
    if (header !== null) {
        header.writeUInt32LE(headerCount - 1, 0);
    }
    return { bytes: Buffer.concat(parts), index };
}

const MAX_ENTRIES_PER_HEADER = 256;

// ---------------------------------------------------------------------------------------------
// The superblock

const SUPERBLOCK_SIZE = 96;
const SQUASHFS_MAGIC = 0x73717368;
const NO_TABLE = 0xffffffffffffffffn;
const PAD_TO = 4096;

const FLAG_NO_FRAGMENTS = 0x0010;
const FLAG_EXPORTABLE = 0x0080;
const FLAG_NO_XATTRS = 0x0200;

function superblock(fields: {
    inodeCount: number;
    mtime: number;
    compressionId: number;
    rootInode: bigint;
    bytesUsed: number;
    idTableStart: number;
    inodeTableStart: number;
    directoryTableStart: number;
    fragmentTableStart: number;
    exportTableStart: number;
}): Buffer {
    const block = Buffer.alloc(SUPERBLOCK_SIZE);
    block.writeUInt32LE(SQUASHFS_MAGIC, 0);
    block.writeUInt32LE(fields.inodeCount, 4);
    block.writeUInt32LE(fields.mtime, 8);
    block.writeUInt32LE(SQUASHFS_BLOCK_SIZE, 12);
    block.writeUInt32LE(0, 16); // fragments
    block.writeUInt16LE(fields.compressionId, 20);
    block.writeUInt16LE(BLOCK_LOG, 22);
    block.writeUInt16LE(FLAG_NO_FRAGMENTS | FLAG_EXPORTABLE | FLAG_NO_XATTRS, 24);
    block.writeUInt16LE(1, 26); // ids
    block.writeUInt16LE(4, 28);
    block.writeUInt16LE(0, 30);
    block.writeBigUInt64LE(fields.rootInode, 32);
    block.writeBigUInt64LE(BigInt(fields.bytesUsed), 40);
    block.writeBigUInt64LE(BigInt(fields.idTableStart), 48);
    block.writeBigUInt64LE(NO_TABLE, 56); // xattr id table
    block.writeBigUInt64LE(BigInt(fields.inodeTableStart), 64);
    block.writeBigUInt64LE(BigInt(fields.directoryTableStart), 72);
    block.writeBigUInt64LE(BigInt(fields.fragmentTableStart), 80);
    block.writeBigUInt64LE(BigInt(fields.exportTableStart), 88);
    return block;
}
