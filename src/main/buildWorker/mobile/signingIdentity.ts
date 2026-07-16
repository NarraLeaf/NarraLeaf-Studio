import crypto from "crypto";
import { buildSelfSignedCertificate } from "./x509";

/**
 * The debug-level signing identity a repacked APK is signed with. This is not
 * a release identity — it is the minimal self-signed RSA key + certificate an
 * unsigned APK needs to be installable at all (Android refuses to install an
 * unsigned APK). One identity is generated once and persisted (by the manager,
 * in userData) and reused across every project so an overwrite install keeps
 * the same signature. Serialized as JSON-friendly strings so it crosses the
 * worker boundary as plain data.
 */

export type SigningIdentity = {
    /** PKCS#8 private key, PEM. */
    privateKeyPem: string;
    /** X.509 certificate, DER, base64. */
    certificateDerBase64: string;
};

export type GenerateSigningIdentityOptions = {
    /** Injected for reproducible tests; defaults to a wide debug window. */
    notBefore?: Date;
    notAfter?: Date;
    serialNumber?: Buffer;
    commonName?: string;
};

const THIRTY_YEARS_MS = 30 * 365 * 24 * 60 * 60 * 1000;

/**
 * Generate a fresh debug signing identity: a 2048-bit RSA key and a matching
 * self-signed certificate. RSA (not EC) because APK Signature Scheme v2 with
 * RSASSA-PKCS1-v1.5 + SHA-256 is the simplest algorithm to implement and
 * verify, and key size / algorithm are invisible to players.
 */
export function generateSigningIdentity(options: GenerateSigningIdentityOptions = {}): SigningIdentity {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const notBefore = options.notBefore ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const notAfter = options.notAfter ?? new Date(notBefore.getTime() + THIRTY_YEARS_MS);
    // A positive 64-bit serial; the leading-zero guard in derInteger keeps it
    // unsigned regardless of the top bit.
    const serialNumber = options.serialNumber ?? crypto.randomBytes(8);

    const certificateDer = buildSelfSignedCertificate({
        commonName: options.commonName ?? "NarraLeaf Debug",
        serialNumber,
        notBefore,
        notAfter,
        subjectPublicKeyInfoDer: publicKey.export({ type: "spki", format: "der" }),
        privateKey,
    });

    return {
        privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        certificateDerBase64: certificateDer.toString("base64"),
    };
}

/** Materialize the private key and certificate bytes from a stored identity. */
export function loadSigningIdentity(identity: SigningIdentity): {
    privateKey: crypto.KeyObject;
    certificateDer: Buffer;
} {
    return {
        privateKey: crypto.createPrivateKey(identity.privateKeyPem),
        certificateDer: Buffer.from(identity.certificateDerBase64, "base64"),
    };
}
