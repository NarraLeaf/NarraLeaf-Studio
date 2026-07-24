import { describe, expect, it } from "vitest";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset } from "@/lib/workspace/services/assets/types";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { assetContentRelativePath, walkDirectoryBytes } from "./assetOverviewSnapshot";

/** A tiny in-memory tree, keyed the way the real service keys paths (either separator). */
function fakeFileSystem(tree: Record<string, Array<{ name: string; type: "file" | "directory"; size?: number }>>) {
    const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");
    const sizes = new Map<string, number>();
    for (const [directory, entries] of Object.entries(tree)) {
        for (const entry of entries) {
            if (entry.type === "file") {
                sizes.set(`${normalize(directory)}/${entry.name}`, entry.size ?? 0);
            }
        }
    }
    return {
        list: async (path: string) => {
            const entries = tree[normalize(path)];
            return entries
                ? { ok: true as const, data: entries.map(entry => ({ name: entry.name, ext: null, type: entry.type })) }
                : { ok: false as const, error: { code: "ENOENT", message: "no such directory" } };
        },
        details: async (path: string) => {
            const size = sizes.get(normalize(path));
            return size === undefined
                ? { ok: false as const, error: { code: "ENOENT", message: "no such file" } }
                : { ok: true as const, data: { size } };
        },
    } as unknown as FileSystemService;
}

describe("walkDirectoryBytes", () => {
    it("totals a nested tree and keys every file by its path relative to the root", async () => {
        const fs = fakeFileSystem({
            "/p/assets": [
                { name: "assets.metadata.image.json", type: "file", size: 30 },
                { name: "content", type: "directory" },
            ],
            "/p/assets/content": [{ name: "ab", type: "directory" }],
            "/p/assets/content/ab": [{ name: "cd", type: "directory" }],
            "/p/assets/content/ab/cd": [
                { name: "ef01", type: "file", size: 100 },
                { name: "ef02", type: "file", size: 250 },
            ],
        });

        const walk = await walkDirectoryBytes(fs, "/p/assets");

        expect(walk.totalBytes).toBe(380);
        expect(walk.fileCount).toBe(3);
        expect(walk.bytesByRelativePath.get("content/ab/cd/ef01")).toBe(100);
        expect(walk.bytesByRelativePath.get("assets.metadata.image.json")).toBe(30);
    });

    it("treats an unreadable directory as empty and an unreadable file as zero", async () => {
        const fs = fakeFileSystem({
            "/p/assets": [
                { name: "content", type: "directory" },
                { name: "ghost", type: "file" },
            ],
        });
        // `ghost` has no recorded size, and `content` is not in the tree at all.
        const walk = await walkDirectoryBytes(fs, "/p/assets");

        expect(walk.totalBytes).toBe(0);
        expect(walk.fileCount).toBe(1);
    });

    it("reports a missing root as an empty walk instead of throwing", async () => {
        const walk = await walkDirectoryBytes(fakeFileSystem({}), "/p/assets");

        expect(walk).toMatchObject({ totalBytes: 0, fileCount: 0 });
    });
});

describe("assetContentRelativePath", () => {
    const base = { name: "A", type: AssetType.Image, hash: "h", tags: [], description: "" };

    it("shards a local asset id the way the project stores it", () => {
        const asset = {
            ...base,
            id: "abcdef01-2345-6789-abcd-ef0123456789",
            source: AssetSource.Local,
            meta: {},
        } as Asset;

        expect(assetContentRelativePath(asset)).toBe("content/ab/cd/ef0123456789abcdef0123456789");
    });

    it("has no local path for a remote asset or an id that is not a storage id", () => {
        const remote = {
            ...base,
            id: "abcdef01-2345-6789-abcd-ef0123456789",
            source: AssetSource.Remote,
            meta: { url: "https://example.test/a.png" },
        } as unknown as Asset;
        const bogus = { ...base, id: "not-a-uuid", source: AssetSource.Local, meta: {} } as Asset;

        expect(assetContentRelativePath(remote)).toBeNull();
        expect(assetContentRelativePath(bogus)).toBeNull();
    });
});
