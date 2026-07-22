import { describe, it, expect } from "vitest";
import type { FileStat } from "@shared/utils/fs";
import { extname, join, parse } from "@shared/utils/path";
import { AssetType } from "./assetTypes";
import {
    assetTypeMatchesExtension,
    expandImportPaths,
    type ImportPathExpansionFs,
} from "./importPathExpansion";

/** A virtual entry keyed by its full filename, mirroring what a real directory listing yields. */
interface VirtualEntry {
    name: string;
    type: "file" | "directory";
}

/**
 * Build an in-memory {@link ImportPathExpansionFs}. `tree` maps a directory path to its entries;
 * the `FileStat` name/ext split is reproduced exactly the way the main-process list handler does it
 * (via `path.parse` / `path.extname`) so the expander's filename reconstruction is exercised for real.
 */
function makeFs(tree: Record<string, VirtualEntry[]>): ImportPathExpansionFs {
    const directories = new Set(Object.keys(tree));
    return {
        isDir: async (path) => directories.has(path),
        list: async (path) => {
            const entries = tree[path];
            if (!entries) {
                return null;
            }
            return entries.map((entry): FileStat => ({
                name: parse(entry.name).name,
                ext: extname(entry.name) || null,
                type: entry.type,
            }));
        },
    };
}

const ROOT = join("D:", "drop");
const SUB = join(ROOT, "sub");
const DEEP = join(SUB, "deep");

describe("assetTypeMatchesExtension", () => {
    it("matches by extension, case-insensitively", () => {
        expect(assetTypeMatchesExtension(AssetType.Image, "photo.PNG")).toBe(true);
        expect(assetTypeMatchesExtension(AssetType.Image, "clip.mp3")).toBe(false);
        expect(assetTypeMatchesExtension(AssetType.Audio, "clip.mp3")).toBe(true);
    });

    it("rejects extensionless names for typed assets but accepts them for Other", () => {
        expect(assetTypeMatchesExtension(AssetType.Image, "README")).toBe(false);
        expect(assetTypeMatchesExtension(AssetType.Other, "README")).toBe(true);
        expect(assetTypeMatchesExtension(AssetType.Other, "anything.xyz")).toBe(true);
    });
});

describe("expandImportPaths", () => {
    const tree: Record<string, VirtualEntry[]> = {
        [ROOT]: [
            { name: "img1.png", type: "file" },
            { name: "notes.txt", type: "file" },
            { name: "music.mp3", type: "file" },
            { name: "sub", type: "directory" },
        ],
        [SUB]: [
            { name: "img2.jpeg", type: "file" },
            { name: "deep", type: "directory" },
        ],
        [DEEP]: [{ name: "img3.webp", type: "file" }],
    };

    it("recursively collects only files matching the target type", async () => {
        const result = await expandImportPaths(AssetType.Image, [ROOT], makeFs(tree));
        expect(result.expandedDirectory).toBe(true);
        expect(result.files).toEqual([
            join(ROOT, "img1.png"),
            join(SUB, "img2.jpeg"),
            join(DEEP, "img3.webp"),
        ]);
    });

    it("collects every file for the Other type (wildcard extensions)", async () => {
        const result = await expandImportPaths(AssetType.Other, [ROOT], makeFs(tree));
        expect(result.files).toEqual([
            join(ROOT, "img1.png"),
            join(ROOT, "notes.txt"),
            join(ROOT, "music.mp3"),
            join(SUB, "img2.jpeg"),
            join(DEEP, "img3.webp"),
        ]);
    });

    it("passes regular file paths through untouched without flagging a directory", async () => {
        const file = join(ROOT, "img1.png");
        const result = await expandImportPaths(AssetType.Image, [file], makeFs(tree));
        expect(result.expandedDirectory).toBe(false);
        expect(result.files).toEqual([file]);
    });

    it("mixes dropped files and directories and de-duplicates the overlap", async () => {
        const explicit = join(ROOT, "img1.png");
        const result = await expandImportPaths(AssetType.Image, [explicit, ROOT], makeFs(tree));
        expect(result.expandedDirectory).toBe(true);
        // img1.png is dropped directly and also discovered inside ROOT; it appears once, first.
        expect(result.files).toEqual([
            explicit,
            join(SUB, "img2.jpeg"),
            join(DEEP, "img3.webp"),
        ]);
    });

    it("reports an expanded directory with no matches (empty result)", async () => {
        const result = await expandImportPaths(AssetType.Audio, [ROOT], makeFs(tree));
        expect(result.expandedDirectory).toBe(true);
        expect(result.files).toEqual([join(ROOT, "music.mp3")]);

        const emptyResult = await expandImportPaths(AssetType.Font, [ROOT], makeFs(tree));
        expect(emptyResult.expandedDirectory).toBe(true);
        expect(emptyResult.files).toEqual([]);
    });

    it("skips directories that cannot be listed", async () => {
        const result = await expandImportPaths(AssetType.Image, [join(ROOT, "missing")], {
            isDir: async () => true,
            list: async () => null,
        });
        expect(result.expandedDirectory).toBe(true);
        expect(result.files).toEqual([]);
    });
});
