import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { entryFileName } from "./fileEntry";
import { extname, parse } from "./path";

/**
 * The exact split `FsListHandler` performs (`fsAction.ts`), and the identical one in the
 * plugin-facing `privileged.fs.list` (`privilegedAction.ts`). Both run in the main process against
 * node's `path`, so the round-trip below is pinned to node rather than to the renderer polyfill.
 */
function splitLikeIpcHandler(fileName: string): { name: string; ext: string | null } {
    return {
        name: nodePath.parse(fileName).name,
        ext: nodePath.extname(fileName) || null,
    };
}

/** Names chosen for the ways a filename can defeat a naive stem-only join. */
const FILE_NAMES = [
    "logo.png",
    "assets.metadata.image.json",
    "archive.tar.gz",
    "README",
    ".gitignore",
    ".env.local",
    "MyProject.nlproj",
    "plugin__acme.kit__store.json",
    "name with spaces.webp",
    "汉字.png",
    "trailing.",
    "UPPER.PNG",
];

describe("entryFileName", () => {
    it("round-trips every filename the list IPC splits", () => {
        for (const fileName of FILE_NAMES) {
            expect(entryFileName(splitLikeIpcHandler(fileName))).toBe(fileName);
        }
    });

    it("round-trips identically under the renderer path polyfill", () => {
        // Listings are split in the main process but consumed in the renderer, so a divergence
        // between node's `path` and the polyfill would reintroduce the bug on one side only.
        for (const fileName of FILE_NAMES) {
            expect(entryFileName({ name: parse(fileName).name, ext: extname(fileName) || null }))
                .toBe(fileName);
        }
    });

    it("treats both spellings of 'no extension' as a bare stem", () => {
        // `FsListHandler` normalizes to null; `Fs.listFiles` leaves the empty string.
        expect(entryFileName({ name: "README", ext: null })).toBe("README");
        expect(entryFileName({ name: "README", ext: "" })).toBe("README");
    });

    it("appends the extension rather than assuming the stem still carries it", () => {
        // Guards the inversion that certified the original bug in a test fake: an entry whose
        // `name` already held the whole filename and whose `ext` was null.
        expect(entryFileName({ name: "a", ext: ".json" })).toBe("a.json");
        expect(entryFileName({ name: "dir", ext: null })).toBe("dir");
    });
});
