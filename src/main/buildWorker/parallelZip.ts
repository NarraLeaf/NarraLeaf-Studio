import fs from "fs/promises";
import { promisify } from "util";
import zlib from "zlib";
import { ZIP_METHOD_DEFLATE, ZIP_METHOD_STORE } from "./mobile/zipModel";
import { writeZip, type ZipOutput, type ZipWriteEntry, type ZipWriteResult } from "./mobile/zipWriter";
import { ARCHIVE_LANE_CEILING, resolveBuildLanes } from "./buildLanes";
import { countBuildStep } from "./stepProgress";

/**
 * A desktop game's zip, compressed on every core.
 *
 * A zip compresses each file as one Deflate stream, and an encoder works through one stream from
 * start to end - so a zip writer, 7-Zip's included, gives each file one thread. A game's zip is
 * dominated by two files: the Electron executable, around 200 MB, and with asset protection on the
 * sealed store, which is as large as the game's art and sound together. Written with one thread per
 * file, those two held a build for minutes while every other core waited.
 *
 * So each file is cut into 1 MiB pieces and the pieces are compressed at once, the way pigz does
 * it: every piece but the first is primed with the 32 KiB before it, the window Deflate can refer
 * back into, and every piece but the last ends with a sync flush, which leaves the stream on a byte
 * boundary with no final block. Laid end to end the pieces are one valid Deflate stream - any
 * unzip reads it as it reads any other - and the archive comes out within a few hundredths of a
 * percent of what one encoder over the whole file would have written.
 *
 * A piece that does not get smaller is written as stored blocks instead, the form Deflate keeps for
 * data it cannot shrink. The sealed store is encrypted and so incompressible from its first byte to
 * its last; it costs the build a read and a copy, plus five bytes per 64 KiB, rather than minutes of
 * searching for repetitions that are not there. A file small enough to be one piece is stored
 * outright when deflating it does not help.
 *
 * Compression is zlib at its highest level. 7-Zip's Deflate encoder searches harder and makes a
 * 200 MB Electron executable about five percent smaller, which across a whole game is about one
 * percent of the archive - the price of a zip that takes seconds instead of minutes.
 */

/** One thing in the archive. Items are written in the order they are given. */
export type ArchiveItem =
    | { kind: "directory"; name: string; mode: number }
    | { kind: "symlink"; name: string; target: string; mode: number }
    | { kind: "file"; name: string; mode: number; content: ArchiveFileContent };

/** A file's bytes: on disk, read a piece at a time, or already in memory. */
export type ArchiveFileContent =
    | { kind: "disk"; path: string; size: number }
    | { kind: "memory"; data: Buffer };

export type ParallelZipOptions = {
    /** Timestamp stamped on every entry, so the same files make the same archive. */
    mtime: Date;
    /** Injected in tests; how many pieces are compressed at once. Read from the machine otherwise. */
    lanes?: number;
    /** Injected in tests; the size a file is cut into. */
    chunkSize?: number;
};

/** The size of the pieces a file is cut into. Large enough that the 32 KiB primer is noise. */
const CHUNK_SIZE = 1024 * 1024;

/** How far back Deflate can refer: the primer each piece is given from the bytes before it. */
const DEFLATE_WINDOW = 32 * 1024;

/** The most one stored block can carry: its length field is 16 bits. */
const MAX_STORED_BLOCK = 0xffff;

/**
 * How many pieces may be compressed or waiting to be written, per lane.
 *
 * Pieces are started strictly in archive order and written in that order, so a lane that finishes
 * early waits for the one before it; a few pieces of slack per lane keep every lane busy without
 * letting a slow piece make the rest pile up in memory - at most a few dozen megabytes.
 */
const PIECES_PER_LANE = 4;

const deflateRaw = promisify(zlib.deflateRaw) as (buffer: Buffer, options: zlib.ZlibOptions) => Promise<Buffer>;

/**
 * zlib's CRC-32, in every Electron Studio ships (Node 22.2 and later). Tests on an older runtime
 * fall back to a table, which gives the same value.
 */
const crc32Of: (data: Buffer, value: number) => number =
    typeof (zlib as { crc32?: unknown }).crc32 === "function"
        ? (zlib as unknown as { crc32: (data: Buffer, value?: number) => number }).crc32
        : tableCrc32;

