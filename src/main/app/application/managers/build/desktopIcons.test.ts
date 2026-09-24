import fs from "fs/promises";
import os from "os";
import path from "path";
import zlib from "zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeRgbaPng } from "@shared/utils/pngOpaque";

/**
 * A real PNG per size, so the module under test can decode what the fake `nativeImage` hands it -
 * the `.ico` writer reads samples back out of its own encoder's output, and a placeholder buffer
 * would only prove the mock agrees with itself.
 */
async function square(size: number): Promise<Buffer> {
    const rgba = new Uint8Array(size * size * 4).fill(0x7f);
    return Buffer.from(await encodeRgbaPng(rgba, size, size, data => zlib.deflateSync(data)));
}

const SQUARES = new Map<number, Buffer>();
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    SQUARES.set(size, await square(size));
}

// nativeImage is a main-process API with no standalone implementation; what this module needs from
// it is a size and a resize that answers in PNG bytes, so that is what is faked.
let sourceSize = { width: 1024, height: 1024 };
let sourceIsEmpty = false;
vi.mock("electron", () => ({
    nativeImage: {
        createFromPath: () => ({
            isEmpty: () => sourceIsEmpty,
            getSize: () => sourceSize,
            resize: (options: { width: number; height: number }) => ({
                getSize: () => ({ width: options.width, height: options.height }),
                toPNG: () => SQUARES.get(options.width),
                toBitmap: () => Buffer.alloc(options.width * options.height * 4),
            }),
        }),
        createFromBitmap: (_bitmap: Buffer, options: { width: number; height: number }) => ({
            toPNG: () => SQUARES.get(options.width),
        }),
    },
}));

const { DESKTOP_ICON_DIR, desktopIconExtension, ensureDesktopIcon } = await import("./desktopIcons");

const projects: string[] = [];

