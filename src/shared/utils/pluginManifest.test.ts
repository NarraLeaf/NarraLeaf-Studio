import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { validatePluginManifest } from "./pluginManifest";

describe("validatePluginManifest", () => {
    it("normalizes a valid dual-entry manifest", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: {
                studio: "main.js",
                runtime: "runtime.js",
            },
            permissions: [
                {
                    kind: "api",
                    capability: "bash.execute",
                },
            ],
        });

        expect(result).toMatchObject({
            ok: true,
            manifest: {
                id: "acme.sample-plugin",
                entries: { studio: "main.js", runtime: "runtime.js" },
                permissions: [{ kind: "api", capability: "bash.execute" }],
            },
        });
    });

    it("accepts a runtime-only manifest", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: {
                runtime: "runtime.js",
            },
        });

        expect(result).toMatchObject({
            ok: true,
            manifest: {
                entries: { runtime: "runtime.js" },
            },
        });
        expect((result as { manifest: { entries: Record<string, string> } }).manifest.entries.studio).toBeUndefined();
    });

    it("normalizes contributes and defaults blueprintNodes to an empty list", () => {
        const withContributes = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
            contributes: {
                blueprintNodes: ["acme.sample-plugin.do-thing", "acme.sample-plugin.do-thing"],
            },
        });
        expect(withContributes).toMatchObject({
            ok: true,
            manifest: {
                contributes: { blueprintNodes: ["acme.sample-plugin.do-thing"] },
            },
        });

        const withoutContributes = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { studio: "main.js" },
        });
        expect(withoutContributes).toMatchObject({
            ok: true,
            manifest: {
                contributes: { blueprintNodes: [] },
            },
        });
    });

    it("normalizes contributed widget types", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
            contributes: {
                widgets: ["acme.sample-plugin.badge"],
            },
        });

        expect(result).toMatchObject({
            ok: true,
            manifest: {
                contributes: { blueprintNodes: [], widgets: ["acme.sample-plugin.badge"] },
            },
        });

        const invalid = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
            contributes: {
                widgets: ["other.badge"],
            },
        });
        expect(invalid).toMatchObject({
            ok: false,
            error: expect.stringContaining("prefixed with the plugin id"),
        });
    });

    it("normalizes contributed runtime data namespaces", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
            contributes: {
                runtimeData: ["acme.sample-plugin.catalog", "acme.sample-plugin.catalog"],
            },
        });

        expect(result).toMatchObject({
            ok: true,
            manifest: {
                contributes: {
                    blueprintNodes: [],
                    widgets: [],
                    runtimeData: ["acme.sample-plugin.catalog"],
                },
            },
        });

        // Namespaces are plugin-scoped on disk, so an unprefixed one would point
        // at another plugin's store (or a core service store).
        const invalid = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
            contributes: {
                runtimeData: ["panelState"],
            },
        });
        expect(invalid).toMatchObject({
            ok: false,
            error: expect.stringContaining("prefixed with the plugin id"),
        });
    });

    it("normalizes contributed test ids", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { studio: "main.js" },
            contributes: {
                tests: ["acme.sample-plugin.smoke", "acme.sample-plugin.smoke"],
            },
        });

        expect(result).toMatchObject({
            ok: true,
            manifest: {
                contributes: {
                    blueprintNodes: [],
                    widgets: [],
                    tests: ["acme.sample-plugin.smoke"],
                },
            },
        });

        // The registry keys tests by id across every plugin at once, so an
        // unprefixed one could shadow Studio's own `narraleaf-studio:` tests or
        // another plugin's.
        const invalid = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { studio: "main.js" },
            contributes: {
                tests: ["smoke"],
            },
        });
        expect(invalid).toMatchObject({
            ok: false,
            error: expect.stringContaining("Contributed test must be prefixed with the plugin id"),
        });
    });

    it("defaults contributes.tests to an empty list", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { studio: "main.js" },
        });

        expect(result).toMatchObject({ ok: true, manifest: { contributes: { tests: [] } } });
    });

    it("derives no install permission from contributed tests", () => {
        // Ruling R3: a test runs only when the author picks it from the Run >
        // Test dialog and presses Start, so there is nothing ambient to consent
        // to. If this ever starts failing, someone taught
        // derivePermissionsFromContributes about tests - that is a product
        // decision, not a bug fix.
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { studio: "main.js" },
            contributes: {
                tests: ["acme.sample-plugin.smoke"],
            },
        });

        expect(result).toMatchObject({ ok: true, manifest: { permissions: [] } });
    });

    it("rejects contributed node types without the plugin id prefix", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
            contributes: {
                blueprintNodes: ["other.plugin.node"],
            },
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("prefixed with the plugin id"),
        });
    });

    it("normalizes contributed locales (language packs)", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.ja-pack",
            name: "Japanese Pack",
            version: "1.0.0",
            entries: { studio: "main.js" },
            contributes: {
                locales: [
                    { code: "ja", nativeName: "日本語", intl: "ja-JP", messages: "locales/ja.json" },
                    { code: "zh", messages: "locales/zh-extra.json" },
                ],
            },
        });

        expect(result).toMatchObject({
            ok: true,
            manifest: {
                contributes: {
                    locales: [
                        { code: "ja", nativeName: "日本語", intl: "ja-JP", messages: "locales/ja.json" },
                        { code: "zh", messages: "locales/zh-extra.json" },
                    ],
                },
            },
        });
    });

    it("rejects a locale contribution without a messages path", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.ja-pack",
            name: "Japanese Pack",
            version: "1.0.0",
            entries: { studio: "main.js" },
            contributes: { locales: [{ code: "ja", nativeName: "日本語" }] },
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("messages must be a relative JSON file path"),
        });
    });

    it("rejects a locale contribution whose messages path escapes the package", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.ja-pack",
            name: "Japanese Pack",
            version: "1.0.0",
            entries: { studio: "main.js" },
            contributes: { locales: [{ code: "ja", nativeName: "日本語", messages: "../../etc/passwd" }] },
        });

        expect(result).toMatchObject({ ok: false });
    });

    it("rejects unknown contributes keys", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
            contributes: {
                storyActions: ["acme.sample-plugin.action"],
            },
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("Unsupported plugin contributes key"),
        });
    });

    it("rejects manifestVersion 1", () => {
        const result = validatePluginManifest({
            manifestVersion: 1,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entry: "main.js",
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("Unsupported plugin manifestVersion"),
        });
    });

    it("rejects manifests without any entry", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: {},
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("at least one of"),
        });
    });

    it("rejects unknown entry targets", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: {
                studio: "main.js",
                launcher: "launcher.js",
            },
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("Unsupported plugin entry target"),
        });
    });

    it("rejects plugin ids without a namespace", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "sample",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { studio: "main.js" },
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("namespaced"),
        });
    });

    it("rejects entries that escape the plugin package", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: {
                runtime: "../runtime.js",
            },
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("relative file path"),
        });
    });

    it("rejects unknown permission kinds", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { studio: "main.js" },
            permissions: [
                {
                    kind: "network",
                    url: "https://example.com",
                },
            ],
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("Unsupported plugin permission kind"),
        });
    });
});

