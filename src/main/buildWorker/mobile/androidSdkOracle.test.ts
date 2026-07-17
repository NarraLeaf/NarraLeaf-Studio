import { execFileSync } from "child_process";
import fs from "fs/promises";
import { existsSync, readdirSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { validateMobileShellManifest } from "./mobileShellManifest";
import { runMobileRepack } from "./runMobileRepack";
import { generateSigningIdentity } from "./signingIdentity";
import type { GameBuildWorkerMobileJob } from "../protocol";

/**
 * The Android SDK oracle: Google's own tools judging what Studio produced.
 *
 * Everything else about the APK is checked by code in this repo — the same code
 * that wrote the bytes, which could be self-consistently wrong. apksigner and
 * aapt2 are the tools the platform itself is built from, so they are the
 * authority on the two questions Studio cannot answer about itself: is this
 * signature one Android will accept at minSdk 26, and does the platform read
 * back the identity we meant to write?
 *
 * The SDK never ships with Studio (its components cannot be redistributed), so
 * this is gated on ANDROID_HOME: it skips on a normal dev machine and runs on
 * CI, where the runner's preinstalled SDK is licensed. CI sets
 * REQUIRE_ANDROID_SDK_ORACLE=1, which turns a missing SDK into a failure —
 * otherwise a runner that lost its SDK would skip silently and look exactly
 * like a pass.
 */

const TEMPLATE_DIR = path.resolve(__dirname, "../../../../node_modules/@narraleaf/studio-shell");
const MTIME = new Date(Date.UTC(2020, 0, 1));
/** The template's minSdk, and so the floor apksigner must accept the signature for. */
const MIN_SDK = 26;

/** Newest build-tools in the local SDK, or null when there is no usable SDK. */
function resolveBuildTools(): string | null {
    const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    if (!sdk || !existsSync(path.join(sdk, "build-tools"))) {
        return null;
    }
    const versions = readdirSync(path.join(sdk, "build-tools")).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }));
    const newest = versions.at(-1);
    return newest ? path.join(sdk, "build-tools", newest) : null;
}

const buildTools = resolveBuildTools();
const oracleRequired = process.env.REQUIRE_ANDROID_SDK_ORACLE === "1";

