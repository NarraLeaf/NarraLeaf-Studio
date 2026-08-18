import { describe, expect, it } from "vitest";
import {
  isNetworkAddressAllowed,
  networkAllowlistCspSources,
  normalizeNetworkAllowlistEntries,
  normalizeNetworkAllowlistEntry,
  type NetworkAllowlist
} from "./networkAllowlist";

const listed = (
  entries: string[],
  plugins: NetworkAllowlist["plugins"] = []
): NetworkAllowlist => ({
  policy: "allowlist",
  entries: normalizeNetworkAllowlistEntries(entries),
  plugins
});

describe("normalizeNetworkAllowlistEntry", () => {
  it("reads a bare authority as the whole host", () => {
    expect(normalizeNetworkAllowlistEntry("https://api.example.com")).toBe(
      "https://api.example.com/*"
    );
    expect(normalizeNetworkAllowlistEntry("https://api.example.com/")).toBe(
      "https://api.example.com/*"
    );
  });

  it("keeps a path the author wrote", () => {
    expect(normalizeNetworkAllowlistEntry("https://api.example.com/v1/*")).toBe(
      "https://api.example.com/v1/*"
    );
    expect(normalizeNetworkAllowlistEntry("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1"
    );
  });

  it("rebuilds rather than appends, so a query is not swallowed into the path", () => {
    expect(normalizeNetworkAllowlistEntry("https://api.example.com?x=1")).toBe(
      "https://api.example.com/?x=1"
    );
  });

  it("keeps a port and a wildcard host label", () => {
    expect(normalizeNetworkAllowlistEntry("https://a.example.com:8443")).toBe(
      "https://a.example.com:8443/*"
    );
    expect(normalizeNetworkAllowlistEntry("https://*.example.com")).toBe("https://*.example.com/*");
  });

  it("refuses everything that is not an http(s) host pattern", () => {
    for (const raw of [
      "",
      "   ",
      "example.com",
      "file:///c:/secrets",
      "steam://run/480",
      "javascript:alert(1)",
      "https://*",
      "https://user:pw@api.example.com",
      null,
      42
    ]) {
      expect(normalizeNetworkAllowlistEntry(raw)).toBeNull();
    }
  });

  it("refuses a whole-scheme wildcard, which is the wide policy wearing a list's name", () => {
    expect(normalizeNetworkAllowlistEntry("https://*")).toBeNull();
  });

  it("drops duplicates and keeps the first spelling", () => {
    expect(
      normalizeNetworkAllowlistEntries([
        "https://api.example.com",
        "https://API.example.com/",
        "https://other.example.com",
        "not a url"
      ])
    ).toEqual(["https://api.example.com/*", "https://other.example.com/*"]);
  });
});

describe("isNetworkAddressAllowed", () => {
  it("allows anything http(s) when no policy is stated", () => {
    expect(isNetworkAddressAllowed("https://anywhere.test/x", undefined)).toBe(true);
    expect(isNetworkAddressAllowed("http://anywhere.test/x", { policy: "any" })).toBe(true);
  });

  it("refuses a non-http scheme whatever the policy is", () => {
    expect(isNetworkAddressAllowed("file:///c:/secrets", undefined)).toBe(false);
    expect(isNetworkAddressAllowed("nlgame://assets/a.png", { policy: "any" })).toBe(false);
    expect(isNetworkAddressAllowed("ws://anywhere.test", listed(["https://anywhere.test"]))).toBe(
      false
    );
  });

  it("fails closed on an address it cannot parse", () => {
    expect(isNetworkAddressAllowed("not a url", undefined)).toBe(false);
    expect(isNetworkAddressAllowed("", { policy: "any" })).toBe(false);
  });

  it("matches a listed host on any path", () => {
    const allowlist = listed(["https://api.example.com"]);
    expect(isNetworkAddressAllowed("https://api.example.com/v1/data", allowlist)).toBe(true);
    expect(isNetworkAddressAllowed("https://api.example.com/", allowlist)).toBe(true);
  });

  it("does not let a listed host match a longer one", () => {
    const allowlist = listed(["https://api.example.com"]);
    expect(isNetworkAddressAllowed("https://api.example.com.evil.test/v1", allowlist)).toBe(false);
    expect(isNetworkAddressAllowed("https://evil.test/?x=https://api.example.com", allowlist)).toBe(
      false
    );
  });

  it("separates scheme and port", () => {
    const allowlist = listed(["https://api.example.com"]);
    expect(isNetworkAddressAllowed("http://api.example.com/v1", allowlist)).toBe(false);
    expect(isNetworkAddressAllowed("https://api.example.com:8443/v1", allowlist)).toBe(false);
  });

  it("honours a path an author scoped", () => {
    const allowlist = listed(["https://api.example.com/v1/*"]);
    expect(isNetworkAddressAllowed("https://api.example.com/v1/data", allowlist)).toBe(true);
    expect(isNetworkAddressAllowed("https://api.example.com/v2/data", allowlist)).toBe(false);
  });

  it("counts a plugin's declared hosts, kept separate from the author's", () => {
    const allowlist = listed(
      ["https://api.example.com"],
      [{ pluginId: "com.example.steam", patterns: ["https://partner.steam-api.test/*"] }]
    );
    expect(isNetworkAddressAllowed("https://partner.steam-api.test/x", allowlist)).toBe(true);
    expect(isNetworkAddressAllowed("https://other.test/x", allowlist)).toBe(false);
  });

  it("refuses an address carrying credentials", () => {
    const allowlist = listed(["https://api.example.com"]);
    expect(isNetworkAddressAllowed("https://api.example.com@evil.test/", allowlist)).toBe(false);
  });
});

describe("networkAllowlistCspSources", () => {
  it("says nothing to narrow to when the policy is not the list", () => {
    expect(networkAllowlistCspSources(undefined)).toBeNull();
    expect(networkAllowlistCspSources({ policy: "any", entries: ["https://a.test/*"] })).toBeNull();
  });

  it("reduces entries to origins and includes plugin hosts", () => {
    const sources = networkAllowlistCspSources(
      listed(
        ["https://api.example.com/v1/*", "https://*.cdn.example.com", "https://a.test:8443"],
        [{ pluginId: "p", patterns: ["https://plugin.test/*"] }]
      )
    );
    expect(sources).toEqual([
      "https://api.example.com",
      "https://*.cdn.example.com",
      "https://a.test:8443",
      "https://plugin.test"
    ]);
  });

  it("emits an empty list for an empty allowlist rather than null", () => {
    expect(networkAllowlistCspSources({ policy: "allowlist" })).toEqual([]);
  });
});
