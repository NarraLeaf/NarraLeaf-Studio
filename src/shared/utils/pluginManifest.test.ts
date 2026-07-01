import { describe, expect, it } from "vitest";
import { validatePluginManifest } from "./pluginManifest";

describe("validatePluginManifest", () => {
    it("normalizes a valid manifest and defaults entry to main.js", () => {
        const result = validatePluginManifest({
            manifestVersion: 1,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
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
                entry: "main.js",
                permissions: [{ kind: "api", capability: "bash.execute" }],
            },
        });
    });

    it("rejects plugin ids without a namespace", () => {
        const result = validatePluginManifest({
            manifestVersion: 1,
            id: "sample",
            name: "Sample Plugin",
            version: "1.0.0",
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("namespaced"),
        });
    });

    it("rejects entries that escape the plugin package", () => {
        const result = validatePluginManifest({
            manifestVersion: 1,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entry: "../main.js",
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining("relative file path"),
        });
    });

    it("rejects unknown permission kinds", () => {
        const result = validatePluginManifest({
            manifestVersion: 1,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
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