/** Write `items` to `output` as a zip, compressing the files' pieces on as many threads as there are lanes. */
export async function writeParallelZip(
    output: ZipOutput,
    items: readonly ArchiveItem[],
    options: ParallelZipOptions,
): Promise<ZipWriteResult> {
    const chunkSize = Math.max(DEFLATE_WINDOW, Math.floor(options.chunkSize ?? CHUNK_SIZE));
    const lanes = Math.max(1, Math.floor(options.lanes ?? resolveBuildLanes("NLS_BUILD_ZIP_LANES", ARCHIVE_LANE_CEILING)));

    // Every piece of every file, in the order the archive needs them.
    const pieces: Piece[] = [];
    const firstPiece = new Map<number, number>();
    let totalBytes = 0;
    items.forEach((item, index) => {
        if (item.kind !== "file") {
            return;
        }
        const size = contentSize(item.content);
        totalBytes += size;
        firstPiece.set(index, pieces.length);
        if (size <= chunkSize) {
            pieces.push({ content: item.content, offset: 0, length: size, last: true });
            return;
        }
        for (let offset = 0; offset < size; offset += chunkSize) {
            const length = Math.min(chunkSize, size - offset);
            pieces.push({ content: item.content, offset, length, last: offset + length === size });
        }
    });

    const pipeline = new PiecePipeline(pieces, lanes, lanes * PIECES_PER_LANE);
    const counted = countBuildStep(totalBytes, "byte");
    try {
        return await writeZip(output, entriesFor(items, firstPiece, pipeline, chunkSize, bytes => counted.advance(bytes)), {
            mtime: options.mtime,
            allowZip64: true,
        });
    } finally {
        counted.end();
        pipeline.abandon();
    }
}

type Piece = {
    content: ArchiveFileContent;
    offset: number;
    length: number;
    /** The file's last piece, which finishes the stream rather than flushing it. */
    last: boolean;
};

type CompressedPiece = {
    /** The piece's own bytes, for the CRC and for storing it when Deflate does not help. */
    raw: Buffer;
    deflated: Buffer;
};

/**
 * The archive's entries, made as the writer asks for them.
 *
 * A file of one piece waits for that piece before its entry is made, because whether it is stored
 * or deflated - and so its header - depends on the result. A file of several pieces is a Deflate
 * stream whose pieces are handed over as they arrive.
 */
async function* entriesFor(
    items: readonly ArchiveItem[],
    firstPiece: ReadonlyMap<number, number>,
    pipeline: PiecePipeline,
    chunkSize: number,
    advance: (bytes: number) => void,
): AsyncIterable<ZipWriteEntry> {
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item.kind === "directory") {
            yield { name: item.name.endsWith("/") ? item.name : `${item.name}/`, source: null, unixMode: item.mode };
            continue;
        }
        if (item.kind === "symlink") {
            yield {
                name: item.name,
                source: { kind: "buffer", data: Buffer.from(item.target, "utf8") },
                unixMode: item.mode,
                symlink: true,
            };
            continue;
        }
        const size = contentSize(item.content);
        const first = firstPiece.get(index) as number;
        if (size <= chunkSize) {
            const { raw, deflated } = await pipeline.take(first);
            advance(raw.length);
            const deflate = deflated.length < raw.length;
            const data = deflate ? deflated : raw;
            yield {
                name: item.name,
                source: {
                    kind: "raw",
                    method: deflate ? ZIP_METHOD_DEFLATE : ZIP_METHOD_STORE,
                    crc32: crc32Of(raw, 0),
                    compressedSize: data.length,
                    uncompressedSize: raw.length,
                    open: async function* () {
                        yield data;
                    },
                },
                unixMode: item.mode,
            };
            continue;
        }
        const count = Math.ceil(size / chunkSize);
        let crc = 0;
        let seen = 0;
        yield {
            name: item.name,
            source: {
                kind: "deflated",
                size,
                crc32: () => crc,
                open: async function* () {
                    for (let piece = first; piece < first + count; piece += 1) {
                        const { raw, deflated } = await pipeline.take(piece);
                        crc = crc32Of(raw, crc);
                        seen += raw.length;
                        advance(raw.length);
                        const last = piece === first + count - 1;
                        yield deflated.length < storedLength(raw.length) ? deflated : storedBlocks(raw, last);
                    }
                    if (seen !== size) {
                        throw new Error(`"${item.name}" was ${seen} bytes when read, not ${size}`);
                    }
                },
            },
            unixMode: item.mode,
        };
    }
}

/**
 * Pieces compressed ahead of the writer, at most `lanes` at a time, started in archive order and
 * handed over in that order.
 */
