import crypto from "crypto";
import fs from "fs/promises";
import {
    SIGNING_EXPIRY_WARNING_DAYS,
    type ResolvedSigningMaterial,
    type SigningCertificateExpiry,
    type SigningCertificateInfo,
    type SigningInspectResult,
} from "@shared/types/signing";
// Relative on purpose: "@/" means src/main here but src/renderer under vitest.
import { KeystoreError, readKeystore } from "../../../../buildWorker/mobile/keystoreReader";

/**
 * Reads the display-only facts out of a signing certificate: who it is for, who
 * issued it, how long it is good for, and its thumbprint. Nothing here touches
 * a private key, and nothing it returns is a secret - the result is meant to be
 * shown in the build dialog and to feed the expiry preflight checks.
 *
 * A bare certificate is parsed by Node's own `crypto.X509Certificate`, which
 * accepts both PEM and DER. A keystore - PKCS#12 or JKS - is a different
 * container: its certificate bags are encrypted under the store password, so it
 * can only be opened with `secrets`, and the keystore reader does that. Called
 * without a password, a keystore is still reported as `unsupported-format`
 * rather than guessed at, because the honest answer is "not without the
 * password", not "this file is broken".
 *
 * The private key `readKeystore` also returns is dropped on the floor here. The
 * only thing that leaves this module is `SigningCertificateInfo`.
 */

/**
 * What it takes to open a keystore. Passwords arrive already unsealed from the
 * vault and must not be logged or passed on; `null` means the vault could not
 * unseal one, which reads the same as having none.
 */
export type KeystoreSecrets = {
    storePassword: string | null;
    /** Defaults to `storePassword`, which is the usual case. */
    keyPassword?: string | null;
    /** Which key to describe. Optional when the keystore holds exactly one. */
    alias?: string;
};

/**
 * Which file of a resolved credential holds the certificate, and what it takes
 * to open it. A PFX and an Apple .p12 carry one password serving as both store
 * and key password; a keystore keeps them apart and names the key to read. The
 * kinds not listed keep their certificate somewhere this process cannot reach -
 * the Windows certificate store, or Azure.
 *
 * Lives here rather than beside either caller: the build dialog's inspector and
 * the expiry preflight must describe the same certificate, and two mappings
 * would eventually disagree about which one that is.
 */
export function certificateContainer(
    material: ResolvedSigningMaterial,
): { file: string; secrets: KeystoreSecrets } | null {
    switch (material.kind) {
        case "windows-pfx":
            return { file: material.file, secrets: { storePassword: material.password } };
        case "android-keystore":
            return {
                file: material.file,
                secrets: {
                    storePassword: material.storePassword,
                    keyPassword: material.keyPassword,
                    alias: material.alias,
                },
            };
        case "ios-apple":
            return { file: material.p12File, secrets: { storePassword: material.p12Password } };
        default:
            return null;
    }
}

export async function inspectCertificateFile(
    filePath: string,
    secrets?: KeystoreSecrets,
): Promise<SigningInspectResult> {
    let bytes: Buffer;
    try {
        bytes = await fs.readFile(filePath);
    } catch {
        return { available: false, reason: "unreadable" };
    }
    return inspectCertificateBytes(bytes, secrets);
}

export function inspectCertificateBytes(bytes: Buffer, secrets?: KeystoreSecrets): SigningInspectResult {
    // Checked before parsing: a PKCS#12 is valid DER, so X509Certificate fails
    // on it with the same opaque error as actual garbage would produce.
    if (looksLikeKeystore(bytes)) {
        return secrets?.storePassword
            ? inspectKeystoreBytes(bytes, secrets.storePassword, secrets)
            : { available: false, reason: "unsupported-format" };
    }
    try {
        return { available: true, certificate: describeCertificate(new crypto.X509Certificate(bytes)) };
    } catch {
        return { available: false, reason: "unreadable" };
    }
}

/**
 * Open a keystore and describe the certificate the signing key belongs to - the
 * leaf of its chain, which is the one an author recognises and the one whose
 * expiry decides whether a build can be signed today.
 */
