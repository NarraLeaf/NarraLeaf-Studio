/**
 * Ad-hoc code signatures for Mach-O images, written byte for byte the way Apple's `codesign`
 * writes them.
 *
 * The command being matched is the one `@electron/fuses` runs after it flips a fuse, which is
 * what a macOS game ships with today:
 *
 *     codesign --sign - --force --preserve-metadata=entitlements,requirements,flags,runtime --deep
 *
 * Matching it exactly, rather than producing some signature macOS also accepts, is what lets a
 * build made on Windows be compared file for file with one made on a Mac. Every layout rule
 * below was read off codesign's output on macOS 15 (Apple silicon), not off documentation.
 *
 * An ad-hoc signature is a superblob of three blobs: a CodeDirectory (the identifier, hashes of
 * a few "special" things such as the bundle's Info.plist, and a SHA-256 hash of every 4 KB page
 * of the image up to the signature), an empty requirement set, and an empty CMS wrapper - there
 * is no certificate, so nothing is signed cryptographically. The image's identity, its cdhash,
 * is the first 20 bytes of the SHA-256 of the CodeDirectory.
 *
 * What this does not write - SHA-1 code directories, entitlements, hardened-runtime flags,
 * preserved requirements - is refused when the input would make codesign write it, so the
 * signer never quietly produces something codesign would not.
 */

import crypto from "crypto";

const MH_MAGIC_64 = 0xfeedfacf;
const MH_MAGIC = 0xfeedface;
const MH_CIGAM_64 = 0xcffaedfe;
const MH_CIGAM = 0xcefaedfe;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;

const LC_SEGMENT_64 = 0x19;
const LC_UUID = 0x1b;
const LC_CODE_SIGNATURE = 0x1d;
const LC_VERSION_MIN_MACOSX = 0x24;
const LC_BUILD_VERSION = 0x32;
const PLATFORM_MACOS = 1;
const MH_EXECUTE = 2;
const CPU_TYPE_ARM64 = 0x0100000c;

const MACH_HEADER_64_LEN = 32;
const SEGMENT_COMMAND_64_LEN = 72;
const SECTION_64_LEN = 80;
const LINKEDIT_DATA_COMMAND_LEN = 16;

const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
const CSSLOT_CODEDIRECTORY = 0;
const CSSLOT_REQUIREMENTS = 2;
const CSSLOT_ENTITLEMENTS = 5;
const CSSLOT_DER_ENTITLEMENTS = 7;
const CSSLOT_SIGNATURESLOT = 0x10000;

/* The CodeDirectory version that carries the executable-segment fields and nothing newer. */
const CODEDIRECTORY_VERSION = 0x20400;
const CS_ADHOC = 0x2;
/* Set by the linker on the signature it writes, and dropped by codesign when it re-signs. */
const CS_LINKER_SIGNED = 0x20000;
const CS_EXECSEG_MAIN_BINARY = 1n;
/* The identifier starts at the end of the version-0x20400 header. */
const CODEDIRECTORY_IDENT_OFFSET = 88;
const SHA256_LEN = 32;
const CS_HASHTYPE_SHA256 = 2;
/* codesign hashes in 4 KB pages on every architecture, arm64 included. */
const PAGE_SIZE_LOG2 = 12;
const PAGE_SIZE = 1 << PAGE_SIZE_LOG2;

/** The requirement set an ad-hoc signature carries: a requirements blob with no entries. */
export const EMPTY_REQUIREMENTS_BLOB = Buffer.from("fade0c010000000c00000000", "hex");
/* An ad-hoc signature's CMS slot: the wrapper blob with nothing in it. */
const EMPTY_CMS_WRAPPER_BLOB = Buffer.from("fade0b0100000008", "hex");
/*
 * The room codesign leaves after the superblob for a CMS signature it might have written, before
 * rounding the whole reservation up to 16 bytes. An ad-hoc signature leaves it as zeros, but it
 * is part of the file, of `LC_CODE_SIGNATURE.datasize` and of `__LINKEDIT`.
 */
const SIGNATURE_RESERVE = 18000;

/*
 * Where codesign puts each slice of a universal image it has signed: every slice starts on a
 * 16 KB boundary and the header says 2^14, whatever the alignment going in. An x86_64 slice
 * `lipo` placed on 4 KB comes out on 16 KB, and an arm64 slice it placed on 32 KB comes back to
 * 16 KB. The slices keep the order they arrived in.
 */
