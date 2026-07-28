import crypto from "crypto";
import fs from "fs/promises";
import {
    SIGNING_EXPIRY_WARNING_DAYS,
    type SigningCertificateExpiry,
    type SigningCertificateInfo,
    type SigningInspectResult,
} from "@shared/types/signing";

/**
 * Reads the display-only facts out of a signing certificate: who it is for, who
 * issued it, how long it is good for, and its thumbprint. Nothing here touches
 * a private key, and nothing it returns is a secret - the result is meant to be
 * shown in the build dialog and to feed the expiry preflight checks.
 *
 * Parsing is Node's own `crypto.X509Certificate`, which accepts both PEM and
 * DER. A PKCS#12 is a different container entirely and Node cannot open one;
 * that is reported rather than guessed at, and stays that way until the
 * keystore reader lands with the Android milestone.
 */

export async function inspectCertificateFile(filePath: string): Promise<SigningInspectResult> {
    let bytes: Buffer;
    try {
        bytes = await fs.readFile(filePath);
    } catch {
        return { available: false, reason: "unreadable" };
    }
    return inspectCertificateBytes(bytes);
}

export function inspectCertificateBytes(bytes: Buffer): SigningInspectResult {
    // Checked before parsing: a PKCS#12 is valid DER, so X509Certificate fails
    // on it with the same opaque error as actual garbage would produce.
    if (looksLikePkcs12(bytes)) {
        return { available: false, reason: "unsupported-format" };
    }
    try {
        return { available: true, certificate: describeCertificate(new crypto.X509Certificate(bytes)) };
    } catch {
        return { available: false, reason: "unreadable" };
    }
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