function inspectKeystoreBytes(
    bytes: Buffer,
    storePassword: string,
    secrets: KeystoreSecrets,
): SigningInspectResult {
    let der: Buffer;
    try {
        const identity = readKeystore(bytes, {
            storePassword,
            // `undefined` makes the reader fall back to the store password;
            // `null` from the vault has to mean the same, not an empty password.
            keyPassword: secrets.keyPassword ?? undefined,
            alias: secrets.alias,
        });
        der = Buffer.from(identity.certificateDerBase64, "base64");
    } catch (error) {
        return { available: false, reason: keystoreFailureReason(error) };
    }
    try {
        return { available: true, certificate: describeCertificate(new crypto.X509Certificate(der)) };
    } catch {
        return { available: false, reason: "unreadable" };
    }
}

/**
 * A container this build of Studio cannot open is a different problem from one
 * it opened and did not like: the first is answered by converting the file, the
 * second by checking the password, the alias, or the file itself.
 */
function keystoreFailureReason(error: unknown): "unsupported-format" | "unreadable" {
    if (error instanceof KeystoreError
        && (error.code === "unsupported-format" || error.code === "unsupported-algorithm")) {
        return "unsupported-format";
    }
    return "unreadable";
}

export function describeCertificate(certificate: crypto.X509Certificate): SigningCertificateInfo {
    return {
        subject: certificate.subject,
        issuer: certificate.issuer,
        notBefore: new Date(certificate.validFrom).toISOString(),
        notAfter: new Date(certificate.validTo).toISOString(),
        sha1: certificate.fingerprint.replace(/:/g, "").toUpperCase(),
        serialNumber: certificate.serialNumber.toUpperCase(),
    };
}

/**
 * Where the certificate sits relative to `now`. `expiring` is the warning band
 * ahead of `notAfter`; a certificate whose `notBefore` is still in the future
 * is called out separately because "expired" would be actively misleading.
 */
export function certificateExpiry(
    certificate: SigningCertificateInfo,
    now: Date = new Date(),
    warningDays: number = SIGNING_EXPIRY_WARNING_DAYS,
): SigningCertificateExpiry {
    const notAfter = Date.parse(certificate.notAfter);
    const notBefore = Date.parse(certificate.notBefore);
    const at = now.getTime();
    if (Number.isNaN(notAfter) || Number.isNaN(notBefore)) {
        return "expired";
    }
    if (at >= notAfter) {
        return "expired";
    }
    if (at < notBefore) {
        return "not-yet-valid";
    }
    return notAfter - at <= warningDays * 24 * 60 * 60 * 1000 ? "expiring" : "valid";
}

/**
 * Whether this file is a keystore rather than a bare certificate - i.e. whether
 * reading it needs a password. Decided on the bytes, never on the extension:
 * authors rename `.jks` to `.keystore` and back, and Android Studio writes
 * PKCS#12 into files named `.jks`.
 */
export function looksLikeKeystore(bytes: Buffer): boolean {
    return looksLikePkcs12(bytes) || looksLikeJavaKeystore(bytes);
}

/**
 * JKS and JCEKS each open with their own magic number. JCEKS counts here even
 * though the reader refuses it: it is a keystore, and saying "unsupported
 * container" beats saying "unreadable file".
 */
export function looksLikeJavaKeystore(bytes: Buffer): boolean {
    if (bytes.length < 4) {
        return false;
    }
    const magic = bytes.readUInt32BE(0);
    return magic === 0xfeedfeed || magic === 0xcececece;
}

/**
 * PFX ::= SEQUENCE { version INTEGER {v3(3)}, authSafe ContentInfo, ... }
 * so a PKCS#12 always opens with a SEQUENCE whose first element is INTEGER 3.
 * An X.509 certificate opens with a SEQUENCE whose first element is another
 * SEQUENCE (tbsCertificate), so the two never collide.
 */
export function looksLikePkcs12(bytes: Buffer): boolean {
    if (bytes.length < 4 || bytes[0] !== 0x30) {
        return false;
    }
    const lengthByte = bytes[1];
    // Definite long form: 0x80 | number of length bytes. Indefinite length
    // (0x80) is not valid DER, so anything else is a short form length.
    const headerLength = lengthByte > 0x80 ? 2 + (lengthByte & 0x7f) : 2;
    return bytes.length >= headerLength + 3
        && bytes[headerLength] === 0x02
        && bytes[headerLength + 1] === 0x01
        && bytes[headerLength + 2] === 0x03;
}
