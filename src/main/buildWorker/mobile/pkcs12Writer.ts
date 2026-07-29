import crypto from "crypto";

/**
 * A minimal PKCS#12 *writer*, used for exactly one thing: handing zsign an
 * Apple signing identity without putting a password on a command line.
 *
 * zsign takes the identity as a `.p12` and its password as `-p <password>` -
 * an argument every other process on the machine can read out of the process
 * list. The way out is that a `.p12` need not have a password at all: with a
 * password-less container zsign is invoked with no `-p`, and nothing secret is
 * ever an argument. So the author's own (password-protected) `.p12` is opened
 * by the keystore reader, and its contents are re-packed here into a
 * short-lived password-less one that lives in a 0600 file for the duration of
 * one zsign run.
 *
 * That is only defensible because the ephemeral file is the same secret, moved
 * from one place a local attacker could read (argv) to another (a temp file
 * with owner-only permissions) - and the file exists for milliseconds where
 * argv is visible for the whole run. The caller must delete it, on failure too.
 *
 * Writing this format is far less work than reading it (keystoreReader.ts):
 * every choice is ours, so the private key goes in an unencrypted `keyBag` and
 * the certificates in a plain SafeContents. The only cryptography left is the
 * integrity MAC, which is not optional in practice - OpenSSL's `PKCS12_parse`
 * refuses a container with no MacData - so it is computed with the empty
 * password, exactly as `openssl pkcs12 -export -passout pass:` does.
 */

/* ---------------------------------------------------------------- DER writer */