const SIGNED_SLICE_ALIGN_LOG2 = 14;
const FAT_HEADER_LEN = 8;
const FAT_ARCH_LEN = 20;
/*
 * Java class files start with the same four bytes as a universal image. In a class file the next
 * word is the class-file version, which is 45 or more, while no universal image has that many
 * slices.
 */
const MAX_FAT_ARCH_COUNT = 39;

/*
 * The oldest macOS deployment target codesign signs with a SHA-256 code directory alone. For an
 * older target it adds a SHA-1 one for the systems that cannot read SHA-256, which this signer
 * does not write.
 */
const MIN_SHA256_ONLY_MACOS = 0x000a0b04; // 10.11.4

/** A Mach-O image after signing. */
export type SignedMachO = {
    image: Buffer;
    /**
     * The cdhash a parent bundle records for this code. For a universal image it is the
     * arm64 slice's: codesign answers for the architecture of the Mac it runs on, and this
     * matches codesign on Apple silicon. An image with no arm64 slice answers with its first.
     */
    cdhash: Buffer;
    /** Every slice's cdhash: `cdhash` first, then the other slices in file order. */
    cdhashes: Buffer[];
};

const sha256 = (data: Buffer): Buffer => crypto.createHash("sha256").update(data).digest();
const alignUp = (value: number, alignment: number): number => Math.ceil(value / alignment) * alignment;

/**
 * Whether `data` is a Mach-O image, thin or universal, as codesign decides it when it finds a
 * file where nested code belongs.
 */
export function isMachO(data: Buffer): boolean {
    if (data.length < 8) {
        return false;
    }
    const little = data.readUInt32LE(0);
    if (little === MH_MAGIC_64 || little === MH_MAGIC || little === MH_CIGAM_64 || little === MH_CIGAM) {
        return true;
    }
    const big = data.readUInt32BE(0);
    if (big === FAT_MAGIC || big === FAT_MAGIC_64) {
        const count = data.readUInt32BE(4);
        return count >= 1 && count <= MAX_FAT_ARCH_COUNT;
    }
    return false;
}

/* ------------------------------------------------------------------ thin images */

type ThinLayout = {
    cpuType: number;
    fileType: number;
    ncmds: number;
    sizeofcmds: number;
    /* Offsets of load commands in the image; undefined when the image has none. */
    linkedit: number;
    text: number | undefined;
    codeSignature: number | undefined;
    uuid: Buffer | undefined;
    /* The macOS deployment target as `xxxx.yy.zz` nibbles, or undefined for none stated. */
    minMacOS: number | undefined;
    otherPlatform: boolean;
    /* Whether `__TEXT` has an `__info_plist` section, the Info.plist of code outside a bundle. */
    embeddedInfoPlist: boolean;
};

function readThinLayout(image: Buffer, name: string): ThinLayout {
    if (image.length < MACH_HEADER_64_LEN) {
        throw new Error(`${name} is too short to be a Mach-O image`);
    }
    const magic = image.readUInt32LE(0);
    if (magic !== MH_MAGIC_64) {
        throw new Error(
            magic === MH_MAGIC || magic === MH_CIGAM || magic === MH_CIGAM_64
                ? `${name} is a 32-bit or big-endian Mach-O image, which cannot be signed here`
                : `${name} is not a Mach-O image`,
        );
    }
    const layout: ThinLayout = {
        cpuType: image.readUInt32LE(4),
        fileType: image.readUInt32LE(12),
        ncmds: image.readUInt32LE(16),
        sizeofcmds: image.readUInt32LE(20),
        linkedit: -1,
        text: undefined,
        codeSignature: undefined,
        uuid: undefined,
        minMacOS: undefined,
        otherPlatform: false,
        embeddedInfoPlist: false,
    };
    const end = MACH_HEADER_64_LEN + layout.sizeofcmds;
    if (end > image.length) {
        throw new Error(`${name}'s load commands run past the end of the file`);
    }
    let offset = MACH_HEADER_64_LEN;
    for (let index = 0; index < layout.ncmds; index++) {
        if (offset + 8 > end) {
            throw new Error(`${name}'s load commands are truncated`);
        }
        const cmd = image.readUInt32LE(offset);
        const size = image.readUInt32LE(offset + 4);
        if (size < 8 || offset + size > end) {
            throw new Error(`${name} has a malformed load command`);
        }
        if (cmd === LC_SEGMENT_64) {
            const segment = image.toString("latin1", offset + 8, offset + 24).replace(/\0.*$/s, "");
            if (segment === "__LINKEDIT") {
                layout.linkedit = offset;
            } else if (segment === "__TEXT") {
                layout.text = offset;
                const sections = image.readUInt32LE(offset + 64);
                for (let section = 0; section < sections; section++) {
                    const at = offset + SEGMENT_COMMAND_64_LEN + section * SECTION_64_LEN;
                    const sectionName = at + 16 <= offset + size ? image.toString("latin1", at, at + 16).replace(/\0.*$/s, "") : "";
                    if (sectionName === "__info_plist") {
                        layout.embeddedInfoPlist = true;
                    }
                }
            }
        } else if (cmd === LC_CODE_SIGNATURE) {
            layout.codeSignature = offset;
        } else if (cmd === LC_UUID) {
            layout.uuid = image.subarray(offset + 8, offset + 24);
        } else if (cmd === LC_BUILD_VERSION) {
            if (image.readUInt32LE(offset + 8) === PLATFORM_MACOS) {
                layout.minMacOS = image.readUInt32LE(offset + 12);
            } else {
                layout.otherPlatform = true;
            }
        } else if (cmd === LC_VERSION_MIN_MACOSX) {
            layout.minMacOS = image.readUInt32LE(offset + 8);
        }
        offset += size;
    }
    if (layout.linkedit < 0) {
        throw new Error(`${name} has no __LINKEDIT segment for a signature to go in`);
    }
    return layout;
}

