import { describe, expect, it } from "vitest";
import { isExecutableContent, unixModeForContent } from "./unixModes";

describe("unixModeForContent", () => {
    it("makes machine code and scripts executable", () => {
        expect(unixModeForContent(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]))).toBe(0o755); // ELF
        expect(unixModeForContent(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))).toBe(0o755); // Mach-O 64
        expect(unixModeForContent(Buffer.from([0xce, 0xfa, 0xed, 0xfe]))).toBe(0o755); // Mach-O 32
        expect(unixModeForContent(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))).toBe(0o755); // universal
        expect(unixModeForContent(Buffer.from("#!/bin/sh\n"))).toBe(0o755);
    });

    it("leaves everything else readable only", () => {
        expect(unixModeForContent(Buffer.from("{\"name\":1}"))).toBe(0o644);
        expect(unixModeForContent(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(0o644); // PNG
        expect(unixModeForContent(Buffer.alloc(0))).toBe(0o644);
        expect(isExecutableContent(Buffer.from("#"))).toBe(false);
    });
});
