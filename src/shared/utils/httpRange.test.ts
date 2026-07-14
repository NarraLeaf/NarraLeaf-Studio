import { describe, expect, it } from "vitest";
import { resolveSingleByteRange } from "./httpRange";

describe("resolveSingleByteRange", () => {
    it("resolves to a full response without a Range header", () => {
        expect(resolveSingleByteRange(null, 100)).toEqual({ kind: "full" });
        expect(resolveSingleByteRange(undefined, 100)).toEqual({ kind: "full" });
        expect(resolveSingleByteRange("", 100)).toEqual({ kind: "full" });
    });

    it("resolves bounded, open-ended, and suffix ranges", () => {
        expect(resolveSingleByteRange("bytes=0-99", 1000)).toEqual({ kind: "partial", start: 0, end: 99 });
        expect(resolveSingleByteRange("bytes=200-", 1000)).toEqual({ kind: "partial", start: 200, end: 999 });
        expect(resolveSingleByteRange("bytes=-100", 1000)).toEqual({ kind: "partial", start: 900, end: 999 });
        expect(resolveSingleByteRange("bytes=-2000", 1000)).toEqual({ kind: "partial", start: 0, end: 999 });
    });

    it("clamps end positions past the payload", () => {
        expect(resolveSingleByteRange("bytes=990-2000", 1000)).toEqual({ kind: "partial", start: 990, end: 999 });
    });

    it("ignores malformed and multi-range headers", () => {
        expect(resolveSingleByteRange("bytes=0-99,200-299", 1000)).toEqual({ kind: "full" });
        expect(resolveSingleByteRange("items=0-99", 1000)).toEqual({ kind: "full" });
        expect(resolveSingleByteRange("bytes=-", 1000)).toEqual({ kind: "full" });
        expect(resolveSingleByteRange("bytes=99-0", 1000)).toEqual({ kind: "full" });
    });

    it("flags unsatisfiable ranges", () => {
        expect(resolveSingleByteRange("bytes=1000-", 1000)).toEqual({ kind: "unsatisfiable" });
        expect(resolveSingleByteRange("bytes=-0", 1000)).toEqual({ kind: "unsatisfiable" });
        expect(resolveSingleByteRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
    });
});
