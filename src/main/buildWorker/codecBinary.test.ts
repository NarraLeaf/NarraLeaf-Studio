import { describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { archiveReaderPathFor } from "@narraleaf/bindings";
import { GAME_BUILD_ARCHS_BY_PLATFORM } from "@shared/types/gameBuild";
import {
    codecPlacementsFor,
    codecTargetFor,
    hostCodecTarget,
    placeCodecBinary,
    UNIVERSAL_CODEC_SLICES,
    UNIVERSAL_CODEC_TARGET,
    writeSupportBinary,
} from "./codecBinary";

describe("codecTargetFor", () => {
    it("translates every desktop target a build can ask for", () => {
        expect(codecTargetFor("windows-x64")).toBe("win32-x64");
        expect(codecTargetFor("windows-arm64")).toBe("win32-arm64");
        expect(codecTargetFor("macos-x64")).toBe("darwin-x64");
        expect(codecTargetFor("macos-arm64")).toBe("darwin-arm64");
        expect(codecTargetFor("linux-x64")).toBe("linux-x64");
        expect(codecTargetFor("linux-arm64")).toBe("linux-arm64");
    });

    it("answers the universal target with the one image that serves both slices", () => {
        expect(codecTargetFor("macos-universal")).toBe(UNIVERSAL_CODEC_TARGET);
    });

    // The point of a table: a key it does not know is answered with null and the
    // caller fails by name, rather than a plausible directory that holds nothing.
    it("does not invent a name for a target it has no image for", () => {
        expect(codecTargetFor("android-arm64")).toBeNull();
        expect(codecTargetFor("windows-universal")).toBeNull();
        expect(codecTargetFor("windows")).toBeNull();
        expect(codecTargetFor("")).toBeNull();
    });

    it("names this machine the way the package names its directories", () => {
        expect(hostCodecTarget()).toBe(`${process.platform}-${process.arch}`);
    });

    /*
     * Driven off the list the build dialog offers rather than a list written
     * here, because the two drifting apart is the failure: the codec package
     * shipped four images while Studio offered six desktop targets, and a
     * protected build for either arm64 desktop had nothing to ship. Nothing said
     * so - the compiler asked for the host's image and got it.
     */
    it("has a real image for every desktop target a build can be asked for", async () => {
        for (const [platform, archs] of Object.entries(GAME_BUILD_ARCHS_BY_PLATFORM)) {
            for (const arch of archs) {
                const key = `${platform}-${arch}`;
                const target = codecTargetFor(key);
                expect(target, `no codec target for ${key}`).not.toBeNull();
                if (target === UNIVERSAL_CODEC_TARGET) {
                    for (const slice of UNIVERSAL_CODEC_SLICES) {
                        await expect(fs.access(archiveReaderPathFor(slice))).resolves.toBeUndefined();
                    }
                } else {
                    await expect(fs.access(archiveReaderPathFor(target as string))).resolves.toBeUndefined();
                }
            }
        }
    });
});

describe("codecPlacementsFor", () => {
    it("gives each target one copy, made of one image", () => {
        expect(codecPlacementsFor(["windows-x64", "linux-arm64"], key => `/out/${key}/bindings.node`)).toEqual([
            { platformKey: "windows-x64", destination: "/out/windows-x64/bindings.node", slices: ["win32-x64"] },
            { platformKey: "linux-arm64", destination: "/out/linux-arm64/bindings.node", slices: ["linux-arm64"] },
        ]);
    });

    // The reason placements exist at all: compiling happens per image, and a
    // universal package is one copy made of two.
    it("gives a universal package one copy made of two images", () => {
        const [placement] = codecPlacementsFor(["macos-universal"], () => "/out/bindings.node");
        expect(placement.slices).toEqual([...UNIVERSAL_CODEC_SLICES]);
    });

    it("refuses by name rather than inventing a directory", () => {
        expect(() => codecPlacementsFor(["android-arm64"], () => "/out")).toThrow(/android-arm64/);
    });
});

describe("placeCodecBinary", () => {
    it("assembles a universal copy from the images produced for it", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codec-place-"));
        try {
            const images: Record<string, string> = {};
            for (const slice of UNIVERSAL_CODEC_SLICES) {
                images[slice] = path.join(dir, slice);
                await fs.copyFile(archiveReaderPathFor(slice), images[slice]);
            }
            const destination = path.join(dir, "shipped", "bindings.node");
            await placeCodecBinary(
                { platformKey: "macos-universal", destination, slices: [...UNIVERSAL_CODEC_SLICES] },
                images,
            );
            const image = await fs.readFile(destination);
            expect(image.readUInt32BE(0)).toBe(0xcafebabe);
            expect(image.readUInt32BE(4)).toBe(2);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    // The failure this replaces would have been a package shipping whatever
    // happened to be at that path, which is how the original defect looked.
    it("refuses when an image it needs was not produced", async () => {
        await expect(placeCodecBinary(
            { platformKey: "windows-x64", destination: "/out/bindings.node", slices: ["win32-x64"] },
            {},
        )).rejects.toThrow(/win32-x64/);
    });
});

describe("writeSupportBinary", () => {
    it("copies the image for a target that has one", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codec-"));
        try {
            const destination = path.join(dir, "bindings.node");
            await writeSupportBinary("linux-x64", destination);
            const written = await fs.readFile(destination);
            const source = await fs.readFile(archiveReaderPathFor("linux-x64"));
            expect(written.equals(source)).toBe(true);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    /*
     * The universal image, checked as a container rather than by loading it -
     * only a macOS machine could load it, and this has to hold everywhere the
     * build runs. Each slice going in unchanged is the property that matters:
     * a Mach-O signature covers its own slice, and the arm64 one is ad-hoc
     * signed at build time.
     */
    it("assembles a fat image whose slices are the thin ones, byte for byte", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codec-fat-"));
        try {
            const destination = path.join(dir, "bindings.node");
            await writeSupportBinary(UNIVERSAL_CODEC_TARGET, destination);
            const image = await fs.readFile(destination);

            expect(image.readUInt32BE(0)).toBe(0xcafebabe);
            expect(image.readUInt32BE(4)).toBe(UNIVERSAL_CODEC_SLICES.length);

            for (const [index, slice] of UNIVERSAL_CODEC_SLICES.entries()) {
                const thin = await fs.readFile(archiveReaderPathFor(slice));
                const at = 8 + 20 * index;
                const cputype = image.readUInt32BE(at);
                const offset = image.readUInt32BE(at + 8);
                const size = image.readUInt32BE(at + 12);
                const align = image.readUInt32BE(at + 16);

                expect(cputype).toBe(thin.readUInt32LE(4));
                expect(size).toBe(thin.length);
                expect(offset % (1 << align)).toBe(0);
                expect(image.subarray(offset, offset + size).equals(thin)).toBe(true);
            }

            // The two slices are for different machines, which is the whole point.
            expect(image.readUInt32BE(8)).not.toBe(image.readUInt32BE(28));
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
