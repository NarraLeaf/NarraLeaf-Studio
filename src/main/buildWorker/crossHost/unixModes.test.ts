import { describe, expect, it } from "vitest";
import { isMacExecutableContent, macModeForContent } from "./unixModes";

describe("macModeForContent", () => {
    it("makes Mach-O images and scripts executable", () => {
        expect(macModeForContent(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))).toBe(0o755); // Mach-O 64
        expect(macModeForContent(Buffer.from([0xce, 0xfa, 0xed, 0xfe]))).toBe(0o755); // Mach-O 32
        expect(macModeForContent(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))).toBe(0o755); // universal
        expect(macModeForContent(Buffer.from("#!/bin/sh\n"))).toBe(0o755);
    });

    it("leaves everything else, Linux machine code included, readable only", () => {
        expect(macModeForContent(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))).toBe(0o644);
        expect(macModeForContent(Buffer.from("{\"name\":1}"))).toBe(0o644);
        expect(macModeForContent(Buffer.alloc(0))).toBe(0o644);
        expect(isMacExecutableContent(Buffer.from("#"))).toBe(false);
    });
});
