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
    ZIP_METHOD_DEFLATE,
    ZIP_METHOD_STORE,
} from "./zipModel";
import {
    BufferZipOutput,
    defaultMethodForName,
    writeZip,
    type ZipWriteEntry,
    type ZipWriteOptions,
} from "./zipWriter";

const run7za = promisify(execFile);

const MTIME = new Date(Date.UTC(2020, 0, 1, 12, 0, 0));
const APK_OPTIONS: ZipWriteOptions = { mtime: MTIME, alignStoredEntries: 4, allowZip64: false };
const IPA_OPTIONS: ZipWriteOptions = { mtime: MTIME, allowZip64: true };

async function ensure7zaExecutable(): Promise<void> {
    if (process.platform === "win32") {
        return;
    }
    await fs.chmod(path7za, 0o755).catch(() => undefined);
}

async function writeToBuffer(entries: ZipWriteEntry[], options: ZipWriteOptions): Promise<Buffer> {
    const output = new BufferZipOutput();
    await writeZip(output, entries, options);
    return output.toBuffer();
}

function inflateEntry(buffer: Buffer, name: string): Buffer {
    const entry = parseZipIndex(buffer).entries.find(candidate => candidate.name === name);
    if (!entry) {
        throw new Error(`No entry "${name}"`);
    }
    const span = readLocalEntryDataSpan(buffer, entry);
    const raw = buffer.subarray(span.start, span.end);
    return entry.method === ZIP_METHOD_DEFLATE ? zlib.inflateRawSync(raw) : Buffer.from(raw);
}

describe("defaultMethodForName", () => {
    it("stores already-compressed formats and deflates the rest", () => {
        expect(defaultMethodForName("assets/bg.png")).toBe("store");
        expect(defaultMethodForName("media/intro.mp4")).toBe("store");
        expect(defaultMethodForName("resources.arsc")).toBe("store");
        expect(defaultMethodForName("www/renderer.js")).toBe("deflate");
        expect(defaultMethodForName("pack.json")).toBe("deflate");
        expect(defaultMethodForName("no-extension")).toBe("deflate");
    });
});

describe("writeZip round trip", () => {
    const text = Buffer.from("narrative ".repeat(400));
    const media = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]);

    it("writes entries our own parser reads back verbatim", async () => {
        const buffer = await writeToBuffer([
            { name: "www/", source: null },
            { name: "www/index.html", source: { kind: "buffer", data: text } },
            { name: "www/assets/clip.png", source: { kind: "buffer", data: media }, unixMode: 0o600 },
        ], APK_OPTIONS);

        const index = parseZipIndex(buffer);
        expect(index.entries.map(entry => entry.name)).toEqual(["www/", "www/index.html", "www/assets/clip.png"]);

        const html = index.entries[1];
        expect(html.method).toBe(ZIP_METHOD_DEFLATE);
        expect(html.crc32).toBe(crc32(text));
        expect(html.uncompressedSize).toBe(text.length);
        expect(inflateEntry(buffer, "www/index.html").equals(text)).toBe(true);

        const png = index.entries[2];
        expect(png.method).toBe(ZIP_METHOD_STORE);
        expect(inflateEntry(buffer, "www/assets/clip.png").equals(media)).toBe(true);
        expect(png.unixMode & 0o777).toBe(0o600);

        const directory = index.entries[0];
        expect(directory.isDirectory).toBe(true);
        expect(directory.unixMode & 0o777).toBe(0o755);
    });

    it("produces byte-identical output for identical input", async () => {
        const entries = (): ZipWriteEntry[] => [
            { name: "a.txt", source: { kind: "buffer", data: text } },
            { name: "b.png", source: { kind: "buffer", data: media } },
        ];
        const first = await writeToBuffer(entries(), APK_OPTIONS);
        const second = await writeToBuffer(entries(), APK_OPTIONS);
        expect(first.equals(second)).toBe(true);
    });

    it("streams a chunked source with a patched CRC", async () => {
        const chunk = Buffer.from("streaming-chunk-");
        const chunkCount = 1024;
        const whole = Buffer.concat(Array.from({ length: chunkCount }, () => chunk));
        const openStream = () => (async function* () {
            for (let i = 0; i < chunkCount; i++) {
                yield chunk;
            }
        })();

        const buffer = await writeToBuffer([
            { name: "big.bin", source: { kind: "stream", size: whole.length, open: openStream }, method: "store" },
            { name: "big.txt", source: { kind: "stream", size: whole.length, open: openStream }, method: "deflate" },
        ], APK_OPTIONS);

        const [stored, deflated] = parseZipIndex(buffer).entries;
        expect(stored.crc32).toBe(crc32(whole));
        expect(stored.compressedSize).toBe(whole.length);
        expect(deflated.method).toBe(ZIP_METHOD_DEFLATE);
        expect(deflated.compressedSize).toBeLessThan(whole.length);
        expect(inflateEntry(buffer, "big.txt").equals(whole)).toBe(true);
        expect(inflateEntry(buffer, "big.bin").equals(whole)).toBe(true);
    });

    it("rejects a stream whose size was declared wrongly", async () => {
        const open = () => (async function* () {
            yield Buffer.from("only-a-few-bytes");
        })();
        await expect(writeToBuffer([
            { name: "liar.bin", source: { kind: "stream", size: 999, open }, method: "store" },
        ], APK_OPTIONS)).rejects.toThrow(/expected 999/);
    });

    it("passes raw entries through byte-identically without re-encoding", async () => {
        const original = await writeToBuffer([
            { name: "keep.txt", source: { kind: "buffer", data: text } },
            { name: "keep.png", source: { kind: "buffer", data: media } },
        ], APK_OPTIONS);
        const sourceIndex = parseZipIndex(original);

        const rawEntries: ZipWriteEntry[] = sourceIndex.entries.map(entry => {
            const span = readLocalEntryDataSpan(original, entry);
            return {
                name: entry.name,
                unixMode: entry.unixMode & 0o777,
                source: {
                    kind: "raw",
                    method: entry.method,
                    crc32: entry.crc32,
                    compressedSize: entry.compressedSize,
                    uncompressedSize: entry.uncompressedSize,
                    open: () => (async function* () {
                        yield original.subarray(span.start, span.end);
                    })(),
                },
            };
        });
        const repacked = await writeToBuffer(rawEntries, APK_OPTIONS);

        for (const entry of parseZipIndex(repacked).entries) {
            const source = sourceIndex.entries.find(candidate => candidate.name === entry.name)!;
            expect(entry.method).toBe(source.method);
            expect(entry.crc32).toBe(source.crc32);
            const repackedSpan = readLocalEntryDataSpan(repacked, entry);
            const sourceSpan = readLocalEntryDataSpan(original, source);
            expect(repacked.subarray(repackedSpan.start, repackedSpan.end)
                .equals(original.subarray(sourceSpan.start, sourceSpan.end))).toBe(true);
        }
        expect(inflateEntry(repacked, "keep.txt").equals(text)).toBe(true);
    });
});

