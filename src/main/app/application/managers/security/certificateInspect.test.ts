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
  looksLikeJavaKeystore,
  looksLikeKeystore,
  looksLikePkcs12
} from "./certificateInspect";

/**
 * A real JKS holding one signing key under the alias `release`, made with
 * keytool and copied from `buildWorker/mobile/keystoreReader.test.ts`, where the
 * reader that opens it is checked field by field against OpenSSL's reading of
 * the same file. What is being proved here is the wiring - that a keystore
 * reaches that reader and comes back as certificate facts - so the expectations
 * below are the certificate's own, not a second opinion about the parser.
 *
 *   keytool -genkeypair -alias release -keyalg RSA -keysize 2048 -validity 3650 \
 *     -dname "CN=NarraLeaf JKS, O=NarraLeaf, C=US" -sigalg SHA256withRSA \
 *     -keystore basic.jks -storetype JKS -storepass storepass -keypass storepass
 */
const BASIC_JKS = Buffer.from(
  "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",
  "base64"
);

const BASIC_JKS_PASSWORD = "storepass";

function makeCertificate(options: { commonName?: string; notBefore?: Date; notAfter?: Date } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return buildSelfSignedCertificate({
    commonName: options.commonName ?? "NarraLeaf Signing Test",
    serialNumber: Buffer.from([0x0a, 0xbc, 0xde]),
    notBefore: options.notBefore ?? new Date(Date.UTC(2026, 0, 1)),
    notAfter: options.notAfter ?? new Date(Date.UTC(2030, 0, 1)),
    subjectPublicKeyInfoDer: publicKey.export({ type: "spki", format: "der" }),
    privateKey
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
      ["PEM", Buffer.from(toPem(der), "utf8")]
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
      Buffer.alloc(64, 0x41)
    ]);
    expect(inspectCertificateBytes(pfx)).toEqual({
      available: false,
      reason: "unsupported-format"
    });
  });

  it("reports anything else it cannot parse as unreadable", () => {
    expect(inspectCertificateBytes(Buffer.from("not a certificate at all"))).toEqual({
      available: false,
      reason: "unreadable"
    });
    expect(inspectCertificateBytes(Buffer.alloc(0))).toEqual({
      available: false,
      reason: "unreadable"
    });
  });
});

describe("inspectCertificateBytes with a keystore", () => {
  it("opens a keystore with its password and describes the signing key's certificate", () => {
    const result = inspectCertificateBytes(BASIC_JKS, { storePassword: BASIC_JKS_PASSWORD });

    expect(result).toMatchObject({ available: true });
    if (!result.available) {
      return;
    }
    expect(result.certificate.subject).toContain("CN=NarraLeaf JKS");
    expect(result.certificate.serialNumber).toBe("ABE201FAA9D3BFEF");
    expect(result.certificate.notAfter).toBe("2036-07-25T21:37:05.000Z");
  });

  it("takes the alias when the caller names one", () => {
    const result = inspectCertificateBytes(BASIC_JKS, {
      storePassword: BASIC_JKS_PASSWORD,
      keyPassword: BASIC_JKS_PASSWORD,
      alias: "release"
    });

    expect(result.available && result.certificate.subject).toContain("CN=NarraLeaf JKS");
  });

  it("treats a null key password as 'the same as the store password', not as an empty one", () => {
    // What the vault hands over when a credential carries only one secret.
    const result = inspectCertificateBytes(BASIC_JKS, {
      storePassword: BASIC_JKS_PASSWORD,
      keyPassword: null
    });

    expect(result).toMatchObject({ available: true });
  });

  it("says a keystore needs a password rather than calling it broken", () => {
    // What preflight sees today: it inspects by path alone, so a keystore is
    // reported as a container it cannot open here - not as a damaged file.
    expect(inspectCertificateBytes(BASIC_JKS)).toEqual({
      available: false,
      reason: "unsupported-format"
    });
    expect(inspectCertificateBytes(BASIC_JKS, { storePassword: null })).toEqual({
      available: false,
      reason: "unsupported-format"
    });
  });

  it("separates a wrong password from a container it cannot open", () => {
    // Both are "no certificate for you", but only one is worth converting the
    // file over, so they must not collapse into the same answer.
    expect(inspectCertificateBytes(BASIC_JKS, { storePassword: "not the password" })).toEqual({
      available: false,
      reason: "unreadable"
    });
  });

  it("reports a JCEKS as an unsupported container", () => {
    const jceks = Buffer.concat([Buffer.from([0xce, 0xce, 0xce, 0xce]), Buffer.alloc(32)]);

    expect(inspectCertificateBytes(jceks, { storePassword: "storepass" })).toEqual({
      available: false,
      reason: "unsupported-format"
    });
  });
});

describe("looksLikeKeystore", () => {
  it("tells a keystore apart from a bare certificate", () => {
    expect(looksLikeKeystore(BASIC_JKS)).toBe(true);
    expect(looksLikeKeystore(Buffer.from([0x30, 0x10, 0x02, 0x01, 0x03, 0x00]))).toBe(true);
    expect(looksLikeKeystore(makeCertificate())).toBe(false);
  });

  it("counts both Java keystore magics", () => {
    expect(looksLikeJavaKeystore(Buffer.from([0xfe, 0xed, 0xfe, 0xed]))).toBe(true);
    expect(looksLikeJavaKeystore(Buffer.from([0xce, 0xce, 0xce, 0xce]))).toBe(true);
    expect(looksLikeJavaKeystore(makeCertificate())).toBe(false);
    expect(looksLikeJavaKeystore(Buffer.alloc(0))).toBe(false);
  });
});

describe("looksLikePkcs12", () => {
  it("separates a PKCS#12 from an X.509 certificate", () => {
    // tbsCertificate is a SEQUENCE, so a certificate's second element is
    // 0x30, never INTEGER 3.
    expect(looksLikePkcs12(makeCertificate())).toBe(false);
    // Short-form length, long-form length: both header shapes.
    expect(looksLikePkcs12(Buffer.from([0x30, 0x10, 0x02, 0x01, 0x03, 0x00]))).toBe(true);
    expect(looksLikePkcs12(Buffer.from([0x30, 0x82, 0x04, 0x00, 0x02, 0x01, 0x03, 0x00]))).toBe(
      true
    );
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
    expect(await inspectCertificateFile(path.join(tempDir, "absent.pem"))).toEqual({
      available: false,
      reason: "unreadable"
    });
  });

  it("carries the password through to a keystore on disk", async () => {
    // Named `.p12` while actually being a JKS: the container is decided by
    // the bytes, because authors and Android Studio both rename these.
    const file = path.join(tempDir, "release.p12");
    await fs.writeFile(file, BASIC_JKS);

    const result = await inspectCertificateFile(file, { storePassword: BASIC_JKS_PASSWORD });
    expect(result.available && result.certificate.subject).toContain("CN=NarraLeaf JKS");
  });
});

describe("certificateExpiry", () => {
  const info = describeCertificate(
    new crypto.X509Certificate(
      makeCertificate({
        notBefore: new Date(Date.UTC(2026, 0, 1)),
        notAfter: new Date(Date.UTC(2027, 0, 1))
      })
    )
  );

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
