import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signJar, verifyJarSignature } from "./jarSigning";
import { describeSigningCertificate, generateSigningIdentity, toApkSigningIdentity } from "./signingIdentity";
import { CENTRAL_HEADER_SIZE, crc32, parseZipIndex, readEntryBytes, readLocalEntryDataSpan } from "./zipModel";
import { BufferZipOutput, writeZip, type ZipWriteEntry } from "./zipWriter";

const execFileAsync = promisify(execFile);

/**
 * One deterministic identity for the whole suite - RSA key generation is the
 * only slow part, and a fresh key per test would buy nothing.
 */
const debugIdentity = generateSigningIdentity({
    notBefore: new Date(Date.UTC(2020, 0, 1)),
    notAfter: new Date(Date.UTC(2050, 0, 1)),
    serialNumber: Buffer.from([0x2a]),
});
const identity = toApkSigningIdentity(debugIdentity);

const MTIME = new Date(Date.UTC(2020, 0, 1));

/**
 * An entry name long enough to force the manifest's 72-byte wrap, with a
 * multi-byte character straddling the first break: "base/assets/" plus 52
 * filler bytes puts "章" at name bytes 64-66, and the first line carries
 * "Name: " (6 bytes) plus name bytes 0-65 - so the wrap lands two bytes into a
 * three-byte character. Round-tripping that is the whole point: the split is
 * defined on bytes, so unwrapping has to rejoin bytes before decoding.
 */
const LONG_NAME = `base/assets/${"x".repeat(52)}章節一的背景圖-with-a-long-tail.png`;

/** A synthetic but structurally real app bundle. */
async function buildBundle(): Promise<Buffer> {
    const entries: ZipWriteEntry[] = [
        { name: "BundleConfig.pb", source: { kind: "buffer", data: Buffer.from([0x08, 0x01, 0x12, 0x02, 0x18, 0x1a]) } },
        { name: "base/", source: null },
        { name: "base/manifest/AndroidManifest.xml", source: { kind: "buffer", data: Buffer.from([0x03, 0x00, 0x08, 0x00, 1, 2, 3, 4]) } },
        { name: "base/dex/classes.dex", source: { kind: "buffer", data: Buffer.from("dex\n035\0placeholder") } },
        // Stored (.png): a payload a test can flip a byte in directly.
        { name: "base/res/drawable/icon.png", source: { kind: "buffer", data: Buffer.alloc(96, 0x37) } },
        { name: LONG_NAME, source: { kind: "buffer", data: Buffer.alloc(48, 0x5c) } },
        { name: "base/assets/www/index.html", source: { kind: "buffer", data: Buffer.from("<!doctype html><title>g</title>") } },
        // An existing META-INF entry: excluded from the manifest, kept in the zip.
        { name: "META-INF/com/android/build/app-metadata.properties", source: { kind: "buffer", data: Buffer.from("appMetadataVersion=1.1\n") } },
    ];
    const output = new BufferZipOutput();
    await writeZip(output, entries, { mtime: MTIME, allowZip64: false });
    return output.toBuffer();
}

const sha256Base64 = (data: Buffer): string => crypto.createHash("sha256").update(data).digest("base64");

function entryBytes(zip: Buffer, name: string): Buffer {
    const entry = parseZipIndex(zip).entries.find(candidate => candidate.name === name);
    if (!entry) {
        throw new Error(`no entry named "${name}"`);
    }
    return readEntryBytes(zip, entry);
}

/**
 * Flip one byte inside a stored entry's data and repair the zip's own CRC-32
 * in both headers, so the result is a well-formed archive that only the
 * signature can object to. Without the repair the tamper is caught by the zip
 * layer - which proves nothing about the signature, and is not what an
 * attacker would hand over: the CRC is not signed, so repairing it is free.
 */
