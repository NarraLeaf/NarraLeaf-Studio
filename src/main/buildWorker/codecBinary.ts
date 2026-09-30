/**
 * Which content-codec image a desktop target needs, and how to put it in place.
 *
 * Two vocabularies meet here and only look alike. A build target is
 * `<GameBuildDesktopPlatform>-<GameBuildArch>` - `windows-x64`, `macos-arm64` -
 * while the codec package names its images after Node's `process.platform`:
 * `win32-x64`, `darwin-arm64`. The same mismatch has bitten koffi (see
 * `koffiPrebuildDirectories`), so this is a table and a test rather than string
 * surgery.
 *
 * A macOS universal target has no image of its own, and cannot: it is one
 * package that runs on two architectures. It gets a fat one built from the two
 * thin ones (fatMachO.ts), which also happens to be what electron-builder's
 * universal merge needs - it packs the two slices separately and refuses a file
 * that is the same thin image in both. One fat file is already universal in
 * both, so there is nothing to tell it.
 */

import fs from "fs/promises";
import { createRequire } from "module";
import path from "path";
import { archiveReaderPathFor } from "@narraleaf/bindings";
import { unpackAsarPath } from "../utils/asarPath";
import { assertMachOSlice, buildFatMachO, type MachOArch } from "./fatMachO";

/** Studio's platform names against the ones the codec package's directories use. */
const CODEC_PLATFORM_NAMES: Readonly<Record<string, string>> = {
    windows: "win32",
    macos: "darwin",
    linux: "linux",
};

/** The synthetic target name for a macOS package that runs on both architectures. */
export const UNIVERSAL_CODEC_TARGET = "darwin-universal";

/** The two thin images a universal one is assembled from. */
export const UNIVERSAL_CODEC_SLICES = ["darwin-x64", "darwin-arm64"] as const;

/**
 * The codec image a build target needs, or null when the target is not one that
 * loads a codec at all.
 */
export function codecTargetFor(platformKey: string): string | null {
    const separator = platformKey.lastIndexOf("-");
    if (separator <= 0) {
        return null;
    }
    const platform = CODEC_PLATFORM_NAMES[platformKey.slice(0, separator)];
    const arch = platformKey.slice(separator + 1);
    if (!platform || !arch) {
        return null;
    }
    if (arch === "universal") {
        return platform === "darwin" ? UNIVERSAL_CODEC_TARGET : null;
    }
    return `${platform}-${arch}`;
}

/** This machine's image, which is what a compile with no target named wants. */
export function hostCodecTarget(): string {
    return `${process.platform}-${process.arch}`;
}

/**
 * Where a codec build reads `<target>/core.a` - the precompiled half of the
 * codec, which the part generated for this build is linked against. Every
 * caller that compiles a codec passes this; the ones that only copy a prebuilt
 * image do not need it.
 *
 * The codec package answers this itself, relative to its own directory, and is
 * right everywhere except inside a packaged Studio. There it is addressed
 * through `app.asar`, and the archive is the one file it hands to a program that
 * is not this process: the C toolchain is an ordinary OS process, and a path
 * inside an archive Electron mounts is not one the OS can open. Electron's
 * patched `fs` hides that from the package's own existence check, so the failure
 * arrives as whatever the compiler says about an input it cannot read rather
 * than as the missing-archive error the package writes.
 *
 * The unpacked twin is the same bytes at a path anything can open - every
 * node_modules file is on disk there (`asarUnpack` in electron-builder.yml, and
 * `onNodeModuleFile` beside it, which is what keeps `.a` files in the package at
 * all). Outside a packaged build this resolves to a real directory already and
 * changes nothing.
 */
export function codecArchiveDir(): string {
    // `<root>/dist/index.js` -> `<root>`, which is where the package keeps its
    // prebuilds. Resolvable by construction: this module imports the package.
    const packageRoot = path.dirname(path.dirname(createRequire(__filename).resolve("@narraleaf/bindings")));
    return unpackAsarPath(path.join(packageRoot, "prebuilds"));
}

