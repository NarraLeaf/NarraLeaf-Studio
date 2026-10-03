import { execFileSync, spawnSync } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
    fileHandleSink,
    SQUASHFS_BLOCK_SIZE,
    squashfsZstdAvailable,
    writeSquashfs,
    type SquashfsCompression,
    type SquashfsEntry,
    type SquashfsOptions,
    type SquashfsSink,
} from "./squashfs";
import { readSquashfs, type ReadEntry } from "./squashfsReader";

/** A sink that keeps the image in memory, applying the superblock patch when asked for the bytes. */
function memorySink(): { sink: SquashfsSink; bytes(): Buffer } {
    const chunks: Buffer[] = [];
    const patches: Array<[number, Buffer]> = [];
    return {
        sink: {
            async write(chunk) {
                chunks.push(Buffer.from(chunk));
            },
            async writeAt(position, chunk) {
                patches.push([position, Buffer.from(chunk)]);
            },
        },
        bytes() {
            const image = Buffer.concat(chunks);
            for (const [position, chunk] of patches) {
                chunk.copy(image, position);
            }
            return image;
        },
    };
}

async function imageOf(entries: SquashfsEntry[], options: SquashfsOptions = {}): Promise<Buffer> {
    const { sink, bytes } = memorySink();
    await writeSquashfs(entries, sink, { mtime: 1_700_000_000, ...options });
    return bytes();
}

function byPath(entries: readonly ReadEntry[]): Map<string, ReadEntry> {
    return new Map(entries.map(entry => [entry.path, entry]));
}

/** Content that compresses well, so blocks are stored compressed. */
function textOf(length: number, seed: string): Buffer {
    const line = Buffer.from(`${seed} the quick brown fox jumps over the lazy dog\n`);
    const out = Buffer.alloc(length);
    for (let at = 0; at < length; at += line.length) {
        line.copy(out, at);
    }
    return out;
}

/** An async iterable over `data` in chunks of awkward, varying sizes. */
function chunked(data: Buffer): () => AsyncIterable<Uint8Array> {
    return async function* () {
        const sizes = [1, 7, 4093, 65536, 131071, 131073, 300000];
        let at = 0;
        let turn = 0;
        while (at < data.length) {
            const size = sizes[turn++ % sizes.length];
            yield data.subarray(at, at + size);
            at += size;
        }
    };
}

const COMPRESSIONS: SquashfsCompression[] = squashfsZstdAvailable() ? ["zstd", "gzip"] : ["gzip"];