/**
 * Refuse an image whose signature codesign would not write the way this module does: one it
 * would give a SHA-1 code directory too, or one whose existing signature carries something
 * `--preserve-metadata` would carry over.
 */
function assertSignableLikeCodesign(image: Buffer, layout: ThinLayout, name: string): void {
    if (layout.otherPlatform) {
        throw new Error(`${name} is not built for macOS`);
    }
    if (layout.minMacOS === undefined || layout.minMacOS < MIN_SHA256_ONLY_MACOS) {
        throw new Error(
            `${name} targets a macOS older than 10.11.4 (or states no target), for which codesign `
            + "also writes a SHA-1 code directory; this signer only writes the SHA-256 one",
        );
    }
    if (layout.codeSignature === undefined) {
        return;
    }
    const dataoff = image.readUInt32LE(layout.codeSignature + 8);
    if (dataoff + 12 > image.length || image.readUInt32BE(dataoff) !== CSMAGIC_EMBEDDED_SIGNATURE) {
        throw new Error(`${name}'s existing code signature is unreadable`);
    }
    const preserved = "which codesign would preserve and this signer does not write";
    const count = image.readUInt32BE(dataoff + 8);
    for (let index = 0; index < count; index++) {
        const type = image.readUInt32BE(dataoff + 12 + index * 8);
        const blob = dataoff + image.readUInt32BE(dataoff + 16 + index * 8);
        if (type === CSSLOT_ENTITLEMENTS || type === CSSLOT_DER_ENTITLEMENTS) {
            throw new Error(`${name} carries entitlements, ${preserved}`);
        }
        const requirements = image.subarray(blob, blob + EMPTY_REQUIREMENTS_BLOB.length);
        if (type === CSSLOT_REQUIREMENTS && !requirements.equals(EMPTY_REQUIREMENTS_BLOB)) {
            throw new Error(`${name} carries code requirements, ${preserved}`);
        }
        if (type === CSSLOT_CODEDIRECTORY && image.readUInt32BE(blob) === CSMAGIC_CODEDIRECTORY) {
            const flags = image.readUInt32BE(blob + 12);
            if ((flags & ~(CS_ADHOC | CS_LINKER_SIGNED)) !== 0) {
                throw new Error(`${name} is signed with flags 0x${flags.toString(16)}, ${preserved}`);
            }
        }
    }
}

/**
 * The executable segment the CodeDirectory names: the `__TEXT` segment's file range, flagged as
 * the main binary for an executable.
 */
function executableSegment(image: Buffer, layout: ThinLayout): { base: bigint; limit: bigint; flags: bigint } {
    if (layout.text === undefined) {
        return { base: 0n, limit: 0n, flags: 0n };
    }
    return {
        base: image.readBigUInt64LE(layout.text + 40),
        limit: image.readBigUInt64LE(layout.text + 48),
        flags: layout.fileType === MH_EXECUTE ? CS_EXECSEG_MAIN_BINARY : 0n,
    };
}

/**
 * An unsigned image with room made for a signature, the way codesign makes it: an
 * `LC_CODE_SIGNATURE` appended to the load commands, in the zero padding the linker leaves
 * before the first section, pointing at the end of the file rounded up to 16 bytes.
 */
