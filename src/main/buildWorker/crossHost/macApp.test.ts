import crypto from "crypto";
import { parse as parsePlist, type PlistObject } from "plist";
import { describe, expect, it } from "vitest";
import type { BundleEntry, BundleTree } from "../macBundle/bundleTree";
import type { GameBuildWorkerFuses } from "../protocol";
import sanitizeFilenamePackage from "sanitize-filename";
import {
    asarHeaderHash,
    assembleMacApp,
    filterBundleIdentifier,
    macBuildVersion,
    macProductFilename,
    sanitizeFileName,
} from "./macApp";

/**
 * The bundle electron-builder's macOS packager would make, rebuilt from a miniature Electron release.
 * The real release is held against a real electron-builder bundle in macApp.golden.test.ts.
 */

const SENTINEL = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";

function plist(entries: Record<string, string>): Buffer {
    const body = Object.entries(entries).map(([key, value]) => `\t<key>${key}</key>\n\t<string>${value}</string>`).join("\n");
    return Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        + `<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`,
    );
}

function file(data: Buffer | string, mode = 0o644): BundleEntry {
    return { kind: "file", mode, data: Buffer.isBuffer(data) ? data : Buffer.from(data) };
}

function frameworkBinary(): Buffer {
    // A fuse wire of eight, as Electron 38 has: version 1, length 8, the release's defaults.
    return Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.from(SENTINEL), Buffer.from([1, 8]), Buffer.from("10110001")]);
}

function release(): BundleTree {
    const tree: BundleTree = new Map<string, BundleEntry>([
        ["LICENSE", file("electron licence")],
        ["LICENSES.chromium.html", file("<html>credits</html>")],
        ["version", file("38.8.6")],
        ["Electron.app", { kind: "directory", mode: 0o755 }],
        ["Electron.app/Contents/Info.plist", file(plist({
            CFBundleDisplayName: "Electron",
            CFBundleExecutable: "Electron",
            CFBundleIconFile: "electron.icns",
            CFBundleIdentifier: "com.github.Electron",
            CFBundleName: "Electron",
        }))],
        ["Electron.app/Contents/MacOS/Electron", file(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), 0o755)],
        ["Electron.app/Contents/Resources/default_app.asar", file("placeholder")],
        ["Electron.app/Contents/Resources/electron.icns", file("electron icon")],
        ["Electron.app/Contents/Resources/de.lproj", { kind: "directory", mode: 0o755 }],
        ["Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/Current", { kind: "symlink", mode: 0o755, target: "A" }],
        ["Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework", file(frameworkBinary(), 0o755)],
    ]);
    for (const locale of ["en", "en_GB", "en_FEMININE", "de", "ja", "zh_CN"]) {
        tree.set(`Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/${locale}.lproj/locale.pak`, file(locale));
    }
    for (const suffix of ["", " (Renderer)", " (Plugin)", " (GPU)"]) {
        const helper = `Electron.app/Contents/Frameworks/Electron Helper${suffix}.app/Contents`;
        tree.set(`${helper}/Info.plist`, file(plist({
            CFBundleExecutable: `Electron Helper${suffix}`,
            CFBundleIdentifier: "com.github.Electron.helper",
            CFBundleName: `Electron Helper${suffix}`,
        })));
        tree.set(`${helper}/MacOS/Electron Helper${suffix}`, file(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), 0o755));
    }
    return tree;
}

const FUSES: GameBuildWorkerFuses = {
    runAsNode: false,
    enableCookieEncryption: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: false,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
    resetAdHocDarwinSignature: true,
};

async function assemble(overrides: Partial<Parameters<typeof assembleMacApp>[0]> = {}) {
    return assembleMacApp({
        release: release(),
        productName: "My Game",
        appId: "com.example.my_game",
        version: "1.2.0",
        author: "Example Studio",
        year: 2026,
        icon: Buffer.from("game icon"),
        languages: ["en-US", "ja"],
        resources: new Map<string, BundleEntry>([
            ["app.asar", file("asar")],
            ["app.asar.unpacked", { kind: "directory", mode: 0o755 }],
            ["app.asar.unpacked/bindings.node", file(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), 0o755)],
        ]),
        asarHeaderHash: "ab".repeat(32),
        notices: new Map([["THIRD-PARTY-NOTICES.txt", Buffer.from("notices")]]),
        fuses: FUSES,
        ...overrides,
    });
}

