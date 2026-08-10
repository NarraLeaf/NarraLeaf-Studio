import { describe, expect, it } from "vitest";
import { buildAab, type BuildAabInput } from "./buildAab";
import { buildProtoArscFixture, buildProtoManifestFixture } from "./aabFixtures";
import { assetDirectoriesOf, bundleModulePath, nativeDirectoriesOf } from "./aabBundle";
import {
    decodeMessage,
    messageAt,
    repeatedAt,
    stringAt,
    summarizeResourceTable,
    summarizeXmlNode,
    uintAt,
} from "./protobufTestReader";
import { parseZipIndex, readEntryBytes } from "./zipModel";
import { BufferZipOutput, writeZip, type ZipWriteEntry } from "./zipWriter";
import type { ApkWwwEntry } from "./repackApk";
import type { AndroidShellTemplate } from "./mobileShellManifest";

const MTIME = new Date(Date.UTC(2020, 0, 1));

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
const NATIVE_BYTES = Buffer.from("\x7fELF fake shared object");

/** A synthetic unsigned template APK shaped like a built shell. */
async function buildTemplateApk(extra: ZipWriteEntry[] = []): Promise<Buffer> {
    const entries: ZipWriteEntry[] = [
        { name: "META-INF/version-control-info.textproto", source: { kind: "buffer", data: Buffer.from("vcs") } },
        { name: "AndroidManifest.xml", source: { kind: "buffer", data: buildProtoManifestFixture() }, method: "deflate" },
        { name: "classes.dex", source: { kind: "buffer", data: DEX_BYTES }, method: "deflate" },
        { name: "classes2.dex", source: { kind: "buffer", data: DEX_BYTES }, method: "deflate" },
        // A real template carries explicit directory entries; keep one so the
        // directory branch is exercised rather than dead code.
        { name: "res/", source: null },
        { name: ICON_SLOT, source: { kind: "buffer", data: PLACEHOLDER_ICON }, method: "store" },
        { name: ICON_SLOT_HDPI, source: { kind: "buffer", data: PLACEHOLDER_ICON }, method: "store" },
        { name: "lib/arm64-v8a/libbindings.so", source: { kind: "buffer", data: NATIVE_BYTES }, method: "store" },
        { name: "lib/x86_64/libbindings.so", source: { kind: "buffer", data: NATIVE_BYTES }, method: "store" },
        { name: "kotlin/kotlin.kotlin_builtins", source: { kind: "buffer", data: Buffer.from("kt") } },
        { name: "resources.arsc", source: { kind: "buffer", data: buildProtoArscFixture() }, method: "store", forceAlign: 4 },
        ...extra,
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
    mtime: MTIME,
};

async function build(overrides: Partial<BuildAabInput> = {}): Promise<Buffer> {
    return buildAab({
        templateApk: await buildTemplateApk(),
        ...BASE,
        www: www({ "index.html": "<!doctype html><title>g</title>", "js/app.js": "console.log(1)" }),
        ...overrides,
    });
}

function names(aab: Buffer): string[] {
    return parseZipIndex(aab).entries.map(entry => entry.name);
}

function bytesOf(aab: Buffer, name: string): Buffer {
    const entry = parseZipIndex(aab).entries.find(candidate => candidate.name === name);
    if (!entry) {
        throw new Error(`No entry "${name}"`);
    }
    return readEntryBytes(aab, entry);
}

describe("bundleModulePath", () => {
    it("routes every APK entry to its bundle home", () => {
        expect(bundleModulePath("AndroidManifest.xml")).toBe("manifest/AndroidManifest.xml");
        expect(bundleModulePath("resources.arsc")).toBe("resources.pb");
        expect(bundleModulePath("classes.dex")).toBe("dex/classes.dex");
        expect(bundleModulePath("classes7.dex")).toBe("dex/classes7.dex");
        expect(bundleModulePath("res/mipmap-mdpi-v4/ic.png")).toBe("res/mipmap-mdpi-v4/ic.png");
        expect(bundleModulePath("lib/arm64-v8a/lib.so")).toBe("lib/arm64-v8a/lib.so");
        expect(bundleModulePath("assets/www/index.html")).toBe("assets/www/index.html");
        // Everything the format has no home for is quarantined under root/.
        expect(bundleModulePath("META-INF/x.properties")).toBe("root/META-INF/x.properties");
        expect(bundleModulePath("kotlin-tooling-metadata.json")).toBe("root/kotlin-tooling-metadata.json");
        expect(bundleModulePath("mydex.dex")).toBe("root/mydex.dex");
    });
});

describe("targeting derivation", () => {
    it("names each ABI directory once, in first-seen order", () => {
        expect(nativeDirectoriesOf([
            "lib/arm64-v8a/a.so", "lib/armeabi-v7a/a.so", "lib/arm64-v8a/b.so", "res/x.png",
        ])).toEqual(["lib/arm64-v8a", "lib/armeabi-v7a"]);
    });

    it("rejects a native library that is not inside an ABI directory", () => {
        expect(() => nativeDirectoriesOf(["lib/loose.so"])).toThrow(/outside an ABI directory/);
    });

    it("declares only the directories that hold a file directly", () => {
        // Not a simplification: bundletool rejects a bundle that targets a
        // directory containing only subdirectories ("Targeted directory
        // 'assets/www' is empty"), which fails validate AND build-apks. A
        // payload with nothing directly in assets/www must not declare it.
        expect(assetDirectoriesOf(["assets/www/js/app.js", "assets/shell-config.json"]))
            .toEqual(["assets/www/js", "assets"]);
        expect(assetDirectoriesOf(["assets/shell-config.json", "assets/www/index.html", "assets/www/js/app.js"]))
            .toEqual(["assets", "assets/www", "assets/www/js"]);
    });
});

describe("buildAab", () => {
    it("lays the template out as a base module", async () => {
        const aab = await build();
        expect(names(aab)).toEqual([
            "BundleConfig.pb",
            "base/root/META-INF/version-control-info.textproto",
            "base/manifest/AndroidManifest.xml",
            "base/dex/classes.dex",
            "base/dex/classes2.dex",
            "base/res/mipmap-mdpi-v4/ic_launcher.png",
            "base/res/mipmap-hdpi-v4/ic_launcher.png",
            "base/lib/arm64-v8a/libbindings.so",
            "base/lib/x86_64/libbindings.so",
            "base/root/kotlin/kotlin.kotlin_builtins",
            "base/resources.pb",
            "base/assets/shell-config.json",
            "base/assets/www/index.html",
            "base/assets/www/js/app.js",
            "base/native.pb",
            "base/assets.pb",
        ]);
    });

    it("carries no directory entries", async () => {
        // bundletool derives directories from the targeting side-files; an
        // empty directory entry would be one more thing to keep in sync.
        expect(names(await build()).some(name => name.endsWith("/"))).toBe(false);
    });

    it("converts the manifest to proto XML with the patched identity", async () => {
        const aab = await build();
        const root = summarizeXmlNode(bytesOf(aab, "base/manifest/AndroidManifest.xml"));
        expect(root).toHaveProperty("name", "manifest");
        const attributes = (root as { attributes: { name: string; value: string; item?: string }[] }).attributes;
        const byName = new Map(attributes.map(attribute => [attribute.name, attribute]));
        expect(byName.get("package")!.value).toBe("com.acme.mygame");
        expect(byName.get("versionName")!.value).toBe("1.2.3");
        expect(byName.get("versionCode")!.item).toBe("int:1002003");
    });

    it("converts resources.arsc to proto with the package renamed in lockstep", async () => {
        const table = summarizeResourceTable(bytesOf(await build(), "base/resources.pb"));
        expect(table.packages[0].name).toBe("com.acme.mygame");
        expect(table.packages[0].types.map(type => type.name)).toEqual(["drawable", "string", "style"]);
    });

    it("declares the bundle format version bundletool reads", async () => {
        // Bundletool.version is field 2 of field 1; an empty version silently
        // opts the bundle into legacy handling.
        const config = decodeMessage(bytesOf(await build(), "BundleConfig.pb"));
        expect(stringAt(messageAt(config, 1)!, 2)).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("targets each native directory by its ABI", async () => {
        const directories = repeatedAt(decodeMessage(bytesOf(await build(), "base/native.pb")), 1);
        expect(directories.map(directory => stringAt(directory, 1))).toEqual(["lib/arm64-v8a", "lib/x86_64"]);
        // AbiAlias: arm64-v8a is 3, x86_64 is 5. Getting these wrong ships a
        // bundle whose native code is missing on the affected devices.
        expect(directories.map(directory => uintAt(messageAt(messageAt(directory, 2)!, 1)!, 1))).toEqual([3, 5]);
    });

    it("declares every asset directory the payload uses", async () => {
        const directories = repeatedAt(decodeMessage(bytesOf(await build(), "base/assets.pb")), 1);
        expect(directories.map(directory => stringAt(directory, 1)))
            .toEqual(["assets", "assets/www", "assets/www/js"]);
        // Targeting is present but empty - bundletool writes the required
        // submessage rather than omitting it, so this does too.
        expect(directories.every(directory => messageAt(directory, 2)?.size === 0)).toBe(true);
    });

    it("injects the game site and shell config under the manifest's roots", async () => {
        const aab = await build();
        expect(bytesOf(aab, "base/assets/www/index.html").toString("utf8")).toBe("<!doctype html><title>g</title>");
        expect(bytesOf(aab, "base/assets/www/js/app.js").toString("utf8")).toBe("console.log(1)");
        expect(bytesOf(aab, "base/assets/shell-config.json").toString("utf8")).toBe(BASE.shellConfigJson);
    });

    it("passes untouched entries through byte-identically", async () => {
        const aab = await build();
        expect(bytesOf(aab, "base/dex/classes.dex").equals(DEX_BYTES)).toBe(true);
        expect(bytesOf(aab, "base/lib/arm64-v8a/libbindings.so").equals(NATIVE_BYTES)).toBe(true);
    });

    it("replaces icon slots that were overridden and keeps the rest", async () => {
        const newIcon = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
        const aab = await build({ iconPngBySlot: { [ICON_SLOT]: newIcon } });
        expect(bytesOf(aab, `base/${ICON_SLOT}`).equals(newIcon)).toBe(true);
        expect(bytesOf(aab, `base/${ICON_SLOT_HDPI}`).equals(PLACEHOLDER_ICON)).toBe(true);
    });

    it("is deterministic for identical inputs", async () => {
        const template = await buildTemplateApk();
        expect((await build({ templateApk: template })).equals(await build({ templateApk: template }))).toBe(true);
    });

    it("stamps entries with the injected mtime, not the wall clock", async () => {
        const template = await buildTemplateApk();
        const early = await build({ templateApk: template, mtime: new Date(Date.UTC(2020, 0, 1)) });
        const late = await build({ templateApk: template, mtime: new Date(Date.UTC(2021, 5, 15, 10, 30)) });
        expect(early.equals(late)).toBe(false);
    });

    it("rejects an unsafe www path", async () => {
        await expect(build({ www: www({ "../escape.txt": "x" }) })).rejects.toThrow(/Unsafe www path/);
    });

    it("rejects a duplicate www path", async () => {
        const duplicated: ApkWwwEntry[] = [
            { relativePath: "index.html", source: { kind: "buffer", data: Buffer.from("a") } },
            { relativePath: "index.html", source: { kind: "buffer", data: Buffer.from("b") } },
        ];
        await expect(build({ www: duplicated })).rejects.toThrow(/Duplicate www path/);
    });

    it("fails loudly when an icon override matches no template slot", async () => {
        await expect(build({ iconPngBySlot: { "res/mipmap-nope/ic.png": Buffer.from([1]) } }))
            .rejects.toThrow(/not present in the template/);
    });

    it("rejects a template containing a symlink (would be silently flattened)", async () => {
        const template = await buildTemplateApk([
            { name: "lib/arm64-v8a/link.so", source: { kind: "buffer", data: Buffer.from("target") }, unixMode: 0o120755 },
        ]);
        await expect(build({ templateApk: template })).rejects.toThrow(/symlink/);
    });

    it("refuses to pass compiled binary XML through as if it were proto XML", async () => {
        const template = await buildTemplateApk([
            { name: "res/layout/main.xml", source: { kind: "buffer", data: Buffer.from([0x03, 0x00, 8, 0, 1, 2, 3, 4]) } },
        ]);
        await expect(build({ templateApk: template })).rejects.toThrow(/compiled binary XML/);
    });

    it("fails loudly when the template lacks AndroidManifest.xml or resources.arsc", async () => {
        const output = new BufferZipOutput();
        await writeZip(output, [
            { name: "AndroidManifest.xml", source: { kind: "buffer", data: buildProtoManifestFixture() } },
        ], { mtime: MTIME, allowZip64: false });
        await expect(build({ templateApk: output.toBuffer() })).rejects.toThrow(/no resources\.arsc/);

        const other = new BufferZipOutput();
        await writeZip(other, [
            { name: "resources.arsc", source: { kind: "buffer", data: buildProtoArscFixture() } },
        ], { mtime: MTIME, allowZip64: false });
        await expect(build({ templateApk: other.toBuffer() })).rejects.toThrow(/no AndroidManifest\.xml/);
    });
});
