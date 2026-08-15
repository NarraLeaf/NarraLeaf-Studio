import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import zlib from "zlib";
import { path7za } from "7zip-bin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    CENTRAL_HEADER_SIZE,
    crc32,
    EOCD_SIZE,
    findMisalignedStoredEntries,
    LOCAL_HEADER_SIZE,
    parseZipIndex,
    readEntryBytes,
    readLocalEntryDataSpan,
    toDosDateTime,
    ZIP_METHOD_DEFLATE,
    ZIP_METHOD_STORE,
} from "./zipModel";

const run7za = promisify(execFile);

async function ensure7zaExecutable(): Promise<void> {
    if (process.platform === "win32") {
        return;
    }
    await fs.chmod(path7za, 0o755).catch(() => undefined);
}

describe("crc32", () => {
    it("matches the reference check value", () => {
        // The canonical CRC-32 test vector.
        expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    });

    it("handles empty input", () => {
        expect(crc32(Buffer.alloc(0))).toBe(0);
    });

    it("agrees with zlib's own trailer", () => {
        const data = Buffer.from("The quick brown fox jumps over the lazy dog");
        // gzip embeds a little-endian CRC-32 of the payload before the size.
        const gz = zlib.gzipSync(data);
        expect(crc32(data)).toBe(gz.readUInt32LE(gz.length - 8));
    });
});

describe("toDosDateTime", () => {
    it("packs the UTC fields with 2-second resolution", () => {
        const { dosTime, dosDate } = toDosDateTime(new Date(Date.UTC(2020, 5, 15, 10, 30, 45)));
        expect(dosDate).toBe(((2020 - 1980) << 9) | (6 << 5) | 15);
        expect(dosTime).toBe((10 << 11) | (30 << 5) | Math.floor(45 / 2));
    });

    it("is timezone-independent for a fixed absolute instant", () => {
        // An epoch constant must pack identically on every machine - packing
        // from local-time getters once baked the build host's timezone into
        // every header.
        const { dosTime, dosDate } = toDosDateTime(new Date(1577836800000)); // 2020-01-01T00:00:00Z
        expect(dosDate).toBe(((2020 - 1980) << 9) | (1 << 5) | 1);
        expect(dosTime).toBe(0);
    });

    it("clamps pre-1980 dates to the DOS epoch", () => {
        const { dosDate } = toDosDateTime(new Date(Date.UTC(1970, 0, 1)));
        expect(dosDate >> 9).toBe(0);
    });
});

describe("parseZipIndex against 7za-produced archives", () => {
    let workDir: string;

    beforeEach(async () => {
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-zipmodel-"));
    });

    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true });
    });

    it("reads names, methods, sizes and data spans from a foreign writer's output", async () => {
        const text = Buffer.from("hello ".repeat(200));
        const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
        await fs.writeFile(path.join(workDir, "readme.txt"), text);
        await fs.writeFile(path.join(workDir, "image.bin"), binary);
        const zipPath = path.join(workDir, "out.zip");
        await ensure7zaExecutable();
        await run7za(path7za, ["a", "-tzip", "-y", zipPath, "."], { cwd: workDir });

        const buffer = await fs.readFile(zipPath);
        const index = parseZipIndex(buffer);
        const byName = new Map(index.entries.map(entry => [entry.name, entry]));

        const readme = byName.get("readme.txt");
        expect(readme).toBeDefined();
        expect(readme!.uncompressedSize).toBe(text.length);
        expect(readme!.crc32).toBe(crc32(text));
        const span = readLocalEntryDataSpan(buffer, readme!);
        const raw = buffer.subarray(span.start, span.end);
        const restored = readme!.method === ZIP_METHOD_DEFLATE ? zlib.inflateRawSync(raw) : Buffer.from(raw);
        expect(restored.equals(text)).toBe(true);

        const image = byName.get("image.bin");
        expect(image).toBeDefined();
        expect(image!.crc32).toBe(crc32(binary));
    });

    it("reads stored entries from a store-only archive", async () => {
        const payload = Buffer.from("stored-payload");
        await fs.writeFile(path.join(workDir, "asset.dat"), payload);
        const zipPath = path.join(workDir, "stored.zip");
        await ensure7zaExecutable();
        await run7za(path7za, ["a", "-tzip", "-mx=0", "-y", zipPath, "asset.dat"], { cwd: workDir });

        const buffer = await fs.readFile(zipPath);
        const [entry] = parseZipIndex(buffer).entries;
        expect(entry.method).toBe(ZIP_METHOD_STORE);
        const span = readLocalEntryDataSpan(buffer, entry);
        expect(buffer.subarray(span.start, span.end).equals(payload)).toBe(true);
        // Alignment checking runs on any archive, aligned or not.
        expect(Array.isArray(findMisalignedStoredEntries(buffer, 4))).toBe(true);
    });

    it("rejects non-zip input loudly", () => {
        expect(() => parseZipIndex(Buffer.from("definitely not a zip file, way too short?")))
            .toThrow(/end-of-central-directory/);
    });
});

