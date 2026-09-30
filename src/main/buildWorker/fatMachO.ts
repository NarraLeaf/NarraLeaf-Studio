/**
 * Mach-O images, as much of them as a universal macOS build has to know.
 *
 * A universal package is packed as two halves, one per architecture, and
 * merged afterwards by `@electron/universal`. The merge joins with `lipo` every
 * Mach-O file that differs between the halves, skips one that is already
 * universal in both, and refuses one that is the same thin image in both,
 * because that image cannot be right for both machines. Everything Studio
 * stages for a universal target is therefore either not machine code at all or
 * a universal image built here from the two thin ones - so the merge is left
 * with nothing to be told, and keeps refusing exactly the mistake it exists to
 * catch. See `runGameBuild.ts`, which configures no exemption for it.
 *
 * Building the container here rather than with `lipo` is what lets any host
 * stage a universal payload: the container is a header and the unchanged thin
 * files after it.
 */

/** The two architectures a macOS build can target, in Node's vocabulary. */
export type MachOArch = "x64" | "arm64";

/** One thin image going into a universal one, and the architecture it is meant to be. */
export type MachOSlice = {
    /** Named in the refusal when the image is not what it is meant to be, e.g. `darwin-x64`. */
    name: string;
    arch: MachOArch;
    image: Buffer;
};

/* A 64-bit Mach-O written by a little-endian machine, which both targets are. */
const MH_MAGIC_64 = 0xfeedfacf;
/* The 32-bit one, which no current target produces but which is still a thin image. */
const MH_MAGIC = 0xfeedface;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;

const CPU_TYPES: Readonly<Record<MachOArch, number>> = {
    x64: 0x01000007,
    arm64: 0x0100000c,
};

/**
 * What the first bytes of a file say it is: a thin Mach-O image, a universal
 * one, or neither.
 *
 * `0xcafebabe` is also how a Java class file starts, which is why nothing here
 * treats "fat" as proof of anything - it is only ever asked whether a file is a
 * thin image, which a class file is not.
 */
export function machOKind(head: Buffer): "thin" | "fat" | null {
    if (head.length < 8) {
        return null;
    }
    const little = head.readUInt32LE(0);
    if (little === MH_MAGIC_64 || little === MH_MAGIC) {
        return "thin";
    }
    const big = head.readUInt32BE(0);
    if (big === FAT_MAGIC || big === FAT_MAGIC_64) {
        return "fat";
    }
    return null;
}

/** The architecture a thin image is for, `"other"` for one this build never targets, null for no image. */
export function thinMachOArch(image: Buffer): MachOArch | "other" | null {
    if (machOKind(image) !== "thin") {
        return null;
    }
    const cpuType = image.readUInt32LE(4);
    const arch = (Object.keys(CPU_TYPES) as MachOArch[]).find(candidate => CPU_TYPES[candidate] === cpuType);
    return arch ?? "other";
}

/**
 * Refuse an image that is not a thin Mach-O for the architecture it is meant to be.
 *
 * The images arrive from elsewhere - a prebuild in a package, or a compiler that
 * was asked for one architecture - and one for the wrong Mac is a well-formed
 * file that fails on one kind of Mac only, on a player's machine. Refusing here
 * names the image and the build stops instead.
 */
export function assertMachOSlice(slice: MachOSlice): void {
    const arch = thinMachOArch(slice.image);
    if (arch === null) {
        throw new Error(`${slice.name} is not a single-architecture Mach-O image`);
    }
    if (arch !== slice.arch) {
        throw new Error(`${slice.name} should be an ${slice.arch} image, but it is built for ${arch}`);
    }
}

/*
 * The container. Every field is big-endian regardless of what the slices are,
 * which is the one thing about this format that is easy to get wrong.
 *
 * The slices go in byte for byte, so each keeps its own signature: a signature
 * covers its own slice and knows nothing about the wrapper. That matters because
 * an arm64 image is signed when it is linked and macOS will not load it
 * otherwise.
 */
const FAT_HEADER_LEN = 8;
const FAT_ARCH_LEN = 20;
/* 2^14, the alignment Apple uses for arm64 and for current x86_64 images alike. */
const SLICE_ALIGN_POW = 14;

/**
 * One universal image made of `slices`, each checked by `assertMachOSlice` first.
 */
export function buildFatMachO(slices: readonly MachOSlice[]): Buffer {
    const seen = new Set<MachOArch>();
    for (const slice of slices) {
        assertMachOSlice(slice);
        if (seen.has(slice.arch)) {
            throw new Error(`two of the images for one universal file are both ${slice.arch}`);
        }
        seen.add(slice.arch);
    }

    const header = Buffer.alloc(FAT_HEADER_LEN + FAT_ARCH_LEN * slices.length);
    header.writeUInt32BE(FAT_MAGIC, 0);
    header.writeUInt32BE(slices.length, 4);

    const alignment = 1 << SLICE_ALIGN_POW;
    const placed: { offset: number; image: Buffer }[] = [];
    let cursor = header.length;
    slices.forEach(({ image }, index) => {
        cursor = Math.ceil(cursor / alignment) * alignment;
        const at = FAT_HEADER_LEN + FAT_ARCH_LEN * index;
        /* cputype and cpusubtype are read off the slice rather than assumed: the
         * subtype in particular carries capability bits this has no business
         * guessing, and getting it wrong makes the loader skip the slice. */
        header.writeUInt32BE(image.readUInt32LE(4), at);
        header.writeUInt32BE(image.readUInt32LE(8), at + 4);
        header.writeUInt32BE(cursor, at + 8);
        header.writeUInt32BE(image.length, at + 12);
        header.writeUInt32BE(SLICE_ALIGN_POW, at + 16);
        placed.push({ offset: cursor, image });
        cursor += image.length;
    });

    const container = Buffer.alloc(cursor);
    header.copy(container, 0);
    for (const { offset, image } of placed) {
        image.copy(container, offset);
    }
    return container;
}
