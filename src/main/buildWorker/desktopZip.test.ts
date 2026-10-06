import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import zlib from "zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { folderArchiveItems, linkStaysInside, writeFolderZip } from "./desktopZip";
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
        const items = await folderArchiveItems(app, { fileMode: absolute => (absolute.endsWith(".exe") ? 0o755 : 0o644) });
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
        await expect(folderArchiveItems(app)).rejects.toThrow(/outside the app/);
    });

    it("reads each file's own permission bits on a macOS or Linux host", async () => {
        const app = path.join(root, "linux-unpacked");
        await layOutApp(app);
        const executable = path.join(app, "Game.exe");
        await fs.chmod(executable, 0o755).catch(() => undefined);
        const own = (await fs.stat(executable)).mode & 0o777;
        const items = await folderArchiveItems(app, { posix: true });
        expect(items.find(item => item.name === "Game.exe")?.mode).toBe(own);
        // And on Windows, where Node makes the bits up, the fixed ones electron-builder used.
        const invented = await folderArchiveItems(app, { posix: false });
        expect(invented.find(item => item.name === "Game.exe")?.mode).toBe(0o644);
        expect(invented.find(item => item.name === "resources/")?.mode).toBe(0o755);
    });

    it("puts a macOS bundle inside one folder named after it, as electron-builder's zip does", async () => {
        const bundle = path.join(root, "mac-arm64", "Game.app");
        await fs.mkdir(path.join(bundle, "Contents", "MacOS"), { recursive: true });
        await fs.writeFile(path.join(bundle, "Contents", "MacOS", "Game"), Buffer.from("macho"));
        await fs.writeFile(path.join(bundle, "Contents", "Info.plist"), Buffer.from("<plist/>"));
        const file = path.join(root, "Game-1.0.0-mac-arm64.zip");
        await writeFolderZip(bundle, file, { topFolder: "Game.app", mtime: new Date(Date.UTC(2026, 0, 1)) });
        expect(parseZipIndex(await fs.readFile(file)).entries.map(entry => entry.name)).toEqual([
            "Game.app/",
            "Game.app/Contents/",
            "Game.app/Contents/Info.plist",
            "Game.app/Contents/MacOS/",
            "Game.app/Contents/MacOS/Game",
        ]);
    });

    it("keeps a framework's relative links as links", async () => {
        const framework = path.join(root, "Electron Framework.framework");
        await fs.mkdir(path.join(framework, "Versions", "A"), { recursive: true });
        await fs.writeFile(path.join(framework, "Versions", "A", "Electron Framework"), Buffer.from("macho"));
        try {
            await fs.symlink("A", path.join(framework, "Versions", "Current"));
            await fs.symlink("Versions/Current/Electron Framework", path.join(framework, "Electron Framework"));
        } catch {
            // A Windows host without the right to make links has nothing to prove here; the macOS
            // and Linux runs of this file do.
            return;
        }
        const items = await folderArchiveItems(framework, { posix: true });
        const links = items.filter(item => item.kind === "symlink").map(item => [item.name, item.kind === "symlink" ? item.target : ""]);
        expect(links).toEqual([
            ["Electron Framework", "Versions/Current/Electron Framework"],
            ["Versions/Current", "A"],
        ]);
    });
});

describe("linkStaysInside", () => {
    it("allows a link that resolves inside the app, and refuses one that leaves it", () => {
        expect(linkStaysInside("Versions/Current", "A")).toBe(true);
        expect(linkStaysInside("Electron Framework", "Versions/Current/Electron Framework")).toBe(true);
        expect(linkStaysInside("Frameworks/X.framework/Versions/Current", "../../Y.framework")).toBe(true);
        expect(linkStaysInside("Versions/Current", "../../outside")).toBe(false);
        expect(linkStaysInside("lib", "..")).toBe(false);
        expect(linkStaysInside("lib", "/usr/lib")).toBe(false);
        expect(linkStaysInside("lib", String.raw`C:\Users\author`)).toBe(false);
        expect(linkStaysInside("lib", "")).toBe(false);
    });
});