const SIDECAR_DIGEST = "a".repeat(64);
const DEP_DIGEST = "b".repeat(64);

/** A manifest that declares every new contribution kind, for the alignment tests. */
function fullManifest(overrides: Record<string, unknown> = {}) {
    return {
        manifestVersion: 2,
        id: "acme.steam",
        name: "Steam",
        version: "1.0.0",
        entries: { runtime: "runtime.js" },
        contributes: {
            runtimeCapabilities: ["store", "events"],
            buildDependencies: [{
                id: "acme.steam.sdk",
                targets: {
                    "windows-x64": {
                        url: "https://partner.example.com/sdk.zip",
                        sha256: DEP_DIGEST,
                        archive: "zip",
                        files: { "redist/win64/steam_api64.dll": "steam_api64.dll" },
                    },
                },
            }],
            sidecars: [{
                id: "acme.steam.bridge",
                targets: {
                    "windows-x64": {
                        entry: "bin/bridge.exe",
                        include: ["bin/bridge.exe", "dep:acme.steam.sdk/steam_api64.dll"],
                        sha256: { "bin/bridge.exe": SIDECAR_DIGEST },
                    },
                },
            }],
        },
        ...overrides,
    };
}

describe("validatePluginManifest — capability/permission alignment", () => {
    it("derives install permissions from contributes so the two cannot diverge", () => {
        const result = validatePluginManifest(fullManifest());

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.manifest.permissions).toEqual([
            { kind: "runtime", capability: "store" },
            { kind: "runtime", capability: "events" },
            { kind: "sidecar", id: "acme.steam.bridge", platforms: ["windows-x64"] },
            { kind: "buildDependency", id: "acme.steam.sdk", hosts: ["partner.example.com"] },
        ]);
    });

    it("refuses a hand-written derived permission — contributes is the only source", () => {
        const result = validatePluginManifest(fullManifest({
            permissions: [{ kind: "sidecar", id: "acme.steam.bridge", platforms: [] }],
        }));

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("derived from contributes"),
        });
    });

    it("applies sidecar defaults so downstream code sees a total shape", () => {
        const result = validatePluginManifest(fullManifest());

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.manifest.contributes.sidecars[0]).toMatchObject({
            kind: "executable",
            transport: "stdio-jsonl",
            autostart: "onGameStart",
            startupTimeoutMs: 5000,
            shutdownTimeoutMs: 3000,
            restart: { maxRetries: 3, backoffMs: 1000 },
        });
    });

    it("rejects an unknown runtime capability rather than ignoring the typo", () => {
        const result = validatePluginManifest(fullManifest({
            contributes: { runtimeCapabilities: ["stroe"] },
        }));

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("Unknown plugin runtime capability"),
        });
    });

    it("rejects capabilities declared without a runtime entry", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.steam",
            name: "Steam",
            version: "1.0.0",
            entries: { studio: "main.js" },
            contributes: { runtimeCapabilities: ["store"] },
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("requires a runtime entry"),
        });
    });

    it("rejects a sidecar include pointing at an undeclared build dependency", () => {
        const result = validatePluginManifest(fullManifest({
            contributes: {
                sidecars: [{
                    id: "acme.steam.bridge",
                    targets: {
                        "windows-x64": {
                            entry: "bin/bridge.exe",
                            include: ["bin/bridge.exe", "dep:acme.steam.missing/x.dll"],
                            sha256: { "bin/bridge.exe": SIDECAR_DIGEST },
                        },
                    },
                }],
            },
        }));

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("undeclared build dependency"),
        });
    });

    it("requires a sha256 for every packaged sidecar file", () => {
        const result = validatePluginManifest(fullManifest({
            contributes: {
                sidecars: [{
                    id: "acme.steam.bridge",
                    targets: {
                        "windows-x64": {
                            entry: "bin/bridge.exe",
                            include: ["bin/bridge.exe", "bin/helper.dll"],
                            sha256: { "bin/bridge.exe": SIDECAR_DIGEST },
                        },
                    },
                }],
            },
        }));

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("missing a valid sha256"),
        });
    });

    it("refuses a plain-http build dependency", () => {
        const result = validatePluginManifest(fullManifest({
            contributes: {
                buildDependencies: [{
                    id: "acme.steam.sdk",
                    targets: {
                        "windows-x64": {
                            url: "http://partner.example.com/sdk.zip",
                            sha256: DEP_DIGEST,
                            archive: "none",
                            fileName: "steam_api64.dll",
                        },
                    },
                }],
            },
        }));

        expect(result).toMatchObject({ ok: false, error: expect.stringContaining("must use https") });
    });

    it("carries a declared icon through normalization", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { studio: "main.js" },
            icon: "assets/icon.png",
        });

        expect(result).toMatchObject({ ok: true, manifest: { icon: "assets/icon.png" } });
    });

    it("leaves icon absent when the manifest declares none", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { studio: "main.js" },
        });

        expect(result.ok).toBe(true);
        expect((result as { manifest: { icon?: string } }).manifest.icon).toBeUndefined();
    });

    it("refuses an icon outside the extension allowlist", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { studio: "main.js" },
            icon: "icon.svg",
        });

        expect(result).toMatchObject({ ok: false, error: expect.stringContaining("must be one of") });
    });

    it("refuses an icon that escapes the package", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { studio: "main.js" },
            icon: "../../../Users/someone/.ssh/id_rsa.png",
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("relative image path inside the plugin package"),
        });
    });

    it("refuses a platform key no build can ever match", () => {
        const result = validatePluginManifest(fullManifest({
            contributes: {
                sidecars: [{
                    id: "acme.steam.bridge",
                    targets: {
                        "android-x64": {
                            entry: "bin/bridge",
                            include: ["bin/bridge"],
                            sha256: { "bin/bridge": SIDECAR_DIGEST },
                        },
                    },
                }],
            },
        }));

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("unsupported platform key"),
        });
    });
});

