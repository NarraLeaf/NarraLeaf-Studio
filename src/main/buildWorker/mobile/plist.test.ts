import { describe, expect, it } from "vitest";
import { parseInfoPlist, patchInfoPlist, type InfoPlistPatch } from "./plist";

/**
 * A representative template Info.plist: XML plist with the placeholder
 * identity, both orientation arrays, and — critically — a NESTED dict
 * (CFBundleIcons) whose inner keys must never be mistaken for top-level ones,
 * plus a nested key literally named "CFBundleIdentifier" to prove the
 * depth-aware locator does not touch it.
 */
const TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleIdentifier</key>
\t<string>com.narraleaf.shell.placeholder</string>
\t<key>CFBundleDisplayName</key>
\t<string>NarraLeaf Shell</string>
\t<key>CFBundleExecutable</key>
\t<string>Shell</string>
\t<key>CFBundleShortVersionString</key>
\t<string>0.0.0</string>
\t<key>CFBundleVersion</key>
\t<string>1</string>
\t<key>CFBundleIcons</key>
\t<dict>
\t\t<key>CFBundlePrimaryIcon</key>
\t\t<dict>
\t\t\t<key>CFBundleIdentifier</key>
\t\t\t<string>nested-should-not-be-touched</string>
\t\t\t<key>CFBundleIconFiles</key>
\t\t\t<array>
\t\t\t\t<string>AppIcon60x60</string>
\t\t\t</array>
\t\t</dict>
\t</dict>
\t<key>UISupportedInterfaceOrientations</key>
\t<array>
\t\t<string>UIInterfaceOrientationLandscapeLeft</string>
\t\t<string>UIInterfaceOrientationLandscapeRight</string>
\t</array>
\t<key>UISupportedInterfaceOrientations~ipad</key>
\t<array>
\t\t<string>UIInterfaceOrientationLandscapeLeft</string>
\t</array>
\t<key>UILaunchStoryboardName</key>
\t<string>LaunchScreen</string>
</dict>
</plist>
`;

const FULL_PATCH: InfoPlistPatch = {
    bundleId: "com.acme.mygame",
    displayName: "My Game",
    shortVersionString: "1.2.3",
    bundleVersion: "1002003",
    orientation: "portrait",
};

describe("parseInfoPlist", () => {
    it("reads the top-level identity, ignoring the nested dict", () => {
        expect(parseInfoPlist(TEMPLATE)).toEqual({
            bundleId: "com.narraleaf.shell.placeholder",
            displayName: "NarraLeaf Shell",
            shortVersionString: "0.0.0",
            bundleVersion: "1",
        });
    });

    it("rejects a plist with no root dict", () => {
        expect(() => parseInfoPlist("<?xml version=\"1.0\"?><plist></plist>")).toThrow(/root <dict>/);
    });
});

describe("patchInfoPlist", () => {
    it("rewrites the identity and reads it back", () => {
        const patched = patchInfoPlist(TEMPLATE, FULL_PATCH);
        expect(parseInfoPlist(patched)).toEqual({
            bundleId: "com.acme.mygame",
            displayName: "My Game",
            shortVersionString: "1.2.3",
            bundleVersion: "1002003",
        });
    });

    it("never touches the nested CFBundleIdentifier inside CFBundleIcons", () => {
        const patched = patchInfoPlist(TEMPLATE, { bundleId: "com.acme.mygame" });
        expect(patched).toContain("<string>nested-should-not-be-touched</string>");
        // Exactly one top-level identifier was rewritten.
        expect(patched.match(/com\.acme\.mygame/g)?.length).toBe(1);
        expect(patched).not.toContain("com.narraleaf.shell.placeholder");
    });

    it("replaces the orientation whitelist for both device arrays", () => {
        const patched = patchInfoPlist(TEMPLATE, { orientation: "portrait" });
        expect(patched).toContain("<string>UIInterfaceOrientationPortrait</string>");
        expect(patched).toContain("<string>UIInterfaceOrientationPortraitUpsideDown</string>");
        expect(patched).not.toContain("UIInterfaceOrientationLandscapeLeft");
    });

    it("expands 'auto' to all four orientations", () => {
        const patched = patchInfoPlist(TEMPLATE, { orientation: "auto" });
        for (const value of [
            "UIInterfaceOrientationPortrait",
            "UIInterfaceOrientationPortraitUpsideDown",
            "UIInterfaceOrientationLandscapeLeft",
            "UIInterfaceOrientationLandscapeRight",
        ]) {
            expect(patched).toContain(`<string>${value}</string>`);
        }
    });

    it("escapes XML metacharacters in a display name", () => {
        const patched = patchInfoPlist(TEMPLATE, { displayName: "Tom & Jerry <Deluxe>" });
        expect(patched).toContain("<string>Tom &amp; Jerry &lt;Deluxe&gt;</string>");
        expect(parseInfoPlist(patched).displayName).toBe("Tom & Jerry <Deluxe>");
    });

    it("is idempotent", () => {
        const once = patchInfoPlist(TEMPLATE, FULL_PATCH);
        const twice = patchInfoPlist(once, FULL_PATCH);
        expect(twice).toBe(once);
    });

    it("patches a subset, leaving other fields and structure intact", () => {
        const patched = patchInfoPlist(TEMPLATE, { bundleVersion: "42" });
        expect(parseInfoPlist(patched)).toEqual({
            bundleId: "com.narraleaf.shell.placeholder",
            displayName: "NarraLeaf Shell",
            shortVersionString: "0.0.0",
            bundleVersion: "42",
        });
        expect(patched).toContain("<key>CFBundleExecutable</key>");
        expect(patched).toContain("<string>LaunchScreen</string>");
    });

    it("throws when a targeted key is absent (template drift)", () => {
        const withoutVersion = TEMPLATE.replace(
            "\t<key>CFBundleVersion</key>\n\t<string>1</string>\n",
            "",
        );
        expect(() => patchInfoPlist(withoutVersion, { bundleVersion: "2" }))
            .toThrow(/no top-level <string> value for CFBundleVersion/);
    });

    it("throws when no orientation array exists", () => {
        const withoutOrientation = TEMPLATE
            .replace(/\t<key>UISupportedInterfaceOrientations<\/key>\n\t<array>[\s\S]*?<\/array>\n/, "")
            .replace(/\t<key>UISupportedInterfaceOrientations~ipad<\/key>\n\t<array>[\s\S]*?<\/array>\n/, "");
        expect(() => patchInfoPlist(withoutOrientation, { orientation: "landscape" }))
            .toThrow(/no UISupportedInterfaceOrientations array/);
    });
});