function withCodeSignatureCommand(image: Buffer, layout: ThinLayout, name: string): Buffer {
    const at = MACH_HEADER_64_LEN + layout.sizeofcmds;
    const room = image.subarray(at, at + LINKEDIT_DATA_COMMAND_LEN);
    if (room.length < LINKEDIT_DATA_COMMAND_LEN || room.some(byte => byte !== 0)) {
        throw new Error(`${name} has no room after its load commands for a code signature command`);
    }
    const grown = Buffer.alloc(alignUp(image.length, 16));
    image.copy(grown);
    grown.writeUInt32LE(layout.ncmds + 1, 16);
    grown.writeUInt32LE(layout.sizeofcmds + LINKEDIT_DATA_COMMAND_LEN, 20);
    grown.writeUInt32LE(LC_CODE_SIGNATURE, at);
    grown.writeUInt32LE(LINKEDIT_DATA_COMMAND_LEN, at + 4);
    grown.writeUInt32LE(grown.length, at + 8);
    grown.writeUInt32LE(0, at + 12);
    return grown;
}

function signThin(
    original: Buffer,
    identifier: string,
    specialSlots: readonly (Buffer | null)[],
    name: string,
): { image: Buffer; cdhash: Buffer } {
    let image = original;
    let layout = readThinLayout(image, name);
    assertSignableLikeCodesign(image, layout, name);
    const execSeg = executableSegment(image, layout);
    if (layout.codeSignature === undefined) {
        image = withCodeSignatureCommand(image, layout, name);
        layout = readThinLayout(image, name);
    }
    const signatureCommand = layout.codeSignature as number;

    // A signature already there is replaced where it stands; the code it covers ends there.
    const codeLimit = image.readUInt32LE(signatureCommand + 8);
    const codeSlots = Math.ceil(codeLimit / PAGE_SIZE);
    const ident = Buffer.from(`${identifier}\0`, "utf8");
    const hashOffset = CODEDIRECTORY_IDENT_OFFSET + ident.length + specialSlots.length * SHA256_LEN;
    const cdLength = hashOffset + codeSlots * SHA256_LEN;
    const indexLength = 12 + 3 * 8;
    const superblobLength = indexLength + cdLength + EMPTY_REQUIREMENTS_BLOB.length + EMPTY_CMS_WRAPPER_BLOB.length;
    const datasize = alignUp(superblobLength + SIGNATURE_RESERVE, 16);

    const out = Buffer.alloc(codeLimit + datasize);
    image.copy(out, 0, 0, codeLimit);

    // The header changes first, because the page hashes cover it.
    out.writeUInt32LE(datasize, signatureCommand + 12);
    const linkeditFileoff = out.readBigUInt64LE(layout.linkedit + 40);
    const linkeditFilesize = BigInt(out.length) - linkeditFileoff;
    /* codesign rounds the segment's memory size to 16 KB on x86_64 too. */
    const segmentAlign = 0x4000n;
    out.writeBigUInt64LE(linkeditFilesize, layout.linkedit + 48);
    out.writeBigUInt64LE(((linkeditFilesize + segmentAlign - 1n) / segmentAlign) * segmentAlign, layout.linkedit + 32);

    const cd = Buffer.alloc(cdLength);
    cd.writeUInt32BE(CSMAGIC_CODEDIRECTORY, 0);
    cd.writeUInt32BE(cdLength, 4);
    cd.writeUInt32BE(CODEDIRECTORY_VERSION, 8);
    cd.writeUInt32BE(CS_ADHOC, 12);
    cd.writeUInt32BE(hashOffset, 16);
    cd.writeUInt32BE(CODEDIRECTORY_IDENT_OFFSET, 20);
    cd.writeUInt32BE(specialSlots.length, 24);
    cd.writeUInt32BE(codeSlots, 28);
    cd.writeUInt32BE(codeLimit, 32);
    cd[36] = SHA256_LEN;
    cd[37] = CS_HASHTYPE_SHA256;
    cd[38] = 0; // platform
    cd[39] = PAGE_SIZE_LOG2;
    cd.writeBigUInt64BE(execSeg.base, 64);
    cd.writeBigUInt64BE(execSeg.limit, 72);
    cd.writeBigUInt64BE(execSeg.flags, 80);
    ident.copy(cd, CODEDIRECTORY_IDENT_OFFSET);
    // Special slot -1 sits just below the code hashes, -2 below it, and so on.
    specialSlots.forEach((hash, index) => {
        if (hash) {
            hash.copy(cd, hashOffset - (index + 1) * SHA256_LEN);
        }
    });
    for (let page = 0; page < codeSlots; page++) {
        const start = page * PAGE_SIZE;
        crypto.createHash("sha256")
            .update(out.subarray(start, Math.min(start + PAGE_SIZE, codeLimit)))
            .digest()
            .copy(cd, hashOffset + page * SHA256_LEN);
    }

    // The superblob's blobs follow its index with no padding between them.
    const blobs: [number, Buffer][] = [
        [CSSLOT_CODEDIRECTORY, cd],
        [CSSLOT_REQUIREMENTS, EMPTY_REQUIREMENTS_BLOB],
        [CSSLOT_SIGNATURESLOT, EMPTY_CMS_WRAPPER_BLOB],
    ];
    out.writeUInt32BE(CSMAGIC_EMBEDDED_SIGNATURE, codeLimit);
    out.writeUInt32BE(superblobLength, codeLimit + 4);
    out.writeUInt32BE(blobs.length, codeLimit + 8);
    let blobOffset = indexLength;
    blobs.forEach(([type, blob], index) => {
        out.writeUInt32BE(type, codeLimit + 12 + index * 8);
        out.writeUInt32BE(blobOffset, codeLimit + 16 + index * 8);
        blob.copy(out, codeLimit + blobOffset);
        blobOffset += blob.length;
    });
    return { image: out, cdhash: sha256(cd).subarray(0, 20) };
}

