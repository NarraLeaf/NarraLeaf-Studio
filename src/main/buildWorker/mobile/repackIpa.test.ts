import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { path7za } from "7zip-bin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseZipIndex, readEntryBytes } from "./zipModel";
import { BufferZipOutput, writeZip, type ZipWriteEntry } from "./zipWriter";
import { repackIpa, type IpaWwwEntry } from "./repackIpa";
import { parseInfoPlist } from "./plist";
import type { IosShellTemplate } from "./mobileShellManifest";

const run7za = promisify(execFile);
const MTIME = new Date(Date.UTC(2020, 0, 1));

const IOS_TEMPLATE: IosShellTemplate = {
    template: "ios/template.app.zip",
    templateDebug: "ios/template-debug.app.zip",
    appDirName: "Shell.app",
    executableName: "Shell",
    placeholders: { bundleId: "com.narraleaf.shell.placeholder" },
    iconSlots: ["AppIcon60x60@2x.png"],
    wwwRoot: "www/",
    shellConfigPath: "shell-config.json",
};

const TEMPLATE_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>CFBundleIdentifier</key>
\t<string>com.narraleaf.shell.placeholder</string>
\t<key>CFBundleDisplayName</key>
\t<string>NarraLeaf Shell</string>
\t<key>CFBundleExecutable</key>
\t<string>Shell</string>
\t<key>CFBundleShortVersionString</key>
\t<string>0.0.0</string>
\t<key>CFBundleVersion</key>
\t<string>1</string>
\t<key>UISupportedInterfaceOrientations</key>
\t<array>
\t\t<string>UIInterfaceOrientationLandscapeLeft</string>
\t</array>
</dict>
</plist>
`;

const EXECUTABLE_BYTES = Buffer.from("\xcf\xfa\xed\xfe fake mach-o executable payload", "binary");
const PLACEHOLDER_ICON = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A synthetic template .app.zip shaped like `ditto -c -k --keepParent Shell.app`. */
async function buildTemplateAppZip(): Promise<Buffer> {
    const entries: ZipWriteEntry[] = [
        { name: "Shell.app/", source: null },
        { name: "Shell.app/Shell", source: { kind: "buffer", data: EXECUTABLE_BYTES }, unixMode: 0o755, method: "store" },
        { name: "Shell.app/Info.plist", source: { kind: "buffer", data: Buffer.from(TEMPLATE_INFO_PLIST) } },
        { name: "Shell.app/AppIcon60x60@2x.png", source: { kind: "buffer", data: PLACEHOLDER_ICON }, method: "store" },
        { name: "Shell.app/LaunchScreen.storyboardc/", source: null },
        { name: "Shell.app/LaunchScreen.storyboardc/Info.plist", source: { kind: "buffer", data: Buffer.from("<plist/>") } },
    ];
    const output = new BufferZipOutput();
    await writeZip(output, entries, { mtime: MTIME, allowZip64: true });
    return output.toBuffer();
}

function www(files: Record<string, string>): IpaWwwEntry[] {
    return Object.entries(files).map(([relativePath, content]) => ({
        relativePath,
        source: { kind: "buffer", data: Buffer.from(content) },
    }));
}

const BASE_INPUT = {
    ios: IOS_TEMPLATE,
    appName: "My Game",
    identity: {
        bundleId: "com.acme.mygame",
        displayName: "My Game",
        shortVersionString: "1.2.3",
        bundleVersion: "1002003",
    },
    orientation: "portrait" as const,
    shellConfigJson: "{\"schemaVersion\":1,\"orientation\":\"portrait\"}",
    mtime: MTIME,
};

async function repack(overrides: Partial<Parameters<typeof repackIpa>[0]> = {}): Promise<Buffer> {
    return repackIpa({
        templateAppZip: await buildTemplateAppZip(),
        ...BASE_INPUT,
        www: www({ "index.html": "<!doctype html><title>g</title>", "pack.json": "{}" }),
        ...overrides,
    });
}

function entryNames(ipa: Buffer): string[] {
    return parseZipIndex(ipa).entries.map(entry => entry.name);
}

function entryByName(ipa: Buffer, name: string) {
    const entry = parseZipIndex(ipa).entries.find(candidate => candidate.name === name);
    if (!entry) {
        throw new Error(`No entry "${name}" in ${entryNames(ipa).join(", ")}`);
    }
    return entry;
}

describe("repackIpa", () => {
    it("re-lays the template under Payload/<AppName>.app and injects the site", async () => {
        const ipa = await repack();
        const names = entryNames(ipa);
        expect(names).toContain("Payload/My Game.app/Shell");
        expect(names).toContain("Payload/My Game.app/Info.plist");
        expect(names).toContain("Payload/My Game.app/www/index.html");
        expect(names).toContain("Payload/My Game.app/www/pack.json");
        expect(names).toContain("Payload/My Game.app/shell-config.json");
        // Nothing keeps the old Shell.app/ prefix.
        expect(names.every(name => !name.startsWith("Shell.app/"))).toBe(true);
    });

    it("patches the Info.plist identity, display name and orientation", async () => {
        const ipa = await repack();
        const plist = readEntryBytes(ipa, entryByName(ipa, "Payload/My Game.app/Info.plist")).toString("utf8");
        expect(parseInfoPlist(plist)).toMatchObject({
            bundleId: "com.acme.mygame",
            displayName: "My Game",
            shortVersionString: "1.2.3",
            bundleVersion: "1002003",
        });
        // The home-screen name must be the game's, not the shell placeholder.
        expect(plist).not.toContain("NarraLeaf Shell");
        expect(plist).toContain("UIInterfaceOrientationPortrait");
        expect(plist).not.toContain("UIInterfaceOrientationLandscapeLeft");
    });

    it("preserves the executable bytes and its 0755 mode", async () => {
        const ipa = await repack();
        const exe = entryByName(ipa, "Payload/My Game.app/Shell");
        expect(readEntryBytes(ipa, exe).equals(EXECUTABLE_BYTES)).toBe(true);
        expect(exe.unixMode & 0o777).toBe(0o755);
    });

    it("replaces an icon slot with the provided PNG", async () => {
        const newIcon = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9, 9]);
        const ipa = await repack({ iconPngBySlot: { "AppIcon60x60@2x.png": newIcon } });
        const icon = entryByName(ipa, "Payload/My Game.app/AppIcon60x60@2x.png");
        expect(readEntryBytes(ipa, icon).equals(newIcon)).toBe(true);
    });

    it("keeps the placeholder icon when no override is given", async () => {
        const ipa = await repack();
        const icon = entryByName(ipa, "Payload/My Game.app/AppIcon60x60@2x.png");
        expect(readEntryBytes(ipa, icon).equals(PLACEHOLDER_ICON)).toBe(true);
    });

    it("writes the shell config verbatim", async () => {
        const ipa = await repack();
        const config = entryByName(ipa, "Payload/My Game.app/shell-config.json");
        expect(readEntryBytes(ipa, config).toString("utf8")).toBe(BASE_INPUT.shellConfigJson);
    });

    it("is deterministic for identical inputs", async () => {
        const first = await repack();
        const second = await repack();
        expect(first.equals(second)).toBe(true);
    });

    it("rejects an unsafe or double-slashed www path", async () => {
        await expect(repack({ www: www({ "../escape.txt": "x" }) })).rejects.toThrow(/Unsafe www path/);
        await expect(repack({ www: www({ "a//b.html": "x" }) })).rejects.toThrow(/Unsafe www path/);
    });

    it("rejects an app name that is not a single path segment", async () => {
        await expect(repack({ appName: "bad/name" })).rejects.toThrow(/Invalid app name/);
        await expect(repack({ appName: "" })).rejects.toThrow(/Invalid app name/);
    });

    it("fails loudly when an icon override matches no template slot (manifest drift)", async () => {
        await expect(repack({ iconPngBySlot: { "does-not-exist.png": Buffer.from([1]) } }))
            .rejects.toThrow(/not present in the template/);
    });

    it("rejects a template containing a symlink (would be silently corrupted)", async () => {
        // Craft a template entry with the S_IFLNK type bits set.
        const output = new BufferZipOutput();
        await writeZip(output, [
            { name: "Shell.app/", source: null },
            { name: "Shell.app/Shell", source: { kind: "buffer", data: EXECUTABLE_BYTES }, unixMode: 0o755, method: "store" },
            { name: "Shell.app/Info.plist", source: { kind: "buffer", data: Buffer.from(TEMPLATE_INFO_PLIST) } },
            { name: "Shell.app/link", source: { kind: "buffer", data: Buffer.from("Shell") }, unixMode: 0o120755 },
        ], { mtime: MTIME, allowZip64: true });
        await expect(repack({ templateAppZip: output.toBuffer() })).rejects.toThrow(/symlink/);
    });

    it("fails loudly when the template lacks the executable", async () => {
        const template = await buildTemplateAppZip();
        // Rename the executable away by rebuilding without it.
        const badTemplate = await (async () => {
            const entries: ZipWriteEntry[] = [
                { name: "Shell.app/", source: null },
                { name: "Shell.app/Info.plist", source: { kind: "buffer", data: Buffer.from(TEMPLATE_INFO_PLIST) } },
            ];
            const output = new BufferZipOutput();
            await writeZip(output, entries, { mtime: MTIME, allowZip64: true });
            return output.toBuffer();
        })();
        await expect(repack({ templateAppZip: badTemplate })).rejects.toThrow(/no executable "Shell"/);
        expect(template.length).toBeGreaterThan(0);
    });
});

describe("repackIpa 7za validation", () => {
    let workDir: string;

    beforeEach(async () => {
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-ipa-"));
    });

    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true });
    });

    async function ensure7za(): Promise<void> {
        if (process.platform !== "win32") {
            await fs.chmod(path7za, 0o755).catch(() => undefined);
        }
    }

    it("produces an archive 7za verifies and extracts with the expected layout", async () => {
        const ipa = await repack();
        const ipaPath = path.join(workDir, "game.ipa");
        await fs.writeFile(ipaPath, ipa);
        await ensure7za();
        await run7za(path7za, ["t", ipaPath]);
        const outDir = path.join(workDir, "out");
        await run7za(path7za, ["x", `-o${outDir}`, "-y", ipaPath]);
        const indexHtml = await fs.readFile(path.join(outDir, "Payload", "My Game.app", "www", "index.html"), "utf8");
        expect(indexHtml).toContain("<!doctype html>");
        const info = await fs.readFile(path.join(outDir, "Payload", "My Game.app", "Info.plist"), "utf8");
        expect(info).toContain("com.acme.mygame");
    });
});
