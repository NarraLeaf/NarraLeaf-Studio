import crypto from "crypto";

/**
 * A minimal DER encoder and self-signed X.509 v3 certificate builder — just
 * enough to mint the debug identity APK Signature Scheme v2 embeds. Node's
 * crypto can generate keys and sign but cannot *build* a certificate; rather
 * than pull in node-forge (large, historically shaky, and a supply-chain
 * addition this offline pipeline would rather avoid), the fixed shape of a
 * debug cert is assembled here. Node's own crypto.X509Certificate parses and
 * verifies the result, which is the in-repo correctness oracle (the CI
 * apksigner run is the external one).
 *
 * Pure with respect to the clock and RNG: validity dates and the serial come
 * in as parameters, so a given identity serializes to fixed bytes.
 */

/* ---------------------------------------------------------------- DER core */

function derLength(length: number): Buffer {
    if (length < 0x80) {
        return Buffer.from([length]);
    }
    const bytes: number[] = [];
    let remaining = length;
    while (remaining > 0) {
        bytes.unshift(remaining & 0xff);
        remaining >>>= 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, content: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSequence(...parts: Buffer[]): Buffer {
    return der(0x30, Buffer.concat(parts));
}

function derSet(content: Buffer): Buffer {
    return der(0x31, content);
}

/** DER INTEGER from a non-negative big-endian magnitude (0x00-padded if the top bit is set). */
export function derInteger(magnitude: Buffer): Buffer {
    let bytes = magnitude;
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0x00 && (bytes[start + 1] & 0x80) === 0) {
        start++;
    }
    bytes = bytes.subarray(start);
    if (bytes.length === 0) {
        bytes = Buffer.from([0x00]);
    }
    if (bytes[0] & 0x80) {
        bytes = Buffer.concat([Buffer.from([0x00]), bytes]);
    }
    return der(0x02, bytes);
}

function derIntegerFromNumber(value: number): Buffer {
    if (value === 0) {
        return der(0x02, Buffer.from([0x00]));
    }
    const bytes: number[] = [];
    let remaining = value;
    while (remaining > 0) {
        bytes.unshift(remaining & 0xff);
        remaining = Math.floor(remaining / 256);
    }
    return derInteger(Buffer.from(bytes));
}

export function encodeOid(oid: string): Buffer {
    const parts = oid.split(".").map(Number);
    const first = 40 * parts[0] + parts[1];
    const body: number[] = [first];
    for (const arc of parts.slice(2)) {
        const stack: number[] = [arc & 0x7f];
        let remaining = Math.floor(arc / 128);
        while (remaining > 0) {
            stack.unshift((remaining & 0x7f) | 0x80);
            remaining = Math.floor(remaining / 128);
        }
        body.push(...stack);
    }
    return der(0x06, Buffer.from(body));
}

function derNull(): Buffer {
    return Buffer.from([0x05, 0x00]);
}

function derUtf8String(value: string): Buffer {
    return der(0x0c, Buffer.from(value, "utf8"));
}

function derBitString(content: Buffer): Buffer {
    // 0 unused bits.
    return der(0x03, Buffer.concat([Buffer.from([0x00]), content]));
}

function derGeneralizedTime(date: Date): Buffer {
    const p = (value: number, width = 2) => String(value).padStart(width, "0");
    const text = `${p(date.getUTCFullYear(), 4)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`
        + `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
    return der(0x18, Buffer.from(text, "ascii"));
}

function derExplicit(tagNumber: number, content: Buffer): Buffer {
    return der(0xa0 | tagNumber, content);
}

/* ------------------------------------------------------------------ X.509 */

const OID_SHA256_WITH_RSA = "1.2.840.113549.1.1.11";
const OID_COMMON_NAME = "2.5.4.3";
const OID_BASIC_CONSTRAINTS = "2.5.29.19";

function algorithmIdentifierSha256Rsa(): Buffer {
    return derSequence(encodeOid(OID_SHA256_WITH_RSA), derNull());
}

function commonName(name: string): Buffer {
    // Name ::= RDNSequence ::= SEQUENCE OF SET OF AttributeTypeAndValue.
    return derSequence(derSet(derSequence(encodeOid(OID_COMMON_NAME), derUtf8String(name))));
}

function basicConstraintsExtension(): Buffer {
    // Extension ::= SEQUENCE { extnID, critical DEFAULT FALSE, extnValue OCTET STRING }.
    // Empty BasicConstraints SEQUENCE means cA = FALSE.
    const value = der(0x04, derSequence());
    return derSequence(encodeOid(OID_BASIC_CONSTRAINTS), value);
}

export type CertificateParams = {
    commonName: string;
    serialNumber: Buffer;
    notBefore: Date;
    notAfter: Date;
    /** SubjectPublicKeyInfo DER (public key `spki` export). */
    subjectPublicKeyInfoDer: Buffer;
    /** Signs the TBSCertificate; must match subjectPublicKeyInfoDer's key. */
    privateKey: crypto.KeyObject;
};

/**
 * Build a self-signed X.509 v3 certificate (DER). Subject == issuer; the
 * TBSCertificate is signed with sha256WithRSAEncryption over the caller's
 * private key.
 */
export function buildSelfSignedCertificate(params: CertificateParams): Buffer {
    const name = commonName(params.commonName);
    const tbsCertificate = derSequence(
        derExplicit(0, derIntegerFromNumber(2)), // version v3
        derInteger(params.serialNumber),
        algorithmIdentifierSha256Rsa(),
        name, // issuer
        derSequence(derGeneralizedTime(params.notBefore), derGeneralizedTime(params.notAfter)),
        name, // subject
        params.subjectPublicKeyInfoDer,
        der(0xa3, derSequence(basicConstraintsExtension())), // [3] extensions
    );
    const signature = crypto.sign("sha256", tbsCertificate, params.privateKey);
    return derSequence(
        tbsCertificate,
        algorithmIdentifierSha256Rsa(),
        derBitString(signature),
    );
}
