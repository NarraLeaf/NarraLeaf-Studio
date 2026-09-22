import { describe, expect, it } from "vitest";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { assertMachOSlice, buildFatMachO, machOKind, thinMachOArch, type MachOArch } from "./fatMachO";

const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;

/** A thin 64-bit Mach-O as far as its header goes, with a recognisable body. */
function thinImage(cpuType: number, body: string, cpuSubtype = 3): Buffer {
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(cpuType, 4);
    header.writeUInt32LE(cpuSubtype, 8);
    return Buffer.concat([header, Buffer.from(body, "utf-8")]);
}

function slice(arch: MachOArch, image: Buffer) {
    return { name: `the ${arch} test image`, arch, image };
}

describe("machOKind", () => {
    it("tells a thin image from a universal one from anything else", () => {
        expect(machOKind(thinImage(CPU_TYPE_ARM64, "x"))).toBe("thin");
        const thin32 = Buffer.alloc(8);
        thin32.writeUInt32LE(0xfeedface, 0);
        expect(machOKind(thin32)).toBe("thin");

        const fat = Buffer.alloc(8);
        fat.writeUInt32BE(0xcafebabe, 0);
        expect(machOKind(fat)).toBe("fat");
        fat.writeUInt32BE(0xcafebabf, 0);
        expect(machOKind(fat)).toBe("fat");

        expect(machOKind(Buffer.from("#!/bin/sh\necho hi\n"))).toBeNull();
        expect(machOKind(Buffer.from("MZ\x90\x00\x03\x00\x00\x00"))).toBeNull();
        expect(machOKind(Buffer.alloc(4))).toBeNull();
    });
});

describe("thinMachOArch", () => {
    it("reads the architecture off a thin image", () => {
        expect(thinMachOArch(thinImage(CPU_TYPE_X86_64, "x"))).toBe("x64");
        expect(thinMachOArch(thinImage(CPU_TYPE_ARM64, "x"))).toBe("arm64");
        expect(thinMachOArch(thinImage(0x00000007, "x"))).toBe("other");
        expect(thinMachOArch(Buffer.from("not an image at all"))).toBeNull();
    });

    /*
     * The prebuilds a universal game's koffi is made of, read as they ship in the package. If koffi
     * ever put the wrong image under a directory name, every universal build would refuse it, and
     * this says so first and says which.
     */
    it("finds koffi's two macOS prebuilds to be the architectures they are named for", () => {
        const koffiRoot = path.dirname(createRequire(__filename).resolve("koffi/package.json"));
        for (const arch of ["x64", "arm64"] as const) {
            const image = fs.readFileSync(path.join(koffiRoot, "build", "koffi", `darwin_${arch}`, "koffi.node"));
            expect(thinMachOArch(image), `darwin_${arch}`).toBe(arch);
        }
    });
});

describe("buildFatMachO", () => {
    it("writes a big-endian header and each slice unchanged at an aligned offset", () => {
        const x64 = thinImage(CPU_TYPE_X86_64, "x86_64 body", 3);
        const arm64 = thinImage(CPU_TYPE_ARM64, "arm64 body, a little longer", 0);
        const image = buildFatMachO([slice("x64", x64), slice("arm64", arm64)]);

        expect(image.readUInt32BE(0)).toBe(0xcafebabe);
        expect(image.readUInt32BE(4)).toBe(2);
        expect(machOKind(image)).toBe("fat");

        for (const [index, thin] of [x64, arm64].entries()) {
            const at = 8 + 20 * index;
            const offset = image.readUInt32BE(at + 8);
            const size = image.readUInt32BE(at + 12);
            const align = image.readUInt32BE(at + 16);
            // Type and subtype come off the slice, so the loader picks the slice the header names.
            expect(image.readUInt32BE(at)).toBe(thin.readUInt32LE(4));
            expect(image.readUInt32BE(at + 4)).toBe(thin.readUInt32LE(8));
            expect(offset % (1 << align)).toBe(0);
            expect(size).toBe(thin.length);
            expect(image.subarray(offset, offset + size).equals(thin)).toBe(true);
        }
    });

    it("assembles koffi's real prebuilds into one image holding both", () => {
        const koffiRoot = path.dirname(createRequire(__filename).resolve("koffi/package.json"));
        const read = (arch: MachOArch) =>
            fs.readFileSync(path.join(koffiRoot, "build", "koffi", `darwin_${arch}`, "koffi.node"));
        const image = buildFatMachO([slice("x64", read("x64")), slice("arm64", read("arm64"))]);

        expect(image.readUInt32BE(4)).toBe(2);
        expect([image.readUInt32BE(8), image.readUInt32BE(28)]).toEqual([CPU_TYPE_X86_64, CPU_TYPE_ARM64]);
    });

    /*
     * The refusals are the reason this checks at all. A universal file holding the wrong image is a
     * well-formed file: it packs, it merges, it signs, and it fails on one kind of Mac only, for a
     * player. Each refusal names the image so the build log says which one was wrong.
     */
    it("refuses an image built for the other architecture, by name", () => {
        const arm64 = thinImage(CPU_TYPE_ARM64, "arm64 body");
        expect(() => buildFatMachO([slice("x64", arm64), slice("arm64", arm64)]))
            .toThrow("the x64 test image should be an x64 image, but it is built for arm64");
    });

    it("refuses two images of one architecture", () => {
        const x64 = thinImage(CPU_TYPE_X86_64, "x86_64 body");
        expect(() => buildFatMachO([slice("x64", x64), slice("x64", x64)])).toThrow(/both x64/);
    });

    it("refuses something that is not a thin image, a universal one included", () => {
        const universal = buildFatMachO([
            slice("x64", thinImage(CPU_TYPE_X86_64, "a")),
            slice("arm64", thinImage(CPU_TYPE_ARM64, "b")),
        ]);
        expect(() => assertMachOSlice(slice("arm64", universal))).toThrow(/not a single-architecture Mach-O image/);
        expect(() => assertMachOSlice(slice("x64", Buffer.from("MZ fake executable"))))
            .toThrow(/not a single-architecture Mach-O image/);
    });
});
