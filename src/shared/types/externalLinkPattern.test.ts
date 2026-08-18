/**
 * The plugin address matcher, tested from the attacker's side first.
 *
 * Every case below is a way a matcher written with `startsWith`, `endsWith` or `includes` would say
 * yes to an address the author never declared. They are the point of the file: the happy path is
 * one `it`, and the rest is the boundary.
 */

import { describe, expect, it } from "vitest";
import {
  EXTERNAL_LINK_PATTERN_DENIED_SCHEMES,
  externalLinkPatternKey,
  isExternalLinkPatternDeclared,
  isValidExternalLinkPattern,
  matchesExternalLinkPattern
} from "./externalLinkPattern";

describe("matchesExternalLinkPattern — hosts", () => {
  it("covers subdomains at any depth under a leading wildcard", () => {
    expect(matchesExternalLinkPattern("https://*.example.com/*", "https://a.example.com/x")).toBe(
      true
    );
    expect(
      matchesExternalLinkPattern("https://*.example.com/*", "https://b.a.example.com/x/y")
    ).toBe(true);
  });

  it("refuses a host that merely starts with the declared one", () => {
    // The case that killed prefix matching for the core node: as a string,
    // `https://store.example.com` is a prefix of this address.
    expect(
      matchesExternalLinkPattern("https://*.example.com/*", "https://example.com.evil.test/x")
    ).toBe(false);
    expect(
      matchesExternalLinkPattern(
        "https://store.example.com/",
        "https://store.example.com.evil.test/"
      )
    ).toBe(false);
  });

  it("refuses the bare domain under a leading wildcard", () => {
    // A wildcard label stands for at least one label. `a.b` is beneath `b`; `b` is not.
    expect(matchesExternalLinkPattern("https://*.example.com/*", "https://example.com/x")).toBe(
      false
    );
  });

  it("refuses a host that ends with the declared labels but is not beneath them", () => {
    expect(matchesExternalLinkPattern("https://*.example.com/*", "https://notexample.com/x")).toBe(
      false
    );
    // `endsWith(".example.com")` would pass this; label comparison does not.
    expect(
      matchesExternalLinkPattern("https://*.example.com/*", "https://evil-example.com/x")
    ).toBe(false);
  });

  it("matches an uppercase host, and an uppercase scheme", () => {
    expect(
      matchesExternalLinkPattern(
        "https://store.example.com/app/*",
        "HTTPS://STORE.EXAMPLE.COM/app/480"
      )
    ).toBe(true);
    // Opaque hosts are NOT lowercased by URL, so this one only passes because the matcher
    // lowercases both sides itself.
    expect(matchesExternalLinkPattern("steam://run/*", "steam://RUN/480")).toBe(true);
  });

  it("treats a bare `*` host as any host in that scheme", () => {
    expect(matchesExternalLinkPattern("steam://*", "steam://run/480")).toBe(true);
    expect(matchesExternalLinkPattern("steam://*", "steam://store/480")).toBe(true);
    expect(matchesExternalLinkPattern("steam://*", "steam://rungameid/480?x=1#y")).toBe(true);
    // Still one scheme, and only one.
    expect(matchesExternalLinkPattern("steam://*", "https://store.example.com/")).toBe(false);
  });
});

describe("matchesExternalLinkPattern — scheme and port", () => {
  it("refuses a scheme mismatch", () => {
    expect(
      matchesExternalLinkPattern("https://store.example.com/", "http://store.example.com/")
    ).toBe(false);
    expect(matchesExternalLinkPattern("steam://run/480", "https://run/480")).toBe(false);
  });

  it("refuses a port mismatch, and treats a default port as no port", () => {
    expect(matchesExternalLinkPattern("https://example.com/x", "https://example.com:8443/x")).toBe(
      false
    );
    expect(matchesExternalLinkPattern("https://example.com:8443/x", "https://example.com/x")).toBe(
      false
    );
    expect(
      matchesExternalLinkPattern("https://example.com:8443/x", "https://example.com:8443/x")
    ).toBe(true);
    // `:443` on https is the default; URL removes it from both sides, so they are one authority.
    expect(matchesExternalLinkPattern("https://example.com:443/x", "https://example.com/x")).toBe(
      true
    );
  });
});

