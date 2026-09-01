/**
 * What a plugin's widget renderer is handed, and what it is not.
 *
 * The host draws every element through one `ElementRendererProps`, and that type carries
 * `hostAdapter` - the whole host API, saves and quit included. A plugin widget renderer is bound
 * into the same registry as the built-in ones, so the narrowing has to happen where the binding is
 * built; these tests drive the real loader and then call the renderer the way the element tree
 * does, because a test that called the plugin's own function would be checking nothing.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { NormalizedPluginManifestV2, RuntimePluginDescriptor } from "@shared/types/plugins";
import { ElementRendererRegistry, type ElementRendererProps } from "../ElementRendererRegistry";
import type { UIHostAdapter } from "../types";
import { loadRuntimePlugins } from "./loadRuntimePlugins";
import type { RuntimePluginGame, RuntimeWidgetRendererProps } from "./runtimePluginApi";

const CAPTURED = "__nlsRuntimePluginWidgetCapture";
const WIDGET_SUFFIX = ".badge";

type Capture = {
    game?: RuntimePluginGame;
    props?: RuntimeWidgetRendererProps;
};

let tempDir = "";
let pluginSeq = 0;

function capture(): Capture {
    return (globalThis as Record<string, unknown>)[CAPTURED] as Capture;
}

/**
 * A plugin whose whole runtime is "register a widget that hands the test what it was given".
 * Written to disk and imported through the real loader: the narrowing is a property of how the
 * loader binds a registration, not of anything the plugin itself can arrange.
 */
async function writeWidgetPlugin(id: string): Promise<RuntimePluginDescriptor> {
    const entryPath = path.join(tempDir, `${id}.mjs`);
    const source = [
        "const { defineRuntimePlugin } = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;",
        "export default defineRuntimePlugin({",
        "  setup(app) {",
        `    globalThis[${JSON.stringify(CAPTURED)}].game = app.game;`,
        "    app.game.widgets.register({",
        `      type: app.plugin.id + ${JSON.stringify(WIDGET_SUFFIX)},`,
        `      render(props) { globalThis[${JSON.stringify(CAPTURED)}].props = props; return null; },`,
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
            blueprintNodes: [],
            widgets: [`${id}${WIDGET_SUFFIX}`],
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
    return {
        plugin: { id, name: id, version: "1.0.0" },
        manifest,
        entryUrl: pathToFileURL(entryPath).href,
    };
}

const SURFACE: UISurface = {
    id: "surface",
    name: "Surface",
    host: "app",
    kind: "appSurface",
    designSize: { width: 320, height: 240 },
    rootElementId: "root",
};

function documentWith(widgetType: string): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [SURFACE],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["badge"],
                layout: { x: 0, y: 0, width: 320, height: 240 },
            },
            badge: {
                id: "badge",
                type: widgetType,
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 40, height: 40 },
            },
        },
    };
}

const ROW: UIListItemScope = { key: "row-2", index: 2, count: 5, item: { id: "b" } };

/** Stands in for the sound mixer, the saves, and everything else reachable off the adapter. */
const HOST_API = { sound: { play: () => undefined } };

function liveAdapter(dispatch: ReturnType<typeof vi.fn>): UIHostAdapter {
    return {
        host: "app",
        blueprintRuntime: {
            surfaceId: SURFACE.id,
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: dispatch as never,
            hostApi: HOST_API as never,
        },
    };
}

function hostProps(widgetType: string, hostAdapter: UIHostAdapter): ElementRendererProps {
    const document = documentWith(widgetType);
    return {
        element: document.elements.badge,
        surface: SURFACE,
        document,
        hostAdapter,
        instanceKey: "list-badge-row-2",
        listItemScope: ROW,
        renderChildren: () => [],
        runtimeData: { surfaceState: { get: () => undefined } },
    };
}