function flipByteIn(zip: Buffer, name: string, offsetInData: number): Buffer {
    const tampered = Buffer.from(zip);
    const index = parseZipIndex(tampered);
    const entry = index.entries.find(candidate => candidate.name === name);
    if (!entry) {
        throw new Error(`no entry named "${name}"`);
    }
    const { start, end } = readLocalEntryDataSpan(tampered, entry);
    tampered[start + offsetInData] ^= 0xff;
    const repaired = crc32(tampered.subarray(start, end));
    tampered.writeUInt32LE(repaired, entry.localHeaderOffset + 14);
    let cursor = index.centralDirectoryOffset;
    for (const candidate of index.entries) {
        if (candidate.name === name) {
            tampered.writeUInt32LE(repaired, cursor + 16);
            return tampered;
        }
        cursor += CENTRAL_HEADER_SIZE
            + tampered.readUInt16LE(cursor + 28)
            + tampered.readUInt16LE(cursor + 30)
            + tampered.readUInt16LE(cursor + 32);
    }
    throw new Error(`no central directory record for "${name}"`);
}

/** Split on CRLF, on bytes - a mid-character wrap makes a string split lie. */
function crlfLines(buffer: Buffer): Buffer[] {
    const lines: Buffer[] = [];
    let start = 0;
    for (let i = 0; i + 1 < buffer.length; i++) {
        if (buffer[i] === 0x0d && buffer[i + 1] === 0x0a) {
            lines.push(buffer.subarray(start, i));
            start = i + 2;
            i++;
        }
    }
    return lines;
}

/** The exact section text for `name`, blank line included. */
function sectionText(file: Buffer, name: string): Buffer {
    const start = file.indexOf(Buffer.from(`Name: ${name}\r\n`, "utf8"));
    if (start < 0) {
        throw new Error(`no section for "${name}"`);
    }
    const blank = file.indexOf(Buffer.from("\r\n\r\n", "ascii"), start);
    return file.subarray(start, blank + 4);
}

/** The (unwrapped) value of a header inside a section. */
function sectionDigest(file: Buffer, name: string): string {
    const section = sectionText(file, name).toString("utf8");
    const match = /\r\nSHA-256-Digest: (.+)\r\n/.exec(section);
    if (!match) {
        throw new Error(`no SHA-256-Digest for "${name}"`);
    }
    return match[1];
}

