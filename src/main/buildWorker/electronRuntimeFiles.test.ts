import fsSync from "fs";
import fs from "fs/promises";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ELECTRON_DARWIN_ARM64_RELEASE_NAMES, ELECTRON_WIN32_X64_RELEASE_NAMES } from "./electronReleaseFixtures";
import { isElectronDistLitter, isElectronRuntimeOutput, tidyElectronStage } from "./electronRuntimeFiles";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const require_ = createRequire(__filename);

let root = "";

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-electron-stage-"));
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

/** Lay out `files` (relative, `/`-separated) under `dir`, each holding its own name. */
async function lay(dir: string, files: readonly string[]): Promise<void> {
    for (const relative of files) {
        const target = path.join(dir, ...relative.split("/"));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, relative, "utf-8");
    }
}

/** Every file under `dir`, relative, `/`-separated and sorted. */
async function listed(dir: string, prefix = ""): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await fs.readdir(path.join(dir, ...prefix.split("/").filter(Boolean)), { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            out.push(...await listed(dir, relative));
        } else {
            out.push(relative);
        }
    }
    return out.sort();
}

describe("the Electron runtime's litter rule", () => {
    it("names what a running Electron writes beside itself", () => {
        expect(isElectronRuntimeOutput("debug.log")).toBe(true);
        expect(isElectronRuntimeOutput("chrome_debug.log")).toBe(true);
        expect(isElectronRuntimeOutput("2f8e1c.dmp")).toBe(true);
        expect(isElectronRuntimeOutput("electron.exe")).toBe(false);
        expect(isElectronDistLitter("debug.log")).toBe(true);
        expect(isElectronDistLitter("Thumbs.db")).toBe(true);
        expect(isElectronDistLitter(".DS_Store")).toBe(true);
    });

    /*
     * The property the whole rule is chosen for. A denylist is only safe while nothing a release
     * ships is on it; these are the complete name sets of the releases Studio packages, so a rule
     * change that would drop part of the runtime fails here rather than on a player's machine.
     */
    it.each([
        ["win32-x64", ELECTRON_WIN32_X64_RELEASE_NAMES],
        ["darwin-arm64", ELECTRON_DARWIN_ARM64_RELEASE_NAMES],
    ])("keeps every name in the %s release", (_label, names) => {
        expect(names.length).toBeGreaterThan(50);
        expect(names.filter(name => isElectronDistLitter(name))).toEqual([]);
    });

    it("is asked about the release Studio actually ships", () => {
        // The fixtures were captured from 38.8.6. A major upgrade - where Electron's file set actually
        // moves - fails here on purpose: capture the new release's names (see electronReleaseFixtures.ts)
        // and update this major with them. A patch release inside the `^38` range resolves on any fresh
        // install and is let through.
        const installed = JSON.parse(
            fsSync.readFileSync(path.join(REPO_ROOT, "node_modules", "electron", "package.json"), "utf8"),
        ) as { version: string };
        expect(installed.version.split(".")[0]).toBe("38");
    });

    /*
     * prepare-preview-runner.js stages Studio's own preview runner from the same directory with a
     * plain-JavaScript copy of this rule. The two must agree on every name either is ever shown.
     */
    it("agrees with the packaging scripts' copy, name by name", () => {
        const { isElectronDistLitter: scriptRule } = require_(
            path.join(REPO_ROOT, "project", "build", "electron-dist-litter.js"),
        ) as { isElectronDistLitter?: (name: string) => boolean };
        expect(typeof scriptRule, "electron-dist-litter.js must export isElectronDistLitter").toBe("function");
        const names = [
            ...ELECTRON_WIN32_X64_RELEASE_NAMES,
            ...ELECTRON_DARWIN_ARM64_RELEASE_NAMES,
            "debug.log", "DEBUG.LOG", "crash.dmp", "notes.log.txt",
            ".DS_Store", "._electron.exe", "__MACOSX", ".AppleDouble", ".Spotlight-V100", ".Trashes",
            ".fseventsd", ".TemporaryItems", "Icon\r", "Icon", "Thumbs.db", "thumbs.db", "ehthumbs.db",
            "ehthumbs_vista.db", "desktop.ini", "Desktop.ini", ".directory",
            ".git", ".svn", ".hg", ".gitignore", "x.nltmp",
            "~$a.docx", ".a.swp", ".a.swo", "a.swp", "a~", "~", ".#a", "#a#", "#", "##",
        ];
        for (const name of names) {
            expect(scriptRule!(name), JSON.stringify(name)).toBe(isElectronDistLitter(name));
        }
    });
});