/**
 * One package's copy of the codec, and the images it is made of.
 *
 * Separating the two is what lets a build's binaries be compiled for the title
 * rather than copied: compiling happens per image, in the codec package, which
 * knows nothing about a package that runs on two architectures. So the images
 * are produced first, wherever they come from, and assembled afterwards.
 */
export type CodecPlacement = {
    /** The build target this copy is for. */
    platformKey: string;
    /** Where the shipped copy goes. */
    destination: string;
    /** The codec targets whose images it is made of; two only for a universal package. */
    slices: string[];
};

/** What each target needs, or a throw naming the target nothing is built for. */
export function codecPlacementsFor(
    platformKeys: readonly string[],
    destinationFor: (platformKey: string) => string,
): CodecPlacement[] {
    return platformKeys.map(platformKey => {
        const target = codecTargetFor(platformKey);
        if (!target) {
            throw new Error(`no content codec is built for ${platformKey}`);
        }
        return {
            platformKey,
            destination: destinationFor(platformKey),
            slices: target === UNIVERSAL_CODEC_TARGET ? [...UNIVERSAL_CODEC_SLICES] : [target],
        };
    });
}

/**
 * The architecture a macOS codec image is meant to be, or null for another
 * platform's image, which goes in unexamined.
 */
function macImageArch(slice: string): MachOArch | null {
    switch (slice) {
        case "darwin-x64":
            return "x64";
        case "darwin-arm64":
            return "arm64";
        default:
            return null;
    }
}

/**
 * Put the images at `sources` in place as one shipped copy.
 *
 * A single image is moved as it is; two are wrapped in a fat container, slice for
 * slice, so each keeps the signature it was built with.
 *
 * A macOS image is checked for the architecture its name promises before it is
 * placed, whether it goes in alone or as half of a universal copy. A protected
 * build compiles each image for the title rather than copying a prebuild, so the
 * image is only as right as the compiler was asked to make it - and an image for
 * the wrong Mac is a package that starts on one kind of Mac and not the other.
 */
export async function placeCodecBinary(
    placement: CodecPlacement,
    sources: Readonly<Record<string, string>>,
): Promise<void> {
    // Before the mkdir, not after: a call that refuses its arguments should not
    // have left a directory behind, and the destination is often somewhere the
    // caller has no business creating when the placement was never going to
    // happen. It also keeps the refusal readable - a destination that cannot be
    // created reports the missing image, rather than reporting the mkdir.
    const files = placement.slices.map(slice => {
        const file = sources[slice];
        if (!file) {
            throw new Error(`no ${slice} image was produced for ${placement.platformKey}`);
        }
        return { slice, file };
    });
    if (files.length === 1) {
        const [{ slice, file }] = files;
        const arch = macImageArch(slice);
        if (arch) {
            assertMachOSlice({ name: `the ${slice} codec image`, arch, image: await fs.readFile(file) });
        }
        await fs.mkdir(path.dirname(placement.destination), { recursive: true });
        await fs.copyFile(file, placement.destination);
        return;
    }
    const image = universalImage(await Promise.all(files.map(async ({ slice, file }) => ({
        slice,
        image: await fs.readFile(file),
    }))));
    await fs.mkdir(path.dirname(placement.destination), { recursive: true });
    await fs.writeFile(placement.destination, image);
}

/** Put the prebuilt image for `codecTarget` at `destination`. */
export async function writeSupportBinary(codecTarget: string, destination: string): Promise<void> {
    if (codecTarget !== UNIVERSAL_CODEC_TARGET) {
        await fs.copyFile(archiveReaderPathFor(codecTarget), destination);
        return;
    }
    await fs.writeFile(destination, universalImage(await Promise.all(UNIVERSAL_CODEC_SLICES.map(async slice => ({
        slice,
        image: await fs.readFile(archiveReaderPathFor(slice)),
    })))));
}

/** One universal image from the macOS images named by their codec target. */
function universalImage(images: readonly { slice: string; image: Buffer }[]): Buffer {
    return buildFatMachO(images.map(({ slice, image }) => {
        const arch = macImageArch(slice);
        if (!arch) {
            throw new Error(`${slice} cannot be part of a universal macOS image`);
        }
        return { name: `the ${slice} codec image`, arch, image };
    }));
}
