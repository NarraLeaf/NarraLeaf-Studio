/**
 * `app.game.navigation` - present exactly when the plugin declared addresses, and carrying its own
 * identity when it calls.
 *
 * The plugins here are real ESM modules loaded through the real loader, because both properties
 * being checked are properties of how the loader builds one `app` per descriptor: a domain that is
 * absent rather than throwing, and an id the plugin never gets to choose. A test that called the
 * backend directly would be checking a function nobody hands a plugin.
 *
 * What is deliberately NOT checked here is whether an address is allowed. That decision does not
 * live in this process at all - it is made by whichever shell performs the act, against the
 * declaration in the pack (see `externalLinkPattern.test.ts` for the decision itself). A renderer
 * that decided it would not be a boundary, so there is nothing here to assert about one.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedPluginManifestV2, RuntimePluginDescriptor } from "@shared/types/plugins";
import type { BlueprintOpenExternalRequest } from "@shared/types/blueprint/externalLink";
import { loadRuntimePlugins } from "./loadRuntimePlugins";
import type { RuntimePluginGame } from "./runtimePluginApi";
import type { RuntimePluginHost } from "./runtimePluginHost";

const CAPTURED = "__nlsRuntimePluginNavigationCapture";

type Captured = Record<string, RuntimePluginGame>;

let tempDir = "";

function captured(): Captured {
    return (globalThis as Record<string, unknown>)[CAPTURED] as Captured;
}

/** Writes a plugin whose whole runtime is "hand my `app.game` back to the test". */
async function writePlugin(id: string, externalLinks: string[]): Promise<RuntimePluginDescriptor> {
    const entryPath = path.join(tempDir, `${id}.mjs`);
    await fs.writeFile(
        entryPath,
        "const { defineRuntimePlugin } = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;\n"
        + `export default defineRuntimePlugin({ setup(app) { globalThis["${CAPTURED}"][app.plugin.id] = app.game; } });\n`,
        "utf-8",
    );
    const manifest: NormalizedPluginManifestV2 = {
        manifestVersion: 2,
        id,
        name: id,
        version: "1.0.0",
        entries: { runtime: `${id}.mjs` },
        contributes: {
            blueprintNodes: [],
            widgets: [],
            tests: [],
            runtimeData: [],
            network: [],
            locales: [],
            runtimeCapabilities: [],
            sidecars: [],
            buildDependencies: [],
            buildConfig: [],
            externalLinks,
        },
        permissions: externalLinks.length > 0
            ? [{ kind: "externalLink", patterns: [...externalLinks] }]
            : [],
    };
    return {
        plugin: { id, name: id, version: "1.0.0" },
        manifest,
        entryUrl: pathToFileURL(entryPath).href,
    };
}

/** Records who asked for what, standing in for the process that would perform the act. */
function recordingHost(): { host: RuntimePluginHost; calls: Array<{ pluginId: string; url: string }> } {
    const calls: Array<{ pluginId: string; url: string }> = [];
    return {
        calls,
        host: {
            navigation: {
                openExternal: async (ownerPluginId: string, request: BlueprintOpenExternalRequest) => {
                    calls.push({ pluginId: ownerPluginId, url: request.url });
                    return { outcome: "opened" as const, error: null };
                },
            },
        },
    };
}

describe("app.game.navigation", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-navigation-"));
        (globalThis as Record<string, unknown>)[CAPTURED] = {};
    });

    afterEach(async () => {
        delete (globalThis as Record<string, unknown>)[CAPTURED];
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("is absent - not throwing - for a plugin that declared no addresses", async () => {
        const plugin = await writePlugin("acme.quiet", []);
        const { host } = recordingHost();

        const results = await loadRuntimePlugins([plugin], { log: () => {}, host });

        expect(results.every(result => result.ok)).toBe(true);
        // The whole contract of a capability-gated domain: `if (app.game.navigation)` is the honest
        // test, and there is no method here to call and be refused by.
        expect(captured()["acme.quiet"].navigation).toBeUndefined();
        expect("navigation" in captured()["acme.quiet"]).toBe(false);
    });

    it("is present for a plugin that declared some", async () => {
        const plugin = await writePlugin("acme.steam", ["steam://*"]);
        const { host } = recordingHost();

        await loadRuntimePlugins([plugin], { log: () => {}, host });

        expect(typeof captured()["acme.steam"].navigation?.openExternal).toBe("function");
    });

    it("is absent when the environment cannot back it, and says why", async () => {
        const plugin = await writePlugin("acme.unbacked", ["steam://*"]);
        const lines: string[] = [];

        await loadRuntimePlugins([plugin], { log: (_level, message) => lines.push(message), host: {} });

        expect(captured()["acme.unbacked"].navigation).toBeUndefined();
        expect(lines.some(line => line.includes("externalLinks"))).toBe(true);
    });

    it("names the calling plugin, and a plugin cannot name another", async () => {
        const steam = await writePlugin("acme.steam", ["steam://*"]);
        const itch = await writePlugin("acme.itch", ["https://itch.io/game/*"]);
        const { host, calls } = recordingHost();

        await loadRuntimePlugins([steam, itch], { log: () => {}, host });

        await captured()["acme.steam"].navigation?.openExternal({ url: "steam://run/480" });
        await captured()["acme.itch"].navigation?.openExternal({ url: "https://itch.io/game/7" });

        // The id is bound by the loader from the descriptor, and there is no argument through which
        // a plugin could supply a different one - which is what makes "its own patterns" a fact
        // about the call rather than a promise the far side has to take on trust.
        expect(calls).toEqual([
            { pluginId: "acme.steam", url: "steam://run/480" },
            { pluginId: "acme.itch", url: "https://itch.io/game/7" },
        ]);

        // And the reverse: itch's call still arrives under itch's name even when it asks for an
        // address only Steam declared, so the far side checks it against itch's (empty of steam:)
        // patterns and refuses.
        await captured()["acme.itch"].navigation?.openExternal({ url: "steam://run/480" });
        expect(calls.at(-1)).toEqual({ pluginId: "acme.itch", url: "steam://run/480" });
    });
});
