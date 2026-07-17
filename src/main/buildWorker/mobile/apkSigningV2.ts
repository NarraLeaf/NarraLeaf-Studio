import crypto from "crypto";
import { loadSigningIdentity, type SigningIdentity } from "./signingIdentity";

/**
 * APK Signature Scheme v2 signer and an independent self-verifier. Pure with
 * respect to fs: an unsigned APK buffer in, a signed APK buffer out.
 *
 * v2 inserts an "APK Signing Block" between the ZIP entries and the Central
 * Directory. The block holds a digest of everything except itself, plus a
 * signature over that digest and the signing certificate. The chunked digest
 * is computed with the End-of-Central-Directory's CD-offset field pointing at
 * the block's start — which is why the digest does not depend on the block's
 * own (yet-unknown) size, breaking the chicken-and-egg. This module produces
 * descriptor-free archives (zipWriter guarantees that), so entry offsets are
 * stable and only the EOCD's CD offset is rewritten on output.
 *
 * Reference: https://source.android.com/docs/security/features/apksigning/v2
 */

const APK_SIGNING_BLOCK_MAGIC = Buffer.from("APK Sig Block 42", "ascii");
const V2_BLOCK_ID = 0x7109871a;
/** RSASSA-PKCS1-v1.5 with SHA2-256, chunked SHA-256 content digest. */
const SIG_ALGO_RSA_PKCS1_SHA256 = 0x0103;
const CHUNK_SIZE = 1024 * 1024;
const EOCD_SIGNATURE = 0x06054b50;

/* ----------------------------------------------------- little-endian codec */

function u32(value: number): Buffer {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value >>> 0, 0);
    return buffer;
}

function u64(value: number): Buffer {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value), 0);
    return buffer;
}

/** uint32le length prefix + payload — the ubiquitous v2 framing. */
function lengthPrefixed(payload: Buffer): Buffer {
    return Buffer.concat([u32(payload.length), payload]);
}

/** A sequence of already-serialized, individually length-prefixed elements. */
function lengthPrefixedSequence(elements: Buffer[]): Buffer {
    return lengthPrefixed(Buffer.concat(elements.map(lengthPrefixed)));
}

/* ------------------------------------------------------------- zip anatomy */

type ApkSections = {
    /** [0, centralDirOffset): the ZIP entries. */
    beforeCentralDir: Buffer;
    centralDirectory: Buffer;
    endOfCentralDirectory: Buffer;
    centralDirOffset: number;
};

function locateSections(apk: Buffer): ApkSections {
    // Find the EOCD (scanning back over the max comment length).
    const lowest = Math.max(0, apk.length - 22 - 0xffff);
    let eocdOffset = -1;
    for (let offset = apk.length - 22; offset >= lowest; offset--) {
        if (apk.readUInt32LE(offset) === EOCD_SIGNATURE
            && offset + 22 + apk.readUInt16LE(offset + 20) === apk.length) {
            eocdOffset = offset;
            break;
        }
    }
    if (eocdOffset < 0) {
        throw new Error("APK has no end-of-central-directory record");
    }
    const centralDirSize = apk.readUInt32LE(eocdOffset + 12);
    const centralDirOffset = apk.readUInt32LE(eocdOffset + 16);
    if (centralDirOffset === 0xffffffff || centralDirSize === 0xffffffff) {
        throw new Error("zip64 APKs are not supported by the v2 signer");
    }
    if (centralDirOffset + centralDirSize !== eocdOffset) {
        throw new Error("Malformed APK: unexpected bytes between the central directory and the EOCD");
    }
    // Reject an already-signed APK rather than double-sign it. A v2 signature
    // sits between the entries and the central directory, so the well-formed
    // check above still passes for a signed APK — the block's magic is the
    // only reliable tell. The repack always signs a freshly built unsigned
    // APK, so an existing block means a caller mistake.
    if (centralDirOffset >= APK_SIGNING_BLOCK_MAGIC.length
        && apk.subarray(centralDirOffset - APK_SIGNING_BLOCK_MAGIC.length, centralDirOffset)
            .equals(APK_SIGNING_BLOCK_MAGIC)) {
        throw new Error("APK already has an APK Signing Block");
    }
    return {
        beforeCentralDir: apk.subarray(0, centralDirOffset),
        centralDirectory: apk.subarray(centralDirOffset, eocdOffset),
        endOfCentralDirectory: apk.subarray(eocdOffset),
        centralDirOffset,
    };
}

/**
 * A copy of the EOCD whose CD-offset field points at `offset`. During digest
 * computation this points at the (future) signing block's start, so the
 * digest is independent of the block's size.
 */
function eocdWithCentralDirOffset(eocd: Buffer, offset: number): Buffer {
    const copy = Buffer.from(eocd);
    copy.writeUInt32LE(offset, 16);
    return copy;
}

/* --------------------------------------------------------- chunked digest */

