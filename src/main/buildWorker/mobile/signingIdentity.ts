import crypto from "crypto";
import { buildSelfSignedCertificate } from "./x509";

/**
 * The debug-level signing identity a repacked APK is signed with. This is not
 * a release identity - it is the minimal self-signed RSA key + certificate an
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

/**
 * What the v2 signer actually consumes: a key and the certificate chain to
 * embed alongside it, leaf first.
 *
 * The debug identity is self-signed and so has a chain of one, but an author's
 * release keystore usually carries the issuing certificates too, and the v2
 * signing block is defined to hold the whole chain. `KeystoreIdentity`
 * (keystoreReader.ts) satisfies this structurally, so a release keystore drops
 * straight in.
 */
export type ApkSigningIdentity = {
  /** PKCS#8 private key, PEM. */
  privateKeyPem: string;
  /** Leaf first: element 0 is the signer's own certificate, then each issuer. */
  certificateChainDerBase64: string[];
};

/** Widen the single-certificate debug identity into a one-element chain. */
export function toApkSigningIdentity(identity: SigningIdentity): ApkSigningIdentity {
  return {
    privateKeyPem: identity.privateKeyPem,
    certificateChainDerBase64: [identity.certificateDerBase64]
  };
}

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
export function generateSigningIdentity(
  options: GenerateSigningIdentityOptions = {}
): SigningIdentity {
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
    privateKey
  });

  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    certificateDerBase64: certificateDer.toString("base64")
  };
}

/** Materialize the private key and certificate bytes from a stored identity. */
export function loadSigningIdentity(identity: SigningIdentity): {
  privateKey: crypto.KeyObject;
  certificateDer: Buffer;
} {
  return {
    privateKey: crypto.createPrivateKey(identity.privateKeyPem),
    certificateDer: Buffer.from(identity.certificateDerBase64, "base64")
  };
}

/** Materialize the private key and the whole certificate chain, leaf first. */
export function loadApkSigningIdentity(identity: ApkSigningIdentity): {
  privateKey: crypto.KeyObject;
  certificateChainDer: Buffer[];
} {
  if (identity.certificateChainDerBase64.length === 0) {
    throw new Error("The signing identity carries no certificate");
  }
  return {
    privateKey: crypto.createPrivateKey(identity.privateKeyPem),
    certificateChainDer: identity.certificateChainDerBase64.map((der) => Buffer.from(der, "base64"))
  };
}

/**
 * The human-facing facts about a signing certificate: what the build log needs
 * to say *which* identity signed, and what the author can compare against
 * `keytool -list`. The fingerprint is the SHA-256 of the certificate's DER,
 * which is exactly what keytool and the Play Console print.
 */
export function describeSigningCertificate(certificateDer: Buffer): {
  subject: string;
  sha256Fingerprint: string;
  notAfter: Date;
} {
  const certificate = new crypto.X509Certificate(certificateDer);
  return {
    // X509Certificate.subject is newline-separated; a log line wants one line.
    subject: certificate.subject.split("\n").join(", "),
    sha256Fingerprint: certificate.fingerprint256,
    notAfter: new Date(certificate.validTo)
  };
}