describe("matchesExternalLinkPattern — paths", () => {
  it("treats a trailing star as a segment-boundary prefix", () => {
    expect(
      matchesExternalLinkPattern(
        "https://store.example.com/app/*",
        "https://store.example.com/app/480"
      )
    ).toBe(true);
    expect(
      matchesExternalLinkPattern(
        "https://store.example.com/app/*",
        "https://store.example.com/app/480/reviews"
      )
    ).toBe(true);
  });

  it("refuses a path that shares a prefix but not a segment", () => {
    // The path half of the same trap: `/appeal` starts with `/app`.
    expect(
      matchesExternalLinkPattern(
        "https://store.example.com/app/*",
        "https://store.example.com/appeal"
      )
    ).toBe(false);
    expect(
      matchesExternalLinkPattern(
        "https://store.example.com/app/*",
        "https://store.example.com/appeal/480"
      )
    ).toBe(false);
  });

  it("matches only itself when the pattern carries no wildcard", () => {
    const pattern = "https://store.example.com/app/480";
    expect(matchesExternalLinkPattern(pattern, "https://store.example.com/app/480")).toBe(true);
    expect(matchesExternalLinkPattern(pattern, "https://store.example.com/app/481")).toBe(false);
    expect(matchesExternalLinkPattern(pattern, "https://store.example.com/app/480/reviews")).toBe(
      false
    );
    expect(matchesExternalLinkPattern(pattern, "https://store.example.com/")).toBe(false);
    expect(matchesExternalLinkPattern(pattern, "https://store.example.com/app")).toBe(false);
  });

  it("ignores a query and fragment the pattern does not name", () => {
    expect(
      matchesExternalLinkPattern(
        "https://store.example.com/app/480",
        "https://store.example.com/app/480?utm=1#reviews"
      )
    ).toBe(true);
  });

  it("requires an exact match for a query the pattern does name", () => {
    expect(
      matchesExternalLinkPattern("https://x.example.com/s?q=1", "https://x.example.com/s?q=1")
    ).toBe(true);
    expect(
      matchesExternalLinkPattern("https://x.example.com/s?q=1", "https://x.example.com/s?q=2")
    ).toBe(false);
    expect(
      matchesExternalLinkPattern("https://x.example.com/s?q=1", "https://x.example.com/s")
    ).toBe(false);
    expect(
      matchesExternalLinkPattern("https://x.example.com/s#a", "https://x.example.com/s#b")
    ).toBe(false);
  });
});

describe("matchesExternalLinkPattern — credentials and denied schemes", () => {
  it("refuses a candidate carrying userinfo, however well its host reads", () => {
    // Parses to the host `store.example.com`, so a host-only check passes it. The address a
    // person reads and the address it goes to are the whole trick, so it is refused outright.
    expect(
      matchesExternalLinkPattern("https://store.example.com/", "https://evil@store.example.com/")
    ).toBe(false);
    expect(
      matchesExternalLinkPattern("https://*.example.com/*", "https://store.example.com@evil.test/x")
    ).toBe(false);
    expect(
      matchesExternalLinkPattern(
        "https://store.example.com/",
        "https://user:pass@store.example.com/"
      )
    ).toBe(false);
  });

  it("refuses a pattern carrying userinfo, so one can never be declared", () => {
    expect(isValidExternalLinkPattern("https://evil@store.example.com/")).toBe(false);
    expect(
      matchesExternalLinkPattern(
        "https://evil@store.example.com/",
        "https://evil@store.example.com/"
      )
    ).toBe(false);
  });

  it("refuses every denied scheme on both sides", () => {
    for (const scheme of EXTERNAL_LINK_PATTERN_DENIED_SCHEMES) {
      const address = `${scheme}whatever`;
      expect(isValidExternalLinkPattern(address)).toBe(false);
      expect(matchesExternalLinkPattern(address, address)).toBe(false);
      // And no other pattern can reach one either, because the scheme must be equal.
      expect(matchesExternalLinkPattern("https://*.example.com/*", address)).toBe(false);
    }
    expect(matchesExternalLinkPattern("javascript://*", "javascript:alert(1)")).toBe(false);
  });
});

