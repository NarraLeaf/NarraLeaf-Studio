import { describe, expect, it } from "vitest";
import { ApiCapability } from "../types/pluginPermissions";
import {
  describePluginInstallPermissions,
  isPermissionSubset,
  NO_INSTALL_PERMISSIONS_COPY
} from "./pluginInstallPermissions";

describe("plugin install permission copy", () => {
  it("synthesizes install permission text from structured filesystem and api permissions", () => {
    expect(
      describePluginInstallPermissions([
        {
          kind: "filesystem",
          path: "/Users/test/Desktop/narraleaf-plugin-permission-test.txt",
          mode: "readwrite",
          recursive: false
        },
        {
          kind: "api",
          capability: ApiCapability.BashExecute
        }
      ])
    ).toEqual([
      "Read and write access for /Users/test/Desktop/narraleaf-plugin-permission-test.txt",
      "Use Studio API capability: bash.execute"
    ]);
  });

  it("uses system fallback copy when install approval has no privileged controls", () => {
    expect(describePluginInstallPermissions(undefined)).toEqual([NO_INSTALL_PERMISSIONS_COPY]);
    expect(describePluginInstallPermissions([])).toEqual([NO_INSTALL_PERMISSIONS_COPY]);
  });

  it("normalizes structured values before rendering them", () => {
    expect(
      describePluginInstallPermissions([
        {
          kind: "api",
          capability: "custom.capability\nwith.extra\tspacing"
        }
      ])
    ).toEqual(["Use Studio API capability: custom.capability with.extra spacing"]);
  });
});

describe("isPermissionSubset", () => {
  const fs = (path: string, mode: "read" | "write" | "readwrite", recursive = false) =>
    ({ kind: "filesystem", path, mode, recursive }) as const;
  const api = (capability: string) => ({ kind: "api", capability }) as const;

  it("treats empty against empty as covered", () => {
    expect(isPermissionSubset([], [])).toBe(true);
    expect(isPermissionSubset(undefined, undefined)).toBe(true);
  });

  it("covers an unchanged set", () => {
    const permissions = [api(ApiCapability.BashExecute), fs("/project", "read")];
    expect(isPermissionSubset(permissions, permissions)).toBe(true);
  });

  it("covers a set that only drops permissions", () => {
    expect(isPermissionSubset([api("a")], [api("a"), api("b")])).toBe(true);
    expect(isPermissionSubset([], [api("a")])).toBe(true);
  });

  it("rejects a newly added capability", () => {
    expect(isPermissionSubset([api("a"), api("b")], [api("a")])).toBe(false);
    expect(isPermissionSubset([api("a")], [])).toBe(false);
  });

  it("lets a broader granted mode cover a narrower request", () => {
    expect(isPermissionSubset([fs("/p", "read")], [fs("/p", "readwrite")])).toBe(true);
    expect(isPermissionSubset([fs("/p", "write")], [fs("/p", "readwrite")])).toBe(true);
    expect(isPermissionSubset([fs("/p", "readwrite")], [fs("/p", "read")])).toBe(false);
    expect(isPermissionSubset([fs("/p", "write")], [fs("/p", "read")])).toBe(false);
  });

  it("lets a recursive grant cover paths beneath it", () => {
    expect(isPermissionSubset([fs("/p/a", "read")], [fs("/p", "read", true)])).toBe(true);
    expect(isPermissionSubset([fs("/p/a", "read", true)], [fs("/p", "read", true)])).toBe(true);
    expect(isPermissionSubset([fs("/p", "read", true)], [fs("/p", "read")])).toBe(false);
    expect(isPermissionSubset([fs("/p/a", "read")], [fs("/p", "read")])).toBe(false);
  });

  it("does not mistake a sibling for a child of a recursive grant", () => {
    expect(isPermissionSubset([fs("/p/bc", "read")], [fs("/p/b", "read", true)])).toBe(false);
  });

  it("compares paths across separator styles", () => {
    expect(isPermissionSubset([fs("C:/p/a", "read")], [fs("C:\\p", "read", true)])).toBe(true);
  });

  it("never lets one kind cover another", () => {
    expect(isPermissionSubset([api("/p")], [fs("/p", "readwrite", true)])).toBe(false);
    expect(isPermissionSubset([fs("/p", "read")], [api("/p")])).toBe(false);
  });
});

