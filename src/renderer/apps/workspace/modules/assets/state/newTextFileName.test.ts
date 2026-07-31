import { describe, expect, it } from "vitest";
import {
    resolveNewTextFileName,
    validateNewTextFileName,
} from "./newTextFileName";

describe("resolveNewTextFileName", () => {
    it("appends .txt when the author typed no extension", () => {
        expect(resolveNewTextFileName("New Text File")).toBe("New Text File.txt");
        expect(resolveNewTextFileName("notes")).toBe("notes.txt");
        expect(resolveNewTextFileName("新建文本文件")).toBe("新建文本文件.txt");
    });

    it("keeps whatever extension the author typed", () => {
        // The editor opens `.md`; the point of these three is that creation does not consult that
        // list at all - `.ini` and `.csv` are equally files a team writes.
        expect(resolveNewTextFileName("plan.md")).toBe("plan.md");
        expect(resolveNewTextFileName("notes.ini")).toBe("notes.ini");
        expect(resolveNewTextFileName("data.csv")).toBe("data.csv");
    });

    it("keeps an extension Studio cannot open", () => {
        expect(resolveNewTextFileName("sketch.psd")).toBe("sketch.psd");
    });

    it("reads the extension from the last dot, not the first", () => {
        expect(resolveNewTextFileName("a.b.csv")).toBe("a.b.csv");
    });

    it("treats a leading dot as an extension", () => {
        expect(resolveNewTextFileName(".gitignore")).toBe(".gitignore");
    });

    it("trims surrounding whitespace and trailing dots before deciding", () => {
        expect(resolveNewTextFileName("  plan.md  ")).toBe("plan.md");
        expect(resolveNewTextFileName("notes.")).toBe("notes.txt");
    });
});

describe("validateNewTextFileName", () => {
    it("accepts an ordinary name", () => {
        expect(validateNewTextFileName("plan.md")).toBeNull();
        expect(validateNewTextFileName("New Text File.txt")).toBeNull();
    });

    it("rejects an empty name", () => {
        expect(validateNewTextFileName("")).toBe("empty");
        expect(validateNewTextFileName("   ")).toBe("empty");
        expect(validateNewTextFileName("...")).toBe("empty");
    });

    it("rejects path separators", () => {
        expect(validateNewTextFileName("docs/plan.md")).toBe("illegalChars");
        expect(validateNewTextFileName("docs\\plan.md")).toBe("illegalChars");
    });

    it("rejects the characters Windows reserves", () => {
        for (const name of ["a:b.txt", "a*b.txt", "a?b.txt", "a\"b.txt", "a<b.txt", "a>b.txt", "a|b.txt"]) {
            expect(validateNewTextFileName(name)).toBe("illegalChars");
        }
    });
});
