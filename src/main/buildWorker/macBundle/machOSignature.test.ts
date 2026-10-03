import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { buildFatMachO } from "../fatMachO";
import { syntheticMachO, syntheticUniversal } from "./macBundleFixtures";
import {
    adHocDesignatedRequirement,
    adHocSignMachO,
    EMPTY_REQUIREMENTS_BLOB,
    embedsInfoPlist,
    isMachO,
    looseCodeIdentifier,
} from "./machOSignature";

/*
 * The pinned digests are of codesign's own output for the same synthetic input
 * (`codesign --sign - --force --preserve-metadata=entitlements,requirements,flags,runtime`,
 * macOS 15.7 on Apple silicon), with the file named as the test names it - the name is part of
 * the identifier. See macBundleFixtures.ts before changing an input.
 */
const APPLE = {
    arm64exe: { sha256: "4151076b2b8b64f4734913e542d34ec00327ab8d1252f353a8187732f6ff2937", cdhash: "5c8639c0d5d3bfd771dc66f58975c574f6f034da" },
    x64exe: { sha256: "d4bcae6464ed26d966330041d7de0b2f0c09047177c486dc31c4db640408dc1e", cdhash: "0fb6ead7aed626d0dc3a46ebb244faada54b7414" },
    linked: { sha256: "45b560c0929fd2a36a1d5196716a99ddfb5b0481d710cfb96b341da41141ee4e", cdhash: "33d9f56944da0a73e3ac5f8ff508b8ad7e1e9e59" },
    fat: { sha256: "5d2e13b0a173826a6032148326ffd9316bec17f19dd78147f0572d157b1e2fd5", cdhash: "d466fe65dba3cc4f8862cce321da65c440348b48" },
    nouuid: { sha256: "7cb0368c8d3fabd2f360fdc9752a3e898d6197b70eb642a9df6df4057a0b3555" },
    dotted: { sha256: "69beeabf2a0b4177d78138664a8215a3c236a109fe5a4f47b05a2d69513d2972" },
};

const sha256 = (data: Buffer): string => crypto.createHash("sha256").update(data).digest("hex");
const REQUIREMENTS_HASH = crypto.createHash("sha256").update(EMPTY_REQUIREMENTS_BLOB).digest();
const LOOSE_SLOTS = [null, REQUIREMENTS_HASH];

/** Sign as codesign signs a file with no Info.plist called `fileName`. */
function signLoose(fileName: string, image: Buffer) {
    return adHocSignMachO(image, looseCodeIdentifier(fileName, image), LOOSE_SLOTS);
}

/** The few header fields the signature changes, read back. */
function signatureLayout(image: Buffer) {
    const ncmds = image.readUInt32LE(16);
    let offset = 32;
    const found: Record<string, number | bigint> = { ncmds, sizeofcmds: image.readUInt32LE(20) };
    for (let index = 0; index < ncmds; index++) {
        const cmd = image.readUInt32LE(offset);
        if (cmd === 0x1d) {
            found.dataoff = image.readUInt32LE(offset + 8);
            found.datasize = image.readUInt32LE(offset + 12);
        }
        if (cmd === 0x19 && image.toString("latin1", offset + 8, offset + 18) === "__LINKEDIT") {
            found.linkeditVmsize = image.readBigUInt64LE(offset + 32);
            found.linkeditFileoff = image.readBigUInt64LE(offset + 40);
            found.linkeditFilesize = image.readBigUInt64LE(offset + 48);
        }
        offset += image.readUInt32LE(offset + 4);
    }
    return found;
}

/** The CodeDirectory of a thin signed image. */
function codeDirectory(image: Buffer): Buffer {
    const dataoff = Number(signatureLayout(image).dataoff);
    const cd = dataoff + image.readUInt32BE(dataoff + 16);
    return image.subarray(cd, cd + image.readUInt32BE(cd + 4));
}