class PiecePipeline {
    private readonly results = new Map<number, Promise<CompressedPiece>>();
    private started = 0;
    private running = 0;
    private taken = 0;
    private abandoned = false;

    constructor(
        private readonly pieces: readonly Piece[],
        private readonly lanes: number,
        private readonly ahead: number,
    ) {}

    /** Piece `index`'s result. Called for every piece, in order. */
    async take(index: number): Promise<CompressedPiece> {
        if (index !== this.taken) {
            throw new Error(`piece ${index} asked for out of order (expected ${this.taken})`);
        }
        this.fill();
        const result = this.results.get(index) as Promise<CompressedPiece>;
        try {
            return await result;
        } finally {
            this.results.delete(index);
            this.taken += 1;
            this.fill();
        }
    }

    /** Start nothing more. Pieces already running finish on their own and are dropped. */
    abandon(): void {
        this.abandoned = true;
        this.results.clear();
    }

    private fill(): void {
        while (
            !this.abandoned
            && this.started < this.pieces.length
            && this.running < this.lanes
            && this.started - this.taken < this.ahead
        ) {
            const index = this.started;
            this.started += 1;
            this.running += 1;
            const result = compressPiece(this.pieces[index]).finally(() => {
                this.running -= 1;
                this.fill();
            });
            // A failure is thrown to whoever takes this piece; until then it must not count as unhandled.
            result.catch(() => undefined);
            this.results.set(index, result);
        }
    }
}

/** One piece, read with the window before it and compressed against that window. */
async function compressPiece(piece: Piece): Promise<CompressedPiece> {
    const primerStart = Math.max(0, piece.offset - DEFLATE_WINDOW);
    const bytes = await readRange(piece.content, primerStart, piece.offset + piece.length - primerStart);
    const primer = bytes.subarray(0, piece.offset - primerStart);
    const raw = bytes.subarray(piece.offset - primerStart);
    const deflated = await deflateRaw(raw, {
        level: zlib.constants.Z_BEST_COMPRESSION,
        memLevel: 9,
        ...(primer.length > 0 ? { dictionary: primer } : {}),
        finishFlush: piece.last ? zlib.constants.Z_FINISH : zlib.constants.Z_SYNC_FLUSH,
    });
    return { raw, deflated };
}

async function readRange(content: ArchiveFileContent, position: number, length: number): Promise<Buffer> {
    if (content.kind === "memory") {
        return content.data.subarray(position, position + length);
    }
    const buffer = Buffer.allocUnsafe(length);
    const handle = await fs.open(content.path, "r");
    try {
        let filled = 0;
        while (filled < length) {
            const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
            if (bytesRead === 0) {
                throw new Error(`${content.path} ended before byte ${position + length}; it changed while it was being archived`);
            }
            filled += bytesRead;
        }
        return buffer;
    } finally {
        await handle.close();
    }
}

function contentSize(content: ArchiveFileContent): number {
    return content.kind === "memory" ? content.data.length : content.size;
}

/** The bytes `length` bytes take as stored blocks. */
function storedLength(length: number): number {
    return length + 5 * Math.max(1, Math.ceil(length / MAX_STORED_BLOCK));
}

/**
 * Bytes as Deflate stored blocks: a byte holding the block header - the final flag, and type 00 -
 * then the length and its complement, then the bytes. Valid wherever a block may start, which after
 * a sync flush or at the start of a stream is a byte boundary.
 */
export function storedBlocks(raw: Buffer, final: boolean): Buffer {
    const blocks = Math.max(1, Math.ceil(raw.length / MAX_STORED_BLOCK));
    const out = Buffer.allocUnsafe(storedLength(raw.length));
    let at = 0;
    for (let block = 0; block < blocks; block += 1) {
        const start = block * MAX_STORED_BLOCK;
        const length = Math.min(MAX_STORED_BLOCK, raw.length - start);
        out[at] = final && block === blocks - 1 ? 1 : 0;
        out.writeUInt16LE(length, at + 1);
        out.writeUInt16LE(~length & 0xffff, at + 3);
        raw.copy(out, at + 5, start, start + length);
        at += 5 + length;
    }
    return out;
}

let crcTable: Uint32Array | null = null;

function tableCrc32(data: Buffer, value: number): number {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n += 1) {
            let c = n;
            for (let k = 0; k < 8; k += 1) {
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            }
            crcTable[n] = c >>> 0;
        }
    }
    let c = ~value >>> 0;
    for (let i = 0; i < data.length; i += 1) {
        c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    }
    return ~c >>> 0;
}