describe.each(COMPRESSIONS)("a squashfs image written with %s", compression => {
    const incompressible = randomBytes(SQUASHFS_BLOCK_SIZE * 2 + 1234);
    const compressible = textOf(SQUASHFS_BLOCK_SIZE * 3 + 77, "a");
    const entries = (): SquashfsEntry[] => [
        { kind: "file", path: "AppRun", mode: 0o755, content: Buffer.from("#!/bin/sh\nexec true\n") },
        { kind: "file", path: "empty", mode: 0o644, content: Buffer.alloc(0) },
        { kind: "file", path: "exactly-one-block", mode: 0o644, content: textOf(SQUASHFS_BLOCK_SIZE, "b") },
        { kind: "file", path: "one-block-and-a-byte", mode: 0o600, content: textOf(SQUASHFS_BLOCK_SIZE + 1, "c") },
        { kind: "file", path: "usr/lib/libnoise.so.1.0.0", mode: 0o644, content: incompressible },
        { kind: "symlink", path: "usr/lib/libnoise.so.1", target: "libnoise.so.1.0.0" },
        { kind: "file", path: "resources/app.asar", mode: 0o644, content: chunked(compressible) },
        { kind: "directory", path: "resources/empty", mode: 0o700 },
        { kind: "symlink", path: ".DirIcon", target: "usr/share/icons/hicolor/256x256/apps/game.png" },
        { kind: "file", path: "usr/share/icons/hicolor/256x256/apps/game.png", mode: 0o644, content: randomBytes(5000) },
        { kind: "file", path: "names/ünïcödé ✓.txt", mode: 0o644, content: Buffer.from("u") },
        { kind: "file", path: "names/UPPER", mode: 0o644, content: Buffer.from("U") },
        { kind: "file", path: "names/lower", mode: 0o644, content: Buffer.from("l") },
    ];

    it("reads back as the tree it was given, owned by root, with the modes it was given", async () => {
        const image = await imageOf(entries(), { compression });
        const read = readSquashfs(image);
        const found = byPath(read.entries);

        expect([...found.keys()].sort()).toEqual([
            "",
            ".DirIcon",
            "AppRun",
            "empty",
            "exactly-one-block",
            "names",
            "names/UPPER",
            "names/lower",
            "names/ünïcödé ✓.txt",
            "one-block-and-a-byte",
            "resources",
            "resources/app.asar",
            "resources/empty",
            "usr",
            "usr/lib",
            "usr/lib/libnoise.so.1",
            "usr/lib/libnoise.so.1.0.0",
            "usr/share",
            "usr/share/icons",
            "usr/share/icons/hicolor",
            "usr/share/icons/hicolor/256x256",
            "usr/share/icons/hicolor/256x256/apps",
            "usr/share/icons/hicolor/256x256/apps/game.png",
        ].sort());
        for (const entry of read.entries) {
            expect(entry.uid).toBe(0);
            expect(entry.gid).toBe(0);
            expect(entry.mtime).toBe(1_700_000_000);
        }
        expect(read.ids).toEqual([0]);

        expect(found.get("AppRun")).toMatchObject({ kind: "file", mode: 0o755 });
        expect(found.get("AppRun")!.data!.toString()).toBe("#!/bin/sh\nexec true\n");
        expect(found.get("empty")).toMatchObject({ kind: "file", mode: 0o644, size: 0 });
        expect(found.get("exactly-one-block")!.data).toEqual(textOf(SQUASHFS_BLOCK_SIZE, "b"));
        expect(found.get("one-block-and-a-byte")).toMatchObject({ mode: 0o600 });
        expect(found.get("one-block-and-a-byte")!.data).toEqual(textOf(SQUASHFS_BLOCK_SIZE + 1, "c"));
        expect(found.get("usr/lib/libnoise.so.1.0.0")!.data).toEqual(incompressible);
        expect(found.get("resources/app.asar")!.data).toEqual(compressible);
        expect(found.get("usr/lib/libnoise.so.1")).toMatchObject({ kind: "symlink", mode: 0o777, target: "libnoise.so.1.0.0" });
        expect(found.get(".DirIcon")!.target).toBe("usr/share/icons/hicolor/256x256/apps/game.png");
        // Declared directories keep their mode; implied ones, and the root, are 0755.
        expect(found.get("resources/empty")).toMatchObject({ kind: "directory", mode: 0o700, nlink: 2 });
        expect(found.get("usr/share/icons")).toMatchObject({ kind: "directory", mode: 0o755 });
        expect(found.get("")).toMatchObject({ kind: "directory", mode: 0o755, nlink: 2 + 3 });
        expect(found.get("names/ünïcödé ✓.txt")!.data!.toString()).toBe("u");
    });

    it("records the format, compression and table layout electron-builder's mksquashfs call produces", async () => {
        const image = await imageOf(entries(), { compression });
        const { superblock } = readSquashfs(image);
        expect(superblock.blockSize).toBe(128 * 1024);
        expect(superblock.compression).toBe(compression === "zstd" ? 6 : 1);
        // NO_FRAGMENTS | EXPORTABLE | NO_XATTRS. mksquashfs also sets DUPLICATES, which describes a
        // deduplication pass this writer does not make.
        expect(superblock.flags).toBe(0x0290);
        expect(superblock.fragments).toBe(0);
        expect(superblock.idCount).toBe(1);
        expect(superblock.mtime).toBe(1_700_000_000);
        // Padded to 4 KiB after the filesystem, the padding not counted in its size.
        expect(image.length % 4096).toBe(0);
        expect(image.length - superblock.bytesUsed).toBeLessThan(4096);
        expect(image.subarray(superblock.bytesUsed).every(byte => byte === 0)).toBe(true);
    });

    it("stores a block it could not shrink as it is", async () => {
        const noise = randomBytes(SQUASHFS_BLOCK_SIZE);
        const image = await imageOf([{ kind: "file", path: "noise", mode: 0o644, content: noise }], { compression });
        // The block follows the superblock unchanged.
        expect(image.subarray(96, 96 + noise.length)).toEqual(noise);
        expect(byPath(readSquashfs(image).entries).get("noise")!.data).toEqual(noise);
    });
});

