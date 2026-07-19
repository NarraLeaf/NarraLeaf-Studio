/**
 * resources.arsc package-name patcher for the APK repack. Pure: Buffer in →
 * Buffer out, no fs.
 *
 * The package name lives in a fixed char16[128] slot inside each
 * ResTable_package header, so the rename is an in-place UTF-16LE write -
 * nothing moves, chunk sizes stay identical, and every other byte of the
 * table (type/key string pools, resource entries) passes through untouched.
 * That, plus the fact that the repack never adds resources, is what makes
 * the arsc side of the rename trivial where the manifest side needs a pool
 * rebuild (axml.ts).
 */

const RES_TABLE_TYPE = 0x0002;
const RES_TABLE_PACKAGE_TYPE = 0x0200;

/** char16[128], null-terminated: 127 usable UTF-16 code units. */
const PACKAGE_NAME_SLOT_BYTES = 256;
const PACKAGE_NAME_MAX_UNITS = 127;
/** Offset of the name slot inside a ResTable_package chunk (header + id). */
const PACKAGE_NAME_OFFSET = 12;

type Chunk = { type: number; start: number; headerSize: number; size: number };

function readChunk(buffer: Buffer, offset: number): Chunk {
    if (offset + 8 > buffer.length) {
        throw new Error("Truncated resource-table chunk header");
    }
    const size = buffer.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > buffer.length) {
        throw new Error("Resource-table chunk size out of bounds");
    }
    return {
        type: buffer.readUInt16LE(offset),
        start: offset,
        headerSize: buffer.readUInt16LE(offset + 2),
        size,
    };
}

function packageChunks(arsc: Buffer): Chunk[] {
    const root = readChunk(arsc, 0);
    if (root.type !== RES_TABLE_TYPE) {
        throw new Error("Not a resources.arsc file (missing RES_TABLE header)");
    }
    const chunks: Chunk[] = [];
    let cursor = root.headerSize;
    while (cursor < root.size) {
        const chunk = readChunk(arsc, cursor);
        if (chunk.type === RES_TABLE_PACKAGE_TYPE) {
            chunks.push(chunk);
        }
        cursor += chunk.size;
    }
    return chunks;
}

function readPackageName(arsc: Buffer, chunk: Chunk): string {
    const slot = arsc.subarray(chunk.start + PACKAGE_NAME_OFFSET, chunk.start + PACKAGE_NAME_OFFSET + PACKAGE_NAME_SLOT_BYTES);
    let end = 0;
    while (end < PACKAGE_NAME_MAX_UNITS && slot.readUInt16LE(end * 2) !== 0) {
        end++;
    }
    return slot.subarray(0, end * 2).toString("utf16le");
}

/** Every package name the table declares, in chunk order (for verification). */
export function parseArscPackageNames(arsc: Buffer): string[] {
    return packageChunks(arsc).map(chunk => readPackageName(arsc, chunk));
}

/**
 * Rename the table's single package in place. The shell template contract is
 * exactly one package (the CI asserts it); more than one means the template
 * changed shape and the repack must stop rather than guess which to rename.
 */
export function patchArscPackageName(arsc: Buffer, packageName: string): { data: Buffer; previous: string } {
    if (packageName.length > PACKAGE_NAME_MAX_UNITS) {
        throw new Error(`Package name exceeds ${PACKAGE_NAME_MAX_UNITS} UTF-16 units: "${packageName}"`);
    }
    const chunks = packageChunks(arsc);
    if (chunks.length !== 1) {
        throw new Error(`Expected exactly one resource-table package, found ${chunks.length}`);
    }
    const previous = readPackageName(arsc, chunks[0]);
    const data = Buffer.from(arsc);
    const slotStart = chunks[0].start + PACKAGE_NAME_OFFSET;
    data.fill(0, slotStart, slotStart + PACKAGE_NAME_SLOT_BYTES);
    data.write(packageName, slotStart, "utf16le");
    return { data, previous };
}
