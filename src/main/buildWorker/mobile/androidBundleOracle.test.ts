import { execFileSync } from "child_process";
import fs from "fs/promises";
import { existsSync, readdirSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { validateMobileShellManifest } from "./mobileShellManifest";
import { buildAab, type BuildAabInput } from "./buildAab";
import { convertArscToProto } from "./arscProto";
import { convertBinaryManifestToProto } from "./axmlProto";
import { summarizeResourceTable, summarizeXmlNode } from "./protobufTestReader";
import { parseZipIndex, readEntryBytes } from "./zipModel";

/**
 * The App Bundle oracle: Google's own tools judging what Studio produced.
 *
 * Everything else about the .aab is checked by code in this repo - the same
 * code that wrote the bytes, which could be self-consistently wrong. That risk
 * is far sharper here than on the APK path, because nothing in Studio can tell
 * whether a protobuf ResourceTable it invented is the one aapt2 would have
 * written. bundletool is the program Play runs on an uploaded bundle, and
 * aapt2 is the compiler whose output format this reimplements, so they are the
 * authority on the two questions Studio cannot answer about itself: will this
 * bundle be accepted and produce installable APKs, and does our conversion
 * mean the same thing as aapt2's?
 *
 * Neither tool ships with Studio (bundletool is a 32 MB jar needing a JRE;
 * the SDK's components cannot be redistributed), so this is gated on
 * BUNDLETOOL_JAR: it skips on a normal dev machine and runs on CI, where both
 * are provisioned. CI sets REQUIRE_ANDROID_BUNDLE_ORACLE=1, which turns a
 * missing tool into a failure - otherwise a runner that lost them would skip
 * silently and look exactly like a pass.
 */

const TEMPLATE_DIR = path.resolve(__dirname, "../../../../node_modules/@narraleaf/studio-shell");
const MTIME = new Date(Date.UTC(2020, 0, 1));

const APPLICATION_ID = "com.example.oraclegame";
const LABEL = "Oracle Game";
const VERSION_NAME = "1.2.3";
const VERSION_CODE = 1_002_003;

/** Newest build-tools in the local SDK, or null when there is no usable SDK. */
function resolveBuildTools(): string | null {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk || !existsSync(path.join(sdk, "build-tools"))) {
    return null;
  }
  const versions = readdirSync(path.join(sdk, "build-tools")).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
  const newest = versions.at(-1);
  return newest ? path.join(sdk, "build-tools", newest) : null;
}

function resolveAapt2(): string | null {
  if (process.env.AAPT2 && existsSync(process.env.AAPT2)) {
    return process.env.AAPT2;
  }
  const buildTools = resolveBuildTools();
  if (!buildTools) {
    return null;
  }
  const binary = path.join(buildTools, process.platform === "win32" ? "aapt2.exe" : "aapt2");
  return existsSync(binary) ? binary : null;
}

function resolveBundletool(): string | null {
  const jar = process.env.BUNDLETOOL_JAR;
  return jar && existsSync(jar) ? jar : null;
}

function resolveJava(): string {
  const home = process.env.JAVA_HOME;
  if (!home) {
    return "java";
  }
  const binary = path.join(home, "bin", process.platform === "win32" ? "java.exe" : "java");
  return existsSync(binary) ? binary : "java";
}

const bundletoolJar = resolveBundletool();
const aapt2Path = resolveAapt2();
const oracleRequired = process.env.REQUIRE_ANDROID_BUNDLE_ORACLE === "1";
const oracleAvailable = bundletoolJar !== null && aapt2Path !== null;

function bundletool(args: string[]): string {
  return execFileSync(resolveJava(), ["-jar", bundletoolJar!, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024
  });
}

