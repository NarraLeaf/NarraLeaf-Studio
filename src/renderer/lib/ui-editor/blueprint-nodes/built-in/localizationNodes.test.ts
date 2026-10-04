/**
 * Localization nodes: every getter here is latent and publishes its result through
 * `execute()`'s `outputValues`, so the assertions below all read the output pin from
 * a *downstream* node rather than from the execute() return - that read path is the
 * one that silently yields `undefined` when a node type is missing on the resolver
 * side (see `graphParamResolvers.ts`).
 * Comments in English per project convention.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
    BLUEPRINT_NODE_TYPE_LITERAL_INTEGER,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_FORMAT_TEXT,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_AVAILABLE_LANGUAGES,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_CURRENT_LANGUAGE,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_HAS_TEXT,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_KEY_TEXT,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_SET_LANGUAGE,
    BLUEPRINT_NODE_TYPE_STRING_FORMAT,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { GameLocalizationConfigSnapshot } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { GAME_LOCALE_STATE_KEY } from "@/lib/ui-editor/blueprint-runtime/blueprintStateWrites";
import { validateBlueprintValueGraphSafe } from "@/lib/ui-editor/blueprint-runtime/BlueprintValueEvaluator";
import { setRuntimeLocaleSource } from "@/lib/ui-editor/runtime/localization/runtimeLocale";
import { executeGraph } from "../../behavior-graph/GraphExecutor";
import { blueprintNodeRegistry, isBlueprintNodeAllowedInGraphContext } from "../BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import type { BlueprintPaletteContext } from "../types";
import { resolveDataPinValue, type DataPinGraph } from "./graphParamResolvers";

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
        // An unreadable output pin resolves to "" here, which Set Language rejects as an empty
        // Language pin - so reaching this assertion is the contract.
        expect(host.setCalls).toEqual(["ja"]);
    });
});

/**
 * `Translation Key Text` - the pure reading of a key - against `Get Text`, the latent one. The point
 * of having both is that a bound label and a label written by an event graph say the same word, so
 * every case below asks the two nodes the same question and expects one answer.
 */
describe("Translation Key Text", () => {
    let releaseLocale: (() => void) | null = null;

    afterEach(() => {
        releaseLocale?.();
        releaseLocale = null;
    });

    /** The language as the running game publishes it to synchronous readers (`runtimeLocale.ts`). */
    function playIn(locale: string, sourceLocale = "en"): void {
        releaseLocale?.();
        releaseLocale = setRuntimeLocaleSource({ getLocale: () => locale, sourceLocale });
    }

    function readKeyText(
        host: LocalizationHost,
        params: Record<string, unknown>,
        trackState?: (key: string) => void,
    ): unknown {
        const graph: DataPinGraph = {
            id: "keyText",
            nodes: { text: { type: BLUEPRINT_NODE_TYPE_LOCALIZATION_KEY_TEXT, params } },
            edges: [],
        };
        return resolveDataPinValue(graph, "text", "value", params, {}, 0, {
            hostAdapter: createLocalizationHostAdapter(host),
            valueExecution: trackState ? { returnValue: () => undefined, trackState } : undefined,
        });
    }

    async function readGetText(host: LocalizationHost, key: string): Promise<unknown> {
        const locals = await runGraph(captureOutputGraph(BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT, "value", { key }), host);
        return locals.out;
    }

    it.each([
        ["a translated language", "ja", "greeting", "こんにちは、{0}さん"],
        ["the source language", "en", "greeting", "Hello, {0}"],
        ["a language that falls back to another", "zh-TW", "greeting", "こんにちは、{0}さん"],
        ["a key the project does not have", "ja", "missing", "missing"],
    ])("gives what Get Text gives in %s", async (_case, locale, key, expected) => {
        playIn(locale);
        const host: LocalizationHost = { locale, setCalls: [] };

        expect(readKeyText(host, { key })).toBe(expected);
        expect(await readGetText(host, key)).toBe(expected);
    });

    it("gives the key name, as Get Text does, when the project has no source language", async () => {
        // A project without a source language ships no localization at all, so the host has no
        // configuration and no language source is installed.
        const host: LocalizationHost = { locale: "", setCalls: [], config: null };

        expect(readKeyText(host, { key: "greeting" })).toBe("greeting");
        expect(await readGetText(host, "greeting")).toBe("greeting");
    });

    it("gives nothing while no key is picked", () => {
        playIn("ja");
        expect(readKeyText({ locale: "ja", setCalls: [] }, {})).toBe("");
        expect(readKeyText({ locale: "ja", setCalls: [] }, { key: "  " })).toBe("");
    });

    it("records the player's language as read when a value binding reads it", () => {
        playIn("ja");
        const reads: string[] = [];
        readKeyText({ locale: "ja", setCalls: [] }, { key: "greeting" }, key => reads.push(key));

        expect(reads).toEqual([GAME_LOCALE_STATE_KEY]);
    });

    it("formats a number into a translated template through Format", () => {
        playIn("ja");
        const graph: DataPinGraph = {
            id: "formatKeyText",
            nodes: {
                text: { type: BLUEPRINT_NODE_TYPE_LOCALIZATION_KEY_TEXT, params: { key: "greeting" } },
                three: { type: BLUEPRINT_NODE_TYPE_LITERAL_INTEGER, params: { value: 3 } },
                values: { type: BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY, params: { __jsonArrayInputPins: ["item_1"] } },
                format: { type: BLUEPRINT_NODE_TYPE_STRING_FORMAT, params: {} },
            },
            edges: [
                { from: { nodeId: "text", port: "value" }, to: { nodeId: "format", port: "template" } },
                { from: { nodeId: "three", port: "value" }, to: { nodeId: "values", port: "item_1" } },
                { from: { nodeId: "values", port: "result" }, to: { nodeId: "format", port: "values" } },
            ],
        };
        registerCoreBlueprintNodes();
        const host: LocalizationHost = { locale: "ja", setCalls: [] };
        const read = () => resolveDataPinValue(graph, "format", "result", {}, {}, 0, {
            hostAdapter: createLocalizationHostAdapter(host),
        });

        expect(read()).toBe("こんにちは、3さん");
        playIn("en");
        expect(read()).toBe("Hello, 3");
    });

    describe("where it may be placed", () => {
        function paletteContext(overrides: Partial<BlueprintPaletteContext>): BlueprintPaletteContext {
            return { graphKind: "event", owner: { kind: "globalMain" }, ...overrides } as BlueprintPaletteContext;
        }
        const valueOwner: BlueprintOwnerRef = { kind: "widgetValue", surfaceId: "s", elementId: "e", propPath: "text" };

        it("is accepted in a Blueprint Value, in a function and in an event graph", () => {
            registerCoreBlueprintNodes();
            const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_LOCALIZATION_KEY_TEXT)!;

            expect(isBlueprintNodeAllowedInGraphContext(def, paletteContext({ owner: valueOwner, isBlueprintValueGraph: true }))).toBe(true);
            expect(isBlueprintNodeAllowedInGraphContext(def, paletteContext({ graphKind: "function" }))).toBe(true);
            expect(isBlueprintNodeAllowedInGraphContext(def, paletteContext({}))).toBe(true);
            expect(validateBlueprintValueGraphSafe({
                nodes: { text: { id: "text", type: BLUEPRINT_NODE_TYPE_LOCALIZATION_KEY_TEXT, params: { key: "greeting" } } },
                edges: [],
            } as never)).toEqual([]);
        });

        it("leaves the latent Get Text out of both, as before", () => {
            registerCoreBlueprintNodes();
            const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT)!;

            expect(isBlueprintNodeAllowedInGraphContext(def, paletteContext({ owner: valueOwner, isBlueprintValueGraph: true }))).toBe(false);
            expect(isBlueprintNodeAllowedInGraphContext(def, paletteContext({ graphKind: "function" }))).toBe(false);
        });

        it("stays out of a story row, which has no host to read the game's translations from", () => {
            registerCoreBlueprintNodes();
            const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_LOCALIZATION_KEY_TEXT)!;

            expect(isBlueprintNodeAllowedInGraphContext(def, paletteContext({
                owner: { kind: "storyAction", blueprintId: "row", mode: "value" },
                isSyncOnlyGraph: true,
            }))).toBe(false);
        });
    });
});

