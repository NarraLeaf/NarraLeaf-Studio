import { describe, expect, it } from "vitest";
import { parseArscPackageNames, patchArscPackageName } from "./arsc";

/**
 * Fixture built by hand (the parser's independent mirror): a RES_TABLE root,
 * a minimal empty global string pool, and ResTable_package chunk(s) with the
 * fixed 256-byte name slot plus a distinctive payload standing in for the
 * type/key pools the patcher must never touch.
 */

const PACKAGE_PAYLOAD = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x01, 0x02, 0x03, 0x04]);

function packageChunk(name: string, payload: Buffer): Buffer {
    const headerSize = 288;
    const body = Buffer.alloc(headerSize + payload.length);
    body.writeUInt16LE(0x0200, 0);
    body.writeUInt16LE(headerSize, 2);
    body.writeUInt32LE(body.length, 4);
    body.writeUInt32LE(0x7f, 8);
    body.write(name, 12, "utf16le");
    // typeStrings / lastPublicType / keyStrings / lastPublicKey / typeIdOffset
    body.writeUInt32LE(headerSize, 268);
    body.writeUInt32LE(0, 272);
    body.writeUInt32LE(headerSize, 276);
    body.writeUInt32LE(0, 280);
    body.writeUInt32LE(0, 284);
    payload.copy(body, headerSize);
    return body;
}

function emptyStringPool(): Buffer {
    const pool = Buffer.alloc(28);
    pool.writeUInt16LE(0x0001, 0);
    pool.writeUInt16LE(28, 2);
    pool.writeUInt32LE(28, 4);
    pool.writeUInt32LE(28, 20);
    return pool;
}

function buildTestArsc(packageNames: string[]): Buffer {
    const packages = packageNames.map(name => packageChunk(name, PACKAGE_PAYLOAD));
    const body = Buffer.concat([emptyStringPool(), ...packages]);
    const header = Buffer.alloc(12);
    header.writeUInt16LE(0x0002, 0);
    header.writeUInt16LE(12, 2);
    header.writeUInt32LE(12 + body.length, 4);
    header.writeUInt32LE(packageNames.length, 8);
    return Buffer.concat([header, body]);
}

describe("parseArscPackageNames", () => {
    it("reads the declared package names", () => {
        expect(parseArscPackageNames(buildTestArsc(["com.narraleaf.shell.placeholder"])))
            .toEqual(["com.narraleaf.shell.placeholder"]);
    });

    it("rejects non-arsc input", () => {
        expect(() => parseArscPackageNames(Buffer.from("not a resource table"))).toThrow();
    });
});

describe("patchArscPackageName", () => {
    it("renames in place, reporting the previous name", () => {
        const original = buildTestArsc(["com.narraleaf.shell.placeholder"]);
        const { data, previous } = patchArscPackageName(original, "com.acme.mygame");
        expect(previous).toBe("com.narraleaf.shell.placeholder");
        expect(parseArscPackageNames(data)).toEqual(["com.acme.mygame"]);
        expect(data.length).toBe(original.length);
    });

    it("touches nothing outside the 256-byte name slot", () => {
        const original = buildTestArsc(["com.narraleaf.shell.placeholder"]);
        const { data } = patchArscPackageName(original, "com.acme.mygame");
        // Name slot lives at packageStart+12; the package chunk starts after
        // the 12-byte table header and the 28-byte string pool.
        const slotStart = 12 + 28 + 12;
        expect(data.subarray(0, slotStart).equals(original.subarray(0, slotStart))).toBe(true);
        expect(data.subarray(slotStart + 256).equals(original.subarray(slotStart + 256))).toBe(true);
        expect(data.includes(PACKAGE_PAYLOAD)).toBe(true);
    });

    it("zero-fills the slot so no placeholder residue survives", () => {
        const { data } = patchArscPackageName(buildTestArsc(["com.narraleaf.shell.placeholder"]), "a.b");
        expect(data.includes(Buffer.from("placeholder", "utf16le"))).toBe(false);
    });

    it("is idempotent", () => {
        const original = buildTestArsc(["com.narraleaf.shell.placeholder"]);
        const once = patchArscPackageName(original, "com.acme.mygame").data;
        const twice = patchArscPackageName(once, "com.acme.mygame").data;
        expect(twice.equals(once)).toBe(true);
    });

    it("rejects a name that overflows the fixed slot", () => {
        const longName = `com.${"x".repeat(130)}`;
        expect(() => patchArscPackageName(buildTestArsc(["a.b"]), longName)).toThrow(/127/);
    });

    it("refuses to guess between multiple packages", () => {
        const twoPackages = buildTestArsc(["com.one", "com.two"]);
        expect(() => patchArscPackageName(twoPackages, "com.acme.mygame")).toThrow(/exactly one/);
    });
});