describe("signJar + verifyJarSignature", () => {
    it("signs a bundle its verifier accepts, covering exactly the payload entries", async () => {
        const signed = signJar(await buildBundle(), identity, { mtime: MTIME });
        const result = verifyJarSignature(signed);
        expect(result.reason).toBeUndefined();
        expect(result.verified).toBe(true);
        expect(result.signerName).toBe("NLSTUDIO");
        // Directories and the pre-existing META-INF entry are excluded; the
        // three signature files are excluded because they are META-INF too.
        expect(result.signedEntryNames).toEqual([
            "BundleConfig.pb",
            "base/manifest/AndroidManifest.xml",
            "base/dex/classes.dex",
            "base/res/drawable/icon.png",
            LONG_NAME,
            "base/assets/www/index.html",
        ]);
        expect(result.certificateChainDer.map(der => der.toString("base64")))
            .toEqual([debugIdentity.certificateDerBase64]);
    });

    it("puts MANIFEST.MF first, then the .SF, then the .RSA, then the original entries", async () => {
        const unsigned = await buildBundle();
        const signed = signJar(unsigned, identity, { mtime: MTIME });
        const names = parseZipIndex(signed).entries.map(entry => entry.name);
        expect(names.slice(0, 3)).toEqual([
            "META-INF/MANIFEST.MF",
            "META-INF/NLSTUDIO.SF",
            "META-INF/NLSTUDIO.RSA",
        ]);
        expect(names.slice(3)).toEqual(parseZipIndex(unsigned).entries.map(entry => entry.name));
    });

    it("preserves every original entry byte-identically", async () => {
        const unsigned = await buildBundle();
        const signed = signJar(unsigned, identity, { mtime: MTIME });
        const unsignedIndex = parseZipIndex(unsigned);
        const signedIndex = parseZipIndex(signed);
        // The original entry region is copied through wholesale, shifted by
        // exactly the three new entries - headers, extra fields and data alike.
        const prefixLength = signedIndex.entries[3].localHeaderOffset - unsignedIndex.entries[0].localHeaderOffset;
        expect(prefixLength).toBeGreaterThan(0);
        expect(signed.subarray(prefixLength, prefixLength + unsignedIndex.centralDirectoryOffset)
            .equals(unsigned.subarray(0, unsignedIndex.centralDirectoryOffset))).toBe(true);
        // And the entries still read back through a normal zip parse.
        for (const entry of unsignedIndex.entries) {
            if (entry.isDirectory) {
                continue;
            }
            expect(entryBytes(signed, entry.name).equals(entryBytes(unsigned, entry.name))).toBe(true);
        }
    });

    it("wraps manifest lines at 72 bytes and round-trips a name that wraps mid-character", async () => {
        const signed = signJar(await buildBundle(), identity, { mtime: MTIME });
        const manifest = entryBytes(signed, "META-INF/MANIFEST.MF");
        const signatureFile = entryBytes(signed, "META-INF/NLSTUDIO.SF");

        for (const file of [manifest, signatureFile]) {
            const lines = crlfLines(file);
            expect(lines.every(line => line.length <= 72)).toBe(true);
            // The wrap must actually be exercised, and at the limit - a signer
            // that wrapped at 70 would pass a "<= 72" check while producing
            // digests no other implementation reproduces.
            expect(lines.some(line => line.length === 72)).toBe(true);
            expect(lines.some(line => line.length > 0 && line[0] === 0x20)).toBe(true);
        }
        // The long name is not just present, it is byte-exact after unwrapping.
        expect(verifyJarSignature(signed).signedEntryNames).toContain(LONG_NAME);
        // ...and the header really was split inside the multi-byte character.
        expect(manifest.includes(Buffer.from(`Name: ${LONG_NAME}\r\n`, "utf8"))).toBe(false);
    });

    it("digests the manifest *section text* in the .SF, not the file it describes", async () => {
        const unsigned = await buildBundle();
        const signed = signJar(unsigned, identity, { mtime: MTIME });
        const manifest = entryBytes(signed, "META-INF/MANIFEST.MF");
        const signatureFile = entryBytes(signed, "META-INF/NLSTUDIO.SF");

        const name = "BundleConfig.pb";
        const fromSignatureFile = sectionDigest(signatureFile, name);
        expect(fromSignatureFile).toBe(sha256Base64(sectionText(manifest, name)));
        // The classic mistake: digesting the file content there instead.
        expect(fromSignatureFile).not.toBe(sha256Base64(entryBytes(unsigned, name)));
        // The manifest, in turn, does digest the content.
        expect(sectionDigest(manifest, name)).toBe(sha256Base64(entryBytes(unsigned, name)));
    });

    it("digests the manifest as a whole and its main section separately", async () => {
        const signed = signJar(await buildBundle(), identity, { mtime: MTIME });
        const manifest = entryBytes(signed, "META-INF/MANIFEST.MF");
        const signatureFile = entryBytes(signed, "META-INF/NLSTUDIO.SF").toString("utf8");

        const whole = /\r\nSHA-256-Digest-Manifest: (.+)\r\n/.exec(signatureFile);
        const main = /SHA-256-Digest-Manifest-Main-Attributes: (.+?)\r\n(?! )/s.exec(
            signatureFile.replace(/\r\n /g, ""),
        );
        expect(whole?.[1]).toBe(sha256Base64(manifest));
        const mainSectionEnd = manifest.indexOf(Buffer.from("\r\n\r\n", "ascii")) + 4;
        expect(main?.[1]).toBe(sha256Base64(manifest.subarray(0, mainSectionEnd)));
    });

    it("is byte-identical across runs", async () => {
        const unsigned = await buildBundle();
        expect(signJar(unsigned, identity, { mtime: MTIME })
            .equals(signJar(unsigned, identity, { mtime: MTIME }))).toBe(true);
    });

    /* ------------------------------------------------------ negative controls */

    it("fails on a flipped byte in a signed entry's payload", async () => {
        const signed = signJar(await buildBundle(), identity, { mtime: MTIME });
        const tampered = flipByteIn(signed, "base/res/drawable/icon.png", 13);
        const result = verifyJarSignature(tampered);
        expect(result.verified).toBe(false);
        expect(result.reason).toMatch(/entry "base\/res\/drawable\/icon\.png" content digest mismatch/);
    });

    it("fails the PKCS#7 check when the .SF is tampered with", async () => {
        const signed = signJar(await buildBundle(), identity, { mtime: MTIME });
        const tampered = flipByteIn(signed, "META-INF/NLSTUDIO.SF", 40);
        const result = verifyJarSignature(tampered);
        expect(result.verified).toBe(false);
        expect(result.reason).toMatch(/PKCS#7 signature does not verify/);
    });

    it("fails the manifest digest when MANIFEST.MF is tampered with", async () => {
        const signed = signJar(await buildBundle(), identity, { mtime: MTIME });
        const tampered = flipByteIn(signed, "META-INF/MANIFEST.MF", 100);
        const result = verifyJarSignature(tampered);
        expect(result.verified).toBe(false);
        expect(result.reason).toMatch(/manifest digest mismatch/);
    });

    it("refuses to double-sign", async () => {
        const signed = signJar(await buildBundle(), identity, { mtime: MTIME });
        expect(() => signJar(signed, identity, { mtime: MTIME })).toThrow(/already JAR-signed/);
        // ...including under a different signer name, which would otherwise
        // produce a second signature describing an archive that no longer matches.
        expect(() => signJar(signed, identity, { mtime: MTIME, signerName: "OTHER" }))
            .toThrow(/already JAR-signed/);
    });

    it("reports an unsigned archive as unverified", async () => {
        const result = verifyJarSignature(await buildBundle());
        expect(result.verified).toBe(false);
        expect(result.reason).toMatch(/no META-INF\/MANIFEST\.MF/);
    });

    it("rejects a signature file name the JAR spec cannot express", async () => {
        const unsigned = await buildBundle();
        expect(() => signJar(unsigned, identity, { signerName: "TOO-LONG-NAME" })).toThrow(/not a usable/);
        expect(() => signJar(unsigned, identity, { signerName: "bad.name" })).toThrow(/not a usable/);
    });

    it("refuses an identity carrying no certificate at all", async () => {
        const empty = { privateKeyPem: debugIdentity.privateKeyPem, certificateChainDerBase64: [] };
        expect(() => signJar(Buffer.alloc(0), empty)).toThrow(/carries no certificate/);
    });

    it("honours a custom signer name", async () => {
        const signed = signJar(await buildBundle(), identity, { mtime: MTIME, signerName: "NLAAB" });
        const names = parseZipIndex(signed).entries.map(entry => entry.name);
        expect(names.slice(0, 3)).toEqual([
            "META-INF/MANIFEST.MF",
            "META-INF/NLAAB.SF",
            "META-INF/NLAAB.RSA",
        ]);
        const result = verifyJarSignature(signed);
        expect(result.verified).toBe(true);
        expect(result.signerName).toBe("NLAAB");
    });

    it("is not fooled by a tamper that repairs the zip's own CRC", async () => {
        // The control for the controls: the tampered archives below are
        // well-formed zips, so a plain zip read of them succeeds.
        const signed = signJar(await buildBundle(), identity, { mtime: MTIME });
        const tampered = flipByteIn(signed, "base/res/drawable/icon.png", 13);
        expect(entryBytes(tampered, "base/res/drawable/icon.png")[13])
            .toBe(entryBytes(signed, "base/res/drawable/icon.png")[13] ^ 0xff);
    });

    it("embeds a whole chain, leaf first, and still verifies", async () => {
        const other = generateSigningIdentity({
            notBefore: new Date(Date.UTC(2020, 0, 1)),
            notAfter: new Date(Date.UTC(2050, 0, 1)),
            serialNumber: Buffer.from([0x2b]),
        });
        const chained = {
            privateKeyPem: debugIdentity.privateKeyPem,
            certificateChainDerBase64: [debugIdentity.certificateDerBase64, other.certificateDerBase64],
        };
        const result = verifyJarSignature(signJar(await buildBundle(), chained, { mtime: MTIME }));
        expect(result.verified).toBe(true);
        expect(result.certificateChainDer.map(der => der.toString("base64")))
            .toEqual(chained.certificateChainDerBase64);
    });
});

/**
 * External oracle. There is no JDK here (so no `jarsigner`), but a plain JRE
 * ships `keytool`, and `keytool -printcert -jarfile` reads every entry through
 * java.util.jar.JarFile with verification on - which is OpenJDK's own
 * JarVerifier, the implementation family that checks an uploaded bundle. It
 * accepts or throws for exactly the reasons a real verifier would. Skipped
 * when no Java runtime is on the host; nothing in the pipeline requires one.
 */
describe("OpenJDK JarVerifier oracle (JRE-gated)", () => {
    let keytool: string | null = null;
    let workDir: string;

    beforeEach(async () => {
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-jarsign-"));
        keytool = await resolveKeytool();
    });

    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true });
    });

    it("produces a signature OpenJDK's JarVerifier accepts, under our certificate", async () => {
        if (!keytool) {
            return;
        }
        const file = path.join(workDir, "signed.aab");
        await fs.writeFile(file, signJar(await buildBundle(), identity, { mtime: MTIME }));
        const { stdout } = await execFileAsync(keytool, printCertArgs(file));
        expect(stdout).toContain("Signer #1");
        // Tie the accepted signature to *our* key, not merely to some signer.
        const certificate = Buffer.from(debugIdentity.certificateDerBase64, "base64");
        expect(stdout).toContain(describeSigningCertificate(certificate).sha256Fingerprint);
    });

    it("is rejected by OpenJDK when a signed payload changed", async () => {
        if (!keytool) {
            return;
        }
        const signed = signJar(await buildBundle(), identity, { mtime: MTIME });
        const file = path.join(workDir, "tampered.aab");
        await fs.writeFile(file, flipByteIn(signed, "base/res/drawable/icon.png", 13));
        expect(await keytoolFailure(keytool, file)).toMatch(/SHA-256 digest error/);
    });

    it("is rejected by OpenJDK when the .SF changed", async () => {
        if (!keytool) {
            return;
        }
        const signed = signJar(await buildBundle(), identity, { mtime: MTIME });
        const file = path.join(workDir, "tampered-sf.aab");
        await fs.writeFile(file, flipByteIn(signed, "META-INF/NLSTUDIO.SF", 40));
        expect(await keytoolFailure(keytool, file)).toMatch(/cannot verify signature block/);
    });
});

