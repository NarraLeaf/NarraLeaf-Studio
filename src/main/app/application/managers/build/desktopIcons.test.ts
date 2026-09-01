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