function readPlistAt(tree: BundleTree, path: string): PlistObject {
    const entry = tree.get(path);
    if (entry?.kind !== "file") {
        throw new Error(`no ${path}`);
    }
    return parsePlist(entry.data.toString("utf8")) as PlistObject;
}

describe("assembleMacApp", () => {
    it("renames the bundle, its executable and its helpers after the product", async () => {
        const { tree, bundlePath } = await assemble();

        expect(bundlePath).toBe("My Game.app");
        expect(tree.has("My Game.app/Contents/MacOS/My Game")).toBe(true);
        expect(tree.has("My Game.app/Contents/Frameworks/My Game Helper (GPU).app/Contents/MacOS/My Game Helper (GPU)")).toBe(true);
        expect(tree.has("My Game.app/Contents/Frameworks/My Game Helper.app/Contents/MacOS/My Game Helper")).toBe(true);
        expect([...tree.keys()].some(key => key.includes("Electron Helper") || key.startsWith("Electron.app"))).toBe(false);
    });

    it("writes the app's Info.plist the way electron-builder does", async () => {
        const { tree } = await assemble();
        const info = readPlistAt(tree, "My Game.app/Contents/Info.plist");

        expect(info).toMatchObject({
            CFBundleIdentifier: "com.example.mygame",
            CFBundleExecutable: "My Game",
            CFBundleName: "My Game",
            CFBundleDisplayName: "My Game",
            CFBundleIconFile: "icon.icns",
            CFBundleShortVersionString: "1.2.0",
            NSHumanReadableCopyright: "Copyright © 2026 Example Studio",
            ElectronAsarIntegrity: { "Resources/app.asar": { algorithm: "SHA256", hash: "ab".repeat(32) } },
        });
        expect((info.NSAppTransportSecurity as PlistObject).NSAllowsLocalNetworking).toBe(true);
        // Sorted keys at every depth, as electron-builder's savePlistFile writes them.
        const text = (tree.get("My Game.app/Contents/Info.plist") as { data: Buffer }).data.toString("utf8");
        expect(text.indexOf("<key>CFBundleDisplayName</key>")).toBeLessThan(text.indexOf("<key>CFBundleExecutable</key>"));
    });

    it("prefers the project's copyright line to the default one", async () => {
        const { tree } = await assemble({ copyright: "© Example" });
        expect(readPlistAt(tree, "My Game.app/Contents/Info.plist").NSHumanReadableCopyright).toBe("© Example");
    });

    it("gives every helper its own identifier, name and version", async () => {
        const { tree } = await assemble();
        const gpu = readPlistAt(tree, "My Game.app/Contents/Frameworks/My Game Helper (GPU).app/Contents/Info.plist");
        const plain = readPlistAt(tree, "My Game.app/Contents/Frameworks/My Game Helper.app/Contents/Info.plist");

        expect(gpu).toMatchObject({
            CFBundleExecutable: "My Game Helper (GPU)",
            CFBundleDisplayName: "My Game Helper (GPU)",
            CFBundleIdentifier: "com.example.mygame.helper.GPU",
            CFBundleVersion: "1.2.0",
            // electron-builder leaves the helpers' CFBundleName alone.
            CFBundleName: "Electron Helper (GPU)",
        });
        expect(plain.CFBundleIdentifier).toBe("com.example.mygame.helper");
    });

    it("keeps only the languages asked for, by electron-builder's matching", async () => {
        const { tree } = await assemble();
        const resources = "My Game.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources";
        const kept = [...tree.keys()].filter(key => key.startsWith(`${resources}/`) && key.endsWith("/locale.pak"))
            .map(key => key.slice(resources.length + 1, -".lproj/locale.pak".length)).sort();

        // `en-US` keeps the bare `en`; `ja` keeps `ja` and narrower forms of it.
        expect(kept).toEqual(["en", "ja"]);
    });

    it("keeps every language when nothing was asked for", async () => {
        const { tree } = await assemble({ languages: [] });
        expect([...tree.keys()].filter(key => key.endsWith("/locale.pak"))).toHaveLength(6);
    });

    it("drops Electron's placeholder app, its icon and the folders nothing lands in", async () => {
        const { tree } = await assemble();

        expect(tree.has("My Game.app/Contents/Resources/default_app.asar")).toBe(false);
        expect(tree.has("My Game.app/Contents/Resources/electron.icns")).toBe(false);
        expect(tree.has("My Game.app/Contents/Resources/de.lproj")).toBe(false);
        expect((tree.get("My Game.app/Contents/Resources/icon.icns") as { data: Buffer }).data.toString()).toBe("game icon");
    });

    it("puts the payload, Electron's licences and the game's notices in Contents/Resources", async () => {
        const { tree } = await assemble();
        const resources = "My Game.app/Contents/Resources";

        expect(tree.get(`${resources}/app.asar.unpacked/bindings.node`)?.mode).toBe(0o755);
        expect((tree.get(`${resources}/LICENSE.electron.txt`) as { data: Buffer }).data.toString()).toBe("electron licence");
        expect(tree.has(`${resources}/LICENSES.chromium.html`)).toBe(true);
        expect(tree.has(`${resources}/THIRD-PARTY-NOTICES.txt`)).toBe(true);
        expect(tree.has("My Game.app/Contents/THIRD-PARTY-NOTICES.txt")).toBe(false);
    });

    it("flips the framework's fuses and keeps its links", async () => {
        const { tree } = await assemble();
        const binary = (tree.get("My Game.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework") as { data: Buffer }).data;
        const wire = binary.subarray(binary.indexOf(SENTINEL) + SENTINEL.length + 2).toString("latin1");

        // OnlyLoadAppFromAsar on, everything Studio sets off, the one it leaves alone (index 6) as released.
        expect(wire).toBe("00000100");
        expect(tree.get("My Game.app/Contents/Frameworks/Electron Framework.framework/Versions/Current"))
            .toEqual({ kind: "symlink", mode: 0o755, target: "A" });
    });

    it("refuses a release with no licence to ship", async () => {
        const incomplete = release();
        incomplete.delete("LICENSE");
        await expect(assemble({ release: incomplete })).rejects.toThrow(/no LICENSE/);
    });
});

