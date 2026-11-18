import { describe, expect, it } from "vitest";
import { parseZipIndex } from "./zipModel";
import { BufferZipOutput, writeZip } from "./zipWriter";

async function archive(zip64: boolean): Promise<Buffer> {
    const output = new BufferZipOutput();
    await writeZip(output, [{ name: "game.txt", source: { kind: "buffer", data: Buffer.from("game") } }], {
        mtime: new Date(Date.UTC(2020, 0, 1)),
        allowZip64: true,
    });
    const original = output.toBuffer();
    if (!zip64) {
        return original;
    }
    const eocdOffset = original.length - 22;
    const eocd = Buffer.from(original.subarray(eocdOffset));
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(1n, 24);
    record.writeBigUInt64LE(1n, 32);
    record.writeBigUInt64LE(BigInt(eocd.readUInt32LE(12)), 40);
    record.writeBigUInt64LE(BigInt(eocd.readUInt32LE(16)), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(eocdOffset), 8);
    locator.writeUInt32LE(1, 16);
    eocd.writeUInt16LE(0xffff, 8);
    eocd.writeUInt16LE(0xffff, 10);
    return Buffer.concat([original.subarray(0, eocdOffset), record, locator, eocd]);
}

async function archiveWithZip64EntryDisk(disk: number): Promise<Buffer> {
    const original = await archive(false);
    const eocdOffset = original.length - 22;
    const eocd = Buffer.from(original.subarray(eocdOffset));
    const centralOffset = eocd.readUInt32LE(16);
    const central = Buffer.from(original.subarray(centralOffset, eocdOffset));
    central.writeUInt16LE(8, 30);
    central.writeUInt16LE(0xffff, 34);
    const extra = Buffer.alloc(8);
    extra.writeUInt16LE(1, 0);
    extra.writeUInt16LE(4, 2);
    extra.writeUInt32LE(disk, 4);
    eocd.writeUInt32LE(central.length + extra.length, 12);
    return Buffer.concat([original.subarray(0, centralOffset), central, extra, eocd]);
}

describe("zip disk ownership", () => {
    it.each([false, true])("accepts an ordinary single-disk archive (zip64: %s)", async zip64 => {
        expect(parseZipIndex(await archive(zip64)).entries.map(entry => entry.name)).toEqual(["game.txt"]);
    });

    it("accepts a zip64 entry whose extended disk number is zero", async () => {
        expect(parseZipIndex(await archiveWithZip64EntryDisk(0)).entries[0].name).toBe("game.txt");
    });

    it("rejects a zip64 entry whose extended disk number is nonzero", async () => {
        const bytes = await archiveWithZip64EntryDisk(1);
        expect(() => parseZipIndex(bytes)).toThrow(/Multi-disk zip archives are not supported/);
    });

    it.each<[string, boolean, (bytes: Buffer) => void]>([
        ["central directory on another disk", false, (bytes: Buffer) => bytes.writeUInt16LE(1, bytes.length - 22 + 6)],
        ["different entry counts on the current disk", false, (bytes: Buffer) => bytes.writeUInt16LE(0, bytes.length - 22 + 8)],
        ["a saturated current-disk entry count without zip64", false, (bytes: Buffer) => bytes.writeUInt16LE(0xffff, bytes.length - 22 + 8)],
        ["entry on another disk", false, (bytes: Buffer) => {
            const centralOffset = bytes.readUInt32LE(bytes.length - 22 + 16);
            bytes.writeUInt16LE(1, centralOffset + 34);
        }],
        ["zip64 record on another disk", true, (bytes: Buffer) => bytes.writeUInt32LE(1, bytes.length - 22 - 20 + 4)],
        ["multiple zip64 disks", true, (bytes: Buffer) => bytes.writeUInt32LE(2, bytes.length - 22 - 20 + 16)],
        ["zip64 archive on another disk", true, (bytes: Buffer) => bytes.writeUInt32LE(1, bytes.length - 22 - 20 - 56 + 16)],
        ["zip64 central directory on another disk", true, (bytes: Buffer) => bytes.writeUInt32LE(1, bytes.length - 22 - 20 - 56 + 20)],
        ["different zip64 entry counts on the current disk", true, (bytes: Buffer) => bytes.writeBigUInt64LE(0n, bytes.length - 22 - 20 - 56 + 24)],
    ])("rejects %s", async (_name, zip64, mutate) => {
        const bytes = await archive(zip64);
        mutate(bytes);
        expect(() => parseZipIndex(bytes)).toThrow(/Multi-disk zip archives are not supported/);
    });
});
