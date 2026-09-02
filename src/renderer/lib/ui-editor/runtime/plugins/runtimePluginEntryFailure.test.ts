/**
 * What a Dev Mode session says when a runtime plugin entry will not load.
 *
 * The failure is invisible on its own: a plugin whose entry throws registers no blueprint nodes and
 * no widget renderers, so the nodes the author placed from it draw as the unknown-node stub. Until
 * this was reported, the only account of it was a line in the DevTools console - and what the author
 * saw was their own graph having stopped working.
 *
 * Real modules through the real loader, for the reason `runtimePluginConfig.test.ts` gives: the
 * thing under test is what the loader does with an entry that throws, and a hand-built result object
 * would only be checking the shape this file already declares.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runtimePluginFailureIssue } from "@/apps/dev-mode/components/runtimeIssueModel";
import { createTranslator } from "@shared/i18n";
import type { NormalizedPluginManifestV2, RuntimePluginDescriptor } from "@shared/types/plugins";
import { loadRuntimePlugins } from "./loadRuntimePlugins";

let tempDir = "";

/** A plugin whose runtime entry is `source`, named `name` in its manifest. */
async function writePlugin(id: string, name: string, source: string): Promise<RuntimePluginDescriptor> {
    // The loader caches per id + version + entry URL, so each plugin gets a file of its own inside a
    // per-test directory: two tests sharing a path would share the first one's outcome.
    const entryPath = path.join(tempDir, `${id}.mjs`);
    await fs.writeFile(entryPath, source, "utf-8");
    const manifest: NormalizedPluginManifestV2 = {
        manifestVersion: 2,
        id,
        name,
        version: "1.0.0",
        entries: { runtime: `${id}.mjs` },
        contributes: {
            blueprintNodes: [],
            widgets: [],
            tests: [],
            runtimeData: [],
            locales: [],
            runtimeCapabilities: [],
            sidecars: [],
            buildDependencies: [],
            buildConfig: [],
            externalLinks: [],
            network: [],
        },
        permissions: [],
    };
    return { plugin: { id, name, version: "1.0.0" }, manifest, entryUrl: pathToFileURL(entryPath).href };
}

beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-entry-"));
});

afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
});

describe("a runtime entry that throws", () => {
    it("comes back naming the plugin, not only its id", async () => {
        const plugin = await writePlugin(
            "acme.gallery",
            "Gallery",
            "const { defineRuntimePlugin } = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;\n"
            + "export default defineRuntimePlugin({ setup() { throw new Error('missing gallery index'); } });\n",
        );

        const [result] = await loadRuntimePlugins([plugin], { log: () => {} });

        expect(result.ok).toBe(false);
        // The host that has to say this out loud is the one with an issue list, and by then the
        // descriptor is gone. So the name travels on the result.
        expect(result.pluginName).toBe("Gallery");
        expect(result.ok === false && result.error).toBe("missing gallery index");
    });

    it("is reported rather than only logged, as an error naming the plugin", async () => {
        const plugin = await writePlugin(
            "acme.broken",
            "Broken Plugin",
            "throw new Error('SyntaxError substitute');\n",
        );
        const logged: string[] = [];

        const [result] = await loadRuntimePlugins([plugin], { log: (_level, message) => logged.push(message) });
        expect(result.ok).toBe(false);
        expect(logged.some(line => line.includes("acme.broken"))).toBe(true);

        const issue = runtimePluginFailureIssue(
            { pluginName: result.pluginName, error: result.ok === false ? result.error : "" },
            createTranslator("en").t,
        );

        // An error, not a warning: an excluded plugin is a project that has not declared it, which
        // an author can mean; an entry that threw is broken code.
        expect(issue.level).toBe("error");
        expect(issue.origin).toBe("plugin");
        expect(issue.pluginName).toBe("Broken Plugin");
        expect(issue.message).toContain("Broken Plugin");
        expect(issue.message).toContain("SyntaxError substitute");
    });

    it("does not stop the plugins beside it from loading", async () => {
        const broken = await writePlugin(
            "acme.broken2",
            "Broken",
            "const { defineRuntimePlugin } = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;\n"
            + "export default defineRuntimePlugin({ setup() { throw new Error('nope'); } });\n",
        );
        const working = await writePlugin(
            "acme.fine",
            "Fine",
            "const { defineRuntimePlugin } = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;\n"
            + "export default defineRuntimePlugin({ setup() {} });\n",
        );

        const results = await loadRuntimePlugins([broken, working], { log: () => {} });

        expect(results.map(item => [item.pluginId, item.ok])).toEqual([
            ["acme.broken2", false],
            ["acme.fine", true],
        ]);
    });
});

describe("the plugin list itself failing", () => {
    it("names no plugin, because nothing loaded and there is nothing to name", () => {
        const issue = runtimePluginFailureIssue(
            { pluginName: null, error: "IPC channel closed" },
            createTranslator("en").t,
        );

        expect(issue.level).toBe("error");
        expect(issue.origin).toBe("plugin");
        expect(issue.pluginName).toBeUndefined();
        expect(issue.message).toContain("IPC channel closed");
    });
});
