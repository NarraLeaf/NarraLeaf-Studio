/**
 * `app.game.inlineTextEffects` - drawing the runs of dialogue a plugin's effect is set on.
 *
 * Real ESM plugins through the real loader, as the other runtime plugin tests do: the ownership and
 * declaration rules belong to the `app` the loader builds per descriptor. What reaches the engine is
 * read back off its word renderer registry, the one place a compiled `Word` looks its renderer up.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getWordRenderer } from "narraleaf-react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedPluginManifestV2, RuntimePluginDescriptor } from "@shared/types/plugins";
import { loadRuntimePlugins } from "./loadRuntimePlugins";

let tempDir = "";

async function writePlugin(id: string, declared: string[], body: string): Promise<RuntimePluginDescriptor> {
    const entryPath = path.join(tempDir, `${id}.mjs`);
    await fs.writeFile(
        entryPath,
        "const { defineRuntimePlugin } = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;\n"
        + "const React = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__.externals.react;\n"
        + `export default defineRuntimePlugin({ setup(app) { ${body} } });\n`,
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
            inlineTextEffects: declared,
            tests: [],
            reservedSaveIds: [],
            runtimeData: [],
            locales: [],
            runtimeCapabilities: [],
            sidecars: [],
            buildDependencies: [],
            buildConfig: [],
            externalLinks: [],
            network: [],
            widgetText: {},
            structs: [],
            agentTools: [],
            agentGuide: "",
        },
        permissions: [],
    };
    return { plugin: { id, name: id, version: "1.0.0" }, manifest, entryUrl: pathToFileURL(entryPath).href };
}

/** What the engine hands a word renderer, for a word `text` long with `config` on it. */
function engineProps(text: string, data: unknown, config: Record<string, unknown> = {}) {
    return { children: text, text, fullText: text, revealed: true, done: true, style: {}, config, data };
}

describe("app.game.inlineTextEffects", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-inline-effects-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("hands the engine a renderer under the effect id, which draws with the narrowed props", async () => {
        const plugin = await writePlugin("acme.fx1", ["acme.fx1.wave"], `
            app.game.inlineTextEffects.register({
                id: "acme.fx1.wave",
                render: props => React.createElement("em", { "data-keys": Object.keys(props).sort().join() },
                    props.text + ":" + props.params.height + ":" + props.hasRuby),
            });
        `);
        const [result] = await loadRuntimePlugins([plugin], { log: () => {} });
        expect(result.ok).toBe(true);

        const renderer = getWordRenderer("acme.fx1.wave");
        expect(renderer).not.toBeNull();
        const html = renderToStaticMarkup(React.createElement(renderer!, engineProps("Run", { height: 2 }, { ruby: "r" }) as never));
        // The engine's `config` is not passed on: what a plugin reads of a word is the narrowed set.
        expect(html).toContain('data-keys="children,done,fullText,hasRuby,params,revealed,style,text"');
        expect(html).toContain("Run:2:true");
    });

    it("refuses an effect the manifest does not declare", async () => {
        const plugin = await writePlugin("acme.fx3", [], `
            app.game.inlineTextEffects.register({ id: "acme.fx3.shake", render: () => null });
        `);
        const [result] = await loadRuntimePlugins([plugin], { log: () => {} });
        expect(result.ok).toBe(false);
        expect(result.ok ? "" : result.error).toContain("contributes.inlineTextEffects");
        expect(getWordRenderer("acme.fx3.shake")).toBeNull();
    });

    it("refuses an id outside the plugin's namespace", async () => {
        const plugin = await writePlugin("acme.fx4", ["acme.other.shake"], `
            app.game.inlineTextEffects.register({ id: "acme.other.shake", render: () => null });
        `);
        const [result] = await loadRuntimePlugins([plugin], { log: () => {} });
        expect(result.ok).toBe(false);
        expect(result.ok ? "" : result.error).toContain("prefixed with plugin id");
    });
});
