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
