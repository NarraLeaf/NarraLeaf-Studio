import { describe, expect, it } from "vitest";
import { parseBinaryManifest } from "./axml";
import { parseArscPackageNames } from "./arsc";
import { verifyApkV2 } from "./apkSigningV2";
import { generateSigningIdentity } from "./signingIdentity";
import { buildArscFixture, buildBinaryManifestFixture } from "./androidFixtures";
import { repackApk, type ApkWwwEntry } from "./repackApk";
import { findMisalignedStoredEntries, parseZipIndex, readEntryBytes, ZIP_METHOD_STORE } from "./zipModel";
import { BufferZipOutput, writeZip, type ZipWriteEntry } from "./zipWriter";
import type { AndroidShellTemplate } from "./mobileShellManifest";

const MTIME = new Date(Date.UTC(2020, 0, 1));

/** One identity for the suite: RSA keygen is the slow part. */
const identity = generateSigningIdentity({
    notBefore: new Date(Date.UTC(2020, 0, 1)),
    notAfter: new Date(Date.UTC(2050, 0, 1)),
    serialNumber: Buffer.from([0x2a]),
});

const ICON_SLOT = "res/mipmap-mdpi-v4/ic_launcher.png";
const ICON_SLOT_HDPI = "res/mipmap-hdpi-v4/ic_launcher.png";

const ANDROID_TEMPLATE: AndroidShellTemplate = {
    template: "android/template.apk",
    templateDebug: "android/template-debug.apk",
    minSdk: 26,
    placeholders: {
        applicationId: "com.narraleaf.shell.placeholder",
        label: "NarraLeaf Shell",
        versionCode: 1,
        versionName: "0.0.0",
    },
    iconSlots: [ICON_SLOT, ICON_SLOT_HDPI],
    wwwRoot: "assets/www/",
    shellConfigPath: "assets/shell-config.json",
};

const DEX_BYTES = Buffer.from("dex\n035\0 fake dalvik payload for passthrough");
const PLACEHOLDER_ICON = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A synthetic unsigned template APK shaped like a built shell. */
async function buildTemplateApk(): Promise<Buffer> {
    const entries: ZipWriteEntry[] = [
        { name: "AndroidManifest.xml", source: { kind: "buffer", data: buildBinaryManifestFixture() }, method: "deflate" },
        { name: "classes.dex", source: { kind: "buffer", data: DEX_BYTES }, method: "deflate" },
        // A real template carries explicit directory entries; keep one so the
        // directory branch is exercised rather than dead code.
        { name: "res/", source: null },
        { name: ICON_SLOT, source: { kind: "buffer", data: PLACEHOLDER_ICON }, method: "store" },
        { name: ICON_SLOT_HDPI, source: { kind: "buffer", data: PLACEHOLDER_ICON }, method: "store" },
        { name: "res/layout/main.xml", source: { kind: "buffer", data: Buffer.from([0x03, 0x00, 8, 0, 1, 2, 3, 4]) } },
        { name: "resources.arsc", source: { kind: "buffer", data: buildArscFixture() }, method: "store", forceAlign: 4 },
    ];
    const output = new BufferZipOutput();
    await writeZip(output, entries, { mtime: MTIME, alignStoredEntries: 4, allowZip64: false });
    return output.toBuffer();
}

function www(files: Record<string, string>): ApkWwwEntry[] {
    return Object.entries(files).map(([relativePath, content]) => ({
        relativePath,
        source: { kind: "buffer", data: Buffer.from(content) },
    }));
}

const BASE = {
    android: ANDROID_TEMPLATE,
    applicationId: "com.acme.mygame",
    label: "My Game",
    versionName: "1.2.3",
    versionCode: 1_002_003,
    shellConfigJson: "{\"schemaVersion\":1,\"orientation\":\"landscape\"}",
    signingIdentity: identity,
    mtime: MTIME,
};

