import { describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { runtimeSupportPathFor } from "@narraleaf/encryption";
import {
    codecTargetFor,
    hostCodecTarget,
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
});

describe("writeSupportBinary", () => {
    it("copies the image for a target that has one", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codec-"));
        try {
            const destination = path.join(dir, "bindings.node");
            await writeSupportBinary("linux-x64", destination);
            const written = await fs.readFile(destination);
            const source = await fs.readFile(runtimeSupportPathFor("linux-x64"));
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
                const thin = await fs.readFile(runtimeSupportPathFor(slice));
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