describe("adHocSignMachO on a thin image", () => {
    it("adds a signature command to an unsigned image and puts the signature at the end, rounded to 16", () => {
        const input = syntheticMachO({ arch: "x64", seed: "b" });
        const before = signatureLayout(input);
        expect(before.dataoff).toBeUndefined();

        const signed = signLoose("x64exe", input);
        const after = signatureLayout(signed.image);
        expect(after.ncmds).toBe(Number(before.ncmds) + 1);
        expect(after.sizeofcmds).toBe(Number(before.sizeofcmds) + 16);
        expect(after.dataoff).toBe(Math.ceil(input.length / 16) * 16);
        expect(signed.image.length).toBe(Number(after.dataoff) + Number(after.datasize));
        // __LINKEDIT grows to the end of the file, and its memory size goes to 16 KB even on x86_64.
        expect(after.linkeditFilesize).toBe(BigInt(signed.image.length) - BigInt(after.linkeditFileoff));
        expect(Number(after.linkeditVmsize) % 0x4000).toBe(0);

        expect(sha256(signed.image)).toBe(APPLE.x64exe.sha256);
        expect(signed.cdhash.toString("hex")).toBe(APPLE.x64exe.cdhash);
    });

    it("signs an unsigned arm64 executable as codesign does", () => {
        const signed = signLoose("arm64exe", syntheticMachO({ arch: "arm64", seed: "a" }));
        expect(sha256(signed.image)).toBe(APPLE.arm64exe.sha256);
        expect(signed.cdhash.toString("hex")).toBe(APPLE.arm64exe.cdhash);
    });

    it("replaces a linker signature where it stands, dropping the linker-signed flag", () => {
        const input = syntheticMachO({ arch: "arm64", seed: "c", fileType: "dylib", linkerSigned: true });
        const signed = signLoose("arm64linked.dylib", input);
        expect(signatureLayout(signed.image).dataoff).toBe(signatureLayout(input).dataoff);
        expect(signatureLayout(signed.image).ncmds).toBe(signatureLayout(input).ncmds);
        expect(codeDirectory(signed.image).readUInt32BE(12)).toBe(0x2);
        expect(sha256(signed.image)).toBe(APPLE.linked.sha256);
        expect(signed.cdhash.toString("hex")).toBe(APPLE.linked.cdhash);
    });

    it("changes nothing when it re-signs its own output, as codesign changes nothing re-signing its own", () => {
        const once = signLoose("arm64exe", syntheticMachO({ arch: "arm64", seed: "a" }));
        const twice = signLoose("arm64exe", once.image);
        expect(twice.image.equals(once.image)).toBe(true);
    });

    it("hashes the special slots it is given below the code hashes, slot -1 nearest", () => {
        const info = Buffer.alloc(32, 0x11);
        const resources = Buffer.alloc(32, 0x33);
        const signed = adHocSignMachO(syntheticMachO({ arch: "arm64", seed: "a" }), "com.example.slots", [info, REQUIREMENTS_HASH, resources]);
        const cd = codeDirectory(signed.image);
        const hashOffset = cd.readUInt32BE(16);
        expect(cd.readUInt32BE(24)).toBe(3);
        expect(cd.subarray(hashOffset - 32, hashOffset).equals(info)).toBe(true);
        expect(cd.subarray(hashOffset - 64, hashOffset - 32).equals(REQUIREMENTS_HASH)).toBe(true);
        expect(cd.subarray(hashOffset - 96, hashOffset - 64).equals(resources)).toBe(true);
        expect(cd.toString("utf8", 88, 88 + "com.example.slots".length)).toBe("com.example.slots");
        expect(signed.cdhash.equals(crypto.createHash("sha256").update(cd).digest().subarray(0, 20))).toBe(true);
    });
});

