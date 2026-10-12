/**
 * A plugin's own words in a game, through the real loader: `app.game.locale.words` reads back only
 * the publishing plugin's units, and a menu the plugin publishes has every label's own words named
 * as that plugin's unit before the game sees it - whatever id the plugin wrote.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameMenuSpec } from "@shared/types/gameMenu";
import type { NormalizedPluginManifestV2, RuntimePluginDescriptor } from "@shared/types/plugins";
import type { PluginRuntimeCapability } from "@shared/types/pluginPermissions";
import { loadRuntimePlugins } from "./loadRuntimePlugins";
import type { RuntimePluginHost } from "./runtimePluginHost";

const CAPTURED = "__nlsRuntimePluginWordsCapture";

let tempDir = "";
let pluginSeq = 0;

async function loadPlugin(source: string[], capabilities: PluginRuntimeCapability[], host: RuntimePluginHost): Promise<string> {
    const id = `acme.words${pluginSeq++}`;
    const entryPath = path.join(tempDir, `${id}.mjs`);
    await fs.writeFile(entryPath, [
        "const { defineRuntimePlugin } = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;",
        "export default defineRuntimePlugin({",
        "  async setup(app) {",
        ...source,
        "  },",
        "});",
        "",
    ].join("\n"), "utf-8");
    const contributes = {
        blueprintNodes: [], widgets: [], tests: [], reservedSaveIds: [], runtimeData: [], locales: [],
        runtimeCapabilities: capabilities, sidecars: [], buildDependencies: [], buildConfig: [],
        externalLinks: [], network: [], widgetText: {}, structs: [], agentTools: [], agentGuide: "",
    } satisfies NormalizedPluginManifestV2["contributes"];
    const descriptor: RuntimePluginDescriptor = {
        plugin: { id, name: id, version: "1.0.0" },
        manifest: { manifestVersion: 2, id, name: id, version: "1.0.0", entries: { runtime: `${id}.mjs` }, contributes, permissions: [] },
        entryUrl: pathToFileURL(entryPath).href,
    };
    const results = await loadRuntimePlugins([descriptor], { log: () => {}, host });
    expect(results.every(result => result.ok)).toBe(true);
    return id;
}

function captured(): Record<string, unknown> {
    return (globalThis as Record<string, unknown>)[CAPTURED] as Record<string, unknown>;
}

describe("a plugin's own words in a game", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-words-"));
        (globalThis as Record<string, unknown>)[CAPTURED] = {};
    });

    afterEach(async () => {
        delete (globalThis as Record<string, unknown>)[CAPTURED];
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("reads back the words this plugin offered, under its own id", async () => {
        const asked: string[] = [];
        const host: RuntimePluginHost = {
            locale: {
                current: () => "en",
                onChange: () => () => undefined,
                text: () => null,
                words: (pluginId, id, text) => {
                    asked.push(`${pluginId}/${id}`);
                    return id === "entry.a.name" ? "The corridor" : text;
                },
            },
        };
        const id = await loadPlugin([
            `globalThis[${JSON.stringify(CAPTURED)}].name = app.game.locale.words("entry.a.name", "走廊");`,
            `globalThis[${JSON.stringify(CAPTURED)}].other = app.game.locale.words("entry.b.name", "教室");`,
        ], ["locale"], host);
        expect(captured()).toEqual({ name: "The corridor", other: "教室" });
        expect(asked).toEqual([`${id}/entry.a.name`, `${id}/entry.b.name`]);
    });

    it("names a menu label's own words as the publishing plugin's unit", async () => {
        let published: GameMenuSpec | null = null;
        const host: RuntimePluginHost = {
            menu: {
                set: async spec => {
                    published = spec;
                },
            },
        };
        const spec: GameMenuSpec = {
            menus: [{
                label: { key: null, text: "游戏", words: "menu-game.label" },
                items: [{ kind: "action", label: { key: "menu.next", text: "推进" }, action: { type: "next" } }],
            }],
        };
        const id = await loadPlugin([`await app.game.menu.set(${JSON.stringify(spec)});`], ["menu"], host);
        expect(published).toEqual({
            menus: [{
                label: { key: null, text: "游戏", words: `plugin:${id}/menu-game.label` },
                items: [{ kind: "action", label: { key: "menu.next", text: "推进" }, action: { type: "next" } }],
            }],
        });
    });
});