describe("macApp helpers", () => {
    it("filters a bundle identifier like electron-builder", () => {
        expect(filterBundleIdentifier("com.example.my game_2")).toBe("com.example.my-game2");
    });

    it("names the bundle in NFD, as codesign wants it", () => {
        expect(macProductFilename("Café")).toBe("Café".normalize("NFD"));
        expect(macProductFilename("A/B")).toBe("AB");
    });

    it("sanitizes a file name exactly as the sanitize-filename package does", () => {
        const samples = [
            "My Game", "A/B\\C:D*E?F\"G<H>I|J", "...", "con", "COM1.txt", "trailing. . ", "\u0001ctrl\u009f",
            "放課後-体験版", "x".repeat(300), `${"é".repeat(127)}😀😀`, "😀".repeat(70),
        ];
        for (const sample of samples) {
            expect(sanitizeFileName(sample), sample).toBe(sanitizeFilenamePackage(sample));
        }
    });

    it("appends a CI build number to the bundle version", () => {
        expect(macBuildVersion("1.0.0", {})).toBe("1.0.0");
        expect(macBuildVersion("1.0.0", { BUILD_NUMBER: "42" })).toBe("1.0.0.42");
    });

    it("hashes an asar header the way electron-builder does", () => {
        const json = JSON.stringify({ files: { "main.js": { size: 1, offset: "0" } } });
        const text = Buffer.from(json);
        const padded = Math.ceil(text.length / 4) * 4;
        const header = Buffer.alloc(8 + padded);
        header.writeUInt32LE(4 + padded, 0);
        header.writeInt32LE(text.length, 4);
        text.copy(header, 8);
        const archive = Buffer.concat([Buffer.from([4, 0, 0, 0]), Buffer.alloc(4), header, Buffer.from("x")]);
        archive.writeUInt32LE(header.length, 4);

        const sha256 = (data: Buffer) => crypto.createHash("sha256").update(data).digest("hex");
        expect(asarHeaderHash(archive, sha256)).toBe(sha256(text));
    });
});