/**
 * A one-entry archive assembled field by field. Every fixture below turns on
 * a central directory that disagrees with the bytes it describes, which no
 * writer - ours or 7za's - will produce on request.
 */
function forgeArchive(options: {
    name: string;
    method: number;
    /** The entry's data exactly as it lies in the file: deflated, or stored. */
    data: Buffer;
    /** What the directory claims the entry expands to. */
    declaredUncompressedSize: number;
    /** Defaults to the real length; larger is what a truncated archive looks like. */
    declaredCompressedSize?: number;
    /**
     * State the uncompressed size the way an archive past 4 GiB has to: the
     * 32-bit field saturated, the real value in a zip64 extra block.
     */
    zip64Size?: boolean;
}): Buffer {
    const nameBytes = Buffer.from(options.name, "utf8");
    const compressedSize = options.declaredCompressedSize ?? options.data.length;
    const { dosTime, dosDate } = toDosDateTime(new Date(Date.UTC(2020, 0, 1)));
    const checksum = crc32(options.data);

    const extra = Buffer.alloc(options.zip64Size ? 12 : 0);
    if (options.zip64Size) {
        extra.writeUInt16LE(0x0001, 0);
        extra.writeUInt16LE(8, 2);
        extra.writeBigUInt64LE(BigInt(options.declaredUncompressedSize), 4);
    }
    const uncompressedField = options.zip64Size ? 0xffffffff : options.declaredUncompressedSize >>> 0;

    const local = Buffer.alloc(LOCAL_HEADER_SIZE);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(options.zip64Size ? 45 : 20, 4);
    local.writeUInt16LE(options.method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressedSize >>> 0, 18);
    local.writeUInt32LE(uncompressedField, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(extra.length, 28);

    const central = Buffer.alloc(CENTRAL_HEADER_SIZE);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(options.zip64Size ? 45 : 20, 6);
    central.writeUInt16LE(options.method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressedSize >>> 0, 20);
    central.writeUInt32LE(uncompressedField, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(((0o100000 | 0o644) << 16) >>> 0, 38);
    central.writeUInt32LE(0, 42);

    const eocd = Buffer.alloc(EOCD_SIZE);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(CENTRAL_HEADER_SIZE + nameBytes.length + extra.length, 12);
    eocd.writeUInt32LE(LOCAL_HEADER_SIZE + nameBytes.length + extra.length + options.data.length, 16);

    return Buffer.concat([local, nameBytes, extra, options.data, central, nameBytes, extra, eocd]);
}

function onlyEntry(archive: Buffer) {
    return parseZipIndex(archive).entries[0];
}

describe("readEntryBytes against an archive that lies about its sizes", () => {
    // A miniature zip bomb: kilobytes on disk, megabytes out, and a directory
    // entry claiming it is neither.
    const expansion = Buffer.alloc(8 * 1024 * 1024, 0);
    const deflatedExpansion = zlib.deflateRawSync(expansion);

    it("returns a deflated entry that tells the truth about itself", () => {
        const payload = Buffer.from("hello ".repeat(200));
        const archive = forgeArchive({
            name: "readme.txt",
            method: ZIP_METHOD_DEFLATE,
            data: zlib.deflateRawSync(payload),
            declaredUncompressedSize: payload.length,
        });
        expect(readEntryBytes(archive, onlyEntry(archive)).equals(payload)).toBe(true);
    });

    it("refuses a deflate stream that expands past its declared size", () => {
        const archive = forgeArchive({
            name: "bomb.txt",
            method: ZIP_METHOD_DEFLATE,
            data: deflatedExpansion,
            declaredUncompressedSize: 64,
        });
        expect(() => readEntryBytes(archive, onlyEntry(archive)))
            .toThrow(/Failed to inflate "bomb\.txt" within its declared 64 bytes/);
    });

    it("refuses a deflate stream that stops short of its declared size", () => {
        const payload = Buffer.from("half a file");
        const archive = forgeArchive({
            name: "truncated.txt",
            method: ZIP_METHOD_DEFLATE,
            data: zlib.deflateRawSync(payload),
            declaredUncompressedSize: payload.length * 2,
        });
        expect(() => readEntryBytes(archive, onlyEntry(archive)))
            .toThrow(/"truncated\.txt" yields 11 bytes but declares 22/);
    });

    it("refuses an entry that declares nothing and carries something", () => {
        const archive = forgeArchive({
            name: "sneaky.txt",
            method: ZIP_METHOD_DEFLATE,
            data: deflatedExpansion,
            declaredUncompressedSize: 0,
        });
        expect(() => readEntryBytes(archive, onlyEntry(archive))).toThrow(/"sneaky\.txt"/);
    });

    it("reads an entry that is genuinely empty", () => {
        // The ceiling's floor of 1 must not turn a zero-byte file into an error.
        const archive = forgeArchive({
            name: "empty.txt",
            method: ZIP_METHOD_DEFLATE,
            data: zlib.deflateRawSync(Buffer.alloc(0)),
            declaredUncompressedSize: 0,
        });
        expect(readEntryBytes(archive, onlyEntry(archive)).length).toBe(0);
    });

    it("takes a zip64 entry's size from the extra field, not the saturated sentinel", () => {
        const payload = Buffer.from("carried in the zip64 block");
        const archive = forgeArchive({
            name: "zip64.txt",
            method: ZIP_METHOD_DEFLATE,
            data: zlib.deflateRawSync(payload),
            declaredUncompressedSize: payload.length,
            zip64Size: true,
        });
        // Reading 0xffffffff as the size would leave the entry unbounded and
        // then fail the equality check, so passing here means the extra field
        // is what bounded the inflate.
        expect(readEntryBytes(archive, onlyEntry(archive)).equals(payload)).toBe(true);
    });

    it("refuses a stored entry whose data span disagrees with its declared size", () => {
        const archive = forgeArchive({
            name: "asset.dat",
            method: ZIP_METHOD_STORE,
            data: Buffer.from("stored-payload"),
            declaredUncompressedSize: 40,
        });
        expect(() => readEntryBytes(archive, onlyEntry(archive)))
            .toThrow(/"asset\.dat" yields 14 bytes but declares 40/);
    });

    it("refuses a stored entry whose span runs off the end of the archive", () => {
        const archive = forgeArchive({
            name: "asset.dat",
            method: ZIP_METHOD_STORE,
            data: Buffer.from("stored-payload"),
            declaredUncompressedSize: 4096,
            declaredCompressedSize: 4096,
        });
        expect(() => readEntryBytes(archive, onlyEntry(archive))).toThrow(/"asset\.dat" yields \d+ bytes/);
    });
});
