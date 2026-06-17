import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT,
    BLUEPRINT_NODE_TYPE_BROADCAST_SEND,
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_DATA_JSON_HAS,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_INT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON,
    BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
    BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LOG,
    BLUEPRINT_NODE_TYPE_STRING_LENGTH,
    BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
} from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "../BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { isValidBlueprintPinConnection } from "../connectionPolicy";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { broadcastBlueprintNodes } from "./broadcastNodes";
import { controlFlowBlueprintNodes } from "./controlFlowNodes";
import { dataBlueprintNodes } from "./dataNodes";
import { devtoolsBlueprintNodes } from "./devtoolsNodes";
import { eventHeadBlueprintNodes } from "./events/eventHeadNodes";
import { resolveDataPinValue } from "./graphParamResolvers";
import { stringBlueprintNodes } from "./stringNodes";
import { textBlueprintNodes } from "./textNodes";

describe("built-in blueprint nodes", () => {
    it("registers documented event, broadcast, string, text, and debug nodes", () => {
        registerCoreBlueprintNodes();

        const types = new Set(blueprintNodeRegistry.list().map(def => def.type));

        for (const def of [
            ...eventHeadBlueprintNodes,
            ...broadcastBlueprintNodes,
            ...controlFlowBlueprintNodes,
            ...dataBlueprintNodes,
            ...stringBlueprintNodes,
            ...textBlueprintNodes,
            ...devtoolsBlueprintNodes,
        ]) {
            expect(types.has(def.type)).toBe(true);
        }
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_BROADCAST_SEND)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT)).toBe(true);
        expect(types.has("if")).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LITERAL_NUMBER)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LITERAL_JSON)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_TO_JSON)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_PARSE_INT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_GET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_HAS)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_STRING_TO_STRING)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LOG)).toBe(true);
    });

    it("uses class.md palette categories for the new node groups", () => {
        registerCoreBlueprintNodes();

        expect(eventHeadBlueprintNodes.every(def => def.category === "Events")).toBe(true);
        expect(broadcastBlueprintNodes.every(def => def.category === "Events")).toBe(true);
        expect(controlFlowBlueprintNodes.every(def => def.category === "Flow")).toBe(true);
        expect(dataBlueprintNodes.every(def => def.category === "Data")).toBe(true);
        expect(stringBlueprintNodes.every(def => def.category === "String")).toBe(true);
        expect(textBlueprintNodes.every(def => def.category === "Text")).toBe(true);
    });

    it("resolves Data literals and explicit conversions", () => {
        registerCoreBlueprintNodes();

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        value: {
                            type: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
                            params: { value: 12.7 },
                        },
                    },
                    edges: [],
                },
                "value",
                "value",
                { value: 12.7 },
                undefined,
            ),
        ).toBe(12.7);

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        convert: {
                            type: BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT,
                            params: { value: "12.7" },
                        },
                    },
                    edges: [],
                },
                "convert",
                "result",
                { value: "12.7" },
                undefined,
            ),
        ).toBe(12.7);

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        convert: {
                            type: BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
                            params: { value: "{\"ok\":true}" },
                        },
                    },
                    edges: [],
                },
                "convert",
                "result",
                { value: "{\"ok\":true}" },
                undefined,
            ),
        ).toEqual({ ok: true });

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        parse: {
                            type: BLUEPRINT_NODE_TYPE_DATA_PARSE_INT,
                            params: { value: "12.7px" },
                        },
                    },
                    edges: [],
                },
                "parse",
                "result",
                { value: "12.7px" },
                undefined,
            ),
        ).toBe(12);

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        parse: {
                            type: BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT,
                            params: { value: "12.7px" },
                        },
                    },
                    edges: [],
                },
                "parse",
                "result",
                { value: "12.7px" },
                undefined,
            ),
        ).toBe(12.7);
    });

    it("coerces numeric outputs when consumed by string inputs", () => {
        registerCoreBlueprintNodes();

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        number: {
                            type: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
                            params: { value: 12.7 },
                        },
                        stringify: {
                            type: BLUEPRINT_NODE_TYPE_STRING_LENGTH,
                        },
                    },
                    edges: [
                        {
                            from: { nodeId: "number", port: "value" },
                            to: { nodeId: "stringify", port: "value" },
                        },
                    ],
                },
                "stringify",
                "value",
                {},
                undefined,
            ),
        ).toBe("12.7");
    });

    it("resolves JSON parse, path read, existence, and stringify nodes", () => {
        registerCoreBlueprintNodes();

        const graph = {
            nodes: {
                parse: {
                    type: BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON,
                    params: { value: "{\"user\":{\"profile\":{\"name\":\"Ada\"}},\"items\":[10,20]}" },
                },
                getName: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
                    params: { path: "user.profile.name" },
                },
                getArrayItem: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
                    params: { path: "items.1" },
                },
                hasName: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_HAS,
                    params: { path: "user.profile.name" },
                },
                stringify: {
                    type: BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
                    params: { value: { ok: true } },
                },
            },
            edges: [
                { from: { nodeId: "parse", port: "result" }, to: { nodeId: "getName", port: "json" } },
                { from: { nodeId: "parse", port: "result" }, to: { nodeId: "getArrayItem", port: "json" } },
                { from: { nodeId: "parse", port: "result" }, to: { nodeId: "hasName", port: "json" } },
            ],
        };

        expect(resolveDataPinValue(graph, "parse", "result", graph.nodes.parse.params, undefined)).toEqual({
            user: { profile: { name: "Ada" } },
            items: [10, 20],
        });
        expect(resolveDataPinValue(graph, "getName", "result", graph.nodes.getName.params, undefined)).toBe("Ada");
        expect(resolveDataPinValue(graph, "getArrayItem", "result", graph.nodes.getArrayItem.params, undefined)).toBe(20);
        expect(resolveDataPinValue(graph, "hasName", "result", graph.nodes.hasName.params, undefined)).toBe(true);
        expect(resolveDataPinValue(graph, "stringify", "result", graph.nodes.stringify.params, undefined)).toBe(
            "{\"ok\":true}",
        );
    });

    it("keeps JSON pin compatibility strict while allowing numeric values into string inputs", () => {
        registerCoreBlueprintNodes();

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
                sourcePort: "value",
                targetType: BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
                targetPort: "value",
            }),
        ).toBe(false);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
                sourcePort: "value",
                targetType: BLUEPRINT_NODE_TYPE_STRING_LENGTH,
                targetPort: "value",
            }),
        ).toBe(true);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_DATA_PARSE_INT,
                sourcePort: "result",
                targetType: BLUEPRINT_NODE_TYPE_STRING_LENGTH,
                targetPort: "value",
            }),
        ).toBe(true);
    });

    it("exposes and executes the If flow node", () => {
        registerCoreBlueprintNodes();

        const eventPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "surfaceMain", surfaceId: "surface" },
            }).map(entry => entry.type),
        );
        const functionPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "function",
                owner: { kind: "surfaceMain", surfaceId: "surface" },
            }).map(entry => entry.type),
        );

        expect(eventPaletteTypes.has("if")).toBe(true);
        expect(functionPaletteTypes.has("if")).toBe(false);

        const ifNode = controlFlowBlueprintNodes.find(def => def.type === "if")!;
        expect(
            ifNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "branch", port: "in" } } },
                    nodes: {
                        condition: {
                            id: "condition",
                            type: BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
                            params: { value: "true" },
                        },
                        branch: { id: "branch", type: "if", params: {} },
                    },
                    edges: [
                        {
                            from: { nodeId: "condition", port: "value" },
                            to: { nodeId: "branch", port: "condition" },
                        },
                    ],
                },
                entry: { start: { nodeId: "branch", port: "in" } },
                node: { id: "branch", type: "if", params: {} },
                params: {},
                hostAdapter: { host: "player" },
            }),
        ).toEqual({ nextPort: "true" });
    });

    it("only exposes Text nodes for Text widget blueprints", () => {
        registerCoreBlueprintNodes();

        const textPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "text" },
                widgetElementType: "nl.text",
            }).map(entry => entry.type),
        );
        const buttonPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                widgetElementType: "nl.button",
            }).map(entry => entry.type),
        );

        expect(textPaletteTypes.has(BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT)).toBe(true);
        expect(textPaletteTypes.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(false);
    });

    it("exposes Broadcast nodes for surface blueprints", () => {
        registerCoreBlueprintNodes();

        const surfacePaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "surfaceMain", surfaceId: "surface" },
            }).map(entry => entry.type),
        );

        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_BROADCAST_SEND)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT)).toBe(true);
    });

    it("executes Text write nodes and resolves Text read nodes against the current widget owner", async () => {
        registerCoreBlueprintNodes();

        const textProps = {
            text: "Before",
            fontAssetId: null,
            fontSize: 16,
            fontWeight: "normal" as const,
            color: "#ffffff",
            textAlign: "left" as const,
            textVerticalAlign: "start" as const,
            lineHeight: 1.4,
            textWrapMode: "word" as const,
            effects: {
                effectBlur: 0,
                effectBackgroundBlur: 0,
                effectShadow: null,
                effectTextShadow: null,
                effectInnerShadow: null,
                effectBlend: "",
                effectGlow: null,
                effectFilter: null,
            },
        };
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                surfaceId: "surface",
                setSurfaceState: () => undefined,
                getSurfaceState: () => undefined,
                emitDebug: () => undefined,
                dispatchElementBlueprintEvent: async () => undefined,
                hostApi: {
                    widget: {
                        getTextProperties: () => textProps,
                        setTextProperties: async (_elementId: string, patch: Partial<typeof textProps>) => {
                            Object.assign(textProps, patch);
                        },
                    },
                },
            },
        } as unknown as UIHostAdapter;

        const setNode = textBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)!;
        await Promise.resolve(
            setNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setText", port: "in" } } },
                    nodes: {
                        setText: {
                            id: "setText",
                            type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
                            params: { text: "After" },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "setText", port: "in" } },
                node: {
                    id: "setText",
                    type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
                    params: { text: "After" },
                },
                params: { text: "After" },
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "text", blueprintId: "bp" },
            }),
        );

        expect(textProps.text).toBe("After");
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getText: { type: BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT },
                    },
                    edges: [],
                },
                "getText",
                "text",
                {},
                undefined,
                0,
                {
                    hostAdapter,
                    executionOwner: { surfaceId: "surface", elementId: "text", blueprintId: "bp" },
                },
            ),
        ).toBe("After");
    });
});