describe("adHocSignMachO on a universal image", () => {
    const fatSlices = (image: Buffer) => Array.from({ length: image.readUInt32BE(4) }, (_, index) => {
        const at = 8 + index * 20;
        const offset = image.readUInt32BE(at + 8);
        return {
            cpuType: image.readUInt32BE(at),
            offset,
            align: image.readUInt32BE(at + 16),
            image: image.subarray(offset, offset + image.readUInt32BE(at + 12)),
        };
    });

    it("signs every slice and lays them out on 16 KB in the order they came", () => {
        const input = syntheticUniversal("d");
        const signed = signLoose("fat", input);
        const slices = fatSlices(signed.image);
        expect(slices.map(slice => slice.cpuType)).toEqual([0x01000007, 0x0100000c]);
        expect(slices.map(slice => slice.align)).toEqual([14, 14]);
        expect(slices[0].offset).toBe(0x4000);
        expect(slices[1].offset).toBe(Math.ceil((slices[0].offset + slices[0].image.length) / 0x4000) * 0x4000);
        expect(signed.image.length).toBe(slices[1].offset + slices[1].image.length);

        expect(sha256(signed.image)).toBe(APPLE.fat.sha256);
        // The cdhash a parent records is the arm64 slice's; the requirement names both.
        const sliceHash = (slice: { image: Buffer }) => crypto.createHash("sha256").update(codeDirectory(slice.image)).digest().subarray(0, 20);
        expect(signed.cdhash.toString("hex")).toBe(APPLE.fat.cdhash);
        expect(signed.cdhash.equals(sliceHash(slices[1]))).toBe(true);
        expect(signed.cdhashes.map(hash => hash.toString("hex"))).toEqual([sliceHash(slices[1]), sliceHash(slices[0])].map(hash => hash.toString("hex")));
        expect(adHocDesignatedRequirement(signed)).toBe(
            `cdhash H"${sliceHash(slices[1]).toString("hex")}" or cdhash H"${sliceHash(slices[0]).toString("hex")}"`,
        );
    });

    it("comes out the same whatever alignment the slices went in with", () => {
        const input = syntheticUniversal("d");
        const thin = fatSlices(input).map(slice => slice.image);
        // lipo's layout for these two: x86_64 on 4 KB (2^12), arm64 on 16 KB.
        const placements = [{ offset: 0x1000, align: 12 }];
        placements.push({ offset: Math.ceil((0x1000 + thin[0].length) / 0x4000) * 0x4000, align: 14 });
        const lipoStyle = Buffer.alloc(placements[1].offset + thin[1].length);
        lipoStyle.writeUInt32BE(0xcafebabe, 0);
        lipoStyle.writeUInt32BE(2, 4);
        placements.forEach(({ offset, align }, index) => {
            const at = 8 + index * 20;
            lipoStyle.writeUInt32BE(thin[index].readUInt32LE(4), at);
            lipoStyle.writeUInt32BE(thin[index].readUInt32LE(8), at + 4);
            lipoStyle.writeUInt32BE(offset, at + 8);
            lipoStyle.writeUInt32BE(thin[index].length, at + 12);
            lipoStyle.writeUInt32BE(align, at + 16);
            thin[index].copy(lipoStyle, offset);
        });
        expect(lipoStyle.equals(input)).toBe(false);
        expect(signLoose("fat", lipoStyle).image.equals(signLoose("fat", input).image)).toBe(true);
    });

    it("keeps an arm64-first container arm64-first, and still answers with the arm64 slice", () => {
        const x64 = syntheticMachO({ arch: "x64", seed: "d:x64" });
        const arm64 = syntheticMachO({ arch: "arm64", seed: "d:arm64", linkerSigned: true });
        const reversed = buildFatMachO([{ name: "arm64", arch: "arm64", image: arm64 }, { name: "x64", arch: "x64", image: x64 }]);
        const signed = signLoose("fat", reversed);
        const slices = fatSlices(signed.image);
        expect(slices.map(slice => slice.cpuType)).toEqual([0x0100000c, 0x01000007]);
        expect(signed.cdhash.toString("hex")).toBe(APPLE.fat.cdhash);
    });
});

