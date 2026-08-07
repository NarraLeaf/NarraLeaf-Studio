import crypto from "crypto";
import { loadApkSigningIdentity, type ApkSigningIdentity } from "./signingIdentity";
import { derInteger, encodeOid } from "./x509";
import {
    CENTRAL_HEADER_SIZE,
    crc32,
    EOCD_SIZE,
    LOCAL_HEADER_SIZE,
    parseZipIndex,
    readEntryBytes,
    toDosDateTime,
    ZIP_METHOD_STORE,
    type ZipIndexEntry,
} from "./zipModel";

/**
 * JAR signing (the "v1" signature) and an independent self-verifier. Pure with
 * respect to fs: a finished zip in, a signed zip out.
 *
 * This exists for the Android App Bundle. An `.apk` is signed with APK
 * Signature Scheme v2 (apkSigningV2.ts) - a block spliced between the entries
 * and the central directory, covering the archive's raw bytes. An `.aab` is
 * not: Play verifies the upload key from a *classic JAR signature*, three
 * ordinary zip entries that sign the archive's logical contents rather than
 * its bytes:
 *
 *   META-INF/MANIFEST.MF   one section per entry, holding SHA-256 of that
 *                          entry's *uncompressed* bytes
 *   META-INF/<NAME>.SF     digests of MANIFEST.MF - the whole file, its main
 *                          section, and each entry section's *text*
 *   META-INF/<NAME>.RSA    a detached PKCS#7 SignedData over the .SF bytes
 *
 * The indirection is the point: the .RSA signs only the small .SF, the .SF
 * pins the manifest, and the manifest pins the content. So an unsigned bundle
 * is rejected by Play, and a bundle whose payload was altered after signing
 * fails at whichever link was broken.
 *
 * Two traps live in this format and both are silent when you get them wrong:
 *
 *  - Manifest lines wrap at 72 *bytes*, with continuation lines beginning with
 *    a single space that belongs to the wrap and not to the value. Asset paths
 *    in a game payload sail past 72 bytes constantly, and so does the
 *    `SHA-256-Digest-Manifest-Main-Attributes` header (41 bytes of name plus a
 *    44-byte digest), so every real bundle exercises this on both files.
 *  - The .SF's per-entry `SHA-256-Digest` is the digest of that entry's
 *    *section text inside MANIFEST.MF*, not of the file the section describes.
 *    Digesting the file there produces a signature that verifies against
 *    nothing while looking entirely plausible.
 *
 * Output layout: MANIFEST.MF, the .SF and the .RSA are prepended as new
 * entries (MANIFEST.MF first, as `JarInputStream` requires), and the original
 * archive's entry region is copied through verbatim - not re-encoded - with
 * every central-directory offset shifted by the prefix. Preserving the
 * original bytes exactly, headers included, is stronger than a raw passthrough
 * through zipWriter (which would restamp headers) and it is what makes the
 * digests we just computed still describe the entries afterwards.
 *
 * Determinism: the three new entries are *stored*, not deflated. They are
 * negligible next to a bundle, and storing removes the one thing that would
 * otherwise break "same input + same identity => byte-identical output" across
 * machines - zlib's compressed bytes are not guaranteed stable across
 * versions.
 *
 * Reference: the JAR File Specification, "Signed JAR File".
 */

/* ------------------------------------------------------------------ options */

export type JarSignOptions = {
    /** Base name of the signature files: META-INF/<signerName>.SF / .RSA. Default "NLSTUDIO". */
    signerName?: string;
    /** Fixed timestamp for reproducible output. */
    mtime?: Date;
};

const DEFAULT_SIGNER_NAME = "NLSTUDIO";
/** The DOS epoch: an obviously synthetic stamp, and stable by construction. */
const DEFAULT_MTIME = new Date(Date.UTC(1980, 0, 1));
const CREATED_BY = "1.0 (NarraLeaf Studio)";

const MANIFEST_PATH = "META-INF/MANIFEST.MF";
const META_INF_PREFIX = "META-INF/";
const SIGNATURE_FILE_PATTERN = /^META-INF\/[^/]+\.SF$/i;

/** The signature-file base name JarVerifier accepts: 1-8 of [A-Za-z0-9_-]. */
const SIGNER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,8}$/;

