import { describe, expect, it } from "vitest";
import {
    extractProvisioningProfilePlist,
    parseProvisioningProfile,
    profileCoversBundleId,
    profileHasExpired,
} from "./provisioningProfile";
import {
    APPLE_PROFILE_APP_ID,
    APPLE_PROFILE_BUNDLE_ID,
    APPLE_PROFILE_NAME,
    APPLE_PROFILE_TEAM,
    appleProvisioningProfile,
} from "./signingFixtures";

/**
 * The fixture is a real CMS-wrapped profile, so these tests cover the unwrap as
 * well as the reading. The synthetic plists below are for the cases a single
 * fixture cannot carry - wildcards, distribution profiles, damage.
 */

const BEFORE_EXPIRY = new Date("2027-01-01T00:00:00Z");
const AFTER_EXPIRY = new Date("2028-01-01T00:00:00Z");

function plistProfile(overrides: {
    applicationIdentifier?: string;
    expiration?: string;
    devices?: string[];
    getTaskAllow?: boolean;
}): Buffer {
    const devices = (overrides.devices ?? [])
        .map(device => `<string>${device}</string>`)
        .join("");
    return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>UUID</key><string>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</string>
    <key>Name</key><string>Synthetic Profile</string>
    <key>TeamName</key><string>Probe Tester</string>
    <key>TeamIdentifier</key><array><string>TEAM123456</string></array>
    <key>CreationDate</key><date>2026-01-02T03:04:05Z</date>
    <key>ExpirationDate</key><date>${overrides.expiration ?? "2027-07-28T00:00:00Z"}</date>
    <key>ProvisionedDevices</key><array>${devices}</array>
    <key>Entitlements</key><dict>
        <key>application-identifier</key><string>${overrides.applicationIdentifier ?? "TEAM123456.com.example.app"}</string>
        <key>com.apple.developer.team-identifier</key><string>TEAM123456</string>
        <key>get-task-allow</key>${overrides.getTaskAllow === false ? "<false/>" : "<true/>"}
    </dict>
</dict>
</plist>`, "utf8");
}

describe("extractProvisioningProfilePlist", () => {
    it("recovers the XML payload from the CMS envelope", () => {
        const xml = extractProvisioningProfilePlist(appleProvisioningProfile());
        expect(xml.startsWith("<?xml")).toBe(true);
        expect(xml).toContain("<key>ExpirationDate</key>");
        // The envelope's own bytes must be gone, not merely skipped past.
        expect(xml.trimEnd().endsWith("</plist>")).toBe(true);
    });

    it("passes a bare plist through, so a caller need not know which shape it has", () => {
        const bare = plistProfile({});
        expect(extractProvisioningProfilePlist(bare)).toBe(bare.toString("utf8"));
    });

    it("refuses something that is neither", () => {
        expect(() => extractProvisioningProfilePlist(Buffer.from("not a profile at all")))
            .toThrow(/neither a signed document nor a property list/);
    });

    it("refuses a truncated envelope rather than returning a fragment", () => {
        const truncated = appleProvisioningProfile().subarray(0, 500);
        expect(() => extractProvisioningProfilePlist(truncated)).toThrow(/could not be read/);
    });
});

describe("parseProvisioningProfile", () => {
    it("reads the facts a build needs off the real fixture", () => {
        const profile = parseProvisioningProfile(appleProvisioningProfile());
        expect(profile.name).toBe(APPLE_PROFILE_NAME);
        expect(profile.teamIdentifier).toBe(APPLE_PROFILE_TEAM);
        expect(profile.applicationIdentifier).toBe(APPLE_PROFILE_APP_ID);
        expect(profile.bundleIdPattern).toBe(APPLE_PROFILE_BUNDLE_ID);
        expect(profile.uuid).toBe("11111111-2222-3333-4444-555555555555");
        expect(profile.teamName).toBe("Probe Tester");
        expect(profile.expiresAt.toISOString()).toBe("2027-07-28T00:00:00.000Z");
        expect(profile.provisionedDevices).toEqual(["00008030-000000000000000E"]);
        expect(profile.allowsDebugging).toBe(true);
    });

    it("keeps the entitlements dictionary, which is what the signature carries", () => {
        const profile = parseProvisioningProfile(appleProvisioningProfile());
        expect(profile.entitlements["keychain-access-groups"]).toEqual(["TEAM123456.*"]);
    });

    it("reads a distribution profile as one with no device limit", () => {
        const profile = parseProvisioningProfile(plistProfile({ devices: [], getTaskAllow: false }));
        expect(profile.provisionedDevices).toEqual([]);
        expect(profile.allowsDebugging).toBe(false);
    });

    it("splits the team prefix off the bundle id, wildcard and all", () => {
        expect(parseProvisioningProfile(plistProfile({ applicationIdentifier: "TEAM123456.*" })).bundleIdPattern)
            .toBe("*");
        expect(parseProvisioningProfile(plistProfile({ applicationIdentifier: "TEAM123456.com.a.b.c" })).bundleIdPattern)
            .toBe("com.a.b.c");
    });

    it("names what is missing rather than returning a half-read profile", () => {
        expect(() => parseProvisioningProfile(Buffer.from("<plist><dict></dict></plist>")))
            .toThrow(/entitlements are missing/);
        expect(() => parseProvisioningProfile(plistProfile({ applicationIdentifier: "TEAM123456." })))
            .toThrow(/has no bundle id/);
    });
});

describe("profileCoversBundleId", () => {
    const profile = parseProvisioningProfile(appleProvisioningProfile());

    it("accepts the app it was issued for", () => {
        expect(profileCoversBundleId(profile, APPLE_PROFILE_BUNDLE_ID)).toEqual({ matches: true });
    });

    it("rejects a different app, and says which is which", () => {
        const result = profileCoversBundleId(profile, "com.narraleaf.games.other");
        expect(result.matches).toBe(false);
        if (result.matches) {
            throw new Error("unreachable");
        }
        expect(result.message).toContain(APPLE_PROFILE_APP_ID);
        expect(result.message).toContain("com.narraleaf.games.other");
    });

    it("rejects a bundle id that merely starts with the profile's, absent a wildcard", () => {
        // "com.narraleaf.games.probe2" starts with the pattern; only a wildcard
        // profile may match by prefix.
        expect(profileCoversBundleId(profile, `${APPLE_PROFILE_BUNDLE_ID}2`).matches).toBe(false);
    });

    it("honours a wildcard profile", () => {
        const wildcard = parseProvisioningProfile(
            plistProfile({ applicationIdentifier: "TEAM123456.com.narraleaf.*" }),
        );
        expect(profileCoversBundleId(wildcard, "com.narraleaf.games.probe").matches).toBe(true);
        expect(profileCoversBundleId(wildcard, "com.example.other").matches).toBe(false);
    });

    it("honours a team-wide wildcard", () => {
        const anything = parseProvisioningProfile(plistProfile({ applicationIdentifier: "TEAM123456.*" }));
        expect(profileCoversBundleId(anything, "literally.anything").matches).toBe(true);
    });
});

describe("profileHasExpired", () => {
    const profile = parseProvisioningProfile(appleProvisioningProfile());

    it("is false before the expiry and true after it", () => {
        expect(profileHasExpired(profile, BEFORE_EXPIRY)).toBe(false);
        expect(profileHasExpired(profile, AFTER_EXPIRY)).toBe(true);
    });

    it("treats the expiry instant itself as expired", () => {
        expect(profileHasExpired(profile, profile.expiresAt)).toBe(true);
    });
});