describe("looseCodeIdentifier", () => {
    it("is the file name without its extension, then \"UUID\" and the LC_UUID in hex", () => {
        const image = syntheticMachO({ arch: "arm64", seed: "a" });
        const uuid = crypto.createHash("sha256").update("a:uuid:0").digest().subarray(0, 16).toString("hex");
        expect(looseCodeIdentifier("arm64exe", image)).toBe(`arm64exe-55554944${uuid}`);
        expect(looseCodeIdentifier("libfoo.dylib", image)).toBe(`libfoo-55554944${uuid}`);
    });

    it("leaves a name that still has a dot in it alone", () => {
        const image = syntheticMachO({ arch: "arm64", seed: "f" });
        expect(looseCodeIdentifier("a.b.c", image)).toBe("a.b");
        expect(sha256(signLoose("a.b.c", image).image)).toBe(APPLE.dotted.sha256);
    });

    it("hashes the 32-bit-sized header and the load commands of an image with no UUID", () => {
        const image = syntheticMachO({ arch: "x64", seed: "e", uuid: false });
        expect(looseCodeIdentifier("nouuid", image)).toBe("nouuid-e9186721a096cc8965b21c3170294e0860deb9a6");
        expect(sha256(signLoose("nouuid", image).image)).toBe(APPLE.nouuid.sha256);
    });

    it("takes a universal image's UUID from its arm64 slice", () => {
        const fat = syntheticUniversal("d");
        expect(looseCodeIdentifier("fat", fat)).toBe(looseCodeIdentifier("fat", syntheticMachO({ arch: "arm64", seed: "d:arm64", linkerSigned: true })));
    });
});

describe("isMachO", () => {
    it("knows thin and universal images and is not fooled by a Java class file", () => {
        expect(isMachO(syntheticMachO({ arch: "arm64", seed: "a" }))).toBe(true);
        expect(isMachO(syntheticUniversal("d"))).toBe(true);
        expect(isMachO(Buffer.from("cafebabe00000034", "hex"))).toBe(false);
        expect(isMachO(Buffer.from("#!/bin/sh\necho hi\n"))).toBe(false);
        expect(isMachO(Buffer.alloc(4))).toBe(false);
    });
});

describe("what codesign would sign differently is refused", () => {
    it("refuses a deployment target old enough to get a SHA-1 code directory", () => {
        expect(() => signLoose("old", syntheticMachO({ arch: "x64", seed: "b", minMacOS: 0x000a0b00 }))).toThrow(/SHA-1/);
        expect(() => signLoose("ok", syntheticMachO({ arch: "x64", seed: "b", minMacOS: 0x000a0b04 }))).not.toThrow();
    });

    it("refuses a signature carrying entitlements or flags --preserve-metadata would keep", () => {
        const linked = syntheticMachO({ arch: "arm64", seed: "c", fileType: "dylib", linkerSigned: true });
        const dataoff = Number(signatureLayout(linked).dataoff);

        const runtime = Buffer.from(linked);
        runtime.writeUInt32BE(0x10002, dataoff + 20 + 12);
        expect(() => signLoose("runtime", runtime)).toThrow(/flags 0x10002/);

        const entitled = Buffer.from(linked);
        entitled.writeUInt32BE(5, dataoff + 12);
        expect(() => signLoose("entitled", entitled)).toThrow(/entitlements/);
    });

    it("refuses 32-bit images and spots an embedded Info.plist", () => {
        const thin32 = Buffer.alloc(64);
        thin32.writeUInt32LE(0xfeedface, 0);
        expect(() => signLoose("old32", thin32)).toThrow(/32-bit/);
        expect(embedsInfoPlist(syntheticMachO({ arch: "arm64", seed: "a", infoPlistSection: true }))).toBe(true);
        expect(embedsInfoPlist(syntheticMachO({ arch: "arm64", seed: "a" }))).toBe(false);
    });
});