const EOCD_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

const CRLF = Buffer.from("\r\n", "ascii");
const SPACE = Buffer.from(" ", "ascii");
/** No manifest line may exceed 72 bytes; a continuation spends one on its space. */
const MAX_LINE_BYTES = 72;
const MAX_CONTINUATION_BYTES = MAX_LINE_BYTES - 1;

const sha256 = (data: Buffer): Buffer => crypto.createHash("sha256").update(data).digest();

/* ------------------------------------------------------- manifest text codec */

/**
 * Append one `Name: value` header, wrapped per the JAR spec: at most 72 bytes
 * per line in the UTF-8 encoding, continuation lines introduced by a single
 * space. The first line gets one byte more than the others precisely because
 * they spend one on that space. The split is by *bytes* and may land inside a
 * multi-byte character - which is what the spec says, and is why unwrapping
 * has to rejoin bytes before decoding.
 */
function writeHeaderLine(out: Buffer[], header: string): void {
    const bytes = Buffer.from(header, "utf8");
    if (bytes.length === 0) {
        out.push(CRLF);
        return;
    }
    out.push(bytes.subarray(0, 1));
    let position = 1;
    while (bytes.length - position > MAX_CONTINUATION_BYTES) {
        out.push(bytes.subarray(position, position + MAX_CONTINUATION_BYTES), CRLF, SPACE);
        position += MAX_CONTINUATION_BYTES;
    }
    out.push(bytes.subarray(position), CRLF);
}

/** One manifest/.SF section: its headers plus the blank line that ends it. */
function writeSection(headers: [string, string][]): Buffer {
    const out: Buffer[] = [];
    for (const [name, value] of headers) {
        writeHeaderLine(out, `${name}: ${value}`);
    }
    out.push(CRLF);
    return Buffer.concat(out);
}

type ManifestSection = {
    /** Byte range in the source file, the terminating blank line included. */
    start: number;
    end: number;
    /** Header name (lower-cased, they are case-insensitive) to unwrapped value. */
    attributes: Map<string, string>;
};

/**
 * Split a manifest-shaped file into sections and unwrap their headers. Section
 * ranges are byte-exact because the .SF's per-entry digests are taken over
 * these exact spans; the parse accepts LF as well as CRLF so a manifest that
 * passed through a lenient producer is still read the way its signer read it.
 */
function parseSections(source: Buffer): ManifestSection[] {
    const sections: ManifestSection[] = [];
    let sectionStart = -1;
    let headers: { key: string; value: Buffer[] }[] = [];

    const flush = (end: number): void => {
        if (sectionStart < 0) {
            return;
        }
        const attributes = new Map<string, string>();
        for (const header of headers) {
            attributes.set(header.key, Buffer.concat(header.value).toString("utf8"));
        }
        sections.push({ start: sectionStart, end, attributes });
        sectionStart = -1;
        headers = [];
    };

    let cursor = 0;
    while (cursor < source.length) {
        let contentEnd = cursor;
        while (contentEnd < source.length && source[contentEnd] !== 0x0d && source[contentEnd] !== 0x0a) {
            contentEnd++;
        }
        let next = contentEnd;
        if (next < source.length) {
            next = source[next] === 0x0d && source[next + 1] === 0x0a ? next + 2 : next + 1;
        }
        if (contentEnd === cursor) {
            flush(next);
        } else {
            if (sectionStart < 0) {
                sectionStart = cursor;
            }
            if (source[cursor] === 0x20) {
                if (headers.length === 0) {
                    throw new Error("Malformed manifest: a section begins with a continuation line");
                }
                headers[headers.length - 1].value.push(source.subarray(cursor + 1, contentEnd));
            } else {
                const colon = source.indexOf(0x3a, cursor);
                if (colon < 0 || colon >= contentEnd) {
                    throw new Error("Malformed manifest: a line carries no header name");
                }
                const key = source.subarray(cursor, colon).toString("utf8").toLowerCase();
                const valueStart = source[colon + 1] === 0x20 ? colon + 2 : colon + 1;
                headers.push({ key, value: [source.subarray(Math.min(valueStart, contentEnd), contentEnd)] });
            }
        }
        cursor = next;
    }
    // A section left unterminated at EOF still counts; the digest then covers
    // exactly the bytes that are there, which is what a signer would have done.
    flush(source.length);
    return sections;
}

