import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import zlib from "zlib";
import { path7za } from "7zip-bin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    crc32,
    findMisalignedStoredEntries,
    parseZipIndex,
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