/* ------------------------------------------------------------------ universal images */

type FatSlice = { cpuType: number; cpuSubtype: number; image: Buffer };

function readFatSlices(image: Buffer, name: string): FatSlice[] {
    const magic = image.readUInt32BE(0);
    if (magic === FAT_MAGIC_64) {
        throw new Error(`${name} is a 64-bit universal container, which cannot be signed here`);
    }
    const count = image.readUInt32BE(4);
    if (FAT_HEADER_LEN + count * FAT_ARCH_LEN > image.length) {
        throw new Error(`${name}'s universal header runs past the end of the file`);
    }
    const slices: FatSlice[] = [];
    for (let index = 0; index < count; index++) {
        const at = FAT_HEADER_LEN + index * FAT_ARCH_LEN;
        const offset = image.readUInt32BE(at + 8);
        const size = image.readUInt32BE(at + 12);
        if (offset + size > image.length) {
            throw new Error(`${name}'s slice ${index} runs past the end of the file`);
        }
        slices.push({
            cpuType: image.readUInt32BE(at),
            cpuSubtype: image.readUInt32BE(at + 4),
            image: image.subarray(offset, offset + size),
        });
    }
    return slices;
}

function isFat(image: Buffer): boolean {
    if (image.length < FAT_HEADER_LEN) {
        return false;
    }
    const magic = image.readUInt32BE(0);
    return magic === FAT_MAGIC || magic === FAT_MAGIC_64;
}

/** The slice codesign takes as the image itself on an Apple-silicon Mac: arm64, else the first. */
function preferredSliceIndex(slices: readonly FatSlice[]): number {
    const arm64 = slices.findIndex(slice => slice.cpuType === CPU_TYPE_ARM64);
    return arm64 >= 0 ? arm64 : 0;
}

/** The image codesign reads identity off: the thin image itself, or a universal one's preferred slice. */
function identityImage(image: Buffer, name: string): Buffer {
    if (!isFat(image)) {
        return image;
    }
    const slices = readFatSlices(image, name);
    if (slices.length === 0) {
        throw new Error(`${name} is a universal container with no slices`);
    }
    return slices[preferredSliceIndex(slices)].image;
}

/* ------------------------------------------------------------------ public */

/**
 * Sign `image` ad hoc as `identifier`.
 *
 * `specialSlots` are the hashes for special slots -1, -2, ... in that order, a null entry being
 * an empty slot: a bundle's main executable has three (its Info.plist, the requirement set and
 * the bundle's CodeResources), loose code two (an empty Info.plist slot and the requirement set).
 *
 * A universal image has every slice signed alike and is reassembled the way codesign
 * reassembles it, each slice on a 16 KB boundary in the order it arrived.
 */