/* ----------------------------------------------------------- DER, PKCS#7 */

// The tag/length wrapper only; the two encoders with real subtlety - OIDs and
// non-negative INTEGERs - come from x509.ts rather than being written twice.
function der(tag: number, content: Buffer): Buffer {
    const length = content.length;
    if (length < 0x80) {
        return Buffer.concat([Buffer.from([tag, length]), content]);
    }
    const bytes: number[] = [];
    let remaining = length;
    while (remaining > 0) {
        bytes.unshift(remaining & 0xff);
        remaining = Math.floor(remaining / 256);
    }
    return Buffer.concat([Buffer.from([tag, 0x80 | bytes.length, ...bytes]), content]);
}

const derSequence = (...parts: Buffer[]): Buffer => der(0x30, Buffer.concat(parts));
const derSet = (...parts: Buffer[]): Buffer => der(0x31, Buffer.concat(parts));
const derOctetString = (content: Buffer): Buffer => der(0x04, content);
const derContext = (tagNumber: number, content: Buffer): Buffer => der(0xa0 | tagNumber, content);
const DER_NULL = Buffer.from([0x05, 0x00]);
const DER_VERSION_1 = derInteger(Buffer.from([0x01]));

const OID_PKCS7_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_PKCS7_DATA = "1.2.840.113549.1.7.1";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
/**
 * The SignerInfo signature algorithm. Two OIDs are usable here and the choice
 * is not cosmetic: `rsaEncryption` names only the cipher and leaves the digest
 * to `digestAlgorithm` (RFC 3370 §3.2, and what `jarsigner` writes), while the
 * combined `sha256WithRSAEncryption` names both. OpenJDK 17's JarVerifier was
 * measured accepting either, so this emits the narrower one purely because its
 * accepted-by set is a superset: older Java lines derive a JCA algorithm name
 * by pasting the two names together, which only terminates sensibly for the
 * cipher-only OID. The verifier below accepts either.
 */
const OID_RSA_ENCRYPTION = "1.2.840.113549.1.1.1";
const OID_SHA256_WITH_RSA = "1.2.840.113549.1.1.11";

const ALGORITHM_SHA256 = derSequence(encodeOid(OID_SHA256), DER_NULL);

type Asn1Node = { tag: number; start: number; contentStart: number; end: number };

function readAsn1(buffer: Buffer, offset: number): Asn1Node {
    if (offset + 2 > buffer.length) {
        throw new Error("DER value is cut short");
    }
    const tag = buffer[offset];
    let cursor = offset + 1;
    const first = buffer[cursor++];
    let length: number;
    if (first < 0x80) {
        length = first;
    } else {
        const count = first & 0x7f;
        if (count === 0 || count > 4 || cursor + count > buffer.length) {
            throw new Error("DER length is out of range");
        }
        length = 0;
        for (let i = 0; i < count; i++) {
            length = length * 256 + buffer[cursor++];
        }
    }
    const end = cursor + length;
    if (end > buffer.length) {
        throw new Error("DER value runs past the end of its container");
    }
    return { tag, start: offset, contentStart: cursor, end };
}

function asn1Children(buffer: Buffer, node: Asn1Node): Asn1Node[] {
    const children: Asn1Node[] = [];
    let cursor = node.contentStart;
    while (cursor < node.end) {
        const child = readAsn1(buffer, cursor);
        children.push(child);
        cursor = child.end;
    }
    return children;
}

/**
 * The signer's IssuerAndSerialNumber, lifted verbatim out of the certificate.
 * Verbatim matters: a re-encoded Name would compare unequal to the issuer's
 * own encoding for any certificate that used a string type we did not guess.
 *
 * TBSCertificate ::= SEQUENCE { [0] version DEFAULT v1, serialNumber INTEGER,
 *                               signature AlgorithmIdentifier, issuer Name, ... }
 */