function tool(name: string, args: string[]): string {
    return execFileSync(path.join(buildTools!, name), args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

/** Repack the real template with a real payload and hand back the APK's path. */
async function buildApk(): Promise<string> {
    const templateManifest = validateMobileShellManifest(
        JSON.parse(await fs.readFile(path.join(TEMPLATE_DIR, "manifest.json"), "utf8")),
    );
    const sourceDir = await tempDir("nls-oracle-site-");
    await fs.writeFile(path.join(sourceDir, "index.html"), "<!doctype html><title>web</title>");
    await fs.writeFile(path.join(sourceDir, "web.js"), "/* bridge */");
    await fs.mkdir(path.join(sourceDir, "assets"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "assets", "bgm.ogg"), Buffer.alloc(64 * 1024, 9));

    const job: GameBuildWorkerMobileJob = {
        sourceDir,
        templateManifest,
        productName: "Oracle Game",
        appDirBaseName: "Oracle Game",
        orientation: "landscape",
        indexHtmlOverride: "<!doctype html><title>mobile</title>",
        shellConfigJson: JSON.stringify({ schemaVersion: 1, orientation: "landscape", backgroundColor: "#000000" }),
        android: {
            templateApkPath: path.join(TEMPLATE_DIR, templateManifest.android.template),
            outputName: "oracle.apk",
            applicationId: "com.example.oraclegame",
            versionName: "1.2.3",
            versionCode: 1_002_003,
            signingIdentity: generateSigningIdentity(),
        },
    };
    const outputDir = await tempDir("nls-oracle-out-");
    const [apk] = await runMobileRepack(job, outputDir, () => undefined, MTIME);
    return apk;
}

describe("the Android SDK oracle's availability", () => {
    it("is present when CI demands it", () => {
        // Without this, a runner whose SDK vanished would skip every oracle
        // below and report a green build — the failure mode this whole file
        // exists to prevent.
        if (oracleRequired) {
            expect(buildTools, "REQUIRE_ANDROID_SDK_ORACLE is set but no Android build-tools were found").not.toBeNull();
        }
    });
});

describe.skipIf(!buildTools)("Google's tools on a Studio-built APK", () => {
    it("passes apksigner verification at the template's minSdk", async () => {
        const apk = await buildApk();
        // The authoritative answer to "will Android install this?": apksigner
        // applies the platform's own acceptance rules for the API range.
        const output = tool("apksigner", ["verify", "--min-sdk-version", String(MIN_SDK), "--verbose", apk]);
        expect(output).toContain("Verifies");
        // v2-only is deliberate and this is what proves it is enough: v1 (JAR)
        // signing is only required below API 24, and the shell's floor is 26.
        expect(output).toMatch(/Verified using v2 scheme \(APK Signature Scheme v2\): true/);
        expect(output).toMatch(/Verified using v1 scheme \(JAR signing\): false/);
    });

    it("reports no signature warnings", async () => {
        const apk = await buildApk();
        const output = tool("apksigner", ["verify", "--min-sdk-version", String(MIN_SDK), "--verbose", apk]);
        // A "WARNING:" line here is how apksigner reports things it tolerates
        // but Android may not — e.g. unprotected entries outside the v2 digest.
        expect(output).not.toContain("WARNING:");
    });

    it("rejects the same APK with one payload byte flipped", async () => {
        // Proves the oracle has teeth, and proves what the signature covers:
        // if apksigner said "Verifies" for a tampered game payload, every
        // assertion above would be theatre and the signature would be
        // protecting only the shell it came from.
        const apk = await buildApk();
        const bytes = await fs.readFile(apk);
        // The ogg payload is stored uncompressed and far from any header, so
        // this corrupts game content and nothing structural.
        const marker = bytes.indexOf(Buffer.alloc(64, 9));
        expect(marker, "payload bytes not found in the APK").toBeGreaterThan(0);
        bytes[marker] ^= 0xff;
        const tampered = path.join(path.dirname(apk), "tampered.apk");
        await fs.writeFile(tampered, bytes);

        expect(() => tool("apksigner", ["verify", "--min-sdk-version", String(MIN_SDK), tampered]))
            .toThrow();
    });

    it("is aligned as zipalign requires", async () => {
        const apk = await buildApk();
        // -c checks; a misaligned APK still installs but forces the platform to
        // copy resources instead of mmap'ing them.
        expect(() => tool("zipalign", ["-c", "-v", "4", apk])).not.toThrow();
    });

    it("reads back the identity Studio wrote", async () => {
        const apk = await buildApk();
        // aapt2 parses the binary manifest the way the platform does, so this
        // is the check that Studio's own AXML patcher did not merely produce
        // something Studio's own parser likes.
        const badging = tool("aapt2", ["dump", "badging", apk]);
        expect(badging).toContain("package: name='com.example.oraclegame'");
        expect(badging).toContain("versionCode='1002003'");
        expect(badging).toContain("versionName='1.2.3'");
        expect(badging).toContain("application-label:'Oracle Game'");
    });

    it("leaves exactly one resource package, renamed in lockstep", async () => {
        const apk = await buildApk();
        const resources = tool("aapt2", ["dump", "resources", apk]);
        const packages = resources.split("\n").filter(line => line.startsWith("Package name="));
        expect(packages).toHaveLength(1);
        expect(packages[0]).toContain("com.example.oraclegame");
    });

    it("declares no provider authority two installed games could collide on", async () => {
        // Two games shipping the same provider authority collide with
        // INSTALL_FAILED_CONFLICTING_PROVIDER on the second install. The shell
        // repo asserts the template has no <provider>; assert it survives the
        // repack, since renaming derived authorities is Studio's half of the
        // contract and a regression here only shows up on a player's device
        // that already has another NarraLeaf game.
        const apk = await buildApk();
        const xmltree = tool("aapt2", ["dump", "xmltree", "--file", "AndroidManifest.xml", apk]);
        expect(xmltree).not.toMatch(/E: provider\b/);
        // Nothing anywhere may still carry the template's placeholder id.
        expect(xmltree).not.toContain("com.narraleaf.shell.placeholder");
    });
});
