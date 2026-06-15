import { describe, expect, it } from "vitest";
import { ProjectNameConvention } from "./nameConvention";

const hasUnsafePathSegment = (segments: readonly string[]): boolean => segments.some(segment => (
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.startsWith("/") ||
    /^[a-zA-Z]:/.test(segment)
));

describe("ProjectNameConvention", () => {
    it("keeps thumbnail cache shard paths under the thumbnail cache root for unsafe asset ids", () => {
        const shard = ProjectNameConvention.EditorThumbnailCacheShard("aaaa/../../../../home/alice/target");

        expect(shard.slice(0, 3)).toEqual(["editor", "cache", "thumbnail"]);
        expect(hasUnsafePathSegment(shard.slice(3))).toBe(false);
        expect(shard.at(-1)).toMatch(/^asset-[0-9a-f]+\.png$/);
    });

    it("does not emit traversal segments for short dot-only asset ids", () => {
        const shard = ProjectNameConvention.EditorThumbnailCacheShard("..");

        expect(hasUnsafePathSegment(shard.slice(3))).toBe(false);
        expect(shard.at(-1)).toBe("asset-2e2e.png");
    });
});
