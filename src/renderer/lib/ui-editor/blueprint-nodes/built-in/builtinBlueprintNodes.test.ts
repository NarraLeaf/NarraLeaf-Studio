import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT,
    BLUEPRINT_NODE_TYPE_BROADCAST_SEND,
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_DATA_JSON_HAS,
    BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
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
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_FLOW_NOOP,
    BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
    BLUEPRINT_NODE_TYPE_FLOW_WHILE,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
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
import { executeGraph } from "../../behavior-graph/GraphExecutor";
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
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_IF)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_NOOP)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_WHILE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_DELAY)).toBe(true);
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
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH)).toBe(true);
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
        const jsonNodeTypes = new Set<string>([
            BLUEPRINT_NODE_TYPE_LITERAL_JSON,
            BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
            BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON,
            BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
            BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
            BLUEPRINT_NODE_TYPE_DATA_JSON_HAS,
            BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
            BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
            BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH,
        ]);
        expect(dataBlueprintNodes.filter(def => !jsonNodeTypes.has(def.type)).every(def => def.category === "Data")).toBe(true);
        expect(dataBlueprintNodes.filter(def => jsonNodeTypes.has(def.type)).every(def => def.category === "JSON")).toBe(true);
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

    it("resolves JSON make object, make array, and array length nodes", () => {
        registerCoreBlueprintNodes();

        const graph = {
            nodes: {
                object: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
                    params: {
                        __jsonObjectInputPins: ["field_1", "field_2"],
                        __jsonObjectFieldNames: { field_1: "name", field_2: "score" },
                        field_1: "Ada",
                        field_2: 42,
                    },
                },
                array: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
                    params: {
                        __jsonArrayInputPins: ["item_1", "item_2"],
                        item_1: true,
                    },
                },
                length: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH,
                    params: {},
                },
            },
            edges: [{ from: { nodeId: "array", port: "result" }, to: { nodeId: "length", port: "value" } }],
        };

        expect(resolveDataPinValue(graph, "object", "result", graph.nodes.object.params, undefined)).toEqual({
            name: "Ada",
            score: 42,
        });
        expect(resolveDataPinValue(graph, "array", "result", graph.nodes.array.params, undefined)).toEqual([
            true,
            null,
        ]);
        expect(resolveDataPinValue(graph, "length", "length", graph.nodes.length.params, undefined)).toBe(2);
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

        expect(eventPaletteTypes.has(BLUEPRINT_NODE_TYPE_FLOW_IF)).toBe(true);
        expect(functionPaletteTypes.has(BLUEPRINT_NODE_TYPE_FLOW_IF)).toBe(false);

        const ifNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_IF)!;
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
                        branch: { id: "branch", type: BLUEPRINT_NODE_TYPE_FLOW_IF, params: {} },
                    },
                    edges: [
                        {
                            from: { nodeId: "condition", port: "value" },
                            to: { nodeId: "branch", port: "condition" },
                        },
                    ],
                },
                entry: { start: { nodeId: "branch", port: "in" } },
                node: { id: "branch", type: BLUEPRINT_NODE_TYPE_FLOW_IF, params: {} },
                params: {},
                hostAdapter: { host: "player" },
            }),
        ).toEqual({ nextPort: "true" });
    });

    it("executes string switch, bounded loops, and zero-duration delay flow nodes", async () => {
        registerCoreBlueprintNodes();

        const switchNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING)!;
        expect(
            switchNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "switch", port: "in" } } },
                    nodes: {
                        switch: {
                            id: "switch",
                            type: BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
                            params: { value: "menu", case0Value: "title", case1Value: "menu" },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "switch", port: "in" } },
                node: {
                    id: "switch",
                    type: BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
                    params: { value: "menu", case0Value: "title", case1Value: "menu" },
                },
                params: { value: "menu", case0Value: "title", case1Value: "menu" },
                hostAdapter: { host: "player" },
            }),
        ).toEqual({ nextPort: "case1" });

        const loopLocals: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "loopGraph",
                entries: { main: { start: { nodeId: "loop", port: "in" } } },
                nodes: {
                    loop: {
                        id: "loop",
                        type: BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP,
                        params: { start: 0, end: 2, step: 1, maxIterations: 10 },
                    },
                    capture: {
                        id: "capture",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "lastIndex" },
                    },
                    done: { id: "done", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP, params: {} },
                },
                edges: [
                    { from: { nodeId: "loop", port: "loop" }, to: { nodeId: "capture", port: "in" } },
                    { from: { nodeId: "loop", port: "index" }, to: { nodeId: "capture", port: "value" } },
                    { from: { nodeId: "capture", port: "next" }, to: { nodeId: "loop", port: "in" } },
                    { from: { nodeId: "loop", port: "completed" }, to: { nodeId: "done", port: "in" } },
                ],
            },
            entry: { start: { nodeId: "loop", port: "in" } },
            hostAdapter: { host: "player" as const },
            blueprintLocals: loopLocals,
            maxSteps: 20,
        });
        expect(loopLocals.lastIndex).toBe(2);

        const forEachNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH)!;
        const forEachLocals: Record<string, unknown> = {};
        expect(
            forEachNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "each", port: "in" } } },
                    nodes: {
                        each: {
                            id: "each",
                            type: BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
                            params: { items: ["a", "b"], maxIterations: 10 },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "each", port: "in" } },
                node: {
                    id: "each",
                    type: BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
                    params: { items: ["a", "b"], maxIterations: 10 },
                },
                params: { items: ["a", "b"], maxIterations: 10 },
                hostAdapter: { host: "player" },
                blueprintLocals: forEachLocals,
            }),
        ).toEqual({ nextPort: "loop", outputValues: { item: "a", index: 0 } });

        const whileNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_WHILE)!;
        const whileLocals: Record<string, unknown> = {};
        const whileContext = {
            graph: {
                id: "graph",
                entries: { main: { start: { nodeId: "while", port: "in" } } },
                nodes: {
                    condition: {
                        id: "condition",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
                        params: { value: true },
                    },
                    while: {
                        id: "while",
                        type: BLUEPRINT_NODE_TYPE_FLOW_WHILE,
                        params: { maxIterations: 1 },
                    },
                },
                edges: [{ from: { nodeId: "condition", port: "value" }, to: { nodeId: "while", port: "condition" } }],
            },
            entry: { start: { nodeId: "while", port: "in" } },
            node: {
                id: "while",
                type: BLUEPRINT_NODE_TYPE_FLOW_WHILE,
                params: { maxIterations: 1 },
            },
            params: { maxIterations: 1 },
            hostAdapter: { host: "player" as const },
            blueprintLocals: whileLocals,
        };
        expect(whileNode.execute(whileContext)).toEqual({ nextPort: "loop" });
        expect(whileNode.execute(whileContext)).toEqual({ nextPort: "completed" });

        const delayNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_DELAY)!;
        await expect(
            Promise.resolve(
                delayNode.execute({
                    graph: {
                        id: "graph",
                        entries: { main: { start: { nodeId: "delay", port: "in" } } },
                        nodes: {
                            delay: {
                                id: "delay",
                                type: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                                params: { duration: 0 },
                            },
                        },
                        edges: [],
                    },
                    entry: { start: { nodeId: "delay", port: "in" } },
                    node: {
                        id: "delay",
                        type: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                        params: { duration: 0 },
                    },
                    params: { duration: 0 },
                    hostAdapter: { host: "player" },
                }),
            ),
        ).resolves.toEqual({ nextPort: "completed" });
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