function derLength(length: number): Buffer {
    if (length < 0x80) {
        return Buffer.from([length]);
    }
    const bytes: number[] = [];
    let remaining = length;
    while (remaining > 0) {
        bytes.unshift(remaining & 0xff);
        remaining = Math.floor(remaining / 256);
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, content: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

const derSequence = (...parts: Buffer[]): Buffer => der(0x30, Buffer.concat(parts));
const derSet = (...parts: Buffer[]): Buffer => der(0x31, Buffer.concat(parts));
const derOctetString = (content: Buffer): Buffer => der(0x04, content);
const derExplicit = (tagNumber: number, content: Buffer): Buffer => der(0xa0 | tagNumber, content);
const DER_NULL = Buffer.from([0x05, 0x00]);

function derOid(dotted: string): Buffer {
    const arcs = dotted.split(".").map(Number);
    const body: number[] = [40 * arcs[0] + arcs[1]];
    for (const arc of arcs.slice(2)) {
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

function derInteger(value: number): Buffer {
    if (value === 0) {
        return der(0x02, Buffer.from([0x00]));
    }
    const bytes: number[] = [];
    let remaining = value;
    while (remaining > 0) {
        bytes.unshift(remaining & 0xff);
        remaining = Math.floor(remaining / 256);
    }
    if (bytes[0] & 0x80) {
        bytes.unshift(0x00);
    }
    return der(0x02, Buffer.from(bytes));
}

/** BMPString: UTF-16 big-endian, which is how PKCS#12 stores friendly names. */
function derBmpString(text: string): Buffer {
    const out = Buffer.alloc(text.length * 2);
    for (let i = 0; i < text.length; i++) {
        out.writeUInt16BE(text.charCodeAt(i), i * 2);
    }
    return der(0x1e, out);
}

/* --------------------------------------------------------- key derivation */

const SHA256_BLOCK_SIZE = 64;
const KDF_ID_MAC = 3;

/** RFC 7292 password encoding: UTF-16 big-endian with a two-byte terminator. */
function toBmpPassword(password: string): Buffer {
    const out = Buffer.alloc(password.length * 2 + 2);
    for (let i = 0; i < password.length; i++) {
        out.writeUInt16BE(password.charCodeAt(i), i * 2);
    }
    return out;
}

function repeatToBlockMultiple(source: Buffer, blockSize: number): Buffer {
    if (source.length === 0) {
        return Buffer.alloc(0);
    }
    const total = blockSize * Math.ceil(source.length / blockSize);
    const out = Buffer.alloc(total);
    for (let i = 0; i < total; i++) {
        out[i] = source[i % source.length];
    }
    return out;
}

/**
 * The PKCS#12 key derivation function (RFC 7292 appendix B), narrowed to the
 * one use left here: the SHA-256 integrity key. keystoreReader.ts has the
 * general version; duplicating this much rather than exporting from there keeps
 * the reader - which is finished and load-bearing - untouched.
 */
function pkcs12MacKey(bmpPassword: Buffer, salt: Buffer, iterations: number, wanted: number): Buffer {
    const v = SHA256_BLOCK_SIZE;
    const u = 32;
    const D = Buffer.alloc(v, KDF_ID_MAC);
    const I = Buffer.concat([repeatToBlockMultiple(salt, v), repeatToBlockMultiple(bmpPassword, v)]);

    const pieces: Buffer[] = [];
    let produced = 0;
    while (produced < wanted) {
        let A = crypto.createHash("sha256").update(D).update(I).digest();
        for (let i = 1; i < iterations; i++) {
            A = crypto.createHash("sha256").update(A).digest();
        }
        pieces.push(A);
        produced += u;
        if (produced >= wanted) {
            break;
        }
        const B = repeatToBlockMultiple(A, v).subarray(0, v);
        for (let block = 0; block < I.length; block += v) {
            let carry = 1;
            for (let k = v - 1; k >= 0; k--) {
                const sum = I[block + k] + B[k] + carry;
                I[block + k] = sum & 0xff;
                carry = sum >>> 8;
            }
        }
    }
    return Buffer.concat(pieces).subarray(0, wanted);
}

/* -------------------------------------------------------------- PKCS#12 */

const OID_DATA = "1.2.840.113549.1.7.1";
const OID_KEY_BAG = "1.2.840.113549.1.12.10.1.1";
const OID_CERT_BAG = "1.2.840.113549.1.12.10.1.3";
const OID_X509_CERTIFICATE = "1.2.840.113549.1.9.22.1";
const OID_FRIENDLY_NAME = "1.2.840.113549.1.9.20";
const OID_LOCAL_KEY_ID = "1.2.840.113549.1.9.21";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";

/** openssl's own default, and cheap for an empty password. */
const MAC_ITERATIONS = 2048;

function bagAttributes(friendlyName: string, localKeyId: Buffer): Buffer {
    return derSet(
        derSequence(derOid(OID_FRIENDLY_NAME), derSet(derBmpString(friendlyName))),
        derSequence(derOid(OID_LOCAL_KEY_ID), derSet(derOctetString(localKeyId))),
    );
}

function safeBag(bagId: string, bagValue: Buffer, attributes: Buffer | null): Buffer {
    const parts = [derOid(bagId), derExplicit(0, bagValue)];
    if (attributes) {
        parts.push(attributes);
    }
    return derSequence(...parts);
}

/** ContentInfo of type `data` wrapping already-encoded SafeContents. */
function dataContentInfo(payload: Buffer): Buffer {
    return derSequence(derOid(OID_DATA), derExplicit(0, derOctetString(payload)));
}

export type Pkcs12WriteInput = {
    /** PKCS#8 PrivateKeyInfo, DER. */
    privateKeyDer: Buffer;
    /** Leaf first. Every certificate goes in: a signer needs the issuing chain. */
    certificateChainDer: Buffer[];
    /** Cosmetic; shows up as the identity's name in anything that lists the file. */
    friendlyName?: string;
    /** Injected by tests so the output is byte-stable. */
    macSalt?: Buffer;
};

/**
 * Build a password-less PKCS#12 container holding one private key and its
 * certificate chain. The result is a secret in plain form - the caller writes
 * it 0600 and deletes it.
 */
export function writePasswordlessPkcs12(input: Pkcs12WriteInput): Buffer {
    if (input.certificateChainDer.length === 0) {
        throw new Error("A PKCS#12 container needs at least the signing certificate");
    }
    const friendlyName = input.friendlyName ?? "signing identity";
    // Ties the key to its leaf certificate. OpenSSL matches them by key anyway,
    // but every real .p12 carries this and a reader is entitled to expect it.
    const localKeyId = crypto.createHash("sha1").update(input.certificateChainDer[0]).digest();

    const certificateBags = input.certificateChainDer.map((certificateDer, index) => safeBag(
        OID_CERT_BAG,
        derSequence(derOid(OID_X509_CERTIFICATE), derExplicit(0, derOctetString(certificateDer))),
        // Only the leaf is the identity; the issuers are just along for the ride.
        index === 0 ? bagAttributes(friendlyName, localKeyId) : null,
    ));
    const keyBag = safeBag(OID_KEY_BAG, input.privateKeyDer, bagAttributes(friendlyName, localKeyId));

    // AuthenticatedSafe ::= SEQUENCE OF ContentInfo. Two sections, both
    // unencrypted: there is no password to encrypt them under.
    const authenticatedSafe = derSequence(
        dataContentInfo(derSequence(...certificateBags)),
        dataContentInfo(derSequence(keyBag)),
    );

    const macSalt = input.macSalt ?? crypto.randomBytes(8);
    const macKey = pkcs12MacKey(toBmpPassword(""), macSalt, MAC_ITERATIONS, 32);
    const mac = crypto.createHmac("sha256", macKey).update(authenticatedSafe).digest();

    // MacData ::= SEQUENCE { mac DigestInfo, macSalt OCTET STRING, iterations INTEGER }
    const macData = derSequence(
        derSequence(derSequence(derOid(OID_SHA256), DER_NULL), derOctetString(mac)),
        derOctetString(macSalt),
        derInteger(MAC_ITERATIONS),
    );

    // PFX ::= SEQUENCE { version INTEGER (3), authSafe ContentInfo, macData MacData }
    return derSequence(derInteger(3), dataContentInfo(authenticatedSafe), macData);
}