/**
 * External-link patterns and the update prompt.
 *
 * The rule the whole derived-permission design rests on: an update that can reach somewhere new is
 * an update the author is asked about again. Anything this cannot prove is covered counts as new.
 */
describe("isPermissionSubset — externalLink", () => {
  const links = (...patterns: string[]) => ({ kind: "externalLink", patterns }) as const;

  it("inherits the grant when the patterns did not change", () => {
    expect(isPermissionSubset([links("steam://*")], [links("steam://*")])).toBe(true);
    expect(
      isPermissionSubset(
        [links("steam://*", "https://store.example.com/app/*")],
        [links("https://store.example.com/app/*", "steam://*")]
      )
    ).toBe(true);
  });

  it("re-prompts when a pattern is added", () => {
    expect(
      isPermissionSubset([links("steam://*", "https://evil.test/*")], [links("steam://*")])
    ).toBe(false);
    expect(isPermissionSubset([links("steam://*")], [])).toBe(false);
  });

  it("lets a narrowed pattern list inherit, because dropping one reaches nowhere new", () => {
    expect(
      isPermissionSubset([links("steam://*")], [links("steam://*", "https://x.example.com/")])
    ).toBe(true);
  });

  it("re-prompts when a pattern is widened rather than added", () => {
    // Deliberately conservative: this compares the declared strings, not what they cover. A
    // pattern that now reaches further is a different string, so it asks again.
    expect(
      isPermissionSubset([links("https://*.example.com/*")], [links("https://store.example.com/*")])
    ).toBe(false);
    expect(
      isPermissionSubset(
        [links("https://store.example.com/*")],
        [links("https://store.example.com/app/*")]
      )
    ).toBe(false);
  });

  it("never lets another kind cover it", () => {
    expect(
      isPermissionSubset([links("steam://*")], [{ kind: "runtime", capability: "store" }])
    ).toBe(false);
  });
});

describe("isPermissionSubset — sidecar", () => {
  const sidecar = (sidecarKind: "executable" | "node", ...platforms: string[]) =>
    ({ kind: "sidecar", id: "acme.steam.bridge", sidecarKind, platforms }) as const;

  it("inherits the grant when nothing about the sidecar changed", () => {
    expect(
      isPermissionSubset(
        [sidecar("executable", "windows-x64")],
        [sidecar("executable", "windows-x64", "linux-x64")]
      )
    ).toBe(true);
  });

  it("re-prompts when the same sidecar changes what it starts", () => {
    // Turning a separate binary into the plugin's own code inside the game is a different
    // thing to approve, and the id and platforms alone cannot see the difference.
    expect(
      isPermissionSubset([sidecar("node", "windows-x64")], [sidecar("executable", "windows-x64")])
    ).toBe(false);
    expect(
      isPermissionSubset([sidecar("executable", "windows-x64")], [sidecar("node", "windows-x64")])
    ).toBe(false);
  });
});

describe("plugin install permission copy — sidecar", () => {
  it("says which of the two a sidecar is", () => {
    expect(
      describePluginInstallPermissions([
        {
          kind: "sidecar",
          id: "acme.steam.bridge",
          sidecarKind: "executable",
          platforms: ["windows-x64"]
        },
        {
          kind: "sidecar",
          id: "acme.steam.helper",
          sidecarKind: "node",
          platforms: ["windows-x64"]
        }
      ])
    ).toEqual([
      "Ship a separate program and run it with your game (acme.steam.bridge, for windows-x64)",
      "Ship the plugin's own code and run it as part of your game (acme.steam.helper, for windows-x64)"
    ]);
  });
});

describe("plugin install permission copy — externalLink", () => {
  it("names every pattern rather than counting them", () => {
    expect(
      describePluginInstallPermissions([
        { kind: "externalLink", patterns: ["steam://*", "https://store.example.com/app/*"] }
      ])
    ).toEqual(["In your game: send the player to steam://*, https://store.example.com/app/*"]);
  });
});
