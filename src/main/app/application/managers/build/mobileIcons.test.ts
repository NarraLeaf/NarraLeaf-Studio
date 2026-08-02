import fs from "fs/promises";
import os from "os";
import path from "path";
import zlib from "zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeOpaquePng, pngHasAlphaChannel } from "@shared/utils/pngOpaque";

// nativeImage is a main-process API with no standalone implementation; the
// resize contract is what this module depends on, so that is what is faked.
let sourceSize = { width: 512, height: 512 };
const resize = vi.fn((options: { width: number; height: number }) => ({
    getSize: () => ({ width: options.width, height: options.height }),
    toBitmap: () => Buffer.alloc(options.width * options.height * 4, 1),
    toPNG: () => Buffer.from(`png:${options.width}x${options.height}`),
}));
vi.mock("electron", () => ({
    nativeImage: {
        createFromPath: (iconPath: string) => ({
            isEmpty: () => iconPath.includes("empty"),
            getSize: () => sourceSize,
            resize,
        }),
        createFromBitmap: (_bitmap: Buffer, options: { width: number; height: number }) => ({
            toPNG: () => Buffer.from(`png:${options.width}x${options.height}:padded`),
        }),
    },
}));

const { readIconSlotSizes, readPngSize, stripAlphaChannel, writeScaledIcons } = await import("./mobileIcons");
const { BufferZipOutput, writeZip } = await import("../../../../buildWorker/mobile/zipWriter");

const tempDirs: string[] = [];

afterEach(async () => {
    resize.mockClear();
    sourceSize = { width: 512, height: 512 };
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

/** A minimal PNG: signature + IHDR carrying the given dimensions. */
function pngOfSize(width: number, height: number): Buffer {
    const bytes = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
    bytes.write("IHDR", 12, "ascii");
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes;
}

/**
 * How Xcode writes the icons it compiles into an app bundle: a private `CgBI`
 * chunk ahead of IHDR. The iOS shell template ships exactly these, so this shape
 * is not hypothetical - it is what every iOS icon slot actually looks like.
 */
function appleOptimizedPngOfSize(width: number, height: number): Buffer {
    const cgbi = Buffer.alloc(16);
    cgbi.writeUInt32BE(4, 0);
    cgbi.write("CgBI", 4, "ascii");
    const png = pngOfSize(width, height);
    return Buffer.concat([png.subarray(0, 8), cgbi, png.subarray(8)]);
}

async function makeTemplateZip(entries: Record<string, Buffer>): Promise<Buffer> {
    const output = new BufferZipOutput();
    await writeZip(
        output,
        Object.entries(entries).map(([name, data]) => ({ name, source: { kind: "buffer" as const, data } })),
        { mtime: new Date(Date.UTC(2020, 0, 1)), allowZip64: false },
    );
    return output.toBuffer();
}

describe("readPngSize", () => {
    it("reads dimensions from the IHDR chunk", () => {
        expect(readPngSize(pngOfSize(144, 144))).toEqual({ width: 144, height: 144 });
    });

    it("reads dimensions past a chunk that precedes IHDR", () => {
        // The iOS template's slots all look like this; treating them as
        // unreadable failed every iOS build that configured an app icon.
        expect(readPngSize(appleOptimizedPngOfSize(120, 120))).toEqual({ width: 120, height: 120 });
    });

    it("rejects anything that is not a readable PNG", () => {
        expect(readPngSize(Buffer.alloc(24))).toBeNull();
        expect(readPngSize(Buffer.from("too short"))).toBeNull();
        expect(readPngSize(pngOfSize(0, 10))).toBeNull();
    });

    it("stops rather than looping on a chunk length past the end of the file", () => {
        const truncated = Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.from([0xff, 0xff, 0xff, 0xff]),
            Buffer.from("junk", "ascii"),
        ]);
        expect(readPngSize(truncated)).toBeNull();
    });
});

describe("readIconSlotSizes", () => {
    it("takes each slot's size from the template's own placeholder", async () => {
        // The whole point: the density→pixels mapping stays in the shell repo.
        // Studio reads what it is replacing instead of hardcoding "xxhdpi = 144".
        const zip = await makeTemplateZip({
            "res/mipmap-mdpi-v4/ic_launcher.png": pngOfSize(48, 48),
            "res/mipmap-xxhdpi-v4/ic_launcher.png": pngOfSize(144, 144),
        });
        expect(readIconSlotSizes(zip, ["res/mipmap-mdpi-v4/ic_launcher.png", "res/mipmap-xxhdpi-v4/ic_launcher.png"]))
            .toEqual([
                { slot: "res/mipmap-mdpi-v4/ic_launcher.png", width: 48, height: 48 },
                { slot: "res/mipmap-xxhdpi-v4/ic_launcher.png", width: 144, height: 144 },
            ]);
    });

    it("resolves slots under an entry prefix (the iOS .app dir)", async () => {
        const zip = await makeTemplateZip({ "Shell.app/AppIcon60x60@2x.png": pngOfSize(120, 120) });
        expect(readIconSlotSizes(zip, ["AppIcon60x60@2x.png"], "Shell.app/"))
            .toEqual([{ slot: "AppIcon60x60@2x.png", width: 120, height: 120 }]);
    });

    it("refuses a declared slot the template does not hold", async () => {
        // Manifest and template disagreeing must not silently ship the
        // placeholder icon the author meant to replace.
        const zip = await makeTemplateZip({ "res/mipmap-mdpi-v4/ic_launcher.png": pngOfSize(48, 48) });
        expect(() => readIconSlotSizes(zip, ["res/mipmap-hdpi-v4/ic_launcher.png"]))
            .toThrow(/missing from the template/);
    });

    it("refuses a slot that is not a readable PNG", async () => {
        const zip = await makeTemplateZip({ "res/mipmap-mdpi-v4/ic_launcher.png": Buffer.from("not a png") });
        expect(() => readIconSlotSizes(zip, ["res/mipmap-mdpi-v4/ic_launcher.png"])).toThrow(/not a readable PNG/);
    });
});