describe("matchesExternalLinkPattern — malformed input", () => {
  it("answers false rather than throwing", () => {
    expect(matchesExternalLinkPattern("https://x.example.com/", "not a url")).toBe(false);
    expect(matchesExternalLinkPattern("not a pattern", "https://x.example.com/")).toBe(false);
    expect(matchesExternalLinkPattern("", "")).toBe(false);
    expect(matchesExternalLinkPattern("https://x.example.com/", "/app/480")).toBe(false);
    expect(matchesExternalLinkPattern("https://x.example.com/", "   ")).toBe(false);
  });

  it("trims a candidate the way the declaration was trimmed", () => {
    expect(matchesExternalLinkPattern("https://x.example.com/a", " https://x.example.com/a ")).toBe(
      true
    );
  });
});

describe("isValidExternalLinkPattern", () => {
  it("accepts the forms a plugin is meant to declare", () => {
    for (const pattern of [
      "https://store.steampowered.com/app/*",
      "https://*.example.com/*",
      "steam://*",
      "steam://run/480",
      "https://example.com:8443/x"
    ]) {
      expect(isValidExternalLinkPattern(pattern)).toBe(true);
    }
  });

  it("refuses anything that is not an absolute address with a scheme", () => {
    for (const pattern of ["store.example.com/*", "/app/*", "*", "  ", "*://example.com/"]) {
      expect(isValidExternalLinkPattern(pattern)).toBe(false);
    }
  });

  it("refuses a `*` that is not a whole leading host label", () => {
    // These look like wildcards and are not. Accepting them would put a permission in front of
    // the author that grants nothing at all.
    for (const pattern of [
      "https://*x.example.com/*",
      "https://a.*.example.com/*",
      "https://*.*.example.com/*",
      "https://exa*ple.com/*"
    ]) {
      expect(isValidExternalLinkPattern(pattern)).toBe(false);
    }
  });

  it("gives two spellings of one address the same key, so a duplicate is findable", () => {
    expect(externalLinkPatternKey("HTTPS://STORE.EXAMPLE.COM/app/*")).toBe(
      externalLinkPatternKey("https://store.example.com/app/*")
    );
    expect(externalLinkPatternKey("https://a.example.com/x")).not.toBe(
      externalLinkPatternKey("https://b.example.com/x")
    );
  });
});

describe("isExternalLinkPatternDeclared", () => {
  it("is false for an empty or missing list", () => {
    expect(isExternalLinkPatternDeclared(undefined, "https://x.example.com/")).toBe(false);
    expect(isExternalLinkPatternDeclared([], "https://x.example.com/")).toBe(false);
  });

  it("passes an address any one pattern covers, and refuses the rest", () => {
    const declared = ["https://store.steampowered.com/app/*", "steam://*"];
    expect(isExternalLinkPatternDeclared(declared, "https://store.steampowered.com/app/480")).toBe(
      true
    );
    expect(isExternalLinkPatternDeclared(declared, "steam://run/480")).toBe(true);
    expect(
      isExternalLinkPatternDeclared(declared, "https://store.steampowered.com.evil.test/app/480")
    ).toBe(false);
    expect(isExternalLinkPatternDeclared(declared, "https://store.steampowered.com/appeal")).toBe(
      false
    );
  });

  it("keeps one plugin's list from covering another's addresses", () => {
    // Two plugins, two lists. The lists are never merged anywhere - this is the property every
    // caller relies on, checked at the level where a merge would be invisible.
    const steam = ["steam://*", "https://store.steampowered.com/app/*"];
    const itch = ["https://itch.io/game/*"];
    expect(isExternalLinkPatternDeclared(itch, "steam://run/480")).toBe(false);
    expect(isExternalLinkPatternDeclared(itch, "https://store.steampowered.com/app/480")).toBe(
      false
    );
    expect(isExternalLinkPatternDeclared(steam, "https://itch.io/game/7")).toBe(false);
    expect(isExternalLinkPatternDeclared(steam, "steam://run/480")).toBe(true);
    expect(isExternalLinkPatternDeclared(itch, "https://itch.io/game/7")).toBe(true);
  });
});
