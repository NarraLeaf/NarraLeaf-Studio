/**
 * Localization nodes: every getter here is latent and publishes its result through
 * `execute()`'s `outputValues`, so the assertions below all read the output pin from
 * a *downstream* node rather than from the execute() return - that read path is the
 * one that silently yields `undefined` when a node type is missing on the resolver
 * side (see `graphParamResolvers.ts`).
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_FORMAT_TEXT,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_AVAILABLE_LANGUAGES,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_CURRENT_LANGUAGE,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_HAS_TEXT,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_SET_LANGUAGE,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { GameLocalizationConfigSnapshot } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { executeGraph } from "../../behavior-graph/GraphExecutor";

const CONFIG: GameLocalizationConfigSnapshot = {
    sourceLocale: "en",
    locales: [
        { code: "en", displayName: "English" },
        { code: "ja", displayName: "日本語" },
        { code: "zh-TW", displayName: "繁體中文", fallback: "ja" },
    ],
    tables: {
        ja: { "key:greeting": "こんにちは、{0}さん" },
    },
    keys: { greeting: "Hello, {0}" },
};

type LocalizationHost = {
    locale: string;
    setCalls: string[];
    config?: GameLocalizationConfigSnapshot | null;
};

function createLocalizationHostAdapter(host: LocalizationHost): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: {
            surfaceId: "surface",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: {
                localization: {
                    getConfig: () => (host.config === undefined ? CONFIG : host.config),
                    getLocale: async () => host.locale,
                    setLocale: async (code: string) => {
                        host.setCalls.push(code);
                        host.locale = code;
                    },
                },
            },
        },
    } as unknown as UIHostAdapter;
}

/**
 * Run `graph` and return the blueprint locals it wrote. Every graph below ends in a
 * Set Var so the assertion goes through the same data-pin read a real downstream node
 * would use.
 */
async function runGraph(graph: UIGraph, host: LocalizationHost): Promise<Record<string, unknown>> {
    const locals: Record<string, unknown> = {};
    await executeGraph({
        graph,
        entry: graph.entries.main,
        hostAdapter: createLocalizationHostAdapter(host),
        blueprintLocals: locals,
    });
    return locals;
}

/** Single getter node whose data output pin feeds a Set Var named `out`. */
function captureOutputGraph(
    nodeType: string,
    outputPortId: string,
    params: Record<string, unknown> = {},
): UIGraph {
    return {
        id: "capture",
        entries: { main: { start: { nodeId: "get", port: "in" } } },
        nodes: {
            get: { id: "get", type: nodeType, params },
            store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
        },
        edges: [
            { from: { nodeId: "get", port: "next" }, to: { nodeId: "store", port: "in" } },
            { from: { nodeId: "get", port: outputPortId }, to: { nodeId: "store", port: "value" } },
        ],
    } as UIGraph;
}

describe("Localization blueprint nodes", () => {
    it("publishes Get Current Language to a downstream data pin", async () => {
        const locals = await runGraph(
            captureOutputGraph(BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_CURRENT_LANGUAGE, "value"),
            { locale: "ja", setCalls: [] },
        );
        expect(locals).toMatchObject({ out: "ja" });
    });

    it("publishes Get Text to a downstream data pin, translated for the current locale", async () => {
        expect(
            await runGraph(
                captureOutputGraph(BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT, "value", { key: "greeting" }),
                { locale: "ja", setCalls: [] },
            ),
        ).toMatchObject({ out: "こんにちは、{0}さん" });

        // Source locale: no table entry, so the key's source text renders.
        expect(
            await runGraph(
                captureOutputGraph(BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT, "value", { key: "greeting" }),
                { locale: "en", setCalls: [] },
            ),
        ).toMatchObject({ out: "Hello, {0}" });

        // Unknown keys render as the key name so the defect is visible in-game.
        expect(
            await runGraph(
                captureOutputGraph(BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT, "value", { key: "missing" }),
                { locale: "ja", setCalls: [] },
            ),
        ).toMatchObject({ out: "missing" });
    });

    it("publishes Has Text to a downstream data pin", async () => {
        expect(
            await runGraph(
                captureOutputGraph(BLUEPRINT_NODE_TYPE_LOCALIZATION_HAS_TEXT, "value", { key: "greeting" }),
                { locale: "en", setCalls: [] },
            ),
        ).toMatchObject({ out: true });
        expect(
            await runGraph(
                captureOutputGraph(BLUEPRINT_NODE_TYPE_LOCALIZATION_HAS_TEXT, "value", { key: "missing" }),
                { locale: "en", setCalls: [] },
            ),
        ).toMatchObject({ out: false });
    });

    it("publishes Format Text to a downstream data pin", async () => {
        const graph: UIGraph = {
            id: "formatText",
            entries: { main: { start: { nodeId: "get", port: "in" } } },
            nodes: {
                get: { id: "get", type: BLUEPRINT_NODE_TYPE_LOCALIZATION_FORMAT_TEXT, params: {} },
                template: {
                    id: "template",
                    type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                    params: { value: "Hello, {0} and {1}" },
                },
                values: {
                    id: "values",
                    type: BLUEPRINT_NODE_TYPE_LITERAL_JSON,
                    params: { value: ["Ada", "Grace"] },
                },
                store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
            },
            edges: [
                { from: { nodeId: "template", port: "value" }, to: { nodeId: "get", port: "text" } },
                { from: { nodeId: "values", port: "value" }, to: { nodeId: "get", port: "values" } },
                { from: { nodeId: "get", port: "next" }, to: { nodeId: "store", port: "in" } },
                { from: { nodeId: "get", port: "value" }, to: { nodeId: "store", port: "value" } },
            ],
        } as UIGraph;

        expect(await runGraph(graph, { locale: "en", setCalls: [] })).toMatchObject({
            out: "Hello, Ada and Grace",
        });
    });

    it("publishes Get Available Languages to a downstream data pin", async () => {
        const locals = await runGraph(
            captureOutputGraph(BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_AVAILABLE_LANGUAGES, "value"),
            { locale: "ja", setCalls: [] },
        );
        expect(locals.out).toEqual([
            { code: "en", displayName: "English", isSource: true },
            { code: "ja", displayName: "日本語", isSource: false },
            { code: "zh-TW", displayName: "繁體中文", isSource: false },
        ]);
    });

    it("feeds Get Current Language straight into Set Language", async () => {
        const host: LocalizationHost = { locale: "ja", setCalls: [] };
        await runGraph(
            {
                id: "roundTrip",
                entries: { main: { start: { nodeId: "get", port: "in" } } },
                nodes: {
                    get: { id: "get", type: BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_CURRENT_LANGUAGE, params: {} },
                    set: { id: "set", type: BLUEPRINT_NODE_TYPE_LOCALIZATION_SET_LANGUAGE, params: {} },
                },
                edges: [
                    { from: { nodeId: "get", port: "next" }, to: { nodeId: "set", port: "in" } },
                    { from: { nodeId: "get", port: "value" }, to: { nodeId: "set", port: "language" } },
                ],
            } as UIGraph,
            host,
        );
        // An unreadable output pin resolves to "" here, which Set Language rejects as
        // "Unknown language: (empty)" - so reaching this assertion is the contract.
        expect(host.setCalls).toEqual(["ja"]);
    });
});