describe("a squashfs image's directories", () => {
    it("index a large directory so every name is found the way the kernel looks names up", async () => {
        // Long names push the listing across many metadata blocks, which is what makes the writer
        // index it; files and subdirectories interleave so the children's inodes are spread over
        // several inode blocks, which splits the runs.
        const entries: SquashfsEntry[] = [];
        for (let i = 0; i < 3000; i++) {
            const name = `entry-${String(i).padStart(5, "0")}-${"x".repeat(i % 120)}`;
            if (i % 10 === 0) {
                entries.push({ kind: "file", path: `big/${name}/inside`, mode: 0o644, content: Buffer.from(name) });
            } else if (i % 7 === 0) {
                entries.push({ kind: "symlink", path: `big/${name}`, target: "elsewhere" });
            } else {
                entries.push({ kind: "file", path: `big/${name}`, mode: 0o644, content: Buffer.from(name) });
            }
        }
        const read = readSquashfs(await imageOf(entries));
        const found = byPath(read.entries);
        expect(read.indexedDirectories).toBe(1);
        const big = found.get("big")!;
        // Too long for the 16-bit size of the basic form, and indexed: the extended form.
        expect(big.inodeType).toBe(8);
        expect(big.nlink).toBe(2 + 300);
        expect(found.size).toBe(1 + 1 + 3000 + 300);
        expect(found.get("big/entry-02999-" + "x".repeat(2999 % 120))!.data!.toString()).toBe("entry-02999-" + "x".repeat(2999 % 120));
    });

    it("splits a run at 256 entries even when the listing is short", async () => {
        const entries: SquashfsEntry[] = Array.from({ length: 700 }, (_, i) => ({
            kind: "file" as const,
            path: `d/${i}`,
            mode: 0o644,
            content: Buffer.alloc(0),
        }));
        const read = readSquashfs(await imageOf(entries));
        expect(read.entries.filter(entry => entry.path.startsWith("d/"))).toHaveLength(700);
    });

    it("nests deeply", async () => {
        const deep = Array.from({ length: 60 }, (_, i) => `level${i}`).join("/");
        const read = readSquashfs(await imageOf([{ kind: "file", path: `${deep}/leaf`, mode: 0o644, content: Buffer.from("leaf") }]));
        expect(byPath(read.entries).get(`${deep}/leaf`)!.data!.toString()).toBe("leaf");
    });

    it("writes an image with nothing in it", async () => {
        const read = readSquashfs(await imageOf([]));
        expect(read.entries.map(entry => entry.path)).toEqual([""]);
    });
});

