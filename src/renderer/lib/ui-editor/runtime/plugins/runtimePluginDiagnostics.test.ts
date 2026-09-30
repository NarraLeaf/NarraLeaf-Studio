/**
 * `app.game.diagnostics` - present exactly when the plugin declared the capability, and answering
 * null rather than throwing while there is no game to report on.
 *
 * Loaded through the real loader for the reason the navigation test is: what is being checked is how
 * the loader builds one `app` per descriptor, and a test that called the backend directly would be
 * checking a function no plugin is ever handed.
 *
 * The numbers themselves are the engine's and are not restated here - what this pins is the shape of
 * the seam: declared/undeclared, live/not live, and that a reading is taken when it is asked for
 * rather than captured once.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedPluginManifestV2, RuntimePluginDescriptor } from "@shared/types/plugins";
import type { PluginRuntimeCapability } from "@shared/types/pluginPermissions";
import { loadRuntimePlugins } from "./loadRuntimePlugins";
import type { RuntimePluginGame, RuntimePluginImageCacheStats } from "./runtimePluginApi";
import type { RuntimePluginHost } from "./runtimePluginHost";

const CAPTURED = "__nlsRuntimePluginDiagnosticsCapture";

let tempDir = "";

function captured(): Record<string, RuntimePluginGame> {
    return (globalThis as Record<string, unknown>)[CAPTURED] as Record<string, RuntimePluginGame>;
}

async function writePlugin(id: string, capabilities: PluginRuntimeCapability[]): Promise<RuntimePluginDescriptor> {
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
            runtimeCapabilities: capabilities,
            sidecars: [],
            buildDependencies: [],
            buildConfig: [],
            externalLinks: [],
        },
        permissions: capabilities.map(capability => ({ kind: "runtime" as const, capability })),
    };
    return {
        plugin: { id, name: id, version: "1.0.0" },
        manifest,
        entryUrl: pathToFileURL(entryPath).href,
    };
}

const SAMPLE: RuntimePluginImageCacheStats = {
    entries: 283,
    blobBytes: 0,
    decodedEntries: 41,
    decodedBytes: 132_644_372,
    pinned: 5,
    budget: { blobBytes: 268_435_456, decodedBytes: 134_217_728 },
};

/** Stands in for the controller, which reads the live session on every call. */
function hostWith(reading: () => RuntimePluginImageCacheStats | null): RuntimePluginHost {
    return { diagnostics: { imageCache: reading } };
}

describe("app.game.diagnostics", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-diagnostics-"));
        (globalThis as Record<string, unknown>)[CAPTURED] = {};
    });

    afterEach(async () => {
        delete (globalThis as Record<string, unknown>)[CAPTURED];
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("is absent - not throwing - for a plugin that did not declare it", async () => {
        const descriptor = await writePlugin("quiet", []);

        await loadRuntimePlugins([descriptor], { log: () => {}, host: hostWith(() => SAMPLE) });

        expect(captured()["quiet"].diagnostics).toBeUndefined();
    });

    it("is present for a plugin that declared it, and reports what the engine holds", async () => {
        const descriptor = await writePlugin("inspector", ["diagnostics"]);

        await loadRuntimePlugins([descriptor], { log: () => {}, host: hostWith(() => SAMPLE) });

        expect(captured()["inspector"].diagnostics?.imageCache()).toEqual(SAMPLE);
    });

    it("answers null while no game is running, which is every plugin's first moment", async () => {
        const descriptor = await writePlugin("inspector", ["diagnostics"]);

        await loadRuntimePlugins([descriptor], { log: () => {}, host: hostWith(() => null) });

        // Present but empty-handed: withholding the member here would make "the game has not
        // started" look the same as "this shell cannot report at all".
        expect(captured()["inspector"].diagnostics).toBeDefined();
        expect(captured()["inspector"].diagnostics?.imageCache()).toBeNull();
    });

    it("takes a fresh reading on every call rather than capturing one", async () => {
        const descriptor = await writePlugin("inspector", ["diagnostics"]);
        let live: RuntimePluginImageCacheStats | null = null;

        await loadRuntimePlugins([descriptor], { log: () => {}, host: hostWith(() => live) });
        const before = captured()["inspector"].diagnostics?.imageCache();
        live = SAMPLE;
        const after = captured()["inspector"].diagnostics?.imageCache();

        expect(before).toBeNull();
        expect(after).toEqual(SAMPLE);
    });

    it("is absent on a shell with no diagnostics to give, even when declared", async () => {
        const descriptor = await writePlugin("inspector", ["diagnostics"]);

        await loadRuntimePlugins([descriptor], { log: () => {}, host: {} });

        expect(captured()["inspector"].diagnostics).toBeUndefined();
    });
});