function readIssuerAndSerial(certificateDer: Buffer): { issuer: Buffer; serial: Buffer } {
    const certificate = readAsn1(certificateDer, 0);
    const tbs = readAsn1(certificateDer, certificate.contentStart);
    let cursor = tbs.contentStart;
    const maybeVersion = readAsn1(certificateDer, cursor);
    if (maybeVersion.tag === 0xa0) {
        cursor = maybeVersion.end;
    }
    const serial = readAsn1(certificateDer, cursor);
    if (serial.tag !== 0x02) {
        throw new Error("The signing certificate has no serial number where one is required");
    }
    const algorithm = readAsn1(certificateDer, serial.end);
    const issuer = readAsn1(certificateDer, algorithm.end);
    if (issuer.tag !== 0x30) {
        throw new Error("The signing certificate has no issuer name where one is required");
    }
    return {
        issuer: certificateDer.subarray(issuer.start, issuer.end),
        serial: certificateDer.subarray(serial.start, serial.end),
    };
}

/**
 * A detached PKCS#7 SignedData over `content`. Detached means the eContent is
 * absent: the .SF bytes live in their own zip entry and are supplied to the
 * verifier from there. No signed attributes - with them the signature would
 * have to cover the DER SET OF authenticatedAttributes rather than the content
 * itself, and this shape is both smaller and what jarsigner emits.
 */
function buildPkcs7SignedData(
    content: Buffer,
    privateKey: crypto.KeyObject,
    certificateChainDer: Buffer[],
): Buffer {
    const { issuer, serial } = readIssuerAndSerial(certificateChainDer[0]);
    const signature = crypto.sign("sha256", content, privateKey);
    const signerInfo = derSequence(
        DER_VERSION_1,
        derSequence(issuer, serial),
        ALGORITHM_SHA256,
        derSequence(encodeOid(OID_RSA_ENCRYPTION), DER_NULL),
        derOctetString(signature),
    );
    const signedData = derSequence(
        DER_VERSION_1,
        derSet(ALGORITHM_SHA256),
        // Detached: contentType only, no [0] eContent.
        derSequence(encodeOid(OID_PKCS7_DATA)),
        // certificates [0] IMPLICIT SET OF Certificate, leaf first.
        derContext(0, Buffer.concat(certificateChainDer)),
        derSet(signerInfo),
    );
    return derSequence(encodeOid(OID_PKCS7_SIGNED_DATA), derContext(0, signedData));
}

/* ------------------------------------------------------------ zip assembly */

type NewEntry = { name: string; data: Buffer };

/**
 * Prepend `newEntries` to a finished archive without disturbing a byte of it.
 * The whole `[0, centralDirectoryOffset)` region - local headers, extra fields
 * and data alike - is copied through and every central-directory offset is
 * shifted by the length of what was inserted ahead of it.
 *
 * The shift breaks any zipalign padding the input had. That is fine here and
 * only here: an `.aab` is never installed, bundletool re-emits the APKs it
 * generates, and nothing reads a bundle's entries by mmap.
 */
