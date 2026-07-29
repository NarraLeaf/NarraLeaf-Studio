import { describe, expect, it } from "vitest";
import {
    parseInfoPlist,
    parsePlist,
    parsePlistDictionary,
    patchInfoPlist,
    type InfoPlistPatch,
} from "./plist";

/**
 * A representative template Info.plist: XML plist with the placeholder
 * identity, both orientation arrays, and - critically - a NESTED dict
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

/**
 * The whole-document reader, which the provisioning-profile parser sits on.
 * Unlike the patcher it materializes values, so what matters is that every type
 * Apple actually writes comes back as the right JS thing - and that nesting is
 * honoured, since a profile's entitlements are a dict inside a dict.
 */
describe("parsePlist", () => {
    const document = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${body}
</plist>`;

    it("reads every scalar type Apple writes", () => {
        const value = parsePlistDictionary(document(`<dict>
    <key>text</key><string>hello</string>
    <key>count</key><integer>42</integer>
    <key>ratio</key><real>1.5</real>
    <key>yes</key><true/>
    <key>no</key><false/>
    <key>when</key><date>2027-07-28T00:00:00Z</date>
    <key>blob</key><data>aGVsbG8=</data>
</dict>`));
        expect(value.text).toBe("hello");
        expect(value.count).toBe(42);
        expect(value.ratio).toBe(1.5);
        expect(value.yes).toBe(true);
        expect(value.no).toBe(false);
        expect(value.when).toEqual(new Date("2027-07-28T00:00:00Z"));
        expect(Buffer.isBuffer(value.blob)).toBe(true);
        expect((value.blob as Buffer).toString("utf8")).toBe("hello");
    });

    it("reads nested dicts and arrays, and keeps their order", () => {
        const value = parsePlistDictionary(document(`<dict>
    <key>Entitlements</key><dict>
        <key>application-identifier</key><string>TEAM.com.app</string>
        <key>groups</key><array><string>a</string><string>b</string></array>
    </dict>
    <key>devices</key><array>
        <string>one</string>
        <dict><key>nested</key><integer>1</integer></dict>
    </array>
</dict>`));
        expect(value.Entitlements).toEqual({
            "application-identifier": "TEAM.com.app",
            groups: ["a", "b"],
        });
        expect(value.devices).toEqual(["one", { nested: 1 }]);
    });

    it("reads base64 data that Apple wraps across lines", () => {
        const value = parsePlistDictionary(document(`<dict>
    <key>cert</key><data>
    aGVsbG8g
    d29ybGQ=
    </data>
</dict>`));
        expect((value.cert as Buffer).toString("utf8")).toBe("hello world");
    });

    it("unescapes entities in strings", () => {
        const value = parsePlistDictionary(document(
            "<dict><key>k</key><string>a &amp; b &lt;c&gt; &quot;d&quot; &#65;</string></dict>",
        ));
        expect(value.k).toBe("a & b <c> \"d\" A");
    });

    it("gives empty elements their zero value, and fresh containers each time", () => {
        const value = parsePlistDictionary(document(
            "<dict><key>s</key><string/><key>a</key><array/><key>b</key><array/><key>d</key><dict/></dict>",
        ));
        expect(value.s).toBe("");
        expect(value.a).toEqual([]);
        expect(value.d).toEqual({});
        // Two empty arrays must not be the same object, or a later mutation of
        // one would show up in the other.
        expect(value.a).not.toBe(value.b);
    });

    it("reads a root array as well as a root dict", () => {
        expect(parsePlist(document("<array><string>x</string></array>"))).toEqual(["x"]);
    });

    it("refuses a binary plist by name rather than producing nonsense", () => {
        expect(() => parsePlist("bplist00\u0000\u0000")).toThrow(/binary property list/);
    });

    it("refuses a document whose root is not a dict when a dict is required", () => {
        expect(() => parsePlistDictionary(document("<array><string>x</string></array>")))
            .toThrow(/not a dictionary/);
    });

    it("reports malformed structure instead of guessing", () => {
        expect(() => parsePlist(document("<dict><key>k</key></dict>"))).toThrow(/Unexpected <\/dict>/);
        expect(() => parsePlist(document("<dict><string>no key</string></dict>"))).toThrow(/Expected a <key>/);
        expect(() => parsePlist(document("<dict><key>k</key><integer>oops</integer></dict>")))
            .toThrow(/Malformed <integer>/);
        expect(() => parsePlist(document("<dict><key>k</key><date>never</date></dict>")))
            .toThrow(/Malformed <date>/);
        expect(() => parsePlist("<plist><dict><key>k</key><string>x</string>")).toThrow(/Unclosed <dict>/);
    });
});