describe("a squashfs image's files", () => {
    it("reads a stream into the same blocks as the bytes it streams", async () => {
        const data = randomBytes(SQUASHFS_BLOCK_SIZE * 5 + 99);
        const fromBytes = await imageOf([{ kind: "file", path: "f", mode: 0o644, content: data }]);
        const fromStream = await imageOf([{ kind: "file", path: "f", mode: 0o644, content: chunked(data) }]);
        expect(fromStream).toEqual(fromBytes);
    });

    it("comes out the same whatever the compression concurrency", async () => {
        const entries = (): SquashfsEntry[] => Array.from({ length: 12 }, (_, i) => ({
            kind: "file" as const,
            path: `f${i}`,
            mode: 0o644,
            content: textOf(SQUASHFS_BLOCK_SIZE * (i % 4) + i * 1000, String(i)),
        }));
        const one = await imageOf(entries(), { concurrency: 1 });
        const many = await imageOf(entries(), { concurrency: 16 });
        expect(many).toEqual(one);
    });

    it("writes a file past 4 GiB with the extended inode", async () => {
        const length = 2 ** 32 + 5;
        const zeros = Buffer.alloc(4 * 1024 * 1024);
        const content = async function* (): AsyncIterable<Uint8Array> {
            let left = length;
            while (left > 0) {
                const take = Math.min(left, zeros.length);
                yield zeros.subarray(0, take);
                left -= take;
            }
        };
        // Content not kept: four gigabytes is more than a test should hold. The reader still
        // decompresses every block and checks its length against the size the inode records.
        const read = readSquashfs(await imageOf([{ kind: "file", path: "huge", mode: 0o644, content }]), { keepData: false });
        const huge = byPath(read.entries).get("huge")!;
        expect(huge.inodeType).toBe(9);
        expect(huge.size).toBe(length);
    }, 120_000);

    it("writes into a file after whatever is already in front of it", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nl-squashfs-"));
        try {
            const file = path.join(dir, "image");
            const prefix = Buffer.from("runtime goes here");
            const handle = await fs.open(file, "w+");
            try {
                await handle.write(prefix, 0, prefix.length, 0);
                await writeSquashfs(
                    [{ kind: "file", path: "a", mode: 0o644, content: Buffer.from("A") }],
                    fileHandleSink(handle, prefix.length),
                    { mtime: 1 },
                );
            } finally {
                await handle.close();
            }
            const written = await fs.readFile(file);
            expect(written.subarray(0, prefix.length)).toEqual(prefix);
            expect(byPath(readSquashfs(written.subarray(prefix.length)).entries).get("a")!.data!.toString()).toBe("A");
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});

describe("what a squashfs image refuses", () => {
    const file = (entryPath: string): SquashfsEntry => ({ kind: "file", path: entryPath, mode: 0o644, content: Buffer.alloc(0) });

    it.each([
        ["a backslash", "dir\\file"],
        ["a parent reference", "dir/../file"],
        ["an empty component", "dir//file"],
        ["a leading slash", "/file"],
        ["a dot component", "./file"],
        ["a name longer than 256 bytes", "x".repeat(257)],
    ])("a path with %s", async (_what, entryPath) => {
        await expect(imageOf([file(entryPath)])).rejects.toThrow();
    });

    it("the same path twice", async () => {
        await expect(imageOf([file("a"), file("a")])).rejects.toThrow(/listed twice/);
        await expect(imageOf([
            { kind: "directory", path: "d", mode: 0o755 },
            { kind: "directory", path: "d", mode: 0o755 },
        ])).rejects.toThrow(/listed twice/);
    });

    it("a path through a file", async () => {
        await expect(imageOf([file("a"), file("a/b")])).rejects.toThrow(/not a directory/);
    });

    it("a mode that is not permission bits", async () => {
        await expect(imageOf([{ kind: "file", path: "a", mode: 0o100644, content: Buffer.alloc(0) }])).rejects.toThrow(/mode/);
    });

    it("a symbolic link to nothing", async () => {
        await expect(imageOf([{ kind: "symlink", path: "a", target: "" }])).rejects.toThrow(/symbolic link/);
    });

    it("lets a directory a path implied be declared afterwards, once", async () => {
        const read = readSquashfs(await imageOf([file("d/a"), { kind: "directory", path: "d", mode: 0o750 }]));
        expect(byPath(read.entries).get("d")!.mode).toBe(0o750);
    });
});

/**
 * The reader above is this file's own, so a mistake shared by it and the writer would pass. Where
 * the real tool is installed - a Linux or macOS machine with squashfs-tools - it gets the last word.
 */
const unsquashfs = spawnSync("unsquashfs", ["-version"], { encoding: "utf8" });
describe.skipIf(unsquashfs.status !== 0)("a squashfs image, according to unsquashfs", () => {
    it("lists and extracts", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nl-unsquashfs-"));
        try {
            const imagePath = path.join(dir, "image.squashfs");
            const entries: SquashfsEntry[] = [
                { kind: "file", path: "bin/run", mode: 0o755, content: Buffer.from("#!/bin/sh\n") },
                { kind: "symlink", path: "run", target: "bin/run" },
                ...Array.from({ length: 2000 }, (_, i) => ({
                    kind: "file" as const,
                    path: `many/${"n".repeat(i % 90)}-${i}`,
                    mode: 0o644,
                    content: textOf(i * 37, String(i)),
                })),
            ];
            await fs.writeFile(imagePath, await imageOf(entries));
            const listing = execFileSync("unsquashfs", ["-lln", imagePath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
            expect(listing).toMatch(/-rwxr-xr-x 0\/0 +10 .* squashfs-root\/bin\/run/);
            expect(listing).toMatch(/lrwxrwxrwx 0\/0 +7 .* squashfs-root\/run -> bin\/run/);
            execFileSync("unsquashfs", ["-q", "-d", path.join(dir, "out"), imagePath]);
            expect(await fs.readFile(path.join(dir, "out", "many", `${"n".repeat(1999 % 90)}-1999`))).toEqual(textOf(1999 * 37, "1999"));
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
