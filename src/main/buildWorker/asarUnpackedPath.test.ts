import { describe, expect, it } from "vitest";
import { asarUnpackedPath } from "./asarUnpackedPath";

describe("asarUnpackedPath", () => {
    it("maps a packaged worker onto its unpacked twin", () => {
        expect(asarUnpackedPath("/Applications/NarraLeaf Studio.app/Contents/Resources/app.asar/dist/main/buildWorker.js", "/"))
            .toBe("/Applications/NarraLeaf Studio.app/Contents/Resources/app.asar.unpacked/dist/main/buildWorker.js");
    });

    it("handles the Windows shape from any host", () => {
        expect(asarUnpackedPath("C:\\Program Files\\NarraLeaf Studio\\resources\\app.asar\\dist\\main\\buildWorker.js", "\\"))
            .toBe("C:\\Program Files\\NarraLeaf Studio\\resources\\app.asar.unpacked\\dist\\main\\buildWorker.js");
    });

    it("returns null outside an asar, which is every unpackaged run", () => {
        expect(asarUnpackedPath("/Users/dev/NarraLeaf-Studio/dist/main/buildWorker.js", "/")).toBeNull();
    });

    // A directory whose name merely starts with "asar" is not an archive, and
    // claiming it would point the fork at a path that does not exist.
    it("matches on the whole segment rather than a substring", () => {
        expect(asarUnpackedPath("/srv/asar-tools/dist/main/buildWorker.js", "/")).toBeNull();
    });
});
