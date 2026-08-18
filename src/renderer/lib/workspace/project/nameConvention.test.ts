import { describe, expect, it } from "vitest";
import { isValidAssetStorageId, ProjectNameConvention } from "./nameConvention";
import { PUPPET_RUNTIMES_PROJECT_DIR } from "@shared/utils/puppetRuntimes";

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
      "4567e89b12d3a456426614174000"
    ]);
  });

  it("rejects traversal and non-storage identifiers before building path shards", () => {
    const traversal = "aaaa../../../../../victim.txt";

    expect(isValidAssetStorageId(traversal)).toBe(false);
    expect(() => ProjectNameConvention.AssetsDataShard(traversal)).toThrow(
      "Invalid asset storage id"
    );
    expect(() => ProjectNameConvention.EditorRemoteAssetShard("/tmp/asset")).toThrow(
      "Invalid asset storage id"
    );
  });

  it("encodes thumbnail cache ids without applying storage-id validation twice", () => {
    const shard = ProjectNameConvention.EditorThumbnailCacheShard(uuid);

    expect(shard.slice(0, 3)).toEqual(["editor", "cache", "thumbnail"]);
    expect(shard.at(-1)).toBe(
      "asset-31323365343536372d653839622d313264332d613435362d343236363134313734303030.png"
    );
    expect(() =>
      ProjectNameConvention.EditorThumbnailCacheShard("asset-with/slash?")
    ).not.toThrow();
  });

  /**
   * The puppet runtime directory is named in two notations — here, with the trailing slash that marks a
   * directory for `Porject.isDir`, and in `@shared/utils/puppetRuntimes` as plain segments, because the
   * main process and the pack step cannot import this module. They have to agree: the editor lists what
   * is in one and the pack step ships what is in the other, so a drift would show an author a runtime
   * that never reaches their game.
   */
  it("names the puppet runtime directory the same as the shared constant", () => {
    expect(ProjectNameConvention.PuppetRuntimes.join("/").replace(/\/$/, "")).toBe(
      PUPPET_RUNTIMES_PROJECT_DIR.join("/")
    );
    // The trailing slash is the directory marker and has to survive, or `resolve` treats it as a file.
    expect(ProjectNameConvention.PuppetRuntimes.at(-1)).toMatch(/\/$/);
  });
});
