import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { generateSigningIdentity, loadSigningIdentity } from "./signingIdentity";

describe("generateSigningIdentity", () => {
    it("produces a loadable RSA key and a matching certificate", () => {
        const identity = generateSigningIdentity({
            notBefore: new Date(Date.UTC(2020, 0, 1)),
            notAfter: new Date(Date.UTC(2050, 0, 1)),
            serialNumber: Buffer.from([0x2a]),
            commonName: "NarraLeaf Debug",
        });
        expect(identity.privateKeyPem).toContain("BEGIN PRIVATE KEY");

        const { privateKey, certificateDer } = loadSigningIdentity(identity);
        const certificate = new crypto.X509Certificate(certificateDer);
        expect(certificate.subject).toContain("NarraLeaf Debug");

        // The certificate's key is the identity's key: a signature made with the
        // private key verifies against the certificate's public key.
        const message = Buffer.from("attestation");
        const signature = crypto.sign("sha256", message, privateKey);
        expect(crypto.verify("sha256", message, certificate.publicKey, signature)).toBe(true);
    });

    it("uses a wide default validity window when none is given", () => {
        const identity = generateSigningIdentity();
        const certificate = new crypto.X509Certificate(Buffer.from(identity.certificateDerBase64, "base64"));
        const years = (new Date(certificate.validTo).getTime() - new Date(certificate.validFrom).getTime())
            / (365 * 24 * 60 * 60 * 1000);
        expect(years).toBeGreaterThan(25);
    });

    it("round-trips through its serialized form", () => {
        const identity = generateSigningIdentity({ serialNumber: Buffer.from([0x05]) });
        const reloaded = loadSigningIdentity(identity);
        const fromKey = crypto.createPublicKey(reloaded.privateKey).export({ type: "spki", format: "der" });
        const fromCert = new crypto.X509Certificate(reloaded.certificateDer)
            .publicKey.export({ type: "spki", format: "der" });
        expect(fromKey.equals(fromCert)).toBe(true);
    });
});
