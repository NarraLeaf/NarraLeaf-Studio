/**
 * `app.game.process` - present exactly when the plugin declared `process.memory` and the shell has
 * processes to count, and absent otherwise, whatever else the plugin holds.
 *
 * Loaded through the real loader for the reason the diagnostics test is: what is checked is how the
 * loader builds one `app` per descriptor. The capability's other half - that a plugin cannot run
 * with a capability the author has not granted - is Studio's install gate and is pinned beside the
 * permission derivation (`pluginInstallPermissions.test.ts`).
 *
 * Comments in English per project convention.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedPluginManifestV2, RuntimePluginDescriptor } from "@shared/types/plugins";
import type { PluginRuntimeCapability } from "@shared/types/pluginPermissions";
import type { GameProcessMemoryReading } from "@shared/types/gameProcessMemory";
import { loadRuntimePlugins } from "./loadRuntimePlugins";
import type { RuntimePluginGame } from "./runtimePluginApi";
import type { RuntimePluginHost } from "./runtimePluginHost";
import { coalesceInFlight, RuntimePluginHostController } from "./runtimePluginHostController";

const CAPTURED = "__nlsRuntimePluginProcessMemoryCapture";

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

const READING: GameProcessMemoryReading = {
    scope: "game",
    processes: [
        { kind: "main", current: false, workingSetBytes: 92_000_000, peakWorkingSetBytes: 120_000_000 },
        { kind: "renderer", current: true, workingSetBytes: 310_000_000, peakWorkingSetBytes: 360_000_000 },
    ],
    workingSetBytes: 402_000_000,
    privateBytes: null,
};

function hostReading(read: () => Promise<GameProcessMemoryReading>): RuntimePluginHost {
    return { process: { memory: read } };
}

describe("app.game.process", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-process-memory-"));
        (globalThis as Record<string, unknown>)[CAPTURED] = {};
    });

    afterEach(async () => {
        delete (globalThis as Record<string, unknown>)[CAPTURED];
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("is absent - not throwing - for a plugin that did not declare it", async () => {
        const descriptor = await writePlugin("quiet", []);

        await loadRuntimePlugins([descriptor], { log: () => {}, host: hostReading(async () => READING) });

        expect(captured()["quiet"].process).toBeUndefined();
    });

    it("is not granted by holding `diagnostics`, the capability next to it", async () => {
        // The inspector already holds `diagnostics`. Reading the machine's memory is a different
        // question, and an update that starts asking it has to be approved on its own.
        const descriptor = await writePlugin("inspector", ["diagnostics"]);

        await loadRuntimePlugins([descriptor], {
            log: () => {},
            host: { ...hostReading(async () => READING), diagnostics: { imageCache: () => null } },
        });

        expect(captured()["inspector"].diagnostics).toBeDefined();
        expect(captured()["inspector"].process).toBeUndefined();
    });

    it("reports the shell's reading for a plugin that declared it", async () => {
        const descriptor = await writePlugin("inspector", ["process.memory"]);

        await loadRuntimePlugins([descriptor], { log: () => {}, host: hostReading(async () => READING) });

        await expect(captured()["inspector"].process?.memory()).resolves.toEqual(READING);
    });

    it("is absent on a shell with no processes to count, even when declared, and says why", async () => {
        const descriptor = await writePlugin("inspector", ["process.memory"]);
        const logged: string[] = [];

        await loadRuntimePlugins([descriptor], { log: (_level, message) => logged.push(message), host: {} });

        expect(captured()["inspector"].process).toBeUndefined();
        expect(logged.some(line => line.includes(`"process.memory"`))).toBe(true);
    });
});

describe("the controller's process backend", () => {
    it("exists only where the shell can read process memory", () => {
        expect(new RuntimePluginHostController({}).host.process).toBeUndefined();
        expect(new RuntimePluginHostController({ processMemory: async () => READING }).host.process).toBeDefined();
    });

    it("sends one request at a time however often it is asked", async () => {
        let calls = 0;
        let answer: (reading: GameProcessMemoryReading) => void = () => {};
        const read = coalesceInFlight(() => {
            calls += 1;
            return new Promise<GameProcessMemoryReading>(resolve => {
                answer = resolve;
            });
        });

        const first = read();
        const second = read();
        answer(READING);

        await expect(first).resolves.toEqual(READING);
        await expect(second).resolves.toEqual(READING);
        expect(calls).toBe(1);
        // And a fresh reading afterwards, rather than the old one kept.
        void read();
        expect(calls).toBe(2);
    });

    it("asks again after a failed request instead of repeating the failure", async () => {
        let calls = 0;
        const read = coalesceInFlight(async () => {
            calls += 1;
            if (calls === 1) {
                throw new Error("window gone");
            }
            return READING;
        });

        await expect(read()).rejects.toThrow("window gone");
        await expect(read()).resolves.toEqual(READING);
    });
});
