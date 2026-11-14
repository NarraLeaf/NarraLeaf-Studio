import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BundleTree } from "../macBundle/bundleTree";
import { FileZipOutput, readZipAsTree, writeTreeAsZip } from "./archive";

let root: string;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nl-cross-archive-"));
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

describe("writeTreeAsZip / readZipAsTree", () => {
    it("carries directories, modes, symbolic links and files left on disk through a zip", async () => {
        const large = path.join(root, "assets.bin");
        const payload = crypto.randomBytes(200_000);
        await fs.writeFile(large, payload);
        const tree: BundleTree = new Map([
            ["Game.app", { kind: "directory", mode: 0o755 }],
            ["Game.app/Contents", { kind: "directory", mode: 0o755 }],
            ["Game.app/Contents/MacOS/Game", { kind: "file", mode: 0o755, data: Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3]) }],
            ["Game.app/Contents/Info.plist", { kind: "file", mode: 0o644, data: Buffer.from("<plist/>") }],
            ["Game.app/Contents/Frameworks/X.framework/Versions/Current", { kind: "symlink", mode: 0o755, target: "A" }],
            ["Game.app/Contents/Resources/assets.bin", {
                kind: "diskFile",
                mode: 0o644,
                path: large,
                size: payload.length,
                sha1: crypto.createHash("sha1").update(payload).digest(),
                sha256: crypto.createHash("sha256").update(payload).digest(),
            }],
        ]);
        const zip = path.join(root, "game.zip");

        await writeTreeAsZip(tree, zip, new Date(2026, 0, 1));
        const back = await readZipAsTree(zip);

        expect(back.get("Game.app")).toEqual({ kind: "directory", mode: 0o755 });
        expect(back.get("Game.app/Contents/MacOS/Game")).toEqual(tree.get("Game.app/Contents/MacOS/Game"));
        expect(back.get("Game.app/Contents/Info.plist")).toEqual(tree.get("Game.app/Contents/Info.plist"));
        expect(back.get("Game.app/Contents/Frameworks/X.framework/Versions/Current"))
            .toEqual({ kind: "symlink", mode: 0o755, target: "A" });
        const asset = back.get("Game.app/Contents/Resources/assets.bin");
        expect(asset?.kind === "file" && asset.data.equals(payload)).toBe(true);
    });

    it("writes the same bytes for the same tree", async () => {
        const tree: BundleTree = new Map([
            ["b.txt", { kind: "file", mode: 0o644, data: Buffer.from("b") }],
            ["a.txt", { kind: "file", mode: 0o644, data: Buffer.from("a") }],
        ]);
        const mtime = new Date(2026, 0, 1);
        await writeTreeAsZip(tree, path.join(root, "one.zip"), mtime);
        await writeTreeAsZip(new Map([...tree].reverse()), path.join(root, "two.zip"), mtime);

        expect((await fs.readFile(path.join(root, "one.zip"))).equals(await fs.readFile(path.join(root, "two.zip")))).toBe(true);
    });
});

describe("FileZipOutput", () => {
    it("writes a complete header patch when a file write is short", async () => {
        const file = path.join(root, "archive.zip");
        const handle = await fs.open(file, "w+");
        const open = vi.spyOn(fs, "open").mockResolvedValueOnce(handle);
        const originalWrite = handle.write.bind(handle);
        const write = vi.spyOn(handle, "write").mockImplementation(((
            buffer: Uint8Array,
            offset: number,
            length: number,
            position: number,
        ) => originalWrite(buffer, offset, Math.min(length, 2), position)) as typeof handle.write);
        const output = await FileZipOutput.create(file);
        try {
            await output.write(Buffer.from("0123456789"));
            await output.patch(2, Buffer.from("ABCDEFGH"));
        } finally {
            await output.close();
            open.mockRestore();
            write.mockRestore();
        }
        expect(await fs.readFile(file, "utf8")).toBe("01ABCDEFGH");
    });

    it("fails instead of looping when a file write makes no progress", async () => {
        const file = path.join(root, "stalled.zip");
        const handle = await fs.open(file, "w+");
        const open = vi.spyOn(fs, "open").mockResolvedValueOnce(handle);
        const write = vi.spyOn(handle, "write").mockResolvedValueOnce({ bytesWritten: 0, buffer: Buffer.alloc(0) } as never);
        const output = await FileZipOutput.create(file);
        try {
            await expect(output.patch(0, Buffer.from("header"))).rejects.toThrow(/no progress/);
        } finally {
            await output.close();
            open.mockRestore();
            write.mockRestore();
        }
    });
});
