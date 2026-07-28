import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Relative on purpose: "@/" means src/main here but src/renderer under vitest.
import { buildSelfSignedCertificate } from "../../../../buildWorker/mobile/x509";
import {
    certificateExpiry,
    describeCertificate,
    inspectCertificateBytes,
    inspectCertificateFile,
    looksLikePkcs12,
} from "./certificateInspect";

function makeCertificate(options: { commonName?: string; notBefore?: Date; notAfter?: Date } = {}) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    return buildSelfSignedCertificate({
        commonName: options.commonName ?? "NarraLeaf Signing Test",
        serialNumber: Buffer.from([0x0a, 0xbc, 0xde]),
        notBefore: options.notBefore ?? new Date(Date.UTC(2026, 0, 1)),
        notAfter: options.notAfter ?? new Date(Date.UTC(2030, 0, 1)),
        subjectPublicKeyInfoDer: publicKey.export({ type: "spki", format: "der" }),
        privateKey,
    });
}

function toPem(der: Buffer): string {
    // Split rather than pad with newlines: a body whose base64 length is an
    // exact multiple of 64 would otherwise gain a blank line, and OpenSSL
    // rejects that - which reads as an inspector bug when it is not one.
    const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
    return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

describe("describeCertificate", () => {
    it("reads the fields the build dialog shows", () => {
        const der = makeCertificate();
        const info = describeCertificate(new crypto.X509Certificate(der));

        expect(info.subject).toContain("NarraLeaf Signing Test");
        expect(info.issuer).toContain("NarraLeaf Signing Test");
        expect(info.notBefore).toBe("2026-01-01T00:00:00.000Z");
        expect(info.notAfter).toBe("2030-01-01T00:00:00.000Z");
        expect(info.serialNumber).toBe("0ABCDE");
    });

    it("reports the SHA-1 thumbprint as bare uppercase hex", () => {
        const der = makeCertificate();
        const info = describeCertificate(new crypto.X509Certificate(der));

        expect(info.sha1).toMatch(/^[0-9A-F]{40}$/);
        // Cross-checked against the hash of the DER itself, not against the same
        // Node property that produced it.
        expect(info.sha1).toBe(crypto.createHash("sha1").update(der).digest("hex").toUpperCase());
    });
});

describe("inspectCertificateBytes", () => {
    it("accepts both DER and PEM", () => {
        const der = makeCertificate();
        const encodings: Array<[string, Buffer]> = [
            ["DER", der],
            ["PEM", Buffer.from(toPem(der), "utf8")],
        ];
        for (const [encoding, bytes] of encodings) {
            const result = inspectCertificateBytes(bytes);
            expect(result, encoding).toMatchObject({ available: true });
            expect(result.available && result.certificate.subject).toContain("NarraLeaf Signing Test");
        }
    });

    it("reports a PKCS#12 as a format it cannot open, not as garbage", () => {
        // A real PFX header: SEQUENCE { INTEGER 3, ... }. Node cannot open the
        // container, and telling the author "unreadable" would send them looking
        // for a corrupt file that is perfectly fine.
        const pfx = Buffer.concat([
            Buffer.from([0x30, 0x82, 0x01, 0x00, 0x02, 0x01, 0x03]),
            Buffer.alloc(64, 0x41),
        ]);
        expect(inspectCertificateBytes(pfx)).toEqual({ available: false, reason: "unsupported-format" });
    });

    it("reports anything else it cannot parse as unreadable", () => {
        expect(inspectCertificateBytes(Buffer.from("not a certificate at all")))
            .toEqual({ available: false, reason: "unreadable" });
        expect(inspectCertificateBytes(Buffer.alloc(0)))
            .toEqual({ available: false, reason: "unreadable" });
    });
});

describe("looksLikePkcs12", () => {
    it("separates a PKCS#12 from an X.509 certificate", () => {
        // tbsCertificate is a SEQUENCE, so a certificate's second element is
        // 0x30, never INTEGER 3.
        expect(looksLikePkcs12(makeCertificate())).toBe(false);
        // Short-form length, long-form length: both header shapes.
        expect(looksLikePkcs12(Buffer.from([0x30, 0x10, 0x02, 0x01, 0x03, 0x00]))).toBe(true);
        expect(looksLikePkcs12(Buffer.from([0x30, 0x82, 0x04, 0x00, 0x02, 0x01, 0x03, 0x00]))).toBe(true);
        expect(looksLikePkcs12(Buffer.from([0x30, 0x10, 0x02, 0x01, 0x02, 0x00]))).toBe(false);
        expect(looksLikePkcs12(Buffer.from([0x02, 0x01, 0x03]))).toBe(false);
    });
});

describe("inspectCertificateFile", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-cert-inspect-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("reads a certificate off disk", async () => {
        const file = path.join(tempDir, "cert.pem");
        await fs.writeFile(file, toPem(makeCertificate({ commonName: "From Disk" })));

        const result = await inspectCertificateFile(file);
        expect(result.available && result.certificate.subject).toContain("From Disk");
    });

    it("reports a missing file as unreadable rather than throwing", async () => {
        expect(await inspectCertificateFile(path.join(tempDir, "absent.pem")))
            .toEqual({ available: false, reason: "unreadable" });
    });
});

describe("certificateExpiry", () => {
    const info = describeCertificate(new crypto.X509Certificate(makeCertificate({
        notBefore: new Date(Date.UTC(2026, 0, 1)),
        notAfter: new Date(Date.UTC(2027, 0, 1)),
    })));

    it("places a certificate against the warning band", () => {
        expect(certificateExpiry(info, new Date(Date.UTC(2026, 5, 1)))).toBe("valid");
        // Inside the default 30-day band.
        expect(certificateExpiry(info, new Date(Date.UTC(2026, 11, 20)))).toBe("expiring");
        expect(certificateExpiry(info, new Date(Date.UTC(2027, 0, 2)))).toBe("expired");
        expect(certificateExpiry(info, new Date(Date.UTC(2025, 0, 1)))).toBe("not-yet-valid");
    });

    it("treats the exact notAfter instant as expired", () => {
        expect(certificateExpiry(info, new Date(Date.UTC(2027, 0, 1)))).toBe("expired");
    });

    it("honours a custom warning window", () => {
        expect(certificateExpiry(info, new Date(Date.UTC(2026, 9, 1)), 120)).toBe("expiring");
        expect(certificateExpiry(info, new Date(Date.UTC(2026, 9, 1)), 30)).toBe("valid");
    });
});