describe("alignment", () => {
    it("aligns every stored entry's data start to 4 bytes, whatever the name length", async () => {
        const entries: ZipWriteEntry[] = [];
        for (let length = 1; length <= 9; length++) {
            entries.push({
                name: `${"n".repeat(length)}.png`,
                source: { kind: "buffer", data: Buffer.from([1, 2, 3, length]) },
            });
            entries.push({
                name: `${"t".repeat(length)}.txt`,
                source: { kind: "buffer", data: Buffer.from("deflate keeps offsets shifting") },
            });
        }
        const buffer = await writeToBuffer(entries, APK_OPTIONS);
        expect(findMisalignedStoredEntries(buffer, 4)).toEqual([]);
    });

    it("writes apksig-conformant alignment blocks (0xd935, multiple in the payload)", async () => {
        // apksig reads the first uint16 of the payload as the alignment
        // multiple when re-signing; a zero/absent multiple would let a later
        // apksigner run silently misalign stored entries.
        const entries: ZipWriteEntry[] = [];
        for (let length = 1; length <= 9; length++) {
            entries.push({
                name: `${"p".repeat(length)}.png`,
                source: { kind: "buffer", data: Buffer.from([length]) },
            });
        }
        const buffer = await writeToBuffer(entries, APK_OPTIONS);
        let blocksSeen = 0;
        for (const entry of parseZipIndex(buffer).entries) {
            const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
            const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
            const extraStart = entry.localHeaderOffset + 30 + nameLength;
            const extra = buffer.subarray(extraStart, extraStart + extraLength);
            let cursor = 0;
            while (cursor + 4 <= extra.length) {
                const id = extra.readUInt16LE(cursor);
                const size = extra.readUInt16LE(cursor + 2);
                if (id === 0xd935) {
                    blocksSeen++;
                    // apksig's minimum block: id + length + uint16 multiple.
                    expect(size).toBeGreaterThanOrEqual(2);
                    expect(extra.readUInt16LE(cursor + 4)).toBe(4);
                }
                cursor += 4 + size;
            }
        }
        expect(blocksSeen).toBeGreaterThan(0);
    });

    it("honors forceAlign for entries that must sit aligned regardless of policy", async () => {
        const buffer = await writeToBuffer([
            { name: "shift.txt", source: { kind: "buffer", data: Buffer.from("x") } },
            {
                name: "resources.arsc",
                source: { kind: "buffer", data: Buffer.from([9, 9, 9, 9]) },
                method: "store",
                forceAlign: 4,
            },
        ], { mtime: MTIME, allowZip64: false });
        const entry = parseZipIndex(buffer).entries.find(candidate => candidate.name === "resources.arsc")!;
        expect(entry.method).toBe(ZIP_METHOD_STORE);
        expect(readLocalEntryDataSpan(buffer, entry).start % 4).toBe(0);
    });
});