/**
 * Build config: the values a plugin needs the author to supply before a build can ship.
 *
 * The one behavioural difference from every other code-backed contribution is what it does *not* do
 * - it derives no install permission - so that is asserted rather than left implied.
 */
describe("validatePluginManifest contributes.buildConfig", () => {
    const buildConfigManifest = (buildConfig: unknown) => ({
        manifestVersion: 2,
        id: "acme.steam",
        name: "Steam",
        version: "1.0.0",
        entries: { runtime: "runtime.js" },
        contributes: { buildConfig },
    });

    it("normalizes a declared field and defaults the optional halves away", () => {
        const result = validatePluginManifest(buildConfigManifest([
            { key: "appId", label: "Steam App ID", type: "text", scope: "global" },
        ]));

        expect(result).toMatchObject({
            ok: true,
            manifest: { contributes: { buildConfig: [{ key: "appId", label: "Steam App ID" }] } },
        });
        const [field] = (result as { manifest: { contributes: { buildConfig: Record<string, unknown>[] } } })
            .manifest.contributes.buildConfig;
        expect(field.description).toBeUndefined();
        expect(field.platforms).toBeUndefined();
        expect(field.required).toBeUndefined();
    });

    it("defaults to an empty list, like every other contribution kind", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.steam",
            name: "Steam",
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
        });

        expect(result).toMatchObject({ ok: true, manifest: { contributes: { buildConfig: [] } } });
    });

    it("grants nothing: a declared field derives no install permission", () => {
        const result = validatePluginManifest(buildConfigManifest([
            { key: "token", label: "Upload token", type: "secret", scope: "variant", required: true },
        ]));

        expect(result).toMatchObject({ ok: true, manifest: { permissions: [] } });
    });

    it("refuses two fields under one key", () => {
        const result = validatePluginManifest(buildConfigManifest([
            { key: "appId", label: "Steam App ID", type: "text", scope: "global" },
            { key: "appId", label: "Steam App ID again", type: "text", scope: "variant" },
        ]));

        expect(result).toMatchObject({ ok: false, error: expect.stringContaining("more than once") });
    });

    it("refuses a field nothing on screen would identify", () => {
        const result = validatePluginManifest(buildConfigManifest([
            { key: "appId", label: "   ", type: "text", scope: "global" },
        ]));

        expect(result).toMatchObject({ ok: false, error: expect.stringContaining("must declare a label") });
    });

    it("refuses an unknown type and an unknown scope", () => {
        expect(validatePluginManifest(buildConfigManifest([
            { key: "appId", label: "Steam App ID", type: "password", scope: "global" },
        ]))).toMatchObject({ ok: false, error: expect.stringContaining("type must be one of") });

        expect(validatePluginManifest(buildConfigManifest([
            { key: "appId", label: "Steam App ID", type: "text", scope: "per-build" },
        ]))).toMatchObject({ ok: false, error: expect.stringContaining("scope must be one of") });
    });

    it("refuses a platform no build can target, and an empty platform list", () => {
        expect(validatePluginManifest(buildConfigManifest([
            { key: "appId", label: "Steam App ID", type: "text", scope: "platform", platforms: ["switch"] },
        ]))).toMatchObject({ ok: false, error: expect.stringContaining("unknown platform") });

        expect(validatePluginManifest(buildConfigManifest([
            { key: "appId", label: "Steam App ID", type: "text", scope: "platform", platforms: [] },
        ]))).toMatchObject({ ok: false, error: expect.stringContaining("non-empty array") });
    });

    it("accepts the fixture package's manifest as it sits on disk", async () => {
        const manifestPath = path.join(
            fileURLToPath(new URL("./__fixtures__/plugins/narraleaf.steam-appid-fixture/", import.meta.url)),
            "manifest.json",
        );
        const result = validatePluginManifest(JSON.parse(await fs.readFile(manifestPath, "utf8")));

        expect(result).toMatchObject({
            ok: true,
            manifest: {
                id: "narraleaf.steam-appid-fixture",
                // The whole point of the fixture: two fields, and no permission from either.
                permissions: [],
                contributes: {
                    buildConfig: [
                        { key: "appId", type: "text", scope: "global", required: true },
                        { key: "buildToken", type: "secret", scope: "variant" },
                    ],
                },
            },
        });
    });
});