/** `-J-Duser.language=en` so the assertions do not depend on the host locale. */
function printCertArgs(file: string): string[] {
    return ["-J-Duser.language=en", "-J-Duser.country=US", "-printcert", "-jarfile", file];
}

type ExecFailure = { stdout?: string; stderr?: string; message?: string };

/** Run keytool expecting it to fail, and return everything it said. */
async function keytoolFailure(keytool: string, file: string): Promise<string> {
    const failure = await execFileAsync(keytool, printCertArgs(file)).then(
        () => null,
        (error: ExecFailure) => error,
    );
    if (!failure) {
        throw new Error("keytool accepted a tampered archive");
    }
    return `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}`;
}

async function resolveKeytool(): Promise<string | null> {
    const executable = process.platform === "win32" ? "keytool.exe" : "keytool";
    const candidates = [
        ...(process.env.KEYTOOL ? [process.env.KEYTOOL] : []),
        ...(process.env.JAVA_HOME ? [path.join(process.env.JAVA_HOME, "bin", executable)] : []),
        "keytool",
    ];
    for (const candidate of candidates) {
        try {
            await execFileAsync(candidate, ["-help"]);
            return candidate;
        } catch (error) {
            // keytool -help exits non-zero; only ENOENT means "not installed".
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                return candidate;
            }
        }
    }
    return null;
}
