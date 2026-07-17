import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { buildSelfSignedCertificate, derInteger, encodeOid } from "./x509";

describe("DER primitives", () => {
    it("encodes OIDs against known byte sequences", () => {
        // sha256WithRSAEncryption and commonName, from RFC 5280 examples.
        expect(encodeOid("1.2.840.113549.1.1.11").toString("hex")).toBe("06092a864886f70d01010b");
        expect(encodeOid("2.5.4.3").toString("hex")).toBe("0603550403");
    });

    it("keeps integers unsigned by padding a set top bit", () => {
        expect(derInteger(Buffer.from([0x80])).toString("hex")).toBe("02020080");
        expect(derInteger(Buffer.from([0x7f])).toString("hex")).toBe("02017f");
        // Redundant leading zero is stripped.
        expect(derInteger(Buffer.from([0x00, 0x01])).toString("hex")).toBe("020101");
    });
});

describe("buildSelfSignedCertificate", () => {
    const notBefore = new Date(Date.UTC(2020, 0, 1));
    const notAfter = new Date(Date.UTC(2050, 0, 1));

    function build(commonName = "NarraLeaf Debug") {
        const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
        const der = buildSelfSignedCertificate({
            commonName,
            serialNumber: Buffer.from([0x01, 0x23, 0x45, 0x67]),
            notBefore,
            notAfter,
            subjectPublicKeyInfoDer: publicKey.export({ type: "spki", format: "der" }),
            privateKey,
        });
        return { der, privateKey, publicKey };
    }

    it("produces a certificate Node's own X.509 parser accepts", () => {
        const { der } = build();
        const certificate = new crypto.X509Certificate(der);
        expect(certificate.subject).toContain("NarraLeaf Debug");
        expect(certificate.issuer).toContain("NarraLeaf Debug");
        expect(new Date(certificate.validFrom).getUTCFullYear()).toBe(2020);
        expect(new Date(certificate.validTo).getUTCFullYear()).toBe(2050);
    });

    it("is self-signed: it verifies against its own public key", () => {
        const { der, publicKey } = build();
        const certificate = new crypto.X509Certificate(der);
        expect(certificate.verify(publicKey)).toBe(true);
    });

    it("embeds exactly the provided public key", () => {
        const { der, publicKey } = build();
        const certificate = new crypto.X509Certificate(der);
        expect(certificate.publicKey.export({ type: "spki", format: "der" })
            .equals(publicKey.export({ type: "spki", format: "der" }))).toBe(true);
    });

    it("encodes validity per RFC 5280: UTCTime through 2049, GeneralizedTime from 2050", () => {
        // Strict parsers (openssl verify, some Android/re-sign toolchains)
        // reject a GeneralizedTime used for a pre-2050 date. UTCTime is tag
        // 0x17; GeneralizedTime is 0x18.
        const { der } = build();
        expect(der.includes(Buffer.concat([Buffer.from([0x17, 0x0d]), Buffer.from("200101000000Z")]))).toBe(true);
        expect(der.includes(Buffer.concat([Buffer.from([0x18, 0x0f]), Buffer.from("20500101000000Z")]))).toBe(true);
    });

    it("is byte-deterministic for fixed inputs", () => {
        const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
        const params = {
            commonName: "NarraLeaf Debug",
            serialNumber: Buffer.from([0x01, 0x23, 0x45, 0x67]),
            notBefore,
            notAfter,
            subjectPublicKeyInfoDer: publicKey.export({ type: "spki", format: "der" }),
            privateKey,
        };
        // PKCS#1 v1.5 is deterministic, so the same key + fields → same bytes.
        expect(buildSelfSignedCertificate(params).equals(buildSelfSignedCertificate(params))).toBe(true);
    });
});
