import { describe, expect, it } from "vitest";
import {
    NETWORK_POLICY_ALLOWLIST,
    NETWORK_POLICY_ANY,
    isLocalNetworkHost,
    isNetworkAddressAllowed,
    networkAllowlistCspSources,
    normalizeNetworkAllowlistEntries,
    normalizeNetworkAllowlistEntry,
    type NetworkAllowlist,
} from "./networkAllowlist";

const listed = (entries: string[], plugins: NetworkAllowlist["plugins"] = []): NetworkAllowlist => ({
    policy: "allowlist",
    entries: normalizeNetworkAllowlistEntries(entries),
    plugins,
});

describe("normalizeNetworkAllowlistEntry", () => {
    it("reads a bare authority as the whole host", () => {
        expect(normalizeNetworkAllowlistEntry("https://api.example.com")).toBe("https://api.example.com/*");
        expect(normalizeNetworkAllowlistEntry("https://api.example.com/")).toBe("https://api.example.com/*");
    });

    it("keeps a path the author wrote", () => {
        expect(normalizeNetworkAllowlistEntry("https://api.example.com/v1/*")).toBe("https://api.example.com/v1/*");
        expect(normalizeNetworkAllowlistEntry("https://api.example.com/v1")).toBe("https://api.example.com/v1");
    });

    it("rebuilds rather than appends, so a query is not swallowed into the path", () => {
        expect(normalizeNetworkAllowlistEntry("https://api.example.com?x=1")).toBe("https://api.example.com/?x=1");
    });

    it("keeps a port and a wildcard host label", () => {
        expect(normalizeNetworkAllowlistEntry("https://a.example.com:8443")).toBe("https://a.example.com:8443/*");
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
            42,
        ]) {
            expect(normalizeNetworkAllowlistEntry(raw)).toBeNull();
        }
    });

    it("refuses a whole-scheme wildcard, which is the wide policy wearing a list's name", () => {
        expect(normalizeNetworkAllowlistEntry("https://*")).toBeNull();
    });

    it("drops duplicates and keeps the first spelling", () => {
        expect(normalizeNetworkAllowlistEntries([
            "https://api.example.com",
            "https://API.example.com/",
            "https://other.example.com",
            "not a url",
        ])).toEqual(["https://api.example.com/*", "https://other.example.com/*"]);
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
        expect(isNetworkAddressAllowed("ws://anywhere.test", listed(["https://anywhere.test"]))).toBe(false);
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
        expect(isNetworkAddressAllowed("https://evil.test/?x=https://api.example.com", allowlist)).toBe(false);
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
        const allowlist = listed(["https://api.example.com"], [
            { pluginId: "com.example.steam", patterns: ["https://partner.steam-api.test/*"] },
        ]);
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
        const sources = networkAllowlistCspSources(listed(
            ["https://api.example.com/v1/*", "https://*.cdn.example.com", "https://a.test:8443"],
            [{ pluginId: "p", patterns: ["https://plugin.test/*"] }],
        ));
        expect(sources).toEqual([
            "https://api.example.com",
            "https://*.cdn.example.com",
            "https://a.test:8443",
            "https://plugin.test",
        ]);
    });

    it("emits an empty list for an empty allowlist rather than null", () => {
        expect(networkAllowlistCspSources({ policy: "allowlist" })).toEqual([]);
    });
});

describe("isLocalNetworkHost", () => {
    it("names the local network in every spelling the parser hands over", () => {
        for (const url of [
            "http://10.0.0.1/",
            "http://172.16.5.4/",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://100.64.0.1/",
            "http://0.0.0.0/",
            "http://[fd00::1]/",
            "http://[fe80::1]/",
            "http://[::ffff:192.168.0.1]/",
            "http://3232235777/",
        ]) {
            expect(isLocalNetworkHost(new URL(url).hostname), url).toBe(true);
        }
    });

    it("leaves the internet and loopback alone", () => {
        for (const url of ["https://api.example.com/", "http://8.8.8.8/", "http://172.32.0.1/", "http://localhost:3000/", "http://127.0.0.1/", "http://[::1]/", "http://[2001:db8::1]/"]) {
            expect(isLocalNetworkHost(new URL(url).hostname), url).toBe(false);
        }
    });

    it("is what \"any address\" refuses, and an allowlist entry still opens it", () => {
        expect(isNetworkAddressAllowed("http://192.168.1.1/admin", { policy: NETWORK_POLICY_ANY })).toBe(false);
        expect(isNetworkAddressAllowed("https://api.example.com/", { policy: NETWORK_POLICY_ANY })).toBe(true);
        expect(isNetworkAddressAllowed("http://localhost:3000/api", { policy: NETWORK_POLICY_ANY })).toBe(true);
        expect(isNetworkAddressAllowed("http://192.168.1.1/admin", {
            policy: NETWORK_POLICY_ALLOWLIST,
            entries: ["http://192.168.1.1/*"],
        })).toBe(true);
    });
});
