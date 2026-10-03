import { describe, expect, it } from "vitest";
import { DIRECTORY_MODE, EXECUTABLE_MODE, REGULAR_FILE_MODE, unixModeForContent } from "./unixModes";

describe("the mode a Linux package gives a file it has no mode for", () => {
    it("makes machine code executable, whatever the file is called", () => {
        // An ELF header: the app, chrome-sandbox, libvulkan.so.1, a .node addon.
        expect(unixModeForContent(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]))).toBe(EXECUTABLE_MODE);
    });

    it("makes scripts executable", () => {
        expect(unixModeForContent(Buffer.from("#!/usr/bin/env bash\n"))).toBe(EXECUTABLE_MODE);
        expect(unixModeForContent(Buffer.from("#!"))).toBe(EXECUTABLE_MODE);
    });

    it("leaves everything else readable and not executable", () => {
        expect(unixModeForContent(Buffer.from("{\"name\":\"koffi\"}"))).toBe(REGULAR_FILE_MODE);
        expect(unixModeForContent(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(REGULAR_FILE_MODE);
        // A Windows or macOS binary is not something a Linux package runs.
        expect(unixModeForContent(Buffer.from("MZ\x90\x00"))).toBe(REGULAR_FILE_MODE);
        expect(unixModeForContent(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))).toBe(REGULAR_FILE_MODE);
    });

    it("judges a file shorter than a header by what it has", () => {
        expect(unixModeForContent(Buffer.alloc(0))).toBe(REGULAR_FILE_MODE);
        expect(unixModeForContent(Buffer.from([0x7f, 0x45, 0x4c]))).toBe(REGULAR_FILE_MODE);
        expect(unixModeForContent(Buffer.from("#"))).toBe(REGULAR_FILE_MODE);
    });

    it("makes every directory enterable", () => {
        expect(DIRECTORY_MODE).toBe(0o755);
        expect(EXECUTABLE_MODE).toBe(0o755);
        expect(REGULAR_FILE_MODE).toBe(0o644);
    });
});
