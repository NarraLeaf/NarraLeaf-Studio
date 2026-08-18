import { describe, expect, it } from "vitest";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset } from "@/lib/workspace/services/assets/types";
import { assetBytesFromWalk, assetContentRelativePath } from "./assetOverviewSnapshot";

const base = { name: "A", type: AssetType.Image, hash: "h", tags: [], description: "" };

function localAsset(id: string): Asset {
  return { ...base, id, source: AssetSource.Local, meta: {} } as Asset;
}

function remoteAsset(id: string): Asset {
  return {
    ...base,
    id,
    source: AssetSource.Remote,
    meta: { url: "https://example.test/a.png", fetchedAt: "2026-08-05T00:00:00.000Z" }
  } as unknown as Asset;
}

describe("assetContentRelativePath", () => {
  it("shards a local asset id the way the project stores it", () => {
    expect(assetContentRelativePath(localAsset("abcdef01-2345-6789-abcd-ef0123456789"))).toBe(
      "content/ab/cd/ef0123456789abcdef0123456789"
    );
  });

  it("shards a remote asset the same way: its snapshot is stored like any other asset's bytes", () => {
    expect(assetContentRelativePath(remoteAsset("abcdef01-2345-6789-abcd-ef0123456789"))).toBe(
      "content/ab/cd/ef0123456789abcdef0123456789"
    );
  });

  it("has no local path for an id that is not a storage id", () => {
    const bogus = { ...base, id: "not-a-uuid", source: AssetSource.Local, meta: {} } as Asset;

    expect(assetContentRelativePath(bogus)).toBeNull();
  });
});

describe("assetBytesFromWalk", () => {
  it("attributes the walk's bytes to the asset at that relative path", () => {
    const asset = localAsset("abcdef01-2345-6789-abcd-ef0123456789");
    const bytes = assetBytesFromWalk([asset], {
      "content/ab/cd/ef0123456789abcdef0123456789": 2048
    });

    expect(bytes.get(asset.id)).toBe(2048);
  });

  it("leaves an asset absent (unknown, not zero) when its content file is not in the walk", () => {
    // The original bug: a file that is present but addressed by the wrong path counts as zero.
    // Here the file is simply not among the walked paths, so the id must not appear at all -
    // the model renders that as unknown bytes, never a measured empty file.
    const asset = localAsset("abcdef01-2345-6789-abcd-ef0123456789");
    const bytes = assetBytesFromWalk([asset], { "some/other/file": 10 });

    expect(bytes.has(asset.id)).toBe(false);
  });

  it("skips assets with no local content path", () => {
    const bogus = { ...base, id: "not-a-uuid", source: AssetSource.Local, meta: {} } as Asset;

    expect(assetBytesFromWalk([bogus], {}).size).toBe(0);
  });

  it("counts a remote asset's snapshot, which takes up room like any other file", () => {
    const remote = remoteAsset("abcdef01-2345-6789-abcd-ef0123456789");
    const bytes = assetBytesFromWalk([remote], {
      "content/ab/cd/ef0123456789abcdef0123456789": 4096
    });

    expect(bytes.get(remote.id)).toBe(4096);
  });
});
