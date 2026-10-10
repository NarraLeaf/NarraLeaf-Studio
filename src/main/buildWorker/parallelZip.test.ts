import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import zlib from "zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseZipIndex, readEntryBytes, ZIP_METHOD_DEFLATE, ZIP_METHOD_STORE } from "./mobile/zipModel";
import { BufferZipOutput, writeZip } from "./mobile/zipWriter";
import { storedBlocks, writeParallelZip, type ArchiveItem } from "./parallelZip";

const MTIME = new Date(Date.UTC(2026, 9, 5, 12, 0, 0));
/** Small pieces, so a test file of a few hundred kilobytes is many of them. */
const CHUNK = 64 * 1024;

let root: string;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nl-parallel-zip-"));
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

/**
 * Something like a game's script as JSON: compresses to around a third, with repeats that reach
 * across piece boundaries. Deterministic, so two calls with one seed are the same bytes.
 */
function prose(bytes: number, seed = 1): Buffer {
    const words = [
        "narration", "choice", "scene", "sprite", "voice", "chapter", "ending", "route", "morning", "letter",
        "station", "umbrella", "promise", "festival", "classroom", "rooftop", "summer", "whisper", "window", "train",
    ];
    let state = seed;
    const next = (): number => {
        state = (state * 1103515245 + 12345) >>> 0;
        return state >>> 16;
    };
    const lines: string[] = [];
    let length = 0;
    while (length < bytes) {
        const text = Array.from({ length: 4 + (next() % 9) }, () => words[next() % words.length]).join(" ");
        const line = `{"id":${next() * 7919},"speaker":"${words[next() % 6]}","text":"${text}"},`;
        lines.push(line);
        length += line.length + 1;
    }
    return Buffer.from(lines.join("\n")).subarray(0, bytes);
}

async function zip(items: ArchiveItem[], lanes = 4): Promise<Buffer> {
    const output = new BufferZipOutput();
    await writeParallelZip(output, items, { mtime: MTIME, lanes, chunkSize: CHUNK });
    return output.toBuffer();
}

function file(name: string, data: Buffer, mode = 0o644): ArchiveItem {
    return { kind: "file", name, mode, content: { kind: "memory", data } };
}

/**
 * Every entry read back, inflated where it was deflated, its CRC checked by zlib rather than by us.
 *
 * Tests compare the bytes with `Buffer.equals`, not `toEqual`/`toMatchObject`: vitest's structural
 * equality walks a Buffer one index at a time, which for a few hundred kilobytes takes seconds and
 * pushed this file past the test timeout on a loaded machine.
 */
function readBack(archive: Buffer): Map<string, { data: Buffer; method: number; compressedSize: number; unixMode: number }> {
    const entries = new Map<string, { data: Buffer; method: number; compressedSize: number; unixMode: number }>();
    for (const entry of parseZipIndex(archive).entries) {
        const data = readEntryBytes(archive, entry);
        expect(zlib.crc32(data)).toBe(entry.crc32);
        entries.set(entry.name, { data, method: entry.method, compressedSize: entry.compressedSize, unixMode: entry.unixMode });
    }
    return entries;
}