function prependEntries(zip: Buffer, newEntries: NewEntry[], mtime: Date): Buffer {
    const index = parseZipIndex(zip);
    if (index.zip64) {
        throw new Error("zip64 archives are not supported by the JAR signer");
    }
    const eocdOffset = index.centralDirectoryOffset + index.centralDirectorySize;
    if (eocdOffset + EOCD_SIZE > zip.length || zip.readUInt32LE(eocdOffset) !== EOCD_SIGNATURE) {
        throw new Error("Malformed archive: unexpected bytes between the central directory and the EOCD");
    }
    const comment = zip.subarray(eocdOffset + EOCD_SIZE);
    if (zip.readUInt16LE(eocdOffset + 20) !== comment.length) {
        throw new Error("Malformed archive: trailing bytes after the end-of-central-directory record");
    }

    const { dosTime, dosDate } = toDosDateTime(mtime);
    const prefixParts: Buffer[] = [];
    const newRecords: Buffer[] = [];
    let prefixLength = 0;
    for (const entry of newEntries) {
        const nameBytes = Buffer.from(entry.name, "utf8");
        const entryCrc = crc32(entry.data);
        const size = entry.data.length;

        const local = Buffer.alloc(LOCAL_HEADER_SIZE);
        local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(ZIP_METHOD_STORE, 8);
        local.writeUInt16LE(dosTime, 10);
        local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(entryCrc, 14);
        local.writeUInt32LE(size, 18);
        local.writeUInt32LE(size, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        local.writeUInt16LE(0, 28);
        prefixParts.push(local, nameBytes, entry.data);

        const record = Buffer.alloc(CENTRAL_HEADER_SIZE);
        record.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
        record.writeUInt16LE((3 << 8) | 20, 4);
        record.writeUInt16LE(20, 6);
        record.writeUInt16LE(0, 8);
        record.writeUInt16LE(ZIP_METHOD_STORE, 10);
        record.writeUInt16LE(dosTime, 12);
        record.writeUInt16LE(dosDate, 14);
        record.writeUInt32LE(entryCrc, 16);
        record.writeUInt32LE(size, 20);
        record.writeUInt32LE(size, 24);
        record.writeUInt16LE(nameBytes.length, 28);
        record.writeUInt16LE(0, 30);
        record.writeUInt16LE(0, 32);
        record.writeUInt16LE(0, 34);
        record.writeUInt16LE(0, 36);
        // 0o100644 in the high word; the >>> 0 keeps the shift unsigned.
        record.writeUInt32LE((0o100644 << 16) >>> 0, 38);
        record.writeUInt32LE(prefixLength, 42);
        newRecords.push(record, nameBytes);

        prefixLength += LOCAL_HEADER_SIZE + nameBytes.length + size;
    }

    // Walk the original central directory and shift each local-header offset.
    const originalRecords = Buffer.from(zip.subarray(index.centralDirectoryOffset, eocdOffset));
    let cursor = 0;
    for (let i = 0; i < index.entries.length; i++) {
        if (originalRecords.readUInt32LE(cursor) !== CENTRAL_HEADER_SIGNATURE) {
            throw new Error(`Central directory entry ${i} has a bad signature`);
        }
        const shifted = originalRecords.readUInt32LE(cursor + 42) + prefixLength;
        if (shifted >= MAX_UINT32) {
            throw new Error("Signing would push an entry past 4 GiB, which this archive cannot express");
        }
        originalRecords.writeUInt32LE(shifted, cursor + 42);
        cursor += CENTRAL_HEADER_SIZE
            + originalRecords.readUInt16LE(cursor + 28)
            + originalRecords.readUInt16LE(cursor + 30)
            + originalRecords.readUInt16LE(cursor + 32);
    }

    const entryCount = index.entries.length + newEntries.length;
    if (entryCount >= MAX_UINT16) {
        throw new Error("Signing would push the archive past 65535 entries, which needs zip64");
    }
    const centralDirectory = Buffer.concat([...newRecords, originalRecords]);
    const centralDirectoryOffset = prefixLength + index.centralDirectoryOffset;
    if (centralDirectoryOffset + centralDirectory.length >= MAX_UINT32) {
        throw new Error("Signing would push the archive past 4 GiB, which needs zip64");
    }

    const eocd = Buffer.alloc(EOCD_SIZE);
    eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entryCount, 8);
    eocd.writeUInt16LE(entryCount, 10);
    eocd.writeUInt32LE(centralDirectory.length, 12);
    eocd.writeUInt32LE(centralDirectoryOffset, 16);
    eocd.writeUInt16LE(comment.length, 20);

    return Buffer.concat([
        ...prefixParts,
        zip.subarray(0, index.centralDirectoryOffset),
        centralDirectory,
        eocd,
        comment,
    ]);
}

/* ------------------------------------------------------------------ signer */

/** Entries the manifest describes: files, and never the META-INF namespace. */
function isCovered(entry: ZipIndexEntry): boolean {
    return !entry.isDirectory && !entry.name.toUpperCase().startsWith(META_INF_PREFIX);
}

/**
 * JAR-sign (v1) a finished zip: read it, add META-INF/MANIFEST.MF, the .SF and
 * the .RSA, and return the new archive.
 *
 * `identity` carries a leaf-first certificate chain; which identity signs is
 * the caller's decision (for a bundle it is the *upload* key Play has on file,
 * and swapping it makes Play reject the upload outright), so the caller, not
 * this function, records the choice in the build log.
 */