function digestChunks(section: Buffer, chunkDigests: Buffer[]): void {
    for (let offset = 0; offset < section.length; offset += CHUNK_SIZE) {
        const chunk = section.subarray(offset, Math.min(offset + CHUNK_SIZE, section.length));
        const hash = crypto.createHash("sha256");
        hash.update(Buffer.from([0xa5]));
        hash.update(u32(chunk.length));
        hash.update(chunk);
        chunkDigests.push(hash.digest());
    }
}

/**
 * The v2 content digest: each of the three sections is split into 1 MiB
 * chunks, each chunk digested as SHA256(0xa5 ‖ len ‖ chunk), and the final
 * digest is SHA256(0x5a ‖ chunkCount ‖ concat(chunkDigests)). A zero-length
 * section contributes no chunks.
 */
function computeContentDigest(sections: ApkSections): Buffer {
    const chunkDigests: Buffer[] = [];
    digestChunks(sections.beforeCentralDir, chunkDigests);
    digestChunks(sections.centralDirectory, chunkDigests);
    digestChunks(eocdWithCentralDirOffset(sections.endOfCentralDirectory, sections.centralDirOffset), chunkDigests);

    const top = crypto.createHash("sha256");
    top.update(Buffer.from([0x5a]));
    top.update(u32(chunkDigests.length));
    for (const digest of chunkDigests) {
        top.update(digest);
    }
    return top.digest();
}

/* ------------------------------------------------------------- v2 assembly */

function buildSignedData(contentDigest: Buffer, certificateDer: Buffer): Buffer {
    const digests = [Buffer.concat([u32(SIG_ALGO_RSA_PKCS1_SHA256), lengthPrefixed(contentDigest)])];
    const certificates = [certificateDer];
    const additionalAttributes: Buffer[] = [];
    return Buffer.concat([
        lengthPrefixedSequence(digests),
        lengthPrefixedSequence(certificates),
        lengthPrefixedSequence(additionalAttributes),
    ]);
}

function buildV2Block(signedData: Buffer, signature: Buffer, publicKeyDer: Buffer): Buffer {
    const signatures = [Buffer.concat([u32(SIG_ALGO_RSA_PKCS1_SHA256), lengthPrefixed(signature)])];
    const signer = Buffer.concat([
        lengthPrefixed(signedData),
        lengthPrefixedSequence(signatures),
        lengthPrefixed(publicKeyDer),
    ]);
    // v2 block value = length-prefixed sequence of signers.
    return lengthPrefixedSequence([signer]);
}

/**
 * Wrap ID→value pairs in the APK Signing Block envelope:
 *   uint64 size ‖ (uint64 pairLen ‖ uint32 id ‖ value)* ‖ uint64 size ‖ magic
 * where size counts everything after the first size field.
 */
function buildSigningBlock(pairs: { id: number; value: Buffer }[]): Buffer {
    const pairBuffers = pairs.map(({ id, value }) => {
        const idAndValue = Buffer.concat([u32(id), value]);
        return Buffer.concat([u64(idAndValue.length), idAndValue]);
    });
    const body = Buffer.concat(pairBuffers);
    const sizeField = u64(body.length + 8 + APK_SIGNING_BLOCK_MAGIC.length);
    return Buffer.concat([sizeField, body, sizeField, APK_SIGNING_BLOCK_MAGIC]);
}

/**
 * Sign an unsigned, descriptor-free APK with a v2 signature and return the
 * signed bytes. The identity is reused across projects so overwrite installs
 * keep the same certificate.
 */
export function signApkV2(apk: Buffer, identity: SigningIdentity): Buffer {
    const { privateKey, certificateDer } = loadSigningIdentity(identity);
    const publicKeyDer = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });

    const sections = locateSections(apk);
    const contentDigest = computeContentDigest(sections);
    const signedData = buildSignedData(contentDigest, certificateDer);
    const signature = crypto.sign("sha256", signedData, privateKey);
    const v2Block = buildV2Block(signedData, signature, publicKeyDer);
    const signingBlock = buildSigningBlock([{ id: V2_BLOCK_ID, value: v2Block }]);

    // Reassemble: entries ‖ signing block ‖ central directory ‖ EOCD, with the
    // EOCD's CD offset moved past the inserted block.
    const newCentralDirOffset = sections.centralDirOffset + signingBlock.length;
    const eocd = eocdWithCentralDirOffset(sections.endOfCentralDirectory, newCentralDirOffset);
    return Buffer.concat([sections.beforeCentralDir, signingBlock, sections.centralDirectory, eocd]);
}

/* -------------------------------------------------------------- verifier */

export type ApkV2VerifyResult = {
    verified: boolean;
    reason?: string;
    certificateDer?: Buffer;
};

function readLengthPrefixed(buffer: Buffer, offset: number): { value: Buffer; next: number } {
    const length = buffer.readUInt32LE(offset);
    const start = offset + 4;
    const end = start + length;
    if (end > buffer.length) {
        throw new Error("length-prefixed field overruns its container");
    }
    return { value: buffer.subarray(start, end), next: end };
}

