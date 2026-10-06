/**
 * A plugin widget's declared words, in a game: the runtime loader reads which props are words off the
 * packed manifest (`contributes.widgetText`), answers the shared readers with them, and hands the
 * widget's renderer those props already in the player's language. A manifest packed without the
 * declaration draws the widget with its props as they are, as before.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameLocalizationBundle } from "@shared/types/localization";
import type { NormalizedPluginManifestV2, PluginWidgetTextContribution, RuntimePluginDescriptor } from "@shared/types/plugins";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import { uiTextSitesOf } from "@shared/types/ui-editor/textSource";
import { ElementRendererRegistry, type ElementRendererProps } from "../ElementRendererRegistry";
import { GameLocalizationContext } from "../localization/GameLocalizationContext";
import { loadRuntimePlugins } from "./loadRuntimePlugins";
import type { RuntimeWidgetRendererProps } from "./runtimePluginApi";

const CAPTURED = "__nlsRuntimePluginWidgetTextCapture";

let tempDir = "";
let pluginSeq = 0;

function captured(): RuntimeWidgetRendererProps | undefined {
    return (globalThis as Record<string, unknown>)[CAPTURED] as RuntimeWidgetRendererProps | undefined;
}

async function loadBadgePlugin(
    widgetText: PluginWidgetTextContribution[] | undefined,
): Promise<{ type: string; registry: ElementRendererRegistry }> {
    const id = `acme.words${pluginSeq++}`;
    const type = `${id}.badge`;
    const entryPath = path.join(tempDir, `${id}.mjs`);
    await fs.writeFile(entryPath, [
        "const { defineRuntimePlugin } = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;",
        "export default defineRuntimePlugin({",
        "  setup(app) {",
        `    app.game.widgets.register({ type: ${JSON.stringify(type)}, render(props) { globalThis[${JSON.stringify(CAPTURED)}] = props; return null; } });`,
        "  },",
        "});",
        "",
    ].join("\n"), "utf-8");
    const contributes = {
        blueprintNodes: [],
        widgets: [type],
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
        widgetText: widgetText ? { [type]: widgetText } : {},
        structs: [],
    } as NormalizedPluginManifestV2["contributes"];
    if (!widgetText) {
        // As a manifest packed by a Studio from before the declaration existed.
        delete (contributes as Partial<NormalizedPluginManifestV2["contributes"]>).widgetText;
    }
    const descriptor: RuntimePluginDescriptor = {
        plugin: { id, name: id, version: "1.0.0" },
        manifest: { manifestVersion: 2, id, name: id, version: "1.0.0", entries: { runtime: `${id}.mjs` }, contributes, permissions: [] },
        entryUrl: pathToFileURL(entryPath).href,
    };
    const registry = new ElementRendererRegistry();
    const results = await loadRuntimePlugins([descriptor], { log: () => {}, elementRenderers: registry });
    expect(results.every(result => result.ok)).toBe(true);
    return { type, registry };
}

const SURFACE: UISurface = {
    id: "surface",
    name: "Surface",
    host: "app",
    kind: "appSurface",
    designSize: { width: 320, height: 240 },
    rootElementId: "root",
};

function propsFor(type: string, badgeProps: Record<string, unknown>): ElementRendererProps {
    const document: UIDocument = {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [SURFACE],
        elements: {
            root: { id: "root", type: "nl.root", parentId: null, childrenIds: ["badge"], layout: { x: 0, y: 0, width: 320, height: 240 } },
            badge: { id: "badge", type, parentId: "root", childrenIds: [], layout: { x: 0, y: 0, width: 40, height: 40 }, props: badgeProps },
        },
    };
    return {
        element: document.elements.badge,
        surface: SURFACE,
        document,
        hostAdapter: { host: "app" },
        renderChildren: () => [],
    };
}

const BUNDLE: GameLocalizationBundle = {
    sourceLocale: "en",
    locales: [{ code: "en", displayName: "English" }, { code: "zh", displayName: "中文" }],
    tables: { zh: { "key:menu.treasure": "宝箱", "ui:badge.hint": "按下打开" } },
    keys: { "menu.treasure": "Treasure" },
};

function drawInGame(registry: ElementRendererRegistry, type: string, props: ElementRendererProps, locale: string): void {
    renderToStaticMarkup(React.createElement(
        GameLocalizationContext.Provider,
        { value: { bundle: BUNDLE, getLocale: () => locale, subscribe: () => () => undefined } },
        registry.get(type)!.render(props),
    ));
}

describe("a plugin widget's declared words in a game", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-widget-text-"));
        delete (globalThis as Record<string, unknown>)[CAPTURED];
    });

    afterEach(async () => {
        delete (globalThis as Record<string, unknown>)[CAPTURED];
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("answers the shared readers with the sites the packed manifest declares", async () => {
        const { type } = await loadBadgePlugin([{ prop: "caption", keyProp: "captionKey" }, { prop: "hint", keyProp: "hintLocalizationKey" }]);
        expect(uiTextSitesOf(type).map(site => [site.textProp, site.keyProp])).toEqual([
            ["caption", "captionKey"],
            ["hint", "hintLocalizationKey"],
        ]);
    });

    it("hands the renderer its words in the player's language", async () => {
        const { type, registry } = await loadBadgePlugin([{ prop: "caption", keyProp: "captionKey" }, { prop: "hint", keyProp: "hintLocalizationKey" }]);
        const given = propsFor(type, { captionKey: "menu.treasure", hint: "Press to open", tone: "gold" });

        drawInGame(registry, type, given, "zh");
        expect(captured()?.element.props).toEqual({ captionKey: "menu.treasure", caption: "宝箱", hint: "按下打开", tone: "gold" });

        drawInGame(registry, type, given, "en");
        expect(captured()?.element.props).toMatchObject({ caption: "Treasure", hint: "Press to open" });
    });

    it("draws a widget whose manifest declares no words with its props as they are", async () => {
        const { type, registry } = await loadBadgePlugin(undefined);
        const given = propsFor(type, { caption: "Treasure", captionKey: "menu.treasure" });

        drawInGame(registry, type, given, "zh");
        expect(uiTextSitesOf(type)).toEqual([]);
        expect(captured()?.element).toBe(given.element);
    });
});