describe("writeScaledIcons", () => {
    it("scales the icon to every slot's size and maps slot to file", async () => {
        const outputDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "nls-icons-")), "out");
        tempDirs.push(path.dirname(outputDir));
        const written = await writeScaledIcons("/project/icon.png", [
            { slot: "res/mipmap-mdpi-v4/ic_launcher.png", width: 48, height: 48 },
            { slot: "res/mipmap-xxhdpi-v4/ic_launcher.png", width: 144, height: 144 },
        ], outputDir);

        expect(resize).toHaveBeenCalledWith({ width: 48, height: 48, quality: "good" });
        expect(resize).toHaveBeenCalledWith({ width: 144, height: 144, quality: "good" });
        expect(Object.keys(written)).toEqual([
            "res/mipmap-mdpi-v4/ic_launcher.png",
            "res/mipmap-xxhdpi-v4/ic_launcher.png",
        ]);
        expect(await fs.readFile(written["res/mipmap-mdpi-v4/ic_launcher.png"], "utf8")).toBe("png:48x48");
        expect(await fs.readFile(written["res/mipmap-xxhdpi-v4/ic_launcher.png"], "utf8")).toBe("png:144x144");
    });

    it("keeps same-named slots from different densities apart", async () => {
        // Every Android density uses the file name ic_launcher.png; flattening
        // the zip path without disambiguating would have them overwrite each
        // other and ship one size everywhere.
        const outputDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "nls-icons-")), "out");
        tempDirs.push(path.dirname(outputDir));
        const written = await writeScaledIcons("/project/icon.png", [
            { slot: "res/mipmap-mdpi-v4/ic_launcher.png", width: 48, height: 48 },
            { slot: "res/mipmap-xxhdpi-v4/ic_launcher.png", width: 144, height: 144 },
        ], outputDir);
        const paths = Object.values(written);
        expect(new Set(paths).size).toBe(paths.length);
    });

    it("fails loudly when the icon cannot be read", async () => {
        const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-icons-"));
        tempDirs.push(outputDir);
        await expect(writeScaledIcons("/project/empty.png", [], outputDir)).rejects.toThrow(/could not be read/);
    });

    it("letterboxes a non-square source instead of stretching it to the slot", async () => {
        // Handing resize both a width and a height makes it resize to exactly
        // those, so this used to ship a squashed logo with nothing to say so.
        sourceSize = { width: 1000, height: 500 };
        const outputDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "nls-icons-")), "out");
        tempDirs.push(path.dirname(outputDir));
        const written = await writeScaledIcons("/project/wide.png", [
            { slot: "res/mipmap-xxhdpi-v4/ic_launcher.png", width: 144, height: 144 },
        ], outputDir);

        expect(resize).toHaveBeenCalledWith({ width: 144, height: 72, quality: "good" });
        expect(await fs.readFile(written["res/mipmap-xxhdpi-v4/ic_launcher.png"], "utf8")).toBe("png:144x144:padded");
    });

    it("fits a tall source by its long edge", async () => {
        sourceSize = { width: 500, height: 1000 };
        const outputDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "nls-icons-")), "out");
        tempDirs.push(path.dirname(outputDir));
        await writeScaledIcons("/project/tall.png", [
            { slot: "res/mipmap-mdpi-v4/ic_launcher.png", width: 48, height: 48 },
        ], outputDir);

        expect(resize).toHaveBeenCalledWith({ width: 24, height: 48, quality: "good" });
    });

    it("strips the alpha channel an opaque target must not carry", async () => {
        // nativeImage.toPNG() always encodes RGBA, so an iOS icon that arrives
        // alpha-free would otherwise leave with a channel again - and be
        // rejected on upload for having one.
        const rgba = new Uint8Array(4 * 4 * 4).fill(200);
        for (let i = 3; i < rgba.length; i += 4) {
            rgba[i] = 255;
        }
        const opaquePng = Buffer.from(await encodeOpaquePng(rgba, 4, 4, bytes => zlib.deflateSync(bytes)));
        const withAlpha = Buffer.from(opaquePng);
        // Colour type 6 is what the real encoder emits; the helper only reads it.
        expect(pngHasAlphaChannel(opaquePng)).toBe(false);
        withAlpha[25] = 6;
        expect(pngHasAlphaChannel(withAlpha)).toBe(true);
        expect(pngHasAlphaChannel(await stripAlphaChannel(opaquePng))).toBe(false);
    });

    it("leaves a PNG that already has no alpha channel untouched", async () => {
        const rgba = new Uint8Array(2 * 2 * 4).fill(120);
        const png = Buffer.from(await encodeOpaquePng(rgba, 2, 2, bytes => zlib.deflateSync(bytes)));
        expect((await stripAlphaChannel(png)).equals(png)).toBe(true);
    });

    it("takes the direct path when the source is already square", async () => {
        const outputDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "nls-icons-")), "out");
        tempDirs.push(path.dirname(outputDir));
        const written = await writeScaledIcons("/project/icon.png", [
            { slot: "res/mipmap-mdpi-v4/ic_launcher.png", width: 48, height: 48 },
        ], outputDir);

        expect(await fs.readFile(written["res/mipmap-mdpi-v4/ic_launcher.png"], "utf8")).toBe("png:48x48");
    });
});
