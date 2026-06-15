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
});