export function adHocSignMachO(
    image: Buffer,
    identifier: string,
    specialSlots: readonly (Buffer | null)[],
    name = "this image",
): SignedMachO {
    if (!isFat(image)) {
        const signed = signThin(image, identifier, specialSlots, name);
        return { image: signed.image, cdhash: signed.cdhash, cdhashes: [signed.cdhash] };
    }
    const slices = readFatSlices(image, name);
    if (slices.length === 0) {
        throw new Error(`${name} is a universal container with no slices`);
    }
    const signed = slices.map((slice, index) => signThin(slice.image, identifier, specialSlots, `${name} (slice ${index})`));

    const alignment = 1 << SIGNED_SLICE_ALIGN_LOG2;
    const offsets: number[] = [];
    let cursor = FAT_HEADER_LEN + FAT_ARCH_LEN * slices.length;
    for (const { image: slice } of signed) {
        cursor = alignUp(cursor, alignment);
        offsets.push(cursor);
        cursor += slice.length;
    }
    const out = Buffer.alloc(cursor);
    out.writeUInt32BE(FAT_MAGIC, 0);
    out.writeUInt32BE(slices.length, 4);
    slices.forEach((slice, index) => {
        const at = FAT_HEADER_LEN + index * FAT_ARCH_LEN;
        out.writeUInt32BE(slice.cpuType, at);
        out.writeUInt32BE(slice.cpuSubtype, at + 4);
        out.writeUInt32BE(offsets[index], at + 8);
        out.writeUInt32BE(signed[index].image.length, at + 12);
        out.writeUInt32BE(SIGNED_SLICE_ALIGN_LOG2, at + 16);
        signed[index].image.copy(out, offsets[index]);
    });

    const preferred = preferredSliceIndex(slices);
    const others = signed.filter((_, index) => index !== preferred).map(slice => slice.cdhash);
    const cdhashes = [signed[preferred].cdhash, ...others];
    return { image: out, cdhash: cdhashes[0], cdhashes };
}

/**
 * The designated requirement codesign states for ad-hoc signed code, which a parent bundle's
 * CodeResources records next to the nested code's cdhash: the code is itself and nothing else,
 * so the requirement names its cdhash - every slice's, for a universal image.
 */
export function adHocDesignatedRequirement(signed: Pick<SignedMachO, "cdhashes">): string {
    return signed.cdhashes.map(hash => `cdhash H"${hash.toString("hex")}"`).join(" or ");
}

/*
 * `sizeof(struct mach_header)`, the 32-bit header. codesign hashes this much of a 64-bit header
 * when it falls back to hashing one, leaving out the trailing reserved word.
 */
const MACH_HEADER_32_LEN = 28;

/**
 * What codesign appends to an ad-hoc identifier that has no dot in it, to keep two unrelated
 * pieces of code from both being called, say, `helper`: the hex of `"UUID"` followed by the
 * image's LC_UUID, or for an image without one, of the SHA-1 of its header and load commands as
 * they were before signing.
 */
function uniqueSuffix(image: Buffer, name: string): string {
    const thin = identityImage(image, name);
    const layout = readThinLayout(thin, name);
    if (layout.uuid) {
        return Buffer.concat([Buffer.from("UUID", "latin1"), layout.uuid]).toString("hex");
    }
    return crypto.createHash("sha1")
        .update(thin.subarray(0, MACH_HEADER_32_LEN))
        .update(thin.subarray(MACH_HEADER_64_LEN, MACH_HEADER_64_LEN + layout.sizeofcmds))
        .digest("hex");
}

/**
 * The identifier codesign gives code that has no Info.plist, such as a helper tool loose in a
 * framework: the file name without its last extension (`libfoo.dylib` is `libfoo`), and, when
 * that leaves no dot in it, an ad-hoc signature's unique suffix after a hyphen. A file named
 * `a.b.c` is plainly `a.b`.
 *
 * Code in a bundle is signed as its CFBundleIdentifier exactly as written, dot or no dot.
 */
export function looseCodeIdentifier(fileName: string, image: Buffer, name = fileName): string {
    const dot = fileName.lastIndexOf(".");
    const recommended = dot >= 0 ? fileName.slice(0, dot) : fileName;
    return recommended.includes(".") ? recommended : `${recommended}-${uniqueSuffix(image, name)}`;
}

/**
 * Whether any slice of `image` embeds an Info.plist. Code outside a bundle that does is
 * identified and hashed by it (special slot -1), which the loose-code path does not do.
 */
export function embedsInfoPlist(image: Buffer, name = "this image"): boolean {
    const thins = isFat(image) ? readFatSlices(image, name).map(slice => slice.image) : [image];
    return thins.some(thin => readThinLayout(thin, name).embeddedInfoPlist);
}
