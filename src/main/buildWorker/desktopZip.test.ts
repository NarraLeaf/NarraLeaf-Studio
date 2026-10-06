import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import zlib from "zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { folderArchiveItems, writeFolderZip } from "./desktopZip";
import { parseZipIndex, readEntryBytes } from "./mobile/zipModel";

let root: string;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nl-desktop-zip-"));
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

/** A small laid-out Windows app: an executable, a resources folder with a sealed store in it. */
async function layOutApp(dir: string): Promise<Map<string, Buffer>> {
    const files = new Map<string, Buffer>([
        ["Game.exe", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300_000, 0x41)])],
        ["resources/app.asar", Buffer.from(JSON.stringify({ files: { "pack.json": { size: 10 } } }).repeat(500))],
        ["resources/app.asar.unpacked/assets.bin", crypto.randomBytes(2_500_000)],
        ["locales/en-US.pak", Buffer.alloc(0)],
    ]);
    for (const [name, data] of files) {
        const target = path.join(dir, ...name.split("/"));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, data);
    }
    return files;
}

describe("writeFolderZip", () => {
    it("puts the app's files at the top of the archive, each one reading back as it was", async () => {
        const app = path.join(root, "win-unpacked");
        const files = await layOutApp(app);
        const file = path.join(root, "Game-1.0.0-win-x64.zip");
        await writeFolderZip(app, file, { mtime: new Date(Date.UTC(2026, 0, 1)) });

        const archive = await fs.readFile(file);
        const entries = parseZipIndex(archive).entries;
        expect(entries.map(entry => entry.name)).toEqual([
            "Game.exe",
            "locales/",
            "locales/en-US.pak",
            "resources/",
            "resources/app.asar",
            "resources/app.asar.unpacked/",
            "resources/app.asar.unpacked/assets.bin",
        ]);
        for (const entry of entries.filter(entry => !entry.isDirectory)) {
            const data = readEntryBytes(archive, entry);
            expect(data.equals(files.get(entry.name)!)).toBe(true);
            expect(zlib.crc32(data)).toBe(entry.crc32);
        }
    });

    it("takes each file's mode from the caller, as a Linux app's are read from its content", async () => {
        const app = path.join(root, "linux-unpacked");
        await layOutApp(app);
        const items = await folderArchiveItems(app, absolute => (absolute.endsWith(".exe") ? 0o755 : 0o644));
        const modes = new Map(items.map(item => [item.name, item.mode]));
        expect(modes.get("Game.exe")).toBe(0o755);
        expect(modes.get("resources/app.asar")).toBe(0o644);
        expect(modes.get("resources/")).toBe(0o755);
    });

    it("refuses a link rather than following it out of the app", async () => {
        const app = path.join(root, "app");
        await fs.mkdir(app, { recursive: true });
        try {
            await fs.symlink(os.tmpdir(), path.join(app, "outside"), "junction");
        } catch {
            return;
        }
        await expect(folderArchiveItems(app, () => 0o644)).rejects.toThrow(/neither a file nor a folder/);
    });
});
