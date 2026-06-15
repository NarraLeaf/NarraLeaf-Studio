import { describe, expect, it } from "vitest";
import { isValidAssetStorageId, splitAssetStorageId } from "./assetStorageId";

describe("asset storage ids", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const sha256 = "a".repeat(64);

    it("accepts generated UUIDs and legacy SHA-256 hashes", () => {
        expect(isValidAssetStorageId(uuid)).toBe(true);
        expect(isValidAssetStorageId(sha256)).toBe(true);
        expect(splitAssetStorageId(uuid)).toEqual([
            "12",
            "3e",
            "4567e89b12d3a456426614174000",
        ]);
    });

    it("rejects ids that could become path traversal segments", () => {
        expect(isValidAssetStorageId("aaaa../../../../../victim.txt")).toBe(false);
        expect(isValidAssetStorageId("/tmp/asset")).toBe(false);
        expect(() => splitAssetStorageId("aaaa../../../../../victim.txt")).toThrow("Invalid asset storage id");
    });
});
