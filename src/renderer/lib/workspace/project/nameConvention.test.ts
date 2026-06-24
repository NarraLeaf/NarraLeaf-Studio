import { describe, expect, it } from "vitest";
import { isValidAssetStorageId, ProjectNameConvention } from "./nameConvention";

describe("ProjectNameConvention asset storage ids", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const sha256 = "a".repeat(64);

    it("accepts generated UUIDs and legacy SHA-256 hashes", () => {
        expect(isValidAssetStorageId(uuid)).toBe(true);
        expect(isValidAssetStorageId(sha256)).toBe(true);
        expect(ProjectNameConvention.AssetsDataShard(uuid)).toEqual([
            "assets",
            "content",
            "12",
            "3e",
            "4567e89b12d3a456426614174000",
        ]);
    });

    it("rejects traversal and non-storage identifiers before building path shards", () => {
        const traversal = "aaaa../../../../../victim.txt";

        expect(isValidAssetStorageId(traversal)).toBe(false);
        expect(() => ProjectNameConvention.AssetsDataShard(traversal)).toThrow("Invalid asset storage id");
        expect(() => ProjectNameConvention.EditorRemoteAssetShard("/tmp/asset")).toThrow("Invalid asset storage id");
    });

    it("encodes thumbnail cache ids without applying storage-id validation twice", () => {
        const shard = ProjectNameConvention.EditorThumbnailCacheShard(uuid);

        expect(shard.slice(0, 3)).toEqual(["editor", "cache", "thumbnail"]);
        expect(shard.at(-1)).toBe("asset-31323365343536372d653839622d313264332d613435362d343236363134313734303030.png");
        expect(() => ProjectNameConvention.EditorThumbnailCacheShard("asset-with/slash?")).not.toThrow();
    });
});
