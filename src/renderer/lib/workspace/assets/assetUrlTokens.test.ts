import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAssetUrlTokens,
  lookupAssetIdForToken,
  lookupAssetIdForUrl,
  parseAssetUrlToken,
  recordAssetUrlToken
} from "./assetUrlTokens";

describe("parseAssetUrlToken", () => {
  beforeEach(clearAssetUrlTokens);

  it("reads the grant token out of a per-file URL", () => {
    expect(parseAssetUrlToken("app://fs/abc123")).toBe("abc123");
  });

  it("stops at the first segment, which is all a directory grant's token is", () => {
    // A model bundle's URL carries the entry path after the token, and the manifest's sibling
    // arithmetic depends on it staying there. Reading the whole path as a token would miss.
    expect(parseAssetUrlToken("app://fs/abc123/Hiyori.2048/texture_00.png")).toBe("abc123");
  });

  it("ignores a query or fragment after the token", () => {
    expect(parseAssetUrlToken("app://fs/abc123?v=2")).toBe("abc123");
    expect(parseAssetUrlToken("app://fs/abc123#top")).toBe("abc123");
  });

  it("returns null for anything that is not a grant URL", () => {
    expect(parseAssetUrlToken("https://example.com/a.png")).toBeNull();
    expect(parseAssetUrlToken("app://fs/")).toBeNull();
    expect(parseAssetUrlToken("")).toBeNull();
    expect(parseAssetUrlToken(undefined)).toBeNull();
    expect(parseAssetUrlToken(42)).toBeNull();
  });
});

describe("the recorded token table", () => {
  beforeEach(clearAssetUrlTokens);

  it("answers with the asset a token was minted for", () => {
    recordAssetUrlToken("token-1", "asset-1");

    expect(lookupAssetIdForToken("token-1")).toBe("asset-1");
    expect(lookupAssetIdForUrl("app://fs/token-1")).toBe("asset-1");
  });

  it("answers null for a token it never minted", () => {
    // A URL pasted in from an earlier run looks identical to a live one, and this is the whole
    // reason an unresolved token has to become a reported gap rather than a silent miss.
    expect(lookupAssetIdForToken("from-last-session")).toBeNull();
    expect(lookupAssetIdForUrl("app://fs/from-last-session")).toBeNull();
  });

  it("keeps every token an asset has been served under", () => {
    // Each read mints a fresh grant, so one asset accumulates tokens across a session and a
    // document may hold any of them.
    recordAssetUrlToken("token-1", "asset-1");
    recordAssetUrlToken("token-2", "asset-1");

    expect(lookupAssetIdForToken("token-1")).toBe("asset-1");
    expect(lookupAssetIdForToken("token-2")).toBe("asset-1");
  });
});