export function signJar(zip: Buffer, identity: ApkSigningIdentity, options: JarSignOptions = {}): Buffer {
    const signerName = options.signerName ?? DEFAULT_SIGNER_NAME;
    if (!SIGNER_NAME_PATTERN.test(signerName)) {
        throw new Error(
            `"${signerName}" is not a usable signature file name: use 1-8 characters from A-Z, a-z, 0-9, _ and -`,
        );
    }
    const mtime = options.mtime ?? DEFAULT_MTIME;
    const { privateKey, certificateChainDer } = loadApkSigningIdentity(identity);

    const index = parseZipIndex(zip);
    // Refuse to double-sign. A second signature would not replace the first;
    // it would sit next to it describing an archive that no longer matches.
    const existing = index.entries.find(entry => SIGNATURE_FILE_PATTERN.test(entry.name));
    if (existing) {
        throw new Error(`The archive is already JAR-signed ("${existing.name}")`);
    }
    const signatureFilePath = `${META_INF_PREFIX}${signerName}.SF`;
    const blockFilePath = `${META_INF_PREFIX}${signerName}.RSA`;
    const taken = new Set(index.entries.map(entry => entry.name.toUpperCase()));
    for (const path of [MANIFEST_PATH, signatureFilePath, blockFilePath]) {
        if (taken.has(path.toUpperCase())) {
            throw new Error(`The archive already contains "${path}"`);
        }
    }

    // MANIFEST.MF: main section, then one section per covered entry, in the
    // archive's own order.
    const manifestParts: Buffer[] = [writeSection([
        ["Manifest-Version", "1.0"],
        ["Created-By", CREATED_BY],
    ])];
    const entrySections: { name: string; section: Buffer }[] = [];
    for (const entry of index.entries) {
        if (!isCovered(entry)) {
            continue;
        }
        const digest = sha256(readEntryBytes(zip, entry)).toString("base64");
        const section = writeSection([["Name", entry.name], ["SHA-256-Digest", digest]]);
        manifestParts.push(section);
        entrySections.push({ name: entry.name, section });
    }
    const mainSection = manifestParts[0];
    const manifest = Buffer.concat(manifestParts);

    // The .SF pins the manifest: the whole file, its main section, and each
    // entry section's *text* - not the file that section describes.
    const signatureFileParts: Buffer[] = [writeSection([
        ["Signature-Version", "1.0"],
        ["Created-By", CREATED_BY],
        ["SHA-256-Digest-Manifest-Main-Attributes", sha256(mainSection).toString("base64")],
        ["SHA-256-Digest-Manifest", sha256(manifest).toString("base64")],
    ])];
    for (const { name, section } of entrySections) {
        signatureFileParts.push(writeSection([
            ["Name", name],
            ["SHA-256-Digest", sha256(section).toString("base64")],
        ]));
    }
    const signatureFile = Buffer.concat(signatureFileParts);

    const block = buildPkcs7SignedData(signatureFile, privateKey, certificateChainDer);

    // MANIFEST.MF must be the archive's first entry - JarInputStream only
    // looks at the first (or, after a META-INF/ directory, the second) one.
    return prependEntries(zip, [
        { name: MANIFEST_PATH, data: manifest },
        { name: signatureFilePath, data: signatureFile },
        { name: blockFilePath, data: block },
    ], mtime);
}

/* ---------------------------------------------------------------- verifier */

export type JarVerifyResult = {
    verified: boolean;
    signerName: string;
    certificateChainDer: Buffer[];
    /** Entries covered by the signature. */
    signedEntryNames: string[];
    /** Why it failed; absent when it verified. */
    reason?: string;
};

type ParsedSignerInfo = {
    issuer: Buffer;
    serial: Buffer;
    signature: Buffer;
};