describe("entry validation", () => {
    const payload: ZipWriteEntry["source"] = { kind: "buffer", data: Buffer.from("x") };

    it("rejects unsafe and duplicate names", async () => {
        await expect(writeToBuffer([{ name: "../escape", source: payload }], APK_OPTIONS)).rejects.toThrow(/Unsafe/);
        await expect(writeToBuffer([{ name: "/rooted", source: payload }], APK_OPTIONS)).rejects.toThrow(/Unsafe/);
        await expect(writeToBuffer([{ name: "a\\b", source: payload }], APK_OPTIONS)).rejects.toThrow(/Unsafe/);
        await expect(writeToBuffer([
            { name: "twice.txt", source: payload },
            { name: "twice.txt", source: payload },
        ], APK_OPTIONS)).rejects.toThrow(/Duplicate/);
    });

    it("rejects a directory with data and a file without", async () => {
        await expect(writeToBuffer([{ name: "dir/", source: payload }], APK_OPTIONS)).rejects.toThrow(/must not/);
        await expect(writeToBuffer([{ name: "file.txt", source: null }], APK_OPTIONS)).rejects.toThrow(/must/);
    });
});

describe("zip64", () => {
    const manyEntries = (count: number): ZipWriteEntry[] => {
        const entries: ZipWriteEntry[] = [];
        for (let i = 0; i < count; i++) {
            entries.push({ name: `d/${i}`, source: { kind: "buffer", data: Buffer.alloc(0) }, method: "store" });
        }
        return entries;
    };

    it("switches to zip64 records at exactly 65535 entries (the EOCD sentinel) and parses back", async () => {
        // 0xFFFF in the EOCD count is the zip64 marker, so the boundary count
        // itself already needs the real value in a zip64 record — an archive
        // with a bare 0xFFFF count is one its own reader rejects.
        const output = new BufferZipOutput();
        const result = await writeZip(output, manyEntries(65535), IPA_OPTIONS);
        expect(result.zip64).toBe(true);
        const index = parseZipIndex(output.toBuffer());
        expect(index.zip64).toBe(true);
        expect(index.entries.length).toBe(65535);
        expect(index.entries[65534].name).toBe("d/65534");
    });

    it("stays plain zip below the sentinel", async () => {
        const output = new BufferZipOutput();
        const result = await writeZip(output, manyEntries(65534), IPA_OPTIONS);
        expect(result.zip64).toBe(false);
        expect(parseZipIndex(output.toBuffer()).entries.length).toBe(65534);
    });

    it("fails loudly instead of writing zip64 when the target forbids it", async () => {
        await expect(writeToBuffer(manyEntries(65535), APK_OPTIONS)).rejects.toThrow(/zip64/);
    });
});

describe("lazy source opening", () => {
    it("never opens a source it will reject (no fd to leak on guard failures)", async () => {
        let opened = false;
        const entries: ZipWriteEntry[] = [{
            name: "huge.bin",
            source: {
                kind: "raw",
                method: ZIP_METHOD_STORE,
                crc32: 0,
                compressedSize: 0x1_0000_0000,
                uncompressedSize: 0x1_0000_0000,
                open: () => {
                    opened = true;
                    return (async function* () {
                        yield Buffer.alloc(0);
                    })();
                },
            },
        }];
        await expect(writeToBuffer(entries, APK_OPTIONS)).rejects.toThrow(/zip64/);
        expect(opened).toBe(false);
    });
});

describe("7za validation of produced archives", () => {
    let workDir: string;

    beforeEach(async () => {
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-zipwriter-"));
    });

    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true });
    });

    it("produces archives 7za verifies and extracts byte-identically", async () => {
        const text = Buffer.from("<!doctype html><title>e2e</title>".repeat(50));
        const media = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
        const buffer = await writeToBuffer([
            { name: "www/", source: null },
            { name: "www/index.html", source: { kind: "buffer", data: text } },
            { name: "www/asset.png", source: { kind: "buffer", data: media } },
            { name: "shell-config.json", source: { kind: "buffer", data: Buffer.from("{\"a\":1}") } },
        ], APK_OPTIONS);
        const zipPath = path.join(workDir, "produced.zip");
        await fs.writeFile(zipPath, buffer);

        await ensure7zaExecutable();
        // "t" fully tests the archive structure and every entry's CRC.
        await run7za(path7za, ["t", zipPath]);

        const extractDir = path.join(workDir, "out");
        await run7za(path7za, ["x", `-o${extractDir}`, "-y", zipPath]);
        expect((await fs.readFile(path.join(extractDir, "www", "index.html"))).equals(text)).toBe(true);
        expect((await fs.readFile(path.join(extractDir, "www", "asset.png"))).equals(media)).toBe(true);
    });
});