describe("writeParallelZip", () => {
    it("deflates a small file that shrinks and stores one that does not", async () => {
        const text = prose(10_000);
        const noise = crypto.randomBytes(10_000);
        const entries = readBack(await zip([file("readme.txt", text), file("noise.bin", noise), file("empty", Buffer.alloc(0))]));

        expect(entries.get("readme.txt")!.method).toBe(ZIP_METHOD_DEFLATE);
        expect(entries.get("readme.txt")!.data.equals(text)).toBe(true);
        expect(entries.get("readme.txt")!.compressedSize).toBeLessThan(text.length);
        expect(entries.get("noise.bin")).toMatchObject({ method: ZIP_METHOD_STORE, compressedSize: noise.length });
        expect(entries.get("noise.bin")!.data.equals(noise)).toBe(true);
        expect(entries.get("empty")).toMatchObject({ method: ZIP_METHOD_STORE, compressedSize: 0 });
        expect(entries.get("empty")!.data.length).toBe(0);
    });

    it("joins the pieces of a large file into one stream any reader inflates", async () => {
        const text = prose(CHUNK * 7 + 1234);
        const entries = readBack(await zip([file("story.json", text)]));

        expect(entries.get("story.json")!.method).toBe(ZIP_METHOD_DEFLATE);
        expect(entries.get("story.json")!.data.equals(text)).toBe(true);
        // Primed with the window before it, each piece compresses about as well as one encoder over
        // the whole file would: within a fraction of a percent.
        const whole = zlib.deflateRawSync(text, { level: 9, memLevel: 9 }).length;
        expect(entries.get("story.json")!.compressedSize).toBeLessThan(whole * 1.01);
    });

    it("writes the pieces of incompressible data as stored blocks, five bytes per 64 KiB over the data", async () => {
        const sealed = crypto.randomBytes(CHUNK * 5 + 777);
        const entries = readBack(await zip([file("assets.bin", sealed)]));

        const entry = entries.get("assets.bin")!;
        expect(entry.data.equals(sealed)).toBe(true);
        // Six pieces, each its own run of stored blocks: a 64 KiB piece is one byte past what one
        // block carries, so it takes two.
        const blocksFor = (length: number) => 5 * Math.ceil(length / 0xffff);
        expect(entry.compressedSize).toBe(sealed.length + 5 * blocksFor(CHUNK) + blocksFor(777));
    });

    it("chooses per piece, so a file that is half noise and half text still shrinks", async () => {
        const mixed = Buffer.concat([crypto.randomBytes(CHUNK * 3), prose(CHUNK * 3)]);
        const entries = readBack(await zip([file("app.asar", mixed)]));

        expect(entries.get("app.asar")!.data.equals(mixed)).toBe(true);
        expect(entries.get("app.asar")!.compressedSize).toBeLessThan(CHUNK * 3 + CHUNK);
    });

    it("reads a file from disk a piece at a time into the same archive as from memory", async () => {
        const data = Buffer.concat([prose(CHUNK * 2), crypto.randomBytes(CHUNK * 2 + 99)]);
        const onDisk = path.join(root, "payload");
        await fs.writeFile(onDisk, data);

        const fromMemory = await zip([file("payload", data)]);
        const fromDisk = await zip([{ kind: "file", name: "payload", mode: 0o644, content: { kind: "disk", path: onDisk, size: data.length } }]);
        expect(fromDisk.equals(fromMemory)).toBe(true);
    });

    it("makes the same archive however many pieces run at once", async () => {
        const items = [
            file("a.txt", prose(CHUNK * 3 + 5, 2)),
            file("b.bin", crypto.randomBytes(CHUNK * 2)),
            file("c.txt", prose(500, 3)),
            file("d.txt", prose(CHUNK * 4, 4)),
        ];
        const one = await zip(items, 1);
        expect((await zip(items, 3)).equals(one)).toBe(true);
        expect((await zip(items, 16)).equals(one)).toBe(true);
    });

    it("carries directories, modes and links", async () => {
        const archive = await zip([
            { kind: "directory", name: "Game.app/", mode: 0o755 },
            file("Game.app/Contents/MacOS/Game", prose(CHUNK * 2), 0o755),
            { kind: "symlink", name: "Game.app/Contents/Frameworks/Current", target: "A", mode: 0o755 },
        ]);
        const index = parseZipIndex(archive);
        const byName = new Map(index.entries.map(entry => [entry.name, entry]));

        expect(byName.get("Game.app/")?.isDirectory).toBe(true);
        expect(byName.get("Game.app/Contents/MacOS/Game")!.unixMode & 0o777).toBe(0o755);
        const link = byName.get("Game.app/Contents/Frameworks/Current")!;
        expect(link.unixMode & 0o170000).toBe(0o120000);
        expect(readEntryBytes(archive, link).toString("utf8")).toBe("A");
    });

    it("refuses a file that is shorter on disk than it was listed", async () => {
        const onDisk = path.join(root, "shrunk");
        await fs.writeFile(onDisk, prose(CHUNK));
        await expect(zip([{ kind: "file", name: "shrunk", mode: 0o644, content: { kind: "disk", path: onDisk, size: CHUNK * 3 } }]))
            .rejects.toThrow(/changed while it was being archived/);
    });
});

describe("storedBlocks", () => {
    it("is Deflate a reader inflates back to the bytes, final only when asked", () => {
        const data = crypto.randomBytes(0xffff * 2 + 10);
        expect(zlib.inflateRawSync(storedBlocks(data, true)).equals(data)).toBe(true);
        // Without the final flag the stream is unfinished, which a strict inflate reports.
        expect(() => zlib.inflateRawSync(storedBlocks(data, false))).toThrow();
    });
});

describe("a deflated entry of 4 GiB or more", () => {
    it("gets zip64 sizes, with the compressed size patched in once its stream has gone past", async () => {
        const size = 2 ** 32 + 10;
        const encoded = Buffer.from([0x03, 0x00]);
        const output = new BufferZipOutput();
        await writeZip(output, [{
            name: "huge.bin",
            source: {
                kind: "deflated",
                size,
                crc32: () => 0x12345678,
                open: async function* () {
                    yield encoded;
                },
            },
        }], { mtime: MTIME, allowZip64: true });
        const archive = output.toBuffer();

        const [entry] = parseZipIndex(archive).entries;
        expect(entry).toMatchObject({ uncompressedSize: size, compressedSize: encoded.length, crc32: 0x12345678 });
        // The local header: 32-bit sizes hold the marker, and the zip64 extra holds both real sizes.
        expect(archive.readUInt32LE(18)).toBe(0xffffffff);
        expect(archive.readUInt32LE(22)).toBe(0xffffffff);
        const extra = 30 + "huge.bin".length;
        expect(archive.readUInt16LE(extra)).toBe(0x0001);
        expect(Number(archive.readBigUInt64LE(extra + 4))).toBe(size);
        expect(Number(archive.readBigUInt64LE(extra + 12))).toBe(encoded.length);
        expect(archive.readUInt32LE(14)).toBe(0x12345678);
    });
});