/** Pull the certificates and the single SignerInfo out of a PKCS#7 SignedData. */
function parsePkcs7(block: Buffer): { certificates: Buffer[]; signer: ParsedSignerInfo } {
    const contentInfo = readAsn1(block, 0);
    const contentInfoParts = asn1Children(block, contentInfo);
    if (contentInfoParts.length < 2 || contentInfoParts[1].tag !== 0xa0) {
        throw new Error("the signature block is not a PKCS#7 ContentInfo");
    }
    const signedData = readAsn1(block, contentInfoParts[1].contentStart);
    const parts = asn1Children(block, signedData);
    if (parts.length < 4) {
        throw new Error("the SignedData is missing required fields");
    }

    let certificates: Buffer[] = [];
    let signerInfos: Asn1Node | null = null;
    for (const part of parts.slice(3)) {
        if (part.tag === 0xa0) {
            certificates = asn1Children(block, part).map(node => Buffer.from(block.subarray(node.start, node.end)));
        } else if (part.tag === 0x31) {
            signerInfos = part;
        }
    }
    if (!signerInfos) {
        throw new Error("the SignedData carries no SignerInfo");
    }
    const signerNodes = asn1Children(block, signerInfos);
    if (signerNodes.length !== 1) {
        throw new Error(`the SignedData carries ${signerNodes.length} SignerInfos, expected exactly one`);
    }
    const fields = asn1Children(block, signerNodes[0]);
    if (fields.length < 5) {
        throw new Error("the SignerInfo is missing required fields");
    }
    const issuerAndSerial = asn1Children(block, fields[1]);
    if (issuerAndSerial.length !== 2) {
        throw new Error("the SignerInfo is not identified by issuer and serial number");
    }
    // fields[3] is either signed attributes ([0] IMPLICIT) or, in the shape
    // this module writes, already the signature algorithm.
    if (fields[3].tag === 0xa0) {
        throw new Error("signed attributes are not supported by this verifier");
    }
    const algorithm = asn1Children(block, fields[3])[0];
    const algorithmOid = block.subarray(algorithm.start, algorithm.end);
    if (!algorithmOid.equals(encodeOid(OID_RSA_ENCRYPTION)) && !algorithmOid.equals(encodeOid(OID_SHA256_WITH_RSA))) {
        throw new Error("the SignerInfo does not use an RSA signature algorithm");
    }
    if (fields[4].tag !== 0x04) {
        throw new Error("the SignerInfo carries no signature");
    }
    return {
        certificates,
        signer: {
            issuer: Buffer.from(block.subarray(issuerAndSerial[0].start, issuerAndSerial[0].end)),
            serial: Buffer.from(block.subarray(issuerAndSerial[1].start, issuerAndSerial[1].end)),
            signature: Buffer.from(block.subarray(fields[4].contentStart, fields[4].end)),
        },
    };
}

function requireAttribute(section: ManifestSection | undefined, key: string, what: string): string {
    const value = section?.attributes.get(key);
    if (value === undefined) {
        throw new Error(`${what} is missing`);
    }
    return value;
}

/**
 * Independently verify a JAR signature: check the PKCS#7 signature over the
 * .SF, then the .SF's digests of the manifest, then the manifest's digests of
 * the entries, then that no entry escaped the manifest.
 *
 * The order is the signature chain's own, so a failure names the link that
 * broke: tampering with the .SF fails at the signature, tampering with the
 * manifest fails at the .SF's manifest digest, tampering with a payload fails
 * at the manifest's content digest.
 */
