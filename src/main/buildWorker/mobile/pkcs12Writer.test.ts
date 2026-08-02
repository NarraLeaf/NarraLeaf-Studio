import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { readKeystore } from "./keystoreReader";
import { writePasswordlessPkcs12 } from "./pkcs12Writer";
import { generateSigningIdentity } from "./signingIdentity";
import { APPLE_IDENTITY_PASSWORD, appleIdentityP12 } from "./signingFixtures";

/**
 * The writer is checked by reading its output back with keystoreReader.ts,
 * which is a genuinely separate implementation (written against RFC 7292 and
 * validated against keytool and openssl output) rather than an inverse of this
 * file. What neither can prove is that OpenSSL - which is what zsign links -
 * accepts the container; that is the gated oracle in signIpa.test.ts.
 */

const FIXED_SALT = Buffer.from("0011223344556677", "hex");

function identityFromFixture() {
    return readKeystore(appleIdentityP12(), { storePassword: APPLE_IDENTITY_PASSWORD });
}

function repack(chainLength?: number) {
    const identity = identityFromFixture();
    const chain = identity.certificateChainDerBase64
        .slice(0, chainLength ?? identity.certificateChainDerBase64.length)
        .map(der => Buffer.from(der, "base64"));
    return {
        identity,
        bytes: writePasswordlessPkcs12({
            privateKeyDer: crypto.createPrivateKey(identity.privateKeyPem)
                .export({ type: "pkcs8", format: "der" }),
            certificateChainDer: chain,
            friendlyName: identity.alias,
            macSalt: FIXED_SALT,
        }),
    };
}

describe("writePasswordlessPkcs12", () => {
    it("round-trips a key and its whole chain, with no password", () => {
        const { identity, bytes } = repack();
        const reread = readKeystore(bytes, { storePassword: "" });
        expect(reread.certificateChainDerBase64).toEqual(identity.certificateChainDerBase64);
        expect(reread.privateKeyPem).toBe(identity.privateKeyPem);
    });

    it("keeps the leaf first, which is what makes it the signing certificate", () => {
        const { identity, bytes } = repack();
        const reread = readKeystore(bytes, { storePassword: "" });
        const leaf = new crypto.X509Certificate(Buffer.from(reread.certificateChainDerBase64[0], "base64"));
        expect(leaf.subject).toContain("Apple Development");
        expect(reread.certificateDerBase64).toBe(identity.certificateDerBase64);
    });

    it("carries the friendly name through as the entry's alias", () => {
        const { bytes } = repack();
        expect(readKeystore(bytes, { storePassword: "" }).alias).toBe(identityFromFixture().alias);
    });

    it("produces a container whose integrity check catches a flipped byte", () => {
        const { bytes } = repack();
        const tampered = Buffer.from(bytes);
        // Land inside the authenticated safe rather than in the trailing MacData
        // - corrupting the MAC itself would prove nothing about coverage.
        tampered[200] ^= 0xff;
        expect(() => readKeystore(tampered, { storePassword: "" })).toThrow();
    });

    it("is byte-identical for the same input and salt", () => {
        expect(repack().bytes.equals(repack().bytes)).toBe(true);
    });

    it("writes a one-element chain when that is all there is", () => {
        const { bytes } = repack(1);
        expect(readKeystore(bytes, { storePassword: "" }).certificateChainDerBase64).toHaveLength(1);
    });

    it("takes a freshly generated identity too, not only a re-packed one", () => {
        const debug = generateSigningIdentity({ serialNumber: Buffer.from([0x07]) });
        const bytes = writePasswordlessPkcs12({
            privateKeyDer: crypto.createPrivateKey(debug.privateKeyPem).export({ type: "pkcs8", format: "der" }),
            certificateChainDer: [Buffer.from(debug.certificateDerBase64, "base64")],
            macSalt: FIXED_SALT,
        });
        expect(readKeystore(bytes, { storePassword: "" }).certificateDerBase64)
            .toBe(debug.certificateDerBase64);
    });

    it("refuses to write a container with no certificate", () => {
        expect(() => writePasswordlessPkcs12({ privateKeyDer: Buffer.alloc(4), certificateChainDer: [] }))
            .toThrow(/needs at least the signing certificate/);
    });

    it("does not open with a non-empty password", () => {
        // Not a security property - there is nothing to decrypt - but the
        // integrity check must still be keyed to the empty password, or the
        // readers that verify it first (including OpenSSL's) would reject it.
        const { bytes } = repack();
        expect(() => readKeystore(bytes, { storePassword: "anything" })).toThrow(/password is incorrect/);
    });
});