/**
 * `contributes.externalLinks` — the declaration, the permission it derives, and the four things a
 * manifest cannot say. The matching itself is tested next to the matcher; what is checked here is
 * that nothing unmatchable, unreadable or unsayable gets as far as the author's install prompt.
 */
describe("validatePluginManifest contributes.externalLinks", () => {
    const linksManifest = (externalLinks: unknown, entries: unknown = { runtime: "runtime.js" }) => ({
        manifestVersion: 2,
        id: "acme.steam",
        name: "Steam",
        version: "1.0.0",
        entries,
        contributes: { externalLinks },
    });

    it("keeps the author's own spelling, in order, and derives one permission carrying all of it", () => {
        const result = validatePluginManifest(linksManifest([
            "steam://*",
            "https://store.steampowered.com/app/*",
        ]));

        expect(result).toMatchObject({
            ok: true,
            manifest: {
                contributes: {
                    externalLinks: ["steam://*", "https://store.steampowered.com/app/*"],
                },
                // One permission, every pattern, unrewritten: this list is what the prompt shows.
                permissions: [{
                    kind: "externalLink",
                    patterns: ["steam://*", "https://store.steampowered.com/app/*"],
                }],
            },
        });
    });

    it("derives nothing when nothing is declared", () => {
        const result = validatePluginManifest(linksManifest([]));
        expect(result).toMatchObject({ ok: true, manifest: { permissions: [] } });

        const absent = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.steam",
            name: "Steam",
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
        });
        expect(absent).toMatchObject({ ok: true, manifest: { contributes: { externalLinks: [] } } });
    });

    it("rejects a blank entry", () => {
        expect(validatePluginManifest(linksManifest(["https://x.example.com/", "   "])))
            .toMatchObject({ ok: false });
        expect(validatePluginManifest(linksManifest([""]))).toMatchObject({ ok: false });
        expect(validatePluginManifest(linksManifest([42]))).toMatchObject({ ok: false });
        expect(validatePluginManifest(linksManifest("https://x.example.com/"))).toMatchObject({ ok: false });
    });

    it("rejects a pattern that does not parse into a scheme", () => {
        for (const pattern of ["store.example.com/*", "/app/*", "*", "*://example.com/"]) {
            expect(validatePluginManifest(linksManifest([pattern]))).toMatchObject({ ok: false });
        }
    });

    it("rejects a duplicate, on the canonical form rather than the raw string", () => {
        expect(validatePluginManifest(linksManifest([
            "https://x.example.com/a",
            "https://x.example.com/a",
        ]))).toMatchObject({ ok: false });
        expect(validatePluginManifest(linksManifest([
            "https://x.example.com/a",
            "HTTPS://X.EXAMPLE.COM/a",
        ]))).toMatchObject({ ok: false });
    });

    it("rejects a script or file scheme whatever the manifest says", () => {
        for (const pattern of [
            "javascript:alert(1)",
            "javascript://*",
            "data:text/html,<script>x</script>",
            "vbscript:msgbox",
            "file:///C:/Windows/System32/cmd.exe",
            "file://*",
        ]) {
            expect(validatePluginManifest(linksManifest([pattern]))).toMatchObject({ ok: false });
        }
    });

    it("rejects the permission being hand-written, the way every derived kind is", () => {
        const result = validatePluginManifest({
            manifestVersion: 2,
            id: "acme.steam",
            name: "Steam",
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
            permissions: [{ kind: "externalLink", patterns: ["https://anything.example.com/*"] }],
        });
        expect(result).toMatchObject({ ok: false });
        expect((result as { error: string }).error).toContain("derived from contributes");
    });

    it("rejects a declaration with no runtime entry to use it", () => {
        expect(validatePluginManifest(linksManifest(["steam://*"], { studio: "main.js" })))
            .toMatchObject({ ok: false });
    });
});
