import crypto from "crypto";
import { rc2CbcDecrypt } from "./rc2";
// Relative on purpose: "@/" means src/main here but src/renderer under vitest.
import type { SigningIdentity } from "./signingIdentity";

/**
 * Reads an author-supplied release keystore - PKCS#12 (`.p12` / `.pfx`) or JKS
 * (`.jks` / `.keystore`) - and hands back the signing key and its certificate
 * chain in the same JSON-friendly shape the debug identity uses, so it crosses
 * the build-worker boundary as plain data.
 *
 * Scope is deliberately "what keytool and Android Studio actually write", not
 * all of RFC 7292: modern keytool protects everything with PBES2 (PBKDF2 +
 * AES-CBC), older keytool and OpenSSL use the PKCS#12 PBE algorithms
 * (3DES for keys, 40-bit RC2 for certificate bags), and JKS uses Sun's own
 * SHA-1 keystream. Anything else is refused by name rather than half-parsed.
 *
 * Nothing here logs. Every failure is an exception carrying a `code` and a
 * message written for the person who picked the file, and no message, no
 * exception, and no return value ever contains password-derived material.
 */

/* ------------------------------------------------------------------- types */

/**
 * A superset of `SigningIdentity`: same two fields the v2 signer already
 * consumes, plus the full chain (leaf first) and the alias the key came from.
 */
export type KeystoreIdentity = SigningIdentity & {
    /** Leaf first, then each issuer in turn. Element 0 equals `certificateDerBase64`. */
    certificateChainDerBase64: string[];
    /** The alias the key was read from - the caller logs it when the identity changes. */
    alias: string;
};

export type ReadKeystoreOptions = {
    /** Password that opens the keystore file itself. */
    storePassword: string;
    /** Password on the individual key. Defaults to `storePassword`, which is the usual case. */
    keyPassword?: string;
    /** Which key to read. Optional when the keystore holds exactly one. */
    alias?: string;
};

export type KeystoreFormat = "pkcs12" | "jks";

export type KeystoreErrorCode =
    | "unsupported-format"
    | "wrong-store-password"
    | "wrong-key-password"
    | "alias-not-found"
    | "no-key-entry"
    | "ambiguous-alias"
    | "unsupported-algorithm"
    | "damaged-file";

/** Every failure this module raises. `code` is for branching, `message` is for showing. */
export class KeystoreError extends Error {
    readonly code: KeystoreErrorCode;

    constructor(code: KeystoreErrorCode, message: string) {
        super(message);
        this.name = "KeystoreError";
        this.code = code;
    }
}

const damaged = (detail: string): KeystoreError =>
    new KeystoreError("damaged-file", `This keystore file could not be read: ${detail}.`);

const unsupportedAlgorithm = (what: string): KeystoreError =>
    new KeystoreError(
        "unsupported-algorithm",
        `This keystore is protected with ${what}, which NarraLeaf Studio cannot open. ` +
            "Convert it first with keytool: " +
            "keytool -importkeystore -srckeystore <your keystore> -destkeystore converted.p12 -deststoretype pkcs12",
    );

const wrongStorePassword = (): KeystoreError =>
    new KeystoreError(
        "wrong-store-password",
        "The keystore password is incorrect. If you are sure the password is right, " +
            "then the keystore file itself is damaged or incomplete.",
    );

/* --------------------------------------------------------------------- DER */

type Asn1 = {
    tag: number;
    /** The value octets. */
    content: Buffer;
    /** Tag, length and value together. */
    raw: Buffer;
};

const TAG_INTEGER = 0x02;
const TAG_BIT_STRING = 0x03;
const TAG_OCTET_STRING = 0x04;
const TAG_OID = 0x06;
const TAG_BMP_STRING = 0x1e;
const TAG_SEQUENCE = 0x30;
const TAG_SET = 0x31;
const TAG_CONTEXT_0 = 0xa0;

function readAsn1(buffer: Buffer, offset: number): { node: Asn1; next: number } {
    if (offset + 2 > buffer.length) {
        throw damaged("a value is cut short");
    }
    const tag = buffer[offset];
    if ((tag & 0x1f) === 0x1f) {
        throw damaged("it uses a tag encoding this reader does not implement");
    }
    let cursor = offset + 1;
    const first = buffer[cursor++];
    let length: number;
    if (first === 0x80) {
        // Indefinite-length BER. keytool, Android Studio and OpenSSL all emit
        // strict DER, so rather than carry a second length model this is named
        // and refused.
        throw unsupportedAlgorithm("an indefinite-length encoding");
    } else if (first < 0x80) {
        length = first;
    } else {
        const count = first & 0x7f;
        if (count > 4 || cursor + count > buffer.length) {
            throw damaged("a length field is out of range");
        }
        length = 0;
        for (let i = 0; i < count; i++) {
            length = length * 256 + buffer[cursor++];
        }
        if (length > 0x7fffffff) {
            throw damaged("a length field is out of range");
        }
    }
    const end = cursor + length;
    if (end > buffer.length) {
        throw damaged("a value runs past the end of the file");
    }
    return {
        node: { tag, content: buffer.subarray(cursor, end), raw: buffer.subarray(offset, end) },
        next: end,
    };
}

