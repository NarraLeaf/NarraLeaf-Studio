import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedPluginManifestV2 } from "@shared/types/plugins";
import { readPublishedPluginData } from "./pluginRuntimeData";

const PLUGIN_ID = "acme.sample-plugin";

function manifest(runtimeData: string[]): NormalizedPluginManifestV2 {
    return {
        manifestVersion: 2,
        id: PLUGIN_ID,
        name: "Sample Plugin",
        version: "1.0.0",
        entries: { runtime: "runtime.js" },
        contributes: { blueprintNodes: [], widgets: [], runtimeData },
        permissions: [],
    };
}

let projectPath = "";

async function writeStore(namespace: string, contents: string): Promise<void> {
    const dir = path.join(projectPath, "editor", "services");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `plugin__${PLUGIN_ID}__${namespace}.json`), contents, "utf-8");
}

beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-data-"));
});

afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true });
});

describe("readPublishedPluginData", () => {
    it("collects the stores a plugin declared as publishable", async () => {
        await writeStore("acme.sample-plugin.catalog", JSON.stringify({ items: [1, 2] }));

        const data = await readPublishedPluginData({
            projectPath,
            manifest: manifest(["acme.sample-plugin.catalog"]),
        });

        expect(data).toEqual({ "acme.sample-plugin.catalog": { items: [1, 2] } });
    });

    it("returns undefined when the plugin declares no runtime data", async () => {
        await writeStore("acme.sample-plugin.catalog", JSON.stringify({ items: [] }));

        expect(await readPublishedPluginData({ projectPath, manifest: manifest([]) })).toBeUndefined();
    });

    it("ignores undeclared stores, so editor-only state cannot leak into a game", async () => {
        await writeStore("acme.sample-plugin.catalog", JSON.stringify({ shipped: true }));
        await writeStore("acme.sample-plugin.editorState", JSON.stringify({ secret: true }));

        const data = await readPublishedPluginData({
            projectPath,
            manifest: manifest(["acme.sample-plugin.catalog"]),
        });

        expect(data).toEqual({ "acme.sample-plugin.catalog": { shipped: true } });
    });

    it("returns undefined when a declared store was never written", async () => {
        // A project that never opened the plugin's panel has no store; that is
        // normal, not an error.
        const data = await readPublishedPluginData({
            projectPath,
            manifest: manifest(["acme.sample-plugin.catalog"]),
        });

        expect(data).toBeUndefined();
    });

    it("skips an unparseable store and reports it instead of failing the build", async () => {
        await writeStore("acme.sample-plugin.broken", "{ not json");
        await writeStore("acme.sample-plugin.catalog", JSON.stringify({ ok: true }));
        const warnings: string[] = [];

        const data = await readPublishedPluginData({
            projectPath,
            manifest: manifest(["acme.sample-plugin.broken", "acme.sample-plugin.catalog"]),
            onWarning: message => warnings.push(message),
        });

        expect(data).toEqual({ "acme.sample-plugin.catalog": { ok: true } });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("acme.sample-plugin.broken");
    });
});