describe("tidying an unpacked Electron runtime", () => {
    it("brings a copied Windows installation to what a downloaded release packages", async () => {
        const appOutDir = path.join(root, "win-unpacked");
        await lay(appOutDir, [
            // What electron-builder left: the distribution, LICENSE already renamed.
            "electron.exe",
            "ffmpeg.dll",
            "LICENSE.electron.txt",
            "LICENSES.chromium.html",
            "locales/en-US.pak",
            "resources/default_app.asar",
            "version",
            // What the machine left.
            "debug.log",
            "4f1c0a.dmp",
            "Thumbs.db",
            "locales/desktop.ini",
        ]);

        const report = await tidyElectronStage({ appOutDir, platform: "windows", sourceDist: path.join(root, "dist") });

        expect(await listed(appOutDir)).toEqual([
            "LICENSE.electron.txt",
            "LICENSES.chromium.html",
            "electron.exe",
            "ffmpeg.dll",
            "locales/en-US.pak",
        ]);
        expect(report.removedLitter.sort()).toEqual(["4f1c0a.dmp", "Thumbs.db", "debug.log", "locales/desktop.ini"]);
    });

    it("reports nothing for a clean download, and leaves it as it was", async () => {
        const appOutDir = path.join(root, "linux-unpacked");
        await lay(appOutDir, ["electron", "LICENSE.electron.txt", "LICENSES.chromium.html", "resources.pak"]);

        const report = await tidyElectronStage({ appOutDir, platform: "linux" });

        expect(report.removedLitter).toEqual([]);
        expect(await listed(appOutDir)).toEqual(["LICENSE.electron.txt", "LICENSES.chromium.html", "electron", "resources.pak"]);
    });

    it("refuses a Windows or Linux runtime that brought no licence", async () => {
        const appOutDir = path.join(root, "win-unpacked");
        await lay(appOutDir, ["electron.exe", "LICENSES.chromium.html"]);

        await expect(tidyElectronStage({ appOutDir, platform: "windows" })).rejects.toThrow(/no LICENSE\b/);
    });

    it("moves a downloaded macOS release's licences inside the bundle before electron-builder deletes them", async () => {
        const appOutDir = path.join(root, "mac-arm64");
        await lay(appOutDir, [
            "Electron.app/Contents/Info.plist",
            "Electron.app/Contents/MacOS/Electron",
            "Electron.app/Contents/Resources/default_app.asar",
            "LICENSE",
            "LICENSES.chromium.html",
        ]);

        await tidyElectronStage({ appOutDir, platform: "macos" });

        expect(await listed(path.join(appOutDir, "Electron.app"))).toEqual([
            "Contents/Info.plist",
            "Contents/LICENSE.electron.txt",
            "Contents/LICENSES.chromium.html",
            "Contents/MacOS/Electron",
        ]);
        await expect(fs.readFile(path.join(appOutDir, "Electron.app", "Contents", "LICENSE.electron.txt"), "utf-8"))
            .resolves.toBe("LICENSE");
    });

    it("takes a copied macOS installation's licences from the installation, which electron-builder never copies", async () => {
        const sourceDist = path.join(root, "dist");
        await lay(sourceDist, ["Electron.app/Contents/Info.plist", "LICENSE", "LICENSES.chromium.html", "version", "debug.log"]);
        // electron-builder copies only the bundle out of an installation.
        const appOutDir = path.join(root, "mac-arm64");
        await lay(appOutDir, [
            "Electron.app/Contents/Info.plist",
            "Electron.app/Contents/Resources/default_app.asar",
            "Electron.app/Contents/Resources/.DS_Store",
        ]);

        const report = await tidyElectronStage({ appOutDir, platform: "macos", sourceDist });

        expect(await listed(appOutDir)).toEqual([
            "Electron.app/Contents/Info.plist",
            "Electron.app/Contents/LICENSE.electron.txt",
            "Electron.app/Contents/LICENSES.chromium.html",
        ]);
        expect(report.removedLitter).toEqual(["Electron.app/Contents/Resources/.DS_Store"]);
        // The installation itself is only read from.
        expect(await listed(sourceDist)).toEqual([
            "Electron.app/Contents/Info.plist", "LICENSE", "LICENSES.chromium.html", "debug.log", "version",
        ]);
    });

    it("refuses a macOS runtime whose licences are nowhere to be found", async () => {
        const appOutDir = path.join(root, "mac-arm64");
        await lay(appOutDir, ["Electron.app/Contents/Info.plist"]);

        await expect(tidyElectronStage({ appOutDir, platform: "macos", sourceDist: path.join(root, "nothing") }))
            .rejects.toThrow(/no LICENSE\b/);
    });

    /*
     * A macOS bundle's frameworks are held together by links (`Versions/Current -> A`). The walk
     * must neither visit a tree twice through one nor reach through one into somewhere else.
     * A junction stands in on Windows, where creating a symbolic link needs a privilege.
     */
    it("does not follow a link out of the runtime", async () => {
        const outside = path.join(root, "outside");
        await lay(outside, ["debug.log", "keep.txt"]);
        const appOutDir = path.join(root, "linux-unpacked");
        await lay(appOutDir, ["electron", "LICENSE.electron.txt", "LICENSES.chromium.html"]);
        await fs.symlink(outside, path.join(appOutDir, "linked"), process.platform === "win32" ? "junction" : "dir");

        const report = await tidyElectronStage({ appOutDir, platform: "linux" });

        expect(report.removedLitter).toEqual([]);
        expect(await listed(outside)).toEqual(["debug.log", "keep.txt"]);
    });
});

/*
 * Studio's own macOS package: electron-builder deletes the two licence texts there too, and
 * electron-builder.yml puts them back. That is a packaging line nothing executes before a release,
 * so it is held here.
 */
describe("Studio's own macOS package", () => {
    it("names both Electron licences in the macOS resources", () => {
        const config = fsSync.readFileSync(path.join(REPO_ROOT, "electron-builder.yml"), "utf8").replace(/\r\n/g, "\n");
        const macBlock = /^mac:\n((?: {2}.*\n|\s*\n)+)/m.exec(config)?.[1] ?? "";
        expect(macBlock, "electron-builder.yml must have a mac block").not.toBe("");
        expect(macBlock).toMatch(/- from: \.\/node_modules\/electron\/dist\/LICENSE\n\s+to: LICENSE\.electron\.txt\n/);
        expect(macBlock).toMatch(/- from: \.\/node_modules\/electron\/dist\/LICENSES\.chromium\.html\n\s+to: LICENSES\.chromium\.html\n/);
    });
});