/** Parse exactly one top-level value and insist nothing follows it. */
function readOnlyAsn1(buffer: Buffer): Asn1 {
    const { node, next } = readAsn1(buffer, 0);
    if (next !== buffer.length) {
        throw damaged("there is unexpected data after the end of the structure");
    }
    return node;
}

/** The values inside a constructed node, in order. */
function items(node: Asn1): Asn1[] {
    const out: Asn1[] = [];
    let offset = 0;
    while (offset < node.content.length) {
        const { node: child, next } = readAsn1(node.content, offset);
        out.push(child);
        offset = next;
    }
    return out;
}

function expectTag(node: Asn1 | undefined, tag: number, what: string): Asn1 {
    if (!node || node.tag !== tag) {
        throw damaged(`${what} is missing or has the wrong shape`);
    }
    return node;
}

function decodeOid(node: Asn1): string {
    if (node.tag !== TAG_OID || node.content.length === 0) {
        throw damaged("an algorithm identifier is malformed");
    }
    const bytes = node.content;
    const arcs: number[] = [Math.floor(bytes[0] / 40), bytes[0] % 40];
    let value = 0;
    for (let i = 1; i < bytes.length; i++) {
        value = value * 128 + (bytes[i] & 0x7f);
        if ((bytes[i] & 0x80) === 0) {
            arcs.push(value);
            value = 0;
        }
    }
    return arcs.join(".");
}

function decodeInteger(node: Asn1): number {
    if (node.tag !== TAG_INTEGER || node.content.length === 0 || node.content.length > 6) {
        throw damaged("a number field is malformed");
    }
    let value = 0;
    for (const byte of node.content) {
        value = value * 256 + byte;
    }
    return value;
}

/** BMPString is UTF-16 big-endian; PKCS#12 stores friendly names that way. */
function decodeBmpString(node: Asn1): string {
    if (node.content.length % 2 !== 0) {
        throw damaged("a name field is malformed");
    }
    let out = "";
    for (let i = 0; i < node.content.length; i += 2) {
        out += String.fromCharCode(node.content.readUInt16BE(i));
    }
    return out;
}

/** `AlgorithmIdentifier ::= SEQUENCE { algorithm OID, parameters ANY OPTIONAL }` */
function readAlgorithmIdentifier(node: Asn1): { oid: string; parameters?: Asn1 } {
    const parts = items(expectTag(node, TAG_SEQUENCE, "an algorithm identifier"));
    return { oid: decodeOid(expectTag(parts[0], TAG_OID, "an algorithm name")), parameters: parts[1] };
}

/* -------------------------------------------------------- key derivation */

const HASH_BLOCK_SIZE: Record<string, number> = {
    sha1: 64,
    sha224: 64,
    sha256: 64,
    sha384: 128,
    sha512: 128,
};

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

const KDF_ID_KEY = 1;
const KDF_ID_IV = 2;
const KDF_ID_MAC = 3;

/**
 * The PKCS#12 key derivation function (RFC 7292 appendix B). Used for the
 * PBES1 algorithms and for the file's own integrity key - never for PBES2,
 * which derives through PBKDF2 from the UTF-8 password instead.
 */