afterEach(async () => {
    sourceSize = { width: 1024, height: 1024 };
    sourceIsEmpty = false;
    await Promise.all(projects.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

/** A project directory holding one source icon, named however the case wants it. */
async function project(iconName = "icon.png"): Promise<{ root: string; icon: string }> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-desktop-icons-"));
    projects.push(root);
    const icon = path.join(root, iconName);
    await fs.writeFile(icon, SQUARES.get(1024)!);
    return { root, icon };
}

/** The sizes an .ico declares, read back out of its directory. */
function icoSizes(ico: Buffer): number[] {
    return Array.from({ length: ico.readUInt16LE(4) }, (_unused, index) => ico[6 + index * 16] || 256);
}

/** The chunk types an .icns holds, in file order. */
function icnsTypes(icns: Buffer): string[] {
    const types: string[] = [];
    for (let offset = 8; offset + 8 <= icns.length;) {
        types.push(icns.toString("ascii", offset, offset + 4));
        offset += icns.readUInt32BE(offset + 4);
    }
    return types;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's IHDR, or null when the bytes are not a PNG at all. */
function pngDimensions(data: Buffer): { width: number; height: number } | null {
    if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE) || data.toString("ascii", 12, 16) !== "IHDR") {
        return null;
    }
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** The pixel edge each .icns chunk type stands for, as Apple defines them. */
const ICNS_CHUNK_EDGE: Record<string, number> = {
    ic11: 32, ic12: 64, ic07: 128, ic08: 256, ic13: 256, ic09: 512, ic14: 512, ic10: 1024,
};

describe("desktopIconExtension", () => {
    it("names a container for the two platforms that want one", () => {
        expect(desktopIconExtension("windows")).toBe(".ico");
        expect(desktopIconExtension("macos")).toBe(".icns");
        // Linux's icon "format" is a set of PNGs, which a PNG already satisfies.
        expect(desktopIconExtension("linux")).toBe(null);
    });
});

describe("ensureDesktopIcon", () => {
    it("writes an .ico under the project's build scratch directory", async () => {
        const { root, icon } = await project();

        const result = await ensureDesktopIcon({ sourceIconPath: icon, platform: "windows", projectPath: root });

        expect(result).toEqual({
            iconPath: path.join(root, DESKTOP_ICON_DIR, "windows", "icon.ico"),
            passedThrough: false,
            reused: false,
        });
        expect(icoSizes(await fs.readFile(result.iconPath))).toEqual([16, 24, 32, 48, 64, 128, 256]);
    });

    it("writes an .icns whose chunks cover every size it rendered", async () => {
        const { root, icon } = await project();

        const result = await ensureDesktopIcon({ sourceIconPath: icon, platform: "macos", projectPath: root });

        expect(result.iconPath).toBe(path.join(root, DESKTOP_ICON_DIR, "macos", "icon.icns"));
        expect(icnsTypes(await fs.readFile(result.iconPath)))
            .toEqual(["ic11", "ic12", "ic07", "ic08", "ic13", "ic09", "ic14", "ic10"]);
    });

    it("fills every .ico entry with an image of the size its directory declares", async () => {
        const { root, icon } = await project();
        const ico = await fs.readFile(
            (await ensureDesktopIcon({ sourceIconPath: icon, platform: "windows", projectPath: root })).iconPath,
        );

        for (let index = 0; index < ico.readUInt16LE(4); index++) {
            const entry = 6 + index * 16;
            const size = ico[entry] || 256;
            const data = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8));
            if (size >= 256) {
                expect(pngDimensions(data), `${size} entry`).toEqual({ width: size, height: size });
            } else {
                // A 32-bit DIB whose height counts the colour rows and the AND mask together.
                expect(pngDimensions(data), `${size} entry`).toBe(null);
                expect([data.readUInt32LE(0), data.readInt32LE(4), data.readInt32LE(8), data.readUInt16LE(14)])
                    .toEqual([40, size, size * 2, 32]);
            }
        }
    });

    it("fills every .icns chunk with a PNG of the edge its type stands for", async () => {
        const { root, icon } = await project();
        const icns = await fs.readFile(
            (await ensureDesktopIcon({ sourceIconPath: icon, platform: "macos", projectPath: root })).iconPath,
        );

        expect(icns.toString("ascii", 0, 4)).toBe("icns");
        expect(icns.readUInt32BE(4)).toBe(icns.length);
        let offset = 8;
        while (offset < icns.length) {
            const type = icns.toString("ascii", offset, offset + 4);
            const length = icns.readUInt32BE(offset + 4);
            const edge = ICNS_CHUNK_EDGE[type];
            expect(edge, `chunk ${type}`).toBeDefined();
            expect(pngDimensions(icns.subarray(offset + 8, offset + length)), `chunk ${type}`)
                .toEqual({ width: edge, height: edge });
            offset += length;
        }
        // The chunk lengths account for the file exactly: nothing trails the last one.
        expect(offset).toBe(icns.length);
    });

    it("stops at the source's own size rather than writing a blurry 1024", async () => {
        sourceSize = { width: 512, height: 512 };
        const { root, icon } = await project();

        const result = await ensureDesktopIcon({ sourceIconPath: icon, platform: "macos", projectPath: root });

        expect(icnsTypes(await fs.readFile(result.iconPath))).not.toContain("ic10");
    });

    it("upscales a small source to reach the size the packager insists on", async () => {
        // electron-builder refuses an .ico whose largest image is under 256.
        sourceSize = { width: 128, height: 128 };
        const { root, icon } = await project();

        const result = await ensureDesktopIcon({ sourceIconPath: icon, platform: "windows", projectPath: root });

        expect(icoSizes(await fs.readFile(result.iconPath))).toContain(256);
    });

    it("hands Linux back the PNG it was given", async () => {
        const { root, icon } = await project();

        expect(await ensureDesktopIcon({ sourceIconPath: icon, platform: "linux", projectPath: root }))
            .toEqual({ iconPath: icon, passedThrough: true, reused: false });
    });

    it("passes a source that is already the target format straight through", async () => {
        // `getDefaultGameIconPath` can answer with an .ico, and an author may point the project at
        // a container of their own.
        const { root, icon } = await project("icon.ico");

        expect(await ensureDesktopIcon({ sourceIconPath: icon, platform: "windows", projectPath: root }))
            .toEqual({ iconPath: icon, passedThrough: true, reused: false });
    });

    it("reuses what it wrote last time, and converts again once the source changes", async () => {
        const { root, icon } = await project();
        const first = await ensureDesktopIcon({ sourceIconPath: icon, platform: "windows", projectPath: root });
        expect(first.reused).toBe(false);

        const second = await ensureDesktopIcon({ sourceIconPath: icon, platform: "windows", projectPath: root });
        expect(second).toMatchObject({ iconPath: first.iconPath, reused: true });

        // A different icon of a different length, which is what a rewrite looks like on disk.
        await fs.writeFile(icon, SQUARES.get(512)!);
        const third = await ensureDesktopIcon({ sourceIconPath: icon, platform: "windows", projectPath: root });
        expect(third.reused).toBe(false);
    });

    it("says so rather than writing a container from an icon it could not read", async () => {
        sourceIsEmpty = true;
        const { root, icon } = await project();

        await expect(ensureDesktopIcon({ sourceIconPath: icon, platform: "windows", projectPath: root }))
            .rejects.toThrow(/could not be read/);
    });
});
