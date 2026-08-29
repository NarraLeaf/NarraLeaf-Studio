import fsPromises from "fs/promises";
import { describe, expect, it } from "vitest";
import { unpatchedFsPromises } from "./unpatchedFs";

describe("unpatched fs", () => {
    // Outside Electron there is no `original-fs`, and there is no asar patch either, so plain
    // `fs/promises` is the unpatched module rather than a stand-in for it. Loading the module must
    // not throw on the way to working that out.
    it("falls back to fs/promises where Electron's asar patch was never applied", () => {
        expect(unpatchedFsPromises).toBe(fsPromises);
    });
});
