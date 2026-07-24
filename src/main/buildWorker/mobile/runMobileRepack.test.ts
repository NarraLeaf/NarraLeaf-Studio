import { constants as bufferConstants } from "buffer";
import { execFileSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { derivePackEncryptionKey, isProtectedPayload } from "@narraleaf/encryption";
import { parseBinaryManifest } from "./axml";
import { parseArscPackageNames } from "./arsc";
import { verifyApkV2 } from "./apkSigningV2";
import { validateMobileShellManifest, type MobileShellManifest } from "./mobileShellManifest";
import { MAX_PAYLOAD_BYTES, payloadExceedsLimit, runMobileRepack } from "./runMobileRepack";
import { generateSigningIdentity } from "./signingIdentity";
import { findMisalignedStoredEntries, parseZipIndex, readEntryBytes, ZIP_METHOD_STORE } from "./zipModel";
import type { GameBuildWorkerMobileJob } from "../protocol";

/**
 * The golden test for the mobile repack: the real, CI-built shell templates -
 * not synthetic fixtures - carrying a real payload, with every claim read back
 * out of the produced package by an independent parser.
 *
 * The synthetic fixtures elsewhere pin the patchers' behaviour on inputs we
 * construct; this pins the one thing they cannot - that the templates the
 * shell repo actually ships satisfy the contract Studio enforces, end to end.
 */

const TEMPLATE_DIR = path.resolve(__dirname, "../../../../node_modules/@narraleaf/studio-shell");
const MTIME = new Date(Date.UTC(2020, 0, 1));

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

async function readManifest(): Promise<MobileShellManifest> {
    return validateMobileShellManifest(JSON.parse(await fs.readFile(path.join(TEMPLATE_DIR, "manifest.json"), "utf8")));
}

/** A compiled-site stand-in: the files a real web export always has. */
async function makeSiteDir(): Promise<string> {
    const dir = await tempDir("nls-site-");
    await fs.writeFile(path.join(dir, "index.html"), "<!doctype html><title>web variant</title>");
    await fs.writeFile(path.join(dir, "web.js"), "/* bridge */");
    await fs.writeFile(path.join(dir, "renderer.js"), "/* renderer */");
    await fs.mkdir(path.join(dir, "assets"), { recursive: true });
    await fs.writeFile(path.join(dir, "assets", "bgm.ogg"), Buffer.alloc(4096, 7));
    await fs.mkdir(path.join(dir, "plugin-api"), { recursive: true });
    await fs.writeFile(path.join(dir, "plugin-api", "runtime.js"), "export const x = 1;");
    return dir;
}

async function makeJob(overrides: Partial<GameBuildWorkerMobileJob> = {}): Promise<GameBuildWorkerMobileJob> {
    const templateManifest = await readManifest();
    return {
        sourceDir: await makeSiteDir(),
        templateManifest,
        productName: "My Game",
        appDirBaseName: "My Game",
        orientation: "landscape",
        indexHtmlOverride: "<!doctype html><title>mobile variant</title>",
        shellConfigJson: JSON.stringify({ schemaVersion: 1, orientation: "landscape", backgroundColor: "#000000" }),
        android: {
            templateApkPath: path.join(TEMPLATE_DIR, templateManifest.android.template),
            outputName: "MyGame-1.2.3-android.apk",
            applicationId: "com.example.mygame",
            versionName: "1.2.3",
            versionCode: 1_002_003,
            signingIdentity: generateSigningIdentity(),
        },
        ios: {
            templateAppZipPath: path.join(TEMPLATE_DIR, templateManifest.ios.template),
            outputName: "MyGame-1.2.3-ios.ipa",
            bundleId: "com.example.mygame",
            shortVersionString: "1.2.3",
            bundleVersion: "1.2.3",
        },
        ...overrides,
    };
}

const logs: string[] = [];
const log = (level: string, message: string) => void logs.push(`${level}: ${message}`);

describe("runMobileRepack against the real shell templates", () => {
    it("produces an installable APK carrying the game and the target identity", async () => {
        const job = await makeJob();
        const outputDir = await tempDir("nls-out-");

        const artifacts = await runMobileRepack(job, outputDir, log, MTIME);

        expect(artifacts).toContain(path.join(outputDir, "MyGame-1.2.3-android.apk"));
        const apk = await fs.readFile(path.join(outputDir, "MyGame-1.2.3-android.apk"));

        // The signature is what makes it installable at all; verify with the
        // independent checker rather than trusting the signer's own word.
        expect(verifyApkV2(apk)).toEqual(expect.objectContaining({ verified: true }));

        // Identity, read back out of the binary manifest.
        const index = parseZipIndex(apk);
        const manifestEntry = index.entries.find(entry => entry.name === "AndroidManifest.xml");
        const axml = parseBinaryManifest(readEntryBytes(apk, manifestEntry!));
        expect(axml.packageName).toBe("com.example.mygame");
        expect(axml.label).toBe("My Game");
        expect(axml.versionCode).toBe(1_002_003);
        expect(axml.versionName).toBe("1.2.3");

        // The resource table's package must be renamed in lockstep, or the app
        // resolves resources against a package that no longer exists.
        const arscEntry = index.entries.find(entry => entry.name === "resources.arsc")!;
        expect(parseArscPackageNames(readEntryBytes(apk, arscEntry))).toEqual(["com.example.mygame"]);

        // API 30+ refuses to install unless resources.arsc is stored + aligned.
        expect(arscEntry.method).toBe(ZIP_METHOD_STORE);
        expect(findMisalignedStoredEntries(apk, 4)).toEqual([]);

        // The payload, under the manifest's declared root.
        const { wwwRoot, shellConfigPath } = job.templateManifest.android;
        const names = index.entries.map(entry => entry.name);
        expect(names).toContain(`${wwwRoot}assets/bgm.ogg`);
        expect(names).toContain(`${wwwRoot}plugin-api/runtime.js`);
        expect(names).toContain(shellConfigPath);

        // The mobile entry document replaces the web one.
        const indexEntry = index.entries.find(entry => entry.name === `${wwwRoot}index.html`)!;
        expect(readEntryBytes(apk, indexEntry).toString("utf8")).toContain("mobile variant");

        // Without a content key, the payload is plain: a known file's bytes come
        // back verbatim and the package's own detector agrees.
        const bgm = readEntryBytes(apk, index.entries.find(entry => entry.name === `${wwwRoot}assets/bgm.ogg`)!);
        expect(Buffer.compare(bgm, Buffer.alloc(4096, 7))).toBe(0);
        expect(isProtectedPayload(bgm)).toBe(false);
    });

    it("protects every payload file under a content key, and leaves shell-config plain", async () => {
        // A real key of the kind the packer hands the repack; the exact value
        // does not matter here, only that the repack protects under it.
        const contentKey = derivePackEncryptionKey(Buffer.alloc(32, 1), Buffer.alloc(16, 2));
        const job = await makeJob({
            contentKey,
            // The manager writes the key into shell-config; mirror that here so
            // the worker-level test reflects the real job it is handed.
            shellConfigJson: JSON.stringify({
                schemaVersion: 1,
                orientation: "landscape",
                backgroundColor: "#000000",
                contentKey,
            }),
        });
        const outputDir = await tempDir("nls-out-");
        await runMobileRepack(job, outputDir, log, MTIME);
        const apk = await fs.readFile(path.join(outputDir, "MyGame-1.2.3-android.apk"));

        const index = parseZipIndex(apk);
        const { wwwRoot, shellConfigPath } = job.templateManifest.android;

        // Every payload file under wwwRoot is protected (all-or-nothing): the
        // package's own detector says so, checked with an independent parser
        // reading the real entry bytes back out of the APK.
        const wwwEntries = index.entries.filter(entry => entry.name.startsWith(wwwRoot) && !entry.name.endsWith("/"));
        expect(wwwEntries.length).toBeGreaterThan(0);
        for (const entry of wwwEntries) {
            expect(isProtectedPayload(readEntryBytes(apk, entry))).toBe(true);
        }

        // A known plaintext file is not shipped as its plaintext.
        const bgm = readEntryBytes(apk, index.entries.find(entry => entry.name === `${wwwRoot}assets/bgm.ogg`)!);
        expect(Buffer.compare(bgm, Buffer.alloc(4096, 7))).not.toBe(0);

        // The entry-document override is protected too, not served as HTML.
        const indexBytes = readEntryBytes(apk, index.entries.find(entry => entry.name === `${wwwRoot}index.html`)!);
        expect(isProtectedPayload(indexBytes)).toBe(true);
        expect(indexBytes.toString("utf8")).not.toContain("mobile variant");

        // shell-config.json stays plain: it is the bootstrap the decoder reads,
        // and it carries the key the shell hands to that decoder.
        const cfgBytes = readEntryBytes(apk, index.entries.find(entry => entry.name === shellConfigPath)!);
        expect(isProtectedPayload(cfgBytes)).toBe(false);
        expect(JSON.parse(cfgBytes.toString("utf8")).contentKey).toBe(contentKey);

        // Still a valid, installable package.
        expect(verifyApkV2(apk)).toEqual(expect.objectContaining({ verified: true }));
    });

    it("an external unzip confirms the payload is ciphertext under a key, plaintext without one", async () => {
        // The judge is the system `unzip`, not Studio's own zip parser or its
        // protected-payload detector: a bug that made both the writer and the
        // reader agree on plaintext would still be caught here.
        const contentKey = derivePackEncryptionKey(Buffer.alloc(32, 3), Buffer.alloc(16, 4));
        const marker = Buffer.alloc(4096, 7); // the bgm.ogg bytes makeSiteDir writes
        const wwwRoot = (await readManifest()).android.wwwRoot;
        const bgmEntry = `${wwwRoot}assets/bgm.ogg`;

        const buildApk = async (key: string | undefined): Promise<string> => {
            const job = await makeJob({
                ...(key ? { contentKey: key } : {}),
                shellConfigJson: JSON.stringify({
                    schemaVersion: 1,
                    orientation: "landscape",
                    backgroundColor: "#000000",
                    ...(key ? { contentKey: key } : {}),
                }),
            });
            const outputDir = await tempDir("nls-out-");
            await runMobileRepack(job, outputDir, log, MTIME);
            return path.join(outputDir, "MyGame-1.2.3-android.apk");
        };

        const unzipEntry = (apkPath: string, entry: string): Buffer =>
            execFileSync("unzip", ["-p", apkPath, entry], { maxBuffer: 64 * 1024 * 1024 });

        // Without a key: the external tool reads back the exact plaintext.
        const plainApk = await buildApk(undefined);
        expect(Buffer.compare(unzipEntry(plainApk, bgmEntry), marker)).toBe(0);

        // With a key: the external tool reads back bytes that are NOT the
        // plaintext, while shell-config.json stays plain JSON carrying the key.
        const protectedApk = await buildApk(contentKey);
        const protectedBgm = unzipEntry(protectedApk, bgmEntry);
        expect(protectedBgm.length).toBeGreaterThan(0);
        expect(Buffer.compare(protectedBgm, marker)).not.toBe(0);
        expect(protectedBgm.includes(marker)).toBe(false);

        const cfg = JSON.parse(unzipEntry(protectedApk, (await readManifest()).android.shellConfigPath).toString("utf8"));
        expect(cfg.contentKey).toBe(contentKey);
    });

    it("produces an IPA laid out as iOS expects, with the executable still executable", async () => {
        const job = await makeJob();
        const outputDir = await tempDir("nls-out-");

        await runMobileRepack(job, outputDir, log, MTIME);
        const ipa = await fs.readFile(path.join(outputDir, "MyGame-1.2.3-ios.ipa"));
        const index = parseZipIndex(ipa);
        const names = index.entries.map(entry => entry.name);
        const appPrefix = "Payload/My Game.app/";

        // The .app is renamed to the product; the executable inside keeps the
        // template's name (CFBundleExecutable is not rewritten).
        const executable = index.entries.find(
            entry => entry.name === `${appPrefix}${job.templateManifest.ios.executableName}`,
        );
        expect(executable).toBeDefined();
        // 0755: an .app whose binary is not executable will not launch.
        expect(executable!.unixMode & 0o777).toBe(0o755);

        const plistEntry = index.entries.find(entry => entry.name === `${appPrefix}Info.plist`)!;
        const plist = readEntryBytes(ipa, plistEntry).toString("utf8");
        expect(plist).toContain("<string>com.example.mygame</string>");
        expect(plist).toContain("<string>My Game</string>");
        expect(plist).toContain("UIInterfaceOrientationLandscapeLeft");

        const wwwPrefix = `${appPrefix}${job.templateManifest.ios.wwwRoot}`;
        expect(names).toContain(`${wwwPrefix}assets/bgm.ogg`);
        expect(names).toContain(`${appPrefix}${job.templateManifest.ios.shellConfigPath}`);
        // The mobile entry document must replace the web one here too - the
        // APK asserting it does not prove the iOS path injects it.
        const indexEntry = index.entries.find(entry => entry.name === `${wwwPrefix}index.html`)!;
        expect(readEntryBytes(ipa, indexEntry).toString("utf8")).toContain("mobile variant");
        // Symlinks would break signing and are forbidden by the contract.
        expect(index.entries.every(entry => (entry.unixMode & 0o170000) !== 0o120000)).toBe(true);
    });

    it("injects the site in a deterministic order regardless of directory order", async () => {
        // Reproducibility across machines rests on this: two hosts whose readdir
        // returns a different order must still produce identical bytes, which
        // comparing two runs on one machine can never show.
        const job = await makeJob();
        const outputDir = await tempDir("nls-out-");
        await runMobileRepack(job, outputDir, log, MTIME);
        const apk = await fs.readFile(path.join(outputDir, "MyGame-1.2.3-android.apk"));
        const wwwRoot = job.templateManifest.android.wwwRoot;
        const injected = parseZipIndex(apk).entries
            .map(entry => entry.name)
            .filter(name => name.startsWith(wwwRoot));
        expect(injected).toEqual([...injected].sort());
    });

    it("is reproducible: identical inputs give byte-identical packages", async () => {
        // Guards the golden property the whole test rests on - if output drifted
        // run to run, no downstream assertion here would mean anything.
        const job = await makeJob();
        const [first, second] = [await tempDir("nls-out-"), await tempDir("nls-out-")];
        await runMobileRepack(job, first, log, MTIME);
        await runMobileRepack(job, second, log, MTIME);
        for (const name of ["MyGame-1.2.3-android.apk", "MyGame-1.2.3-ios.ipa"]) {
            expect(await fs.readFile(path.join(first, name))).toEqual(await fs.readFile(path.join(second, name)));
        }
    });

    it("packages one platform without the other", async () => {
        const job = await makeJob();
        delete job.ios;
        const outputDir = await tempDir("nls-out-");
        const artifacts = await runMobileRepack(job, outputDir, log, MTIME);
        expect(artifacts).toEqual([path.join(outputDir, "MyGame-1.2.3-android.apk")]);
        await expect(fs.access(path.join(outputDir, "MyGame-1.2.3-ios.ipa"))).rejects.toThrow();
    });

    it("bounds the payload by what a Buffer can hold", () => {
        // The package is assembled in memory, so this is a real ceiling, not a
        // policy choice; a payload past it must be a clear error rather than an
        // allocation failure deep in the writer.
        expect(payloadExceedsLimit(MAX_PAYLOAD_BYTES)).toBe(false);
        expect(payloadExceedsLimit(MAX_PAYLOAD_BYTES + 1)).toBe(true);
        expect(MAX_PAYLOAD_BYTES).toBeLessThan(bufferConstants.MAX_LENGTH);
    });

    it("refuses an icon slot the template does not have", async () => {
        // The manifest and the template disagreeing must fail, not silently
        // ship the placeholder icon the author tried to replace.
        const iconDir = await tempDir("nls-icon-");
        const iconPath = path.join(iconDir, "icon.png");
        await fs.writeFile(iconPath, Buffer.alloc(64));
        const job = await makeJob();
        job.android!.iconPngBySlot = { "res/mipmap-nonexistent/ic_launcher.png": iconPath };
        await expect(runMobileRepack(job, await tempDir("nls-out-"), log, MTIME))
            .rejects.toThrow(/not present in the template/);
    });
});