/**
 * `Format Text` left the add-node menu when Format became the one formatter. Graphs that already hold
 * one must not notice: it stays registered, keeps its pins, and formats exactly as it did - including
 * where it differs from Format, which is why those differences are pinned here.
 */
describe("Format Text in an existing graph", () => {
    async function formatText(template: string, values: unknown): Promise<unknown> {
        const graph: UIGraph = {
            id: "formatTextKept",
            entries: { main: { start: { nodeId: "get", port: "in" } } },
            nodes: {
                get: { id: "get", type: BLUEPRINT_NODE_TYPE_LOCALIZATION_FORMAT_TEXT, params: {} },
                template: { id: "template", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: template } },
                values: { id: "values", type: BLUEPRINT_NODE_TYPE_LITERAL_JSON, params: { value: values } },
                store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
            },
            edges: [
                { from: { nodeId: "template", port: "value" }, to: { nodeId: "get", port: "text" } },
                { from: { nodeId: "values", port: "value" }, to: { nodeId: "get", port: "values" } },
                { from: { nodeId: "get", port: "next" }, to: { nodeId: "store", port: "in" } },
                { from: { nodeId: "get", port: "value" }, to: { nodeId: "store", port: "value" } },
            ],
        } as UIGraph;
        return (await runGraph(graph, { locale: "en", setCalls: [] })).out;
    }

    it("formats as it always has", async () => {
        expect(await formatText("{0} of {1}", [3, 10])).toBe("3 of 10");
        // A lone value fills {0}.
        expect(await formatText("{0} s", 3)).toBe("3 s");
        // Only numbered placeholders are placeholders; anything else in braces is text.
        expect(await formatText("{name} {0} { 0 }", ["x"])).toBe("{name} x { 0 }");
        // A number with no value is blank.
        expect(await formatText("[{2}]", ["x"])).toBe("[]");
    });

    it("keeps its registration and pins, and is only gone from the add-node menu", () => {
        registerCoreBlueprintNodes();
        const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_LOCALIZATION_FORMAT_TEXT)!;

        expect(def.pins.map(pin => pin.id)).toEqual(["in", "next", "text", "values", "value"]);
        expect(def.hideInPalette).toBe(true);
        const context = { graphKind: "event", owner: { kind: "globalMain" } } as BlueprintPaletteContext;
        expect(isBlueprintNodeAllowedInGraphContext(def, context)).toBe(true);
        expect(blueprintNodeRegistry.listPaletteEntries(context).some(entry => entry.type === BLUEPRINT_NODE_TYPE_LOCALIZATION_FORMAT_TEXT))
            .toBe(false);
        expect(blueprintNodeRegistry.listPaletteEntries(context).some(entry => entry.type === BLUEPRINT_NODE_TYPE_STRING_FORMAT))
            .toBe(true);
    });
});