function pkcs12Kdf(
    hash: string,
    bmpPassword: Buffer,
    salt: Buffer,
    iterations: number,
    id: number,
    wanted: number,
): Buffer {
    const v = HASH_BLOCK_SIZE[hash];
    const u = crypto.createHash(hash).digest().length;
    const D = Buffer.alloc(v, id);
    const I = Buffer.concat([
        repeatToBlockMultiple(salt, v),
        repeatToBlockMultiple(bmpPassword, v),
    ]);

    const pieces: Buffer[] = [];
    let produced = 0;
    while (produced < wanted) {
        let A = crypto.createHash(hash).update(D).update(I).digest();
        for (let i = 1; i < iterations; i++) {
            A = crypto.createHash(hash).update(A).digest();
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

/* ------------------------------------------------------------ decryption */

const OID_PBE_SHA1_128RC4 = "1.2.840.113549.1.12.1.1";
const OID_PBE_SHA1_40RC4 = "1.2.840.113549.1.12.1.2";
const OID_PBE_SHA1_3DES = "1.2.840.113549.1.12.1.3";
const OID_PBE_SHA1_2DES = "1.2.840.113549.1.12.1.4";
const OID_PBE_SHA1_128RC2 = "1.2.840.113549.1.12.1.5";
const OID_PBE_SHA1_40RC2 = "1.2.840.113549.1.12.1.6";
const OID_PBES2 = "1.2.840.113549.1.5.13";
const OID_PBKDF2 = "1.2.840.113549.1.5.12";
const OID_PBMAC1 = "1.2.840.113549.1.5.14";

const OID_AES128_CBC = "2.16.840.1.101.3.4.1.2";
const OID_AES192_CBC = "2.16.840.1.101.3.4.1.22";
const OID_AES256_CBC = "2.16.840.1.101.3.4.1.42";
const OID_DES_EDE3_CBC = "1.2.840.113549.3.7";

const PRF_BY_OID: Record<string, string> = {
    "1.2.840.113549.2.7": "sha1",
    "1.2.840.113549.2.8": "sha224",
    "1.2.840.113549.2.9": "sha256",
    "1.2.840.113549.2.10": "sha384",
    "1.2.840.113549.2.11": "sha512",
};

const ALGORITHM_NAMES: Record<string, string> = {
    [OID_PBE_SHA1_128RC4]: "128-bit RC4",
    [OID_PBE_SHA1_40RC4]: "40-bit RC4",
    [OID_PBMAC1]: "the newer PBMAC1 integrity scheme",
};

/** Strip PKCS#7 padding. `null` means the padding is wrong, i.e. the password is. */
function unpad(plaintext: Buffer, blockSize: number): Buffer | null {
    if (plaintext.length === 0 || plaintext.length % blockSize !== 0) {
        return null;
    }
    const pad = plaintext[plaintext.length - 1];
    if (pad < 1 || pad > blockSize || pad > plaintext.length) {
        return null;
    }
    for (let i = plaintext.length - pad; i < plaintext.length; i++) {
        if (plaintext[i] !== pad) {
            return null;
        }
    }
    return plaintext.subarray(0, plaintext.length - pad);
}

function nodeCbcDecrypt(cipherName: string, key: Buffer, iv: Buffer, ciphertext: Buffer): Buffer {
    const decipher = crypto.createDecipheriv(cipherName, key, iv);
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** `PBEParameter ::= SEQUENCE { salt OCTET STRING, iterations INTEGER }` */
function readPbeParameters(parameters: Asn1 | undefined): { salt: Buffer; iterations: number } {
    const parts = items(expectTag(parameters, TAG_SEQUENCE, "the password settings"));
    return {
        salt: expectTag(parts[0], TAG_OCTET_STRING, "the password salt").content,
        iterations: decodeInteger(expectTag(parts[1], TAG_INTEGER, "the password iteration count")),
    };
}

type Pbes1Shape = {
    /** Bytes of key material to derive. */
    keyLength: number;
    /** `null` for the hand-rolled RC2 path. */
    nodeCipher: string | null;
    /** Effective key bits, RC2 only. */
    rc2EffectiveBits?: number;
    blockSize: number;
};

const PBES1_SHAPES: Record<string, Pbes1Shape> = {
    [OID_PBE_SHA1_3DES]: { keyLength: 24, nodeCipher: "des-ede3-cbc", blockSize: 8 },
    [OID_PBE_SHA1_2DES]: { keyLength: 16, nodeCipher: "des-ede3-cbc", blockSize: 8 },
    [OID_PBE_SHA1_128RC2]: { keyLength: 16, nodeCipher: null, rc2EffectiveBits: 128, blockSize: 8 },
    [OID_PBE_SHA1_40RC2]: { keyLength: 5, nodeCipher: null, rc2EffectiveBits: 40, blockSize: 8 },
};

function decryptPbes1(
    oid: string,
    parameters: Asn1 | undefined,
    password: string,
    ciphertext: Buffer,
): Buffer | null {
    const shape = PBES1_SHAPES[oid];
    const { salt, iterations } = readPbeParameters(parameters);
    const bmp = toBmpPassword(password);
    const key = pkcs12Kdf("sha1", bmp, salt, iterations, KDF_ID_KEY, shape.keyLength);
    const iv = pkcs12Kdf("sha1", bmp, salt, iterations, KDF_ID_IV, shape.blockSize);

    let plaintext: Buffer;
    if (shape.nodeCipher === null) {
        plaintext = rc2CbcDecrypt(key, shape.rc2EffectiveBits as number, iv, ciphertext);
    } else if (oid === OID_PBE_SHA1_2DES) {
        // Two-key triple DES is K1|K2 used as K1|K2|K1; Node only offers the
        // three-key cipher, so expand rather than reach for a legacy name.
        plaintext = nodeCbcDecrypt(
            shape.nodeCipher,
            Buffer.concat([key, key.subarray(0, 8)]),
            iv,
            ciphertext,
        );
    } else {
        plaintext = nodeCbcDecrypt(shape.nodeCipher, key, iv, ciphertext);
    }
    return unpad(plaintext, shape.blockSize);
}

function decryptPbes2(parameters: Asn1 | undefined, password: string, ciphertext: Buffer): Buffer | null {
    const parts = items(expectTag(parameters, TAG_SEQUENCE, "the encryption settings"));
    const kdf = readAlgorithmIdentifier(expectTag(parts[0], TAG_SEQUENCE, "the key derivation settings"));
    if (kdf.oid !== OID_PBKDF2) {
        throw unsupportedAlgorithm(`the key derivation function ${kdf.oid}`);
    }
    const kdfParts = items(expectTag(kdf.parameters, TAG_SEQUENCE, "the key derivation settings"));
    const salt = expectTag(kdfParts[0], TAG_OCTET_STRING, "the password salt").content;
    const iterations = decodeInteger(expectTag(kdfParts[1], TAG_INTEGER, "the password iteration count"));
    // keyLength and prf are both optional and either may be absent.
    let declaredKeyLength: number | undefined;
    let prf = "sha1";
    for (const extra of kdfParts.slice(2)) {
        if (extra.tag === TAG_INTEGER) {
            declaredKeyLength = decodeInteger(extra);
        } else if (extra.tag === TAG_SEQUENCE) {
            const prfOid = readAlgorithmIdentifier(extra).oid;
            if (!PRF_BY_OID[prfOid]) {
                throw unsupportedAlgorithm(`the password hash ${prfOid}`);
            }
            prf = PRF_BY_OID[prfOid];
        }
    }

    const scheme = readAlgorithmIdentifier(expectTag(parts[1], TAG_SEQUENCE, "the cipher settings"));
    const cipherByOid: Record<string, { name: string; keyLength: number; ivLength: number }> = {
        [OID_AES128_CBC]: { name: "aes-128-cbc", keyLength: 16, ivLength: 16 },
        [OID_AES192_CBC]: { name: "aes-192-cbc", keyLength: 24, ivLength: 16 },
        [OID_AES256_CBC]: { name: "aes-256-cbc", keyLength: 32, ivLength: 16 },
        [OID_DES_EDE3_CBC]: { name: "des-ede3-cbc", keyLength: 24, ivLength: 8 },
    };
    const cipher = cipherByOid[scheme.oid];
    if (!cipher) {
        throw unsupportedAlgorithm(`the cipher ${ALGORITHM_NAMES[scheme.oid] ?? scheme.oid}`);
    }
    const iv = expectTag(scheme.parameters, TAG_OCTET_STRING, "the cipher starting value").content;
    if (iv.length !== cipher.ivLength) {
        throw damaged("the cipher starting value is the wrong size");
    }

    const key = crypto.pbkdf2Sync(
        // PBES2 hashes the password as UTF-8, unlike the PKCS#12 algorithms above.
        Buffer.from(password, "utf8"),
        salt,
        iterations,
        declaredKeyLength ?? cipher.keyLength,
        prf,
    );
    const plaintext = nodeCbcDecrypt(cipher.name, key.subarray(0, cipher.keyLength), iv, ciphertext);
    return unpad(plaintext, cipher.ivLength === 8 ? 8 : 16);
}

/** Returns `null` when the password is wrong; throws when the algorithm is not supported. */
function decryptPkcs12(
    algorithm: { oid: string; parameters?: Asn1 },
    password: string,
    ciphertext: Buffer,
): Buffer | null {
    if (PBES1_SHAPES[algorithm.oid]) {
        return decryptPbes1(algorithm.oid, algorithm.parameters, password, ciphertext);
    }
    if (algorithm.oid === OID_PBES2) {
        return decryptPbes2(algorithm.parameters, password, ciphertext);
    }
    throw unsupportedAlgorithm(ALGORITHM_NAMES[algorithm.oid] ?? `the algorithm ${algorithm.oid}`);
}

/* ---------------------------------------------------------------- PKCS#12 */

const OID_DATA = "1.2.840.113549.1.7.1";
const OID_ENCRYPTED_DATA = "1.2.840.113549.1.7.6";
const OID_KEY_BAG = "1.2.840.113549.1.12.10.1.1";
const OID_SHROUDED_KEY_BAG = "1.2.840.113549.1.12.10.1.2";
const OID_CERT_BAG = "1.2.840.113549.1.12.10.1.3";
const OID_X509_CERTIFICATE = "1.2.840.113549.1.9.22.1";
const OID_FRIENDLY_NAME = "1.2.840.113549.1.9.20";
const OID_LOCAL_KEY_ID = "1.2.840.113549.1.9.21";

const HASH_BY_OID: Record<string, string> = {
    "1.3.14.3.2.26": "sha1",
    "2.16.840.1.101.3.4.2.1": "sha256",
    "2.16.840.1.101.3.4.2.2": "sha384",
    "2.16.840.1.101.3.4.2.3": "sha512",
    "2.16.840.1.101.3.4.2.4": "sha224",
};

type BagAttributes = { friendlyName?: string; localKeyId?: Buffer };

type Pkcs12KeyBag = {
    attributes: BagAttributes;
    /** The `EncryptedPrivateKeyInfo`, or the bare `PrivateKeyInfo` when unshrouded. */
    value: Asn1;
    shrouded: boolean;
};

type Pkcs12CertBag = { attributes: BagAttributes; der: Buffer };

function readBagAttributes(node: Asn1 | undefined): BagAttributes {
    const out: BagAttributes = {};
    if (!node || node.tag !== TAG_SET) {
        return out;
    }
    for (const attribute of items(node)) {
        if (attribute.tag !== TAG_SEQUENCE) {
            continue;
        }
        const parts = items(attribute);
        if (parts.length < 2 || parts[0].tag !== TAG_OID || parts[1].tag !== TAG_SET) {
            continue;
        }
        const values = items(parts[1]);
        if (values.length === 0) {
            continue;
        }
        const oid = decodeOid(parts[0]);
        if (oid === OID_FRIENDLY_NAME && values[0].tag === TAG_BMP_STRING) {
            out.friendlyName = decodeBmpString(values[0]);
        } else if (oid === OID_LOCAL_KEY_ID && values[0].tag === TAG_OCTET_STRING) {
            out.localKeyId = values[0].content;
        }
    }
    return out;
}

function collectSafeBags(
    safeContentsDer: Buffer,
    keyBags: Pkcs12KeyBag[],
    certBags: Pkcs12CertBag[],
): void {
    for (const bag of items(expectTag(readOnlyAsn1(safeContentsDer), TAG_SEQUENCE, "a keystore section"))) {
        const parts = items(expectTag(bag, TAG_SEQUENCE, "a keystore entry"));
        const bagId = decodeOid(expectTag(parts[0], TAG_OID, "a keystore entry type"));
        const wrapper = expectTag(parts[1], TAG_CONTEXT_0, "a keystore entry body");
        const value = readAsn1(wrapper.content, 0).node;
        const attributes = readBagAttributes(parts[2]);

        if (bagId === OID_SHROUDED_KEY_BAG) {
            keyBags.push({ attributes, value, shrouded: true });
        } else if (bagId === OID_KEY_BAG) {
            keyBags.push({ attributes, value, shrouded: false });
        } else if (bagId === OID_CERT_BAG) {
            const certParts = items(expectTag(value, TAG_SEQUENCE, "a certificate entry"));
            if (decodeOid(expectTag(certParts[0], TAG_OID, "a certificate type")) !== OID_X509_CERTIFICATE) {
                continue; // A CRL or an SDSI certificate; nothing to sign with.
            }
            const inner = readAsn1(
                expectTag(certParts[1], TAG_CONTEXT_0, "a certificate body").content,
                0,
            ).node;
            certBags.push({
                attributes,
                der: Buffer.from(expectTag(inner, TAG_OCTET_STRING, "a certificate body").content),
            });
        }
        // safeContentsBag / crlBag / secretBag: nothing a code signer needs.
    }
}

type Pkcs12Contents = { keyBags: Pkcs12KeyBag[]; certBags: Pkcs12CertBag[] };

/**
 * Verify the file's own integrity check with the store password, then unpack
 * every bag. The integrity check runs first so a mistyped password produces one
 * clear message instead of a cascade of decryption failures.
 */
function openPkcs12(file: Buffer, storePassword: string): Pkcs12Contents {
    const pfx = items(expectTag(readOnlyAsn1(file), TAG_SEQUENCE, "the keystore"));
    const authSafeInfo = items(expectTag(pfx[1], TAG_SEQUENCE, "the keystore contents"));
    if (decodeOid(expectTag(authSafeInfo[0], TAG_OID, "the keystore content type")) !== OID_DATA) {
        throw damaged("the keystore contents are not in the expected form");
    }
    const authSafeOctets = expectTag(
        readAsn1(expectTag(authSafeInfo[1], TAG_CONTEXT_0, "the keystore contents").content, 0).node,
        TAG_OCTET_STRING,
        "the keystore contents",
    ).content;

    // MacData ::= SEQUENCE { mac DigestInfo, macSalt OCTET STRING, iterations INTEGER DEFAULT 1 }
    const macData = pfx[2];
    if (!macData || macData.tag !== TAG_SEQUENCE) {
        throw damaged("it has no integrity check, so its contents cannot be trusted");
    }
    const macParts = items(macData);
    const digestInfo = items(expectTag(macParts[0], TAG_SEQUENCE, "the integrity check"));
    const digestAlgorithm = readAlgorithmIdentifier(
        expectTag(digestInfo[0], TAG_SEQUENCE, "the integrity check algorithm"),
    );
    const hash = HASH_BY_OID[digestAlgorithm.oid];
    if (!hash) {
        throw unsupportedAlgorithm(
            `the integrity check algorithm ${ALGORITHM_NAMES[digestAlgorithm.oid] ?? digestAlgorithm.oid}`,
        );
    }
    const expectedMac = expectTag(digestInfo[1], TAG_OCTET_STRING, "the integrity check value").content;
    const macSalt = expectTag(macParts[1], TAG_OCTET_STRING, "the integrity check salt").content;
    const macIterations = macParts[2] ? decodeInteger(macParts[2]) : 1;

    const macKey = pkcs12Kdf(
        hash,
        toBmpPassword(storePassword),
        macSalt,
        macIterations,
        KDF_ID_MAC,
        crypto.createHash(hash).digest().length,
    );
    const actualMac = crypto.createHmac(hash, macKey).update(authSafeOctets).digest();
    if (actualMac.length !== expectedMac.length || !crypto.timingSafeEqual(actualMac, expectedMac)) {
        throw wrongStorePassword();
    }

    const keyBags: Pkcs12KeyBag[] = [];
    const certBags: Pkcs12CertBag[] = [];
    for (const contentInfo of items(
        expectTag(readOnlyAsn1(authSafeOctets), TAG_SEQUENCE, "the keystore sections"),
    )) {
        const parts = items(expectTag(contentInfo, TAG_SEQUENCE, "a keystore section"));
        const type = decodeOid(expectTag(parts[0], TAG_OID, "a keystore section type"));
        const body = expectTag(parts[1], TAG_CONTEXT_0, "a keystore section body");

        if (type === OID_DATA) {
            const octets = expectTag(
                readAsn1(body.content, 0).node,
                TAG_OCTET_STRING,
                "a keystore section body",
            ).content;
            collectSafeBags(octets, keyBags, certBags);
            continue;
        }
        if (type !== OID_ENCRYPTED_DATA) {
            continue;
        }
        // EncryptedData ::= SEQUENCE { version INTEGER, encryptedContentInfo }
        const encryptedData = items(
            expectTag(readAsn1(body.content, 0).node, TAG_SEQUENCE, "an encrypted keystore section"),
        );
        const contentInfoParts = items(
            expectTag(encryptedData[1], TAG_SEQUENCE, "an encrypted keystore section"),
        );
        const algorithm = readAlgorithmIdentifier(
            expectTag(contentInfoParts[1], TAG_SEQUENCE, "an encryption algorithm"),
        );
        const encryptedContent = contentInfoParts[2];
        if (!encryptedContent) {
            continue;
        }
        // [0] IMPLICIT OCTET STRING - the content octets are the ciphertext.
        const plaintext = decryptPkcs12(algorithm, storePassword, encryptedContent.content);
        if (plaintext === null) {
            // The integrity check already passed, so the store password is right;
            // a keystore whose certificate section uses a different password is
            // not something keytool can even produce.
            throw damaged("one of its sections could not be decrypted");
        }
        collectSafeBags(plaintext, keyBags, certBags);
    }

    return { keyBags, certBags };
}

/** Java names an unnamed PKCS#12 entry by its position; match that so aliases agree. */
function pkcs12AliasOf(bag: Pkcs12KeyBag, index: number): string {
    return bag.attributes.friendlyName ?? String(index + 1);
}

/* -------------------------------------------------------------------- JKS */

const JKS_MAGIC = 0xfeedfeed;
const JCEKS_MAGIC = 0xcececece;
const JKS_TAG_PRIVATE_KEY = 1;
const JKS_TAG_TRUSTED_CERT = 2;
/** The literal Sun mixed into every JKS store digest. */
const JKS_DIGEST_SALT = Buffer.from("Mighty Aphrodite", "utf8");
const OID_SUN_KEY_PROTECTOR = "1.3.6.1.4.1.42.2.17.1.1";

/** JKS passwords are hashed as UTF-16 big-endian with no terminator. */
function toUtf16BePassword(password: string): Buffer {
    const out = Buffer.alloc(password.length * 2);
    for (let i = 0; i < password.length; i++) {
        out.writeUInt16BE(password.charCodeAt(i), i * 2);
    }
    return out;
}

type JksReader = { buffer: Buffer; offset: number };

function jksU32(reader: JksReader): number {
    if (reader.offset + 4 > reader.buffer.length) {
        throw damaged("it ends in the middle of an entry");
    }
    const value = reader.buffer.readUInt32BE(reader.offset);
    reader.offset += 4;
    return value;
}

function jksBytes(reader: JksReader, length: number): Buffer {
    if (length < 0 || reader.offset + length > reader.buffer.length) {
        throw damaged("it ends in the middle of an entry");
    }
    const value = reader.buffer.subarray(reader.offset, reader.offset + length);
    reader.offset += length;
    return value;
}

/** Java's modified UTF-8: a two-byte length, then only the one, two and three byte forms. */
function jksUtf(reader: JksReader): string {
    if (reader.offset + 2 > reader.buffer.length) {
        throw damaged("it ends in the middle of an entry name");
    }
    const length = reader.buffer.readUInt16BE(reader.offset);
    reader.offset += 2;
    const bytes = jksBytes(reader, length);
    let out = "";
    let i = 0;
    while (i < bytes.length) {
        const byte = bytes[i];
        if (byte < 0x80) {
            out += String.fromCharCode(byte);
            i += 1;
        } else if ((byte & 0xe0) === 0xc0) {
            if (i + 1 >= bytes.length) {
                throw damaged("an entry name is malformed");
            }
            out += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
            i += 2;
        } else if ((byte & 0xf0) === 0xe0) {
            if (i + 2 >= bytes.length) {
                throw damaged("an entry name is malformed");
            }
            out += String.fromCharCode(
                ((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
            );
            i += 3;
        } else {
            throw damaged("an entry name is malformed");
        }
    }
    return out;
}

type JksKeyEntry = { alias: string; encryptedKey: Buffer; chain: Buffer[] };

function openJks(file: Buffer, storePassword: string): JksKeyEntry[] {
    if (file.length < 4 + 4 + 4 + 20) {
        throw damaged("it is too short to be a keystore");
    }
    const digestStart = file.length - 20;
    const expectedDigest = file.subarray(digestStart);
    const actualDigest = crypto
        .createHash("sha1")
        .update(toUtf16BePassword(storePassword))
        .update(JKS_DIGEST_SALT)
        .update(file.subarray(0, digestStart))
        .digest();
    if (!crypto.timingSafeEqual(actualDigest, expectedDigest)) {
        throw wrongStorePassword();
    }

    const reader: JksReader = { buffer: file.subarray(0, digestStart), offset: 0 };
    jksU32(reader); // magic, already checked by the format sniffer
    const version = jksU32(reader);
    if (version !== 1 && version !== 2) {
        throw unsupportedAlgorithm(`a Java keystore of version ${version}`);
    }
    const count = jksU32(reader);
    if (count > 10000) {
        throw damaged("it claims to hold an implausible number of entries");
    }

    const readCertificate = (): Buffer => {
        if (version === 2) {
            const certType = jksUtf(reader);
            if (certType !== "X.509" && certType !== "X509") {
                throw unsupportedAlgorithm(`certificates of type ${certType}`);
            }
        }
        return Buffer.from(jksBytes(reader, jksU32(reader)));
    };

    const entries: JksKeyEntry[] = [];
    for (let i = 0; i < count; i++) {
        const tag = jksU32(reader);
        const alias = jksUtf(reader);
        jksBytes(reader, 8); // creation date
        if (tag === JKS_TAG_PRIVATE_KEY) {
            const encryptedKey = Buffer.from(jksBytes(reader, jksU32(reader)));
            const chainLength = jksU32(reader);
            if (chainLength > 100) {
                throw damaged("an entry claims an implausibly long certificate chain");
            }
            const chain: Buffer[] = [];
            for (let c = 0; c < chainLength; c++) {
                chain.push(readCertificate());
            }
            entries.push({ alias, encryptedKey, chain });
        } else if (tag === JKS_TAG_TRUSTED_CERT) {
            readCertificate(); // A trusted certificate; there is no key to sign with.
        } else {
            throw damaged(`it contains an entry of an unknown kind (${tag})`);
        }
    }
    return entries;
}

/**
 * Undo Sun's key protection: a SHA-1 keystream XORed over the key, with a
 * trailing digest that says whether the password was right.
 */
function decryptJksKey(encryptedKey: Buffer, keyPassword: string): Buffer | null {
    const outer = items(expectTag(readOnlyAsn1(encryptedKey), TAG_SEQUENCE, "a key entry"));
    const algorithm = readAlgorithmIdentifier(expectTag(outer[0], TAG_SEQUENCE, "a key entry algorithm"));
    if (algorithm.oid !== OID_SUN_KEY_PROTECTOR) {
        throw unsupportedAlgorithm(`the key protection algorithm ${algorithm.oid}`);
    }
    const protectedKey = expectTag(outer[1], TAG_OCTET_STRING, "a key entry body").content;
    if (protectedKey.length <= 40) {
        throw damaged("a key entry is too short");
    }

    const salt = protectedKey.subarray(0, 20);
    const ciphertext = protectedKey.subarray(20, protectedKey.length - 20);
    const expectedDigest = protectedKey.subarray(protectedKey.length - 20);

    const passwordBytes = toUtf16BePassword(keyPassword);
    const plaintext = Buffer.allocUnsafe(ciphertext.length);
    let keystream = crypto.createHash("sha1").update(passwordBytes).update(salt).digest();
    for (let offset = 0; offset < ciphertext.length; offset += 20) {
        const span = Math.min(20, ciphertext.length - offset);
        for (let i = 0; i < span; i++) {
            plaintext[offset + i] = ciphertext[offset + i] ^ keystream[i];
        }
        keystream = crypto.createHash("sha1").update(passwordBytes).update(keystream).digest();
    }

    const actualDigest = crypto.createHash("sha1").update(passwordBytes).update(plaintext).digest();
    return crypto.timingSafeEqual(actualDigest, expectedDigest) ? plaintext : null;
}

/* -------------------------------------------------------- shared assembly */

function toPrivateKey(pkcs8Der: Buffer): crypto.KeyObject | null {
    try {
        return crypto.createPrivateKey({ key: pkcs8Der, format: "der", type: "pkcs8" });
    } catch {
        return null;
    }
}

function toCertificate(der: Buffer): crypto.X509Certificate | null {
    try {
        return new crypto.X509Certificate(der);
    } catch {
        return null;
    }
}

/**
 * Order the certificates leaf first. The leaf is whichever one the private key
 * belongs to; each following certificate is the issuer of the one before it.
 * Anything left over (a sibling entry's certificate, an unrelated root) is
 * dropped rather than appended in arbitrary order.
 */
function buildChain(
    privateKey: crypto.KeyObject,
    candidates: crypto.X509Certificate[],
    alias: string,
): crypto.X509Certificate[] {
    const leaf = candidates.find((certificate) => {
        try {
            return certificate.checkPrivateKey(privateKey);
        } catch {
            return false;
        }
    });
    if (!leaf) {
        throw damaged(`the certificate belonging to the key "${alias}" is missing`);
    }

    const chain = [leaf];
    const remaining = candidates.filter((certificate) => certificate !== leaf);
    for (;;) {
        const current = chain[chain.length - 1];
        if (current.subject === current.issuer) {
            break; // Reached a self-signed root.
        }
        const issuerIndex = remaining.findIndex((candidate) => {
            try {
                return current.checkIssued(candidate);
            } catch {
                return false;
            }
        });
        if (issuerIndex < 0) {
            break;
        }
        chain.push(remaining[issuerIndex]);
        remaining.splice(issuerIndex, 1);
    }
    return chain;
}

function toIdentity(
    alias: string,
    privateKey: crypto.KeyObject,
    chain: crypto.X509Certificate[],
): KeystoreIdentity {
    const chainDer = chain.map((certificate) => certificate.raw.toString("base64"));
    return {
        privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        certificateDerBase64: chainDer[0],
        certificateChainDerBase64: chainDer,
        alias,
    };
}

function pickAlias(available: string[], requested: string | undefined): number {
    if (available.length === 0) {
        throw new KeystoreError(
            "no-key-entry",
            "This keystore holds no signing keys, only certificates. " +
                "Choose a keystore that contains the private key you sign with.",
        );
    }
    if (requested === undefined) {
        if (available.length === 1) {
            return 0;
        }
        throw new KeystoreError(
            "ambiguous-alias",
            `This keystore holds more than one key (${available.join(", ")}). Choose which one to sign with.`,
        );
    }
    // keytool folds aliases to lower case, so match without regard to case.
    const index = available.findIndex(
        (candidate) => candidate.toLowerCase() === requested.toLowerCase(),
    );
    if (index < 0) {
        throw new KeystoreError(
            "alias-not-found",
            `This keystore has no key named "${requested}". It contains: ${available.join(", ")}.`,
        );
    }
    return index;
}

function wrongKeyPassword(alias: string, explicit: boolean): KeystoreError {
    return new KeystoreError(
        "wrong-key-password",
        explicit
            ? `The key password for "${alias}" is incorrect. ` +
              "It is the password set on the key itself, which can differ from the keystore password."
            : `The key "${alias}" is protected by its own password, different from the keystore password. ` +
              "Enter that key password as well.",
    );
}

/* ------------------------------------------------------------ public face */

/**
 * Work out what kind of keystore this is from its leading bytes. Extensions
 * lie - authors rename `.jks` to `.keystore` and back, and Android Studio
 * writes PKCS#12 into files named `.jks`.
 */
export function detectKeystoreFormat(file: Buffer): KeystoreFormat {
    if (file.length >= 4) {
        const magic = file.readUInt32BE(0);
        if (magic === JKS_MAGIC) {
            return "jks";
        }
        if (magic === JCEKS_MAGIC) {
            throw new KeystoreError(
                "unsupported-format",
                "This is a JCEKS keystore, which NarraLeaf Studio cannot open. " +
                    "Convert it with keytool: keytool -importkeystore -srckeystore <your keystore> " +
                    "-srcstoretype jceks -destkeystore converted.p12 -deststoretype pkcs12",
            );
        }
        // A PKCS#12 file is a DER SEQUENCE holding version 3.
        if (file[0] === TAG_SEQUENCE) {
            return "pkcs12";
        }
    }
    throw new KeystoreError(
        "unsupported-format",
        "This file is not a keystore NarraLeaf Studio can read. " +
            "Choose a PKCS#12 file (.p12 or .pfx) or a Java keystore (.jks or .keystore).",
    );
}

/**
 * The names of the signing keys in a keystore, in file order, so the build
 * dialog can offer a picker. Certificate-only entries are left out - you cannot
 * sign with them. Requires the store password, and reports a wrong one the same
 * way `readKeystore` does.
 */
export function listAliases(file: Buffer, storePassword: string): string[] {
    if (detectKeystoreFormat(file) === "jks") {
        return openJks(file, storePassword).map((entry) => entry.alias);
    }
    return openPkcs12(file, storePassword).keyBags.map(pkcs12AliasOf);
}

/**
 * Read one signing key and its certificate chain out of a keystore.
 *
 * `file` is the keystore's bytes; reading them is the caller's job, which keeps
 * this module free of the filesystem and testable against embedded fixtures.
 */
export function readKeystore(file: Buffer, options: ReadKeystoreOptions): KeystoreIdentity {
    const format = detectKeystoreFormat(file);
    const explicitKeyPassword = options.keyPassword !== undefined;
    const keyPassword = options.keyPassword ?? options.storePassword;

    if (format === "jks") {
        const entries = openJks(file, options.storePassword);
        const entry = entries[pickAlias(entries.map((candidate) => candidate.alias), options.alias)];

        const pkcs8 = decryptJksKey(entry.encryptedKey, keyPassword);
        if (pkcs8 === null) {
            throw wrongKeyPassword(entry.alias, explicitKeyPassword);
        }
        const privateKey = toPrivateKey(pkcs8);
        if (!privateKey) {
            throw damaged(`the key "${entry.alias}" is not in a form this reader understands`);
        }
        const certificates = entry.chain.map(toCertificate);
        if (certificates.some((certificate) => certificate === null)) {
            throw damaged(`a certificate belonging to the key "${entry.alias}" is malformed`);
        }
        // JKS already stores the chain leaf first, but re-deriving it means a
        // store written by something other than keytool cannot hand us a chain
        // in the wrong order.
        return toIdentity(
            entry.alias,
            privateKey,
            buildChain(privateKey, certificates as crypto.X509Certificate[], entry.alias),
        );
    }

    const { keyBags, certBags } = openPkcs12(file, options.storePassword);
    const aliases = keyBags.map(pkcs12AliasOf);
    const index = pickAlias(aliases, options.alias);
    const bag = keyBags[index];
    const alias = aliases[index];

    let pkcs8: Buffer;
    if (bag.shrouded) {
        // EncryptedPrivateKeyInfo ::= SEQUENCE { encryptionAlgorithm, encryptedData OCTET STRING }
        const parts = items(expectTag(bag.value, TAG_SEQUENCE, "a key entry"));
        const algorithm = readAlgorithmIdentifier(
            expectTag(parts[0], TAG_SEQUENCE, "a key entry algorithm"),
        );
        const ciphertext = expectTag(parts[1], TAG_OCTET_STRING, "a key entry body").content;
        const plaintext = decryptPkcs12(algorithm, keyPassword, ciphertext);
        if (plaintext === null) {
            throw wrongKeyPassword(alias, explicitKeyPassword);
        }
        pkcs8 = plaintext;
    } else {
        pkcs8 = Buffer.from(bag.value.raw);
    }

    const privateKey = toPrivateKey(pkcs8);
    if (!privateKey) {
        // The padding survived but the contents did not parse: with PBES1 and
        // PBES2 alike that is one wrong password in 256, not a broken file.
        throw bag.shrouded
            ? wrongKeyPassword(alias, explicitKeyPassword)
            : damaged(`the key "${alias}" is not in a form this reader understands`);
    }

    const certificates = certBags
        .map((certBag) => toCertificate(certBag.der))
        .filter((certificate): certificate is crypto.X509Certificate => certificate !== null);
    return toIdentity(alias, privateKey, buildChain(privateKey, certificates, alias));
}
