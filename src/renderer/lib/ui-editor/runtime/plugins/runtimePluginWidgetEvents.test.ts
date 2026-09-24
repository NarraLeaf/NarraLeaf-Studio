/**
 * A plugin widget's declared events start the author's graphs in a game.
 *
 * The widget module in the editor declared them and the properties panel listed them, and in a
 * game or in Dev Mode nothing ran: every seam between a raised event and a graph - the dispatcher,
 * the head lookup, the payload read - asked a table of built-in widget types, which a plugin's is not
 * in. `dispatchEvent` reached the dispatcher and the dispatcher dropped it without a word.
 *
 * What runs here is what a game runs: the real runtime plugin loader importing a plugin entry off
 * disk, the Dev Mode host adapter, the real dispatcher and the built-in nodes. What comes back is
 * what an author could observe - the lines `Log` wrote.
 *
 * Comments in English per project convention.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { NormalizedPluginManifestV2, RuntimePluginDescriptor } from "@shared/types/plugins";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { ElementRendererRegistry } from "../ElementRendererRegistry";
import { blueprintOf, createRowRuntime, graphOf } from "../testing/rowRuntimeTestKit";
import { loadRuntimePlugins } from "./loadRuntimePlugins";

let tempDir = "";
let pluginSeq = 0;

/**
 * A plugin whose runtime entry registers a rating widget, the head its "rated" event starts on, and
 * a logic API naming both that head and the built-in Mouse Click one - the shared declaration the
 * studio entry would register too.
 */
async function writeRatingPlugin(id: string, options: { declareLogic: boolean }): Promise<RuntimePluginDescriptor> {
    const entryPath = path.join(tempDir, `${id}.mjs`);
    const logic = {
        supportsPrivateBlueprint: true,
        events: [
            { id: "rated", displayName: "Rated", dispatchKind: "interaction", headNodeTypes: [`${id}.onRated`] },
            { id: "mouseClick", displayName: "Mouse click", dispatchKind: "interaction", headNodeTypes: [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK] },
        ],
        commands: [],
        readableState: [],
        writableProps: [],
    };
    const source = [
        "const { defineRuntimePlugin } = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;",
        "export default defineRuntimePlugin({",
        "  setup(app) {",
        "    app.game.blueprintNodes.register({",
        "      type: app.plugin.id + '.onRated',",
        "      displayName: 'On Rated',",
        "      execute: () => ({ nextPort: 'then' }),",
        "    });",
        "    app.game.widgets.register({",
        "      type: app.plugin.id + '.rating',",
        "      render: () => null,",
        options.declareLogic ? `      logicApi: ${JSON.stringify(logic)},` : "",
        "    });",
        "  },",
        "});",
        "",
    ].join("\n");
    await fs.writeFile(entryPath, source, "utf-8");
    const manifest: NormalizedPluginManifestV2 = {
        manifestVersion: 2,
        id,
        name: id,
        version: "1.0.0",
        entries: { runtime: `${id}.mjs` },
        contributes: {
            blueprintNodes: [`${id}.onRated`],
            widgets: [`${id}.rating`],
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
    return { plugin: { id, name: id, version: "1.0.0" }, manifest, entryUrl: pathToFileURL(entryPath).href };
}

function pageWith(widgetType: string): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [{
            id: "page",
            name: "Page",
            host: "app",
            kind: "appSurface",
            designSize: { width: 640, height: 360 },
            rootElementId: "root",
        }],
        elements: {
            root: { id: "root", type: "nl.root", parentId: null, childrenIds: ["rating"], layout: { x: 0, y: 0, width: 640, height: 360 } },
            rating: { id: "rating", type: widgetType, parentId: "root", childrenIds: [], layout: { x: 0, y: 0, width: 200, height: 40 } },
        },
    };
}

async function loadRatingPlugin(options: { declareLogic: boolean }): Promise<string> {
    // A fresh id per test: the loader caches by id+version+entry for the life of the process.
    const pluginId = `acme.rating${pluginSeq++}`;
    const results = await loadRuntimePlugins([await writeRatingPlugin(pluginId, options)], {
        log: () => undefined,
        elementRenderers: new ElementRendererRegistry(),
    });
    expect(results.every(result => result.ok)).toBe(true);
    return pluginId;
}

/** The rating's own blueprint: its head logs the stars, and a click logs that it was clicked. */
function ratingBlueprint(pluginId: string) {
    return blueprintOf("bp-rating", { kind: "widgetMain", surfaceId: "page", elementId: "rating" }, {
        rated: {
            graph: graphOf({
                nodes: { head: { type: `${pluginId}.onRated` }, log: { type: BLUEPRINT_NODE_TYPE_LOG } },
                exec: ["head", "log"],
                data: [["head", "stars", "log", "value"]],
            }),
        },
        clicked: {
            graph: graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                    text: { type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "clicked" } },
                    log: { type: BLUEPRINT_NODE_TYPE_LOG },
                },
                exec: ["head", "log"],
                data: [["text", "value", "log", "value"]],
            }),
        },
    });
}

async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

let page: ReturnType<typeof createRowRuntime> | null = null;

beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-widget-events-"));
});

afterEach(async () => {
    page?.release();
    expect(page?.errors ?? []).toEqual([]);
    page = null;
    await fs.rm(tempDir, { recursive: true, force: true });
});

describe("a plugin widget's own event", () => {
    it("starts the widget's graph on the plugin's head, with the payload on its pins", async () => {
        const pluginId = await loadRatingPlugin({ declareLogic: true });
        page = createRowRuntime([ratingBlueprint(pluginId)], { document: pageWith(`${pluginId}.rating`) });

        await page.runtime.dispatchElementBlueprintEvent("rating", "rated", { stars: 4 });
        await settle();

        expect(page.logs).toEqual(["4"]);
    });

    it("starts nothing else in the blueprint", async () => {
        const pluginId = await loadRatingPlugin({ declareLogic: true });
        page = createRowRuntime([ratingBlueprint(pluginId)], { document: pageWith(`${pluginId}.rating`) });

        await page.runtime.dispatchElementBlueprintEvent("rating", "rated", { stars: 2 });
        await settle();

        expect(page.logs).not.toContain("clicked");
    });
});

describe("a built-in event a plugin widget declares", () => {
    it("starts the built-in head, as it would on a Container", async () => {
        const pluginId = await loadRatingPlugin({ declareLogic: true });
        page = createRowRuntime([ratingBlueprint(pluginId)], { document: pageWith(`${pluginId}.rating`) });

        await page.runtime.dispatchElementBlueprintEvent("rating", "mouseClick", { x: 1, y: 1 });
        await settle();

        expect(page.logs).toEqual(["clicked"]);
    });
});

describe("a plugin widget whose runtime entry declares no events", () => {
    it("raises nothing a graph hears, as its declaration says", async () => {
        const pluginId = await loadRatingPlugin({ declareLogic: false });
        page = createRowRuntime([ratingBlueprint(pluginId)], { document: pageWith(`${pluginId}.rating`) });

        await page.runtime.dispatchElementBlueprintEvent("rating", "rated", { stars: 4 });
        await settle();

        expect(page.logs).toEqual([]);
    });
});