export function verifyJarSignature(zip: Buffer): JarVerifyResult {
    let signerName = "";
    let certificateChainDer: Buffer[] = [];
    let signedEntryNames: string[] = [];
    try {
        const index = parseZipIndex(zip);
        const byUpperName = new Map<string, ZipIndexEntry>();
        for (const entry of index.entries) {
            byUpperName.set(entry.name.toUpperCase(), entry);
        }

        const manifestEntry = byUpperName.get(MANIFEST_PATH);
        if (!manifestEntry) {
            throw new Error("the archive has no META-INF/MANIFEST.MF");
        }
        const signatureEntries = index.entries.filter(entry => SIGNATURE_FILE_PATTERN.test(entry.name));
        if (signatureEntries.length !== 1) {
            throw new Error(
                signatureEntries.length === 0
                    ? "the archive carries no META-INF/*.SF signature file"
                    : `the archive carries ${signatureEntries.length} signature files, expected exactly one`,
            );
        }
        const signatureEntry = signatureEntries[0];
        signerName = signatureEntry.name.slice(META_INF_PREFIX.length, -".SF".length);
        const blockEntry = byUpperName.get(`${META_INF_PREFIX}${signerName}.RSA`.toUpperCase());
        if (!blockEntry) {
            throw new Error(`the archive has no META-INF/${signerName}.RSA signature block`);
        }

        const manifest = readEntryBytes(zip, manifestEntry);
        const signatureFile = readEntryBytes(zip, signatureEntry);
        const block = readEntryBytes(zip, blockEntry);

        // 1. The PKCS#7 signature over the .SF bytes.
        const { certificates, signer } = parsePkcs7(block);
        certificateChainDer = certificates;
        if (certificates.length === 0) {
            throw new Error("the signature block carries no certificate");
        }
        const signerCertificate = certificates.find(certificateDer => {
            const { issuer, serial } = readIssuerAndSerial(certificateDer);
            return issuer.equals(signer.issuer) && serial.equals(signer.serial);
        });
        if (!signerCertificate) {
            throw new Error("no embedded certificate matches the signer's issuer and serial number");
        }
        const publicKey = new crypto.X509Certificate(signerCertificate).publicKey;
        if (!crypto.verify("sha256", signatureFile, publicKey, signer.signature)) {
            throw new Error("the PKCS#7 signature does not verify against the signature file");
        }

        // 2. The .SF's digests of the manifest.
        const signatureSections = parseSections(signatureFile);
        const signatureMain = signatureSections[0];
        const manifestDigest = requireAttribute(signatureMain, "sha-256-digest-manifest", "SHA-256-Digest-Manifest");
        if (sha256(manifest).toString("base64") !== manifestDigest) {
            throw new Error("manifest digest mismatch");
        }
        const manifestSections = parseSections(manifest);
        if (manifestSections.length === 0) {
            throw new Error("the manifest is empty");
        }
        const mainDigest = requireAttribute(
            signatureMain,
            "sha-256-digest-manifest-main-attributes",
            "SHA-256-Digest-Manifest-Main-Attributes",
        );
        const mainSection = manifestSections[0];
        if (sha256(manifest.subarray(mainSection.start, mainSection.end)).toString("base64") !== mainDigest) {
            throw new Error("manifest main attributes digest mismatch");
        }

        // 3. Each .SF entry section digests the *manifest section's text*.
        const manifestByName = new Map<string, ManifestSection>();
        for (const section of manifestSections.slice(1)) {
            const name = section.attributes.get("name");
            if (name === undefined) {
                throw new Error("a manifest section carries no Name");
            }
            manifestByName.set(name, section);
        }
        signedEntryNames = [...manifestByName.keys()];
        for (const section of signatureSections.slice(1)) {
            const name = section.attributes.get("name");
            if (name === undefined) {
                throw new Error("a signature file section carries no Name");
            }
            const manifestSection = manifestByName.get(name);
            if (!manifestSection) {
                throw new Error(`the signature file signs "${name}", which the manifest does not describe`);
            }
            const expected = requireAttribute(section, "sha-256-digest", `SHA-256-Digest for "${name}"`);
            const actual = sha256(manifest.subarray(manifestSection.start, manifestSection.end)).toString("base64");
            if (actual !== expected) {
                throw new Error(`entry "${name}" section digest mismatch`);
            }
        }

        // 4. Each manifest section digests the entry's uncompressed bytes.
        for (const [name, section] of manifestByName) {
            const entry = byUpperName.get(name.toUpperCase());
            if (!entry) {
                throw new Error(`the manifest describes "${name}", which the archive does not contain`);
            }
            const expected = requireAttribute(section, "sha-256-digest", `SHA-256-Digest for "${name}"`);
            if (sha256(readEntryBytes(zip, entry)).toString("base64") !== expected) {
                throw new Error(`entry "${name}" content digest mismatch`);
            }
        }

        // 5. Coverage: nothing outside META-INF may escape the manifest, or an
        //    entry appended after signing would ride along unsigned.
        for (const entry of index.entries) {
            if (isCovered(entry) && !manifestByName.has(entry.name)) {
                throw new Error(`entry "${entry.name}" is not covered by the signature`);
            }
        }

        return { verified: true, signerName, certificateChainDer, signedEntryNames };
    } catch (error) {
        return {
            verified: false,
            signerName,
            certificateChainDer,
            signedEntryNames,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}