function aapt2(args: string[]): string {
  return execFileSync(aapt2Path!, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function templateApkBytes(): Promise<Buffer> {
  const manifest = validateMobileShellManifest(
    JSON.parse(await fs.readFile(path.join(TEMPLATE_DIR, "manifest.json"), "utf8"))
  );
  return fs.readFile(path.join(TEMPLATE_DIR, manifest.android.template));
}

const DEFAULT_WWW: BuildAabInput["www"] = [
  {
    relativePath: "index.html",
    source: { kind: "buffer", data: Buffer.from("<!doctype html><title>mobile</title>") }
  },
  { relativePath: "js/app.js", source: { kind: "buffer", data: Buffer.from("/* bridge */") } },
  { relativePath: "media/bgm.ogg", source: { kind: "buffer", data: Buffer.alloc(64 * 1024, 9) } }
];

async function bundleInput(www: BuildAabInput["www"] = DEFAULT_WWW): Promise<BuildAabInput> {
  const manifest = validateMobileShellManifest(
    JSON.parse(await fs.readFile(path.join(TEMPLATE_DIR, "manifest.json"), "utf8"))
  );
  return {
    templateApk: await templateApkBytes(),
    android: manifest.android,
    applicationId: APPLICATION_ID,
    label: LABEL,
    versionName: VERSION_NAME,
    versionCode: VERSION_CODE,
    www,
    shellConfigJson: JSON.stringify({
      schemaVersion: 1,
      orientation: "landscape",
      backgroundColor: "#000000"
    }),
    mtime: MTIME
  };
}

/** Build the real template into an .aab on disk and hand back its path. */
async function buildBundle(www?: BuildAabInput["www"]): Promise<string> {
  const dir = await tempDir("nls-bundle-oracle-");
  const bundle = path.join(dir, "oracle.aab");
  await fs.writeFile(bundle, await buildAab(await bundleInput(www)));
  return bundle;
}

function entryBytes(archive: Buffer, name: string): Buffer {
  const entry = parseZipIndex(archive).entries.find((candidate) => candidate.name === name);
  if (!entry) {
    throw new Error(`No entry "${name}"`);
  }
  return readEntryBytes(archive, entry);
}

describe("the App Bundle oracle's availability", () => {
  it("is present when CI demands it", () => {
    // Without this, a runner whose tools vanished would skip every oracle
    // below and report a green build - the failure mode this whole file
    // exists to prevent.
    if (oracleRequired) {
      expect(
        bundletoolJar,
        "REQUIRE_ANDROID_BUNDLE_ORACLE is set but BUNDLETOOL_JAR names no jar"
      ).not.toBeNull();
      expect(
        aapt2Path,
        "REQUIRE_ANDROID_BUNDLE_ORACLE is set but no aapt2 was found"
      ).not.toBeNull();
    }
  });
});

describe.skipIf(!oracleAvailable)("Google's tools on a Studio-built App Bundle", () => {
  it("passes bundletool validation", async () => {
    // The authoritative answer to "will Play accept this?": bundletool
    // applies its own structural rules for the bundle format.
    const output = bundletool(["validate", `--bundle=${await buildBundle()}`]);
    expect(output).toContain("Feature module: base");
  });

  it("accepts a payload whose intermediate directories hold no files", async () => {
    // The asset-targeting rule bundletool actually enforces, and the one
    // this got wrong first: naming a directory that contains only
    // subdirectories fails with "Targeted directory 'assets/www' is
    // empty". A site whose only entry is assets/www/js/app.js is exactly
    // that shape, and no assertion inside Studio would have caught it.
    const bundle = await buildBundle([
      { relativePath: "js/app.js", source: { kind: "buffer", data: Buffer.from("/* only */") } }
    ]);
    expect(bundletool(["validate", `--bundle=${bundle}`])).toContain("assets/www/js/app.js");
  });

  it("builds installable APKs whose payload and identity survive", async () => {
    const dir = await tempDir("nls-bundle-apks-");
    const apks = path.join(dir, "out.apks");
    bundletool([
      "build-apks",
      `--bundle=${await buildBundle()}`,
      `--output=${apks}`,
      "--mode=universal",
      "--overwrite"
    ]);
    // The .apks set is a zip; the universal APK is the one a device would
    // install, and it is the only proof that the whole chain - our proto
    // table, bundletool's re-compilation back to a binary one - round
    // trips rather than merely parsing.
    const universal = entryBytes(await fs.readFile(apks), "universal.apk");
    expect(entryBytes(universal, "assets/www/index.html").toString("utf8")).toBe(
      "<!doctype html><title>mobile</title>"
    );
    expect(entryBytes(universal, "assets/www/js/app.js").toString("utf8")).toBe("/* bridge */");
    expect(entryBytes(universal, "assets/shell-config.json").toString("utf8")).toContain(
      '"orientation":"landscape"'
    );

    // aapt2 only reads files, and it reads the REBUILT binary manifest -
    // so this is the platform's own parser confirming that what survived
    // the proto round trip is still the identity Studio asked for.
    const universalPath = path.join(dir, "universal.apk");
    await fs.writeFile(universalPath, universal);
    const badging = aapt2(["dump", "badging", universalPath]);
    expect(badging).toContain(`package: name='${APPLICATION_ID}'`);
    expect(badging).toContain(`versionCode='${VERSION_CODE}'`);
    expect(badging).toContain(`versionName='${VERSION_NAME}'`);
    expect(badging).toContain(`application-label:'${LABEL}'`);
  });

  it("reads back the manifest Studio wrote", async () => {
    const manifest = bundletool(["dump", "manifest", `--bundle=${await buildBundle()}`]);
    expect(manifest).toContain(`package="${APPLICATION_ID}"`);
    expect(manifest).toContain(`android:versionCode="${VERSION_CODE}"`);
    expect(manifest).toContain(`android:versionName="${VERSION_NAME}"`);
    expect(manifest).toContain(`android:label="${LABEL}"`);
    expect(manifest).toContain(
      '<uses-sdk android:minSdkVersion="26" android:targetSdkVersion="34"/>'
    );
    expect(manifest).toContain('android:name="com.narraleaf.shell.MainActivity"');
    expect(manifest).toContain('<action android:name="android.intent.action.MAIN"/>');
    expect(manifest).toContain('<category android:name="android.intent.category.LAUNCHER"/>');
    // Nothing anywhere may still carry the template's placeholder id.
    expect(manifest).not.toContain("com.narraleaf.shell.placeholder");
  });

  it("reads back every resource Studio wrote, with its values", async () => {
    const resources = bundletool([
      "dump",
      "resources",
      `--bundle=${await buildBundle()}`,
      "--values"
    ]);
    expect(resources).toContain(`Package '${APPLICATION_ID}':`);
    expect(resources).toContain("0x7f010000 - mipmap/ic_launcher");
    for (const [density, directory] of [
      [160, "mdpi"],
      [240, "hdpi"],
      [320, "xhdpi"],
      [480, "xxhdpi"],
      [640, "xxxhdpi"]
    ] as const) {
      expect(resources).toContain(
        `density: ${density} - [FILE] res/mipmap-${directory}-v4/ic_launcher.png`
      );
    }
    expect(resources).toContain("0x7f020000 - style/ShellTheme");
    // The compound style, item for item: a reference, a boolean, the magic
    // @null reference and another boolean.
    expect(resources).toContain("(default) - [STYLE] [0x0106000c, true, 0x00000000, true]");
  });

  it("converts the manifest to the same thing aapt2 does", async () => {
    // aapt2 is the compiler this reimplements. Comparing the decoded
    // structures rather than the bytes keeps the assertion about meaning:
    // provenance fields (source positions, tool fingerprints) are aapt2's
    // to write and nobody reads them.
    const dir = await tempDir("nls-bundle-aapt2-");
    const templateApk = path.join(dir, "template.apk");
    const protoApk = path.join(dir, "proto.apk");
    await fs.writeFile(templateApk, await templateApkBytes());
    aapt2(["convert", "--output-format", "proto", "-o", protoApk, templateApk]);

    const template = await fs.readFile(templateApk);
    const theirs = await fs.readFile(protoApk);
    expect(
      summarizeXmlNode(convertBinaryManifestToProto(entryBytes(template, "AndroidManifest.xml")))
    ).toEqual(summarizeXmlNode(entryBytes(theirs, "AndroidManifest.xml")));
  });

  it("converts the resource table to the same thing aapt2 does", async () => {
    const dir = await tempDir("nls-bundle-aapt2-");
    const templateApk = path.join(dir, "template.apk");
    const protoApk = path.join(dir, "proto.apk");
    await fs.writeFile(templateApk, await templateApkBytes());
    aapt2(["convert", "--output-format", "proto", "-o", protoApk, templateApk]);

    const template = await fs.readFile(templateApk);
    const theirs = await fs.readFile(protoApk);
    expect(
      summarizeResourceTable(convertArscToProto(entryBytes(template, "resources.arsc")))
    ).toEqual(summarizeResourceTable(entryBytes(theirs, "resources.pb")));
  });
});