async function loadWidgetPlugin(): Promise<{ widgetType: string; registry: ElementRendererRegistry }> {
    // A fresh id per test: the loader caches by id+version+entry for the life of the process and
    // its widget table is module-level, so a reused id would answer with an earlier test's plugin.
    const pluginId = `acme.widget${pluginSeq++}`;
    const descriptor = await writeWidgetPlugin(pluginId);
    const registry = new ElementRendererRegistry();
    const results = await loadRuntimePlugins([descriptor], { log: () => {}, elementRenderers: registry });
    expect(results.every(result => result.ok)).toBe(true);
    return { widgetType: `${pluginId}${WIDGET_SUFFIX}`, registry };
}

describe("plugin widget renderers", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-widget-"));
        (globalThis as Record<string, unknown>)[CAPTURED] = {};
    });

    afterEach(async () => {
        delete (globalThis as Record<string, unknown>)[CAPTURED];
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("never sees the host adapter, under that name or any other", async () => {
        const { widgetType, registry } = await loadWidgetPlugin();
        const hostAdapter = liveAdapter(vi.fn(async () => undefined));

        registry.get(widgetType)!.render(hostProps(widgetType, hostAdapter));

        const props = capture().props;
        expect(props).toBeDefined();
        expect(props).not.toHaveProperty("hostAdapter");
        // Not just the name: nothing the plugin can read is the adapter, the blueprint runtime it
        // carries, or the host API behind that.
        const reachable = Object.values(props as unknown as Record<string, unknown>);
        expect(reachable).not.toContain(hostAdapter);
        expect(reachable).not.toContain(hostAdapter.blueprintRuntime);
        expect(reachable).not.toContain(HOST_API);
    });

    it("keeps the element, the document and the row it is drawn in", async () => {
        const { widgetType, registry } = await loadWidgetPlugin();
        const given = hostProps(widgetType, liveAdapter(vi.fn(async () => undefined)));

        registry.get(widgetType)!.render(given);

        const props = capture().props!;
        expect(props.element).toBe(given.element);
        expect(props.surface).toBe(given.surface);
        expect(props.document).toBe(given.document);
        expect(props.renderChildren).toBe(given.renderChildren);
        expect(props.runtimeData).toBe(given.runtimeData);
        expect(props.listItemScope).toBe(ROW);
        expect(props.instanceKey).toBe("list-badge-row-2");
        // The same object `setup` was handed, so a capability reached from a renderer is the one
        // the manifest declared rather than a second, wider view of the host.
        expect(props.game).toBe(capture().game);
    });

    it("raises its own event slots, on the row it is being drawn in", async () => {
        const { widgetType, registry } = await loadWidgetPlugin();
        const dispatch = vi.fn(async () => undefined);

        registry.get(widgetType)!.render(hostProps(widgetType, liveAdapter(dispatch)));
        await capture().props!.dispatchEvent!("mouseClick", { x: 1 });

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith(
            "badge",
            "mouseClick",
            { x: 1 },
            { listItemScope: ROW, instanceKey: "list-badge-row-2" },
        );
    });

    it("can address a row other than the one being drawn", async () => {
        const { widgetType, registry } = await loadWidgetPlugin();
        const dispatch = vi.fn(async () => undefined);
        const other: UIListItemScope = { key: "row-4", index: 4, count: 5, item: { id: "d" } };

        registry.get(widgetType)!.render(hostProps(widgetType, liveAdapter(dispatch)));
        await capture().props!.dispatchEvent!("itemClick", undefined, { listItemScope: other, instanceKey: "k" });

        expect(dispatch).toHaveBeenCalledWith("badge", "itemClick", undefined, {
            listItemScope: other,
            instanceKey: "k",
        });
    });

    it("dispatches nothing, rather than throwing, where there is no blueprint runtime", async () => {
        const { widgetType, registry } = await loadWidgetPlugin();

        registry.get(widgetType)!.render(hostProps(widgetType, { host: "app" }));

        await expect(capture().props!.dispatchEvent!("mouseClick")).resolves.toBeUndefined();
    });
});