async function repack(overrides: Partial<Parameters<typeof repackApk>[0]> = {}): Promise<Buffer> {
    return repackApk({
        templateApk: await buildTemplateApk(),
        ...BASE,
        www: www({ "index.html": "<!doctype html><title>g</title>", "pack.json": "{}" }),
        ...overrides,
    });
}

function names(apk: Buffer): string[] {
    return parseZipIndex(apk).entries.map(entry => entry.name);
}

function entryByName(apk: Buffer, name: string) {
    const entry = parseZipIndex(apk).entries.find(candidate => candidate.name === name);
    if (!entry) {
        throw new Error(`No entry "${name}"`);
    }
    return entry;
}

describe("repackApk", () => {
    it("produces a v2-signed APK our verifier accepts", async () => {
        const apk = await repack();
        const result = verifyApkV2(apk);
        expect(result.verified).toBe(true);
        expect(result.reason).toBeUndefined();
    });

    it("patches the manifest identity", async () => {
        const apk = await repack();
        const manifest = readEntryBytes(apk, entryByName(apk, "AndroidManifest.xml"));
        expect(parseBinaryManifest(manifest)).toEqual({
            packageName: "com.acme.mygame",
            label: "My Game",
            versionCode: 1_002_003,
            versionName: "1.2.3",
        });
    });

    it("renames the resources.arsc package and keeps it stored and aligned", async () => {
        const apk = await repack();
        const arsc = entryByName(apk, "resources.arsc");
        expect(arsc.method).toBe(ZIP_METHOD_STORE);
        expect(parseArscPackageNames(readEntryBytes(apk, arsc))).toEqual(["com.acme.mygame"]);
        // API 30+ rejects an unaligned or compressed resources.arsc at install.
        expect(findMisalignedStoredEntries(apk, 4)).toEqual([]);
    });

    it("injects the game site and shell config under the manifest's roots", async () => {
        const apk = await repack();
        const entryNames = names(apk);
        expect(entryNames).toContain("assets/www/index.html");
        expect(entryNames).toContain("assets/www/pack.json");
        expect(entryNames).toContain("assets/shell-config.json");
        // Read the payload back, not just the names: the site is the only
        // thing the repack exists to carry, and a source that silently
        // produced nothing would still satisfy a name-only assertion.
        expect(readEntryBytes(apk, entryByName(apk, "assets/www/index.html")).toString("utf8"))
            .toBe("<!doctype html><title>g</title>");
        expect(readEntryBytes(apk, entryByName(apk, "assets/www/pack.json")).toString("utf8")).toBe("{}");
        expect(readEntryBytes(apk, entryByName(apk, "assets/shell-config.json")).toString("utf8"))
            .toBe(BASE.shellConfigJson);
    });

    it("stamps entries with the injected mtime, not the wall clock", async () => {
        // Two repacks in the same run would share a wall-clock DOS timestamp
        // (2-second granularity), so determinism alone cannot prove the
        // injected mtime is honored — different mtimes must differ.
        const template = await buildTemplateApk();
        const early = await repack({ templateApk: template, mtime: new Date(Date.UTC(2020, 0, 1)) });
        const late = await repack({ templateApk: template, mtime: new Date(Date.UTC(2021, 5, 15, 10, 30)) });
        expect(early.equals(late)).toBe(false);
    });

    it("passes untouched entries through byte-identically", async () => {
        const apk = await repack();
        expect(readEntryBytes(apk, entryByName(apk, "classes.dex")).equals(DEX_BYTES)).toBe(true);
    });

    it("preserves the template's directory entries", async () => {
        const apk = await repack();
        const dir = entryByName(apk, "res/");
        expect(dir.isDirectory).toBe(true);
        expect(dir.unixMode & 0o777).toBe(0o755);
    });

    it("replaces icon slots that were overridden and keeps the rest", async () => {
        const newIcon = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
        const apk = await repack({ iconPngBySlot: { [ICON_SLOT]: newIcon } });
        expect(readEntryBytes(apk, entryByName(apk, ICON_SLOT)).equals(newIcon)).toBe(true);
        expect(readEntryBytes(apk, entryByName(apk, ICON_SLOT_HDPI)).equals(PLACEHOLDER_ICON)).toBe(true);
    });

    it("is deterministic for identical inputs and identity", async () => {
        const first = await repack();
        const second = await repack();
        expect(first.equals(second)).toBe(true);
    });

    it("keeps every stored entry 4-byte aligned after signing", async () => {
        const apk = await repack();
        expect(findMisalignedStoredEntries(apk, 4)).toEqual([]);
    });

    it("detects tampering after the fact (the signature covers the payload)", async () => {
        const apk = await repack();
        const tampered = Buffer.from(apk);
        tampered[80] ^= 0xff;
        expect(verifyApkV2(tampered).verified).toBe(false);
    });

    it("rejects an unsafe www path", async () => {
        await expect(repack({ www: www({ "../escape.txt": "x" }) })).rejects.toThrow(/Unsafe www path/);
    });

    it("fails loudly when an icon override matches no template slot", async () => {
        await expect(repack({ iconPngBySlot: { "res/mipmap-nope/ic.png": Buffer.from([1]) } }))
            .rejects.toThrow(/not present in the template/);
    });

    it("only replaces entries the manifest declares as icon slots", async () => {
        // The slot list is the gate: without it an override could overwrite an
        // arbitrary template entry (classes.dex here) that happens to be named.
        await expect(repack({ iconPngBySlot: { "classes.dex": Buffer.from("PWNED") } }))
            .rejects.toThrow(/not present in the template/);
    });

    it("rejects a template containing a symlink (would be silently flattened)", async () => {
        const output = new BufferZipOutput();
        await writeZip(output, [
            { name: "AndroidManifest.xml", source: { kind: "buffer", data: buildBinaryManifestFixture() } },
            { name: "resources.arsc", source: { kind: "buffer", data: buildArscFixture() }, method: "store", forceAlign: 4 },
            { name: "lib/link.so", source: { kind: "buffer", data: Buffer.from("target") }, unixMode: 0o120755 },
        ], { mtime: MTIME, alignStoredEntries: 4, allowZip64: false });
        await expect(repack({ templateApk: output.toBuffer() })).rejects.toThrow(/symlink/);
    });

    it("fails loudly when the template lacks resources.arsc", async () => {
        const output = new BufferZipOutput();
        await writeZip(output, [
            { name: "AndroidManifest.xml", source: { kind: "buffer", data: buildBinaryManifestFixture() } },
        ], { mtime: MTIME, alignStoredEntries: 4, allowZip64: false });
        await expect(repack({ templateApk: output.toBuffer() })).rejects.toThrow(/no resources\.arsc/);
    });

    it("fails loudly when the template lacks AndroidManifest.xml", async () => {
        const output = new BufferZipOutput();
        await writeZip(output, [
            { name: "resources.arsc", source: { kind: "buffer", data: buildArscFixture() }, method: "store", forceAlign: 4 },
        ], { mtime: MTIME, alignStoredEntries: 4, allowZip64: false });
        await expect(repack({ templateApk: output.toBuffer() })).rejects.toThrow(/no AndroidManifest\.xml/);
    });

    it("renames authority-shaped derived strings with the package", async () => {
        const apk = await repack();
        const manifest = readEntryBytes(apk, entryByName(apk, "AndroidManifest.xml"));
        // The template's "<placeholder>.provider" must follow the rename, or two
        // repacked games would collide at install.
        expect(manifest.includes(Buffer.from("com.acme.mygame.provider", "utf16le"))).toBe(true);
        expect(manifest.includes(Buffer.from("com.narraleaf.shell.placeholder", "utf16le"))).toBe(false);
    });
});