function findSigningBlock(apk: Buffer): { block: Buffer; centralDirOffset: number; sections: ApkSections } {
    const lowest = Math.max(0, apk.length - 22 - 0xffff);
    let eocdOffset = -1;
    for (let offset = apk.length - 22; offset >= lowest; offset--) {
        if (apk.readUInt32LE(offset) === EOCD_SIGNATURE
            && offset + 22 + apk.readUInt16LE(offset + 20) === apk.length) {
            eocdOffset = offset;
            break;
        }
    }
    if (eocdOffset < 0) {
        throw new Error("no end-of-central-directory record");
    }
    const centralDirOffset = apk.readUInt32LE(eocdOffset + 16);
    // The block's trailing size field sits immediately before the CD.
    const trailerSizeOffset = centralDirOffset - 8;
    if (trailerSizeOffset < 0) {
        throw new Error("no room for an APK Signing Block");
    }
    const magicStart = centralDirOffset - APK_SIGNING_BLOCK_MAGIC.length;
    if (!apk.subarray(magicStart, centralDirOffset).equals(APK_SIGNING_BLOCK_MAGIC)) {
        throw new Error("APK Signing Block magic not found");
    }
    const blockSize = Number(apk.readBigUInt64LE(magicStart - 8));
    const blockStart = centralDirOffset - blockSize - 8;
    if (blockStart < 0) {
        throw new Error("APK Signing Block size out of bounds");
    }
    const block = apk.subarray(blockStart + 8, centralDirOffset - 8 - APK_SIGNING_BLOCK_MAGIC.length);
    const eocd = apk.subarray(eocdOffset);
    return {
        block,
        centralDirOffset,
        sections: {
            beforeCentralDir: apk.subarray(0, blockStart),
            centralDirectory: apk.subarray(centralDirOffset, eocdOffset),
            endOfCentralDirectory: eocd,
            // The digest treats the EOCD CD-offset as the signing block start.
            centralDirOffset: blockStart,
        },
    };
}

/**
 * Independently verify a v2 signature: recompute the content digest, check it
 * against the signed digest, verify the signature with the embedded
 * certificate's key, and confirm that key matches the signer's public key.
 * The in-repo counterpart to the CI apksigner check — it catches structural
 * and digest mistakes without any Android toolchain.
 */
export function verifyApkV2(apk: Buffer): ApkV2VerifyResult {
    try {
        const { block, sections } = findSigningBlock(apk);

        // Walk the ID→value pairs to the v2 block.
        let v2Value: Buffer | null = null;
        let cursor = 0;
        while (cursor < block.length) {
            const pairLength = Number(block.readBigUInt64LE(cursor));
            const id = block.readUInt32LE(cursor + 8);
            if (id === V2_BLOCK_ID) {
                v2Value = block.subarray(cursor + 12, cursor + 8 + pairLength);
            }
            cursor += 8 + pairLength;
        }
        if (!v2Value) {
            return { verified: false, reason: "no v2 signature block" };
        }

        const signers = readLengthPrefixed(v2Value, 0).value;
        const signer = readLengthPrefixed(signers, 0).value;
        const signedData = readLengthPrefixed(signer, 0);
        const signatures = readLengthPrefixed(signer, signedData.next);
        const publicKeyField = readLengthPrefixed(signer, signatures.next);

        // Parse signed data: digests, certificates, attributes.
        const digestsSeq = readLengthPrefixed(signedData.value, 0);
        const certificatesSeq = readLengthPrefixed(signedData.value, digestsSeq.next);
        const firstDigest = readLengthPrefixed(digestsSeq.value, 0).value;
        const signedDigest = readLengthPrefixed(firstDigest, 4).value; // skip algo id
        const certificateDer = readLengthPrefixed(certificatesSeq.value, 0).value;

        // Parse the first signature.
        const firstSignature = readLengthPrefixed(signatures.value, 0).value;
        const signatureBytes = readLengthPrefixed(firstSignature, 4).value;

        const publicKey = crypto.createPublicKey({
            key: publicKeyField.value,
            format: "der",
            type: "spki",
        });

        // 1. Recomputed digest must match the signed one.
        const recomputed = computeContentDigest(sections);
        if (!recomputed.equals(signedDigest)) {
            return { verified: false, reason: "content digest mismatch" };
        }
        // 2. Signature over signed-data must verify with the signer key.
        if (!crypto.verify("sha256", signedData.value, publicKey, signatureBytes)) {
            return { verified: false, reason: "signature does not verify" };
        }
        // 3. The certificate's key must be the signer key.
        const certificate = new crypto.X509Certificate(Buffer.from(certificateDer));
        const certKeyDer = certificate.publicKey.export({ type: "spki", format: "der" });
        if (!certKeyDer.equals(Buffer.from(publicKeyField.value))) {
            return { verified: false, reason: "certificate key does not match signer key" };
        }
        return { verified: true, certificateDer: Buffer.from(certificateDer) };
    } catch (error) {
        return { verified: false, reason: error instanceof Error ? error.message : String(error) };
    }
}
