import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signApkV2, verifyApkV2 } from "./apkSigningV2";
import { generateSigningIdentity } from "./signingIdentity";
import { BufferZipOutput, writeZip, type ZipWriteEntry } from "./zipWriter";

const execFileAsync = promisify(execFile);

/**
 * A deterministic debug identity for the whole suite (generation is the only
 * slow part). A fresh RSA key per test would triple the runtime for no gain.
 */
const identity = generateSigningIdentity({
    notBefore: new Date(Date.UTC(2020, 0, 1)),
    notAfter: new Date(Date.UTC(2050, 0, 1)),
    serialNumber: Buffer.from([0x2a]),
});

/** A minimal but structurally real unsigned APK (a ZIP), 4-byte aligned. */
async function buildUnsignedApk(): Promise<Buffer> {
    const entries: ZipWriteEntry[] = [
        { name: "AndroidManifest.xml", source: { kind: "buffer", data: Buffer.from([0x03, 0x00, 0x08, 0x00, 1, 2, 3, 4]) } },
        { name: "resources.arsc", source: { kind: "buffer", data: Buffer.alloc(64, 7) }, method: "store", forceAlign: 4 },
        { name: "classes.dex", source: { kind: "buffer", data: Buffer.from("dex\n035\0placeholder") } },
        { name: "assets/www/index.html", source: { kind: "buffer", data: Buffer.from("<!doctype html><title>g</title>") } },
        { name: "assets/www/pack.json", source: { kind: "buffer", data: Buffer.from("{\"assets\":{}}") } },
    ];
    const output = new BufferZipOutput();
    await writeZip(output, entries, { mtime: new Date(Date.UTC(2020, 0, 1)), alignStoredEntries: 4, allowZip64: false });
    return output.toBuffer();
}

describe("signApkV2 + verifyApkV2", () => {
    it("signs an APK the self-verifier accepts", async () => {
        const signed = signApkV2(await buildUnsignedApk(), identity);
        const result = verifyApkV2(signed);
        expect(result.verified).toBe(true);
        expect(result.reason).toBeUndefined();
    });

    it("embeds the identity's certificate", async () => {
        const signed = signApkV2(await buildUnsignedApk(), identity);
        const result = verifyApkV2(signed);
        const expectedCert = Buffer.from(identity.certificateDerBase64, "base64");
        expect(result.certificateDer?.equals(expectedCert)).toBe(true);
    });

    it("preserves the original entry bytes ahead of the signing block", async () => {
        const unsigned = await buildUnsignedApk();
        const signed = signApkV2(unsigned, identity);
        // The signing block is inserted at the old central-directory offset, so
        // every entry byte before it is untouched.
        const eocd = unsigned.length - 22;
        const centralDirOffset = unsigned.readUInt32LE(eocd + 16);
        expect(signed.subarray(0, centralDirOffset).equals(unsigned.subarray(0, centralDirOffset))).toBe(true);
        expect(signed.length).toBeGreaterThan(unsigned.length);
    });

    it("is deterministic for a fixed identity and input", async () => {
        const unsigned = await buildUnsignedApk();
        expect(signApkV2(unsigned, identity).equals(signApkV2(unsigned, identity))).toBe(true);
    });

    it("detects tampering with the entry contents", async () => {
        const signed = signApkV2(await buildUnsignedApk(), identity);
        const tampered = Buffer.from(signed);
        tampered[64] ^= 0xff; // flip a byte inside the entries region
        expect(verifyApkV2(tampered).verified).toBe(false);
    });

    it("detects tampering with the central directory", async () => {
        const unsigned = await buildUnsignedApk();
        const signed = signApkV2(unsigned, identity);
        const tampered = Buffer.from(signed);
        // Flip a byte a few into the central directory (after the block).
        const eocd = tampered.length - 22;
        const centralDirOffset = tampered.readUInt32LE(eocd + 16);
        tampered[centralDirOffset + 20] ^= 0xff;
        expect(verifyApkV2(tampered).verified).toBe(false);
    });

    it("rejects an APK that already carries a signing block", async () => {
        const signed = signApkV2(await buildUnsignedApk(), identity);
        expect(() => signApkV2(signed, identity)).toThrow(/already has an APK Signing Block/);
    });

    it("reports 'no signature' for an unsigned APK", async () => {
        const result = verifyApkV2(await buildUnsignedApk());
        expect(result.verified).toBe(false);
        expect(result.reason).toMatch(/magic not found|no v2/);
    });
});

/**
 * External oracle: when the Android SDK's apksigner is on PATH (the CI runner,
 * or a dev machine that installed it), it must accept our signature. Skipped
 * otherwise — the pipeline never ships or requires the SDK.
 */
describe("apksigner oracle (SDK-gated)", () => {
    let apksigner: string | null = null;
    let workDir: string;

    beforeEach(async () => {
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-apksign-"));
        apksigner = await resolveApksigner();
    });

    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true });
    });

    it("produces a signature apksigner verifies", async () => {
        if (!apksigner) {
            return; // no SDK on this host
        }
        const signed = signApkV2(await buildUnsignedApk(), identity);
        const apkPath = path.join(workDir, "signed.apk");
        await fs.writeFile(apkPath, signed);
        // --min-sdk-version 26 matches the shell template's minSdk.
        await execFileAsync(apksigner, ["verify", "--min-sdk-version", "26", "--verbose", apkPath]);
    });
});

async function resolveApksigner(): Promise<string | null> {
    const explicit = process.env.APKSIGNER;
    if (explicit) {
        return explicit;
    }
    const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    if (!home) {
        return null;
    }
    try {
        const buildTools = path.join(home, "build-tools");
        const versions = await fs.readdir(buildTools);
        for (const version of versions.sort().reverse()) {
            const candidate = path.join(buildTools, version, process.platform === "win32" ? "apksigner.bat" : "apksigner");
            if (await fs.access(candidate).then(() => true).catch(() => false)) {
                return candidate;
            }
        }
    } catch {
        return null;
    }
    return null;
}

// Silence an unused-import lint when the oracle is the only crypto user.
void crypto;
