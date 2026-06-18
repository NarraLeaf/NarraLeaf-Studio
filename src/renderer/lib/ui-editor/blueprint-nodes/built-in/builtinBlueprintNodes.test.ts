import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT,
    BLUEPRINT_NODE_TYPE_BROADCAST_SEND,
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_DATA_JSON_HAS,
    BLUEPRINT_NODE_TYPE_DATA_JSON_SET,
    BLUEPRINT_NODE_TYPE_DATA_JSON_REMOVE,
    BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MERGE_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_JSON_CLONE,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_INT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
    BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT,
    BLUEPRINT_NODE_TYPE_FRAME_EMIT,
    BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
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
    BLUEPRINT_NODE_TYPE_STATE_GET,
    BLUEPRINT_NODE_TYPE_STATE_SET,
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
import { listBlueprintNodePaletteEntries } from "../../behavior-graph/nodeEditorCatalog";
import { broadcastBlueprintNodes } from "./broadcastNodes";
import { controlFlowBlueprintNodes } from "./controlFlowNodes";
import { dataBlueprintNodes } from "./dataNodes";
import { devtoolsBlueprintNodes } from "./devtoolsNodes";
import { eventHeadBlueprintNodes } from "./events/eventHeadNodes";
import { frameBlueprintNodes } from "./frameNodes";
import { resolveDataPinValue } from "./graphParamResolvers";
import { stateBlueprintNodes } from "./stateNodes";
import { stringBlueprintNodes } from "./stringNodes";
import { textBlueprintNodes } from "./textNodes";

describe("built-in blueprint nodes", () => {
    it("registers documented event, broadcast, string, text, and debug nodes", () => {
        registerCoreBlueprintNodes();

        const types = new Set(blueprintNodeRegistry.list().map(def => def.type));

        for (const def of [
            ...eventHeadBlueprintNodes,
            ...broadcastBlueprintNodes,
            ...frameBlueprintNodes,
            ...controlFlowBlueprintNodes,
            ...dataBlueprintNodes,
            ...stringBlueprintNodes,
            ...stateBlueprintNodes,
            ...textBlueprintNodes,
            ...devtoolsBlueprintNodes,
        ]) {
            expect(types.has(def.type)).toBe(true);
        }
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_BROADCAST_SEND)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FRAME_EMIT)).toBe(true);
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
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_SET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_REMOVE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_MERGE_OBJECT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_CLONE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_STRING_TO_STRING)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_STATE_GET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LOG)).toBe(true);
    });

    it("uses class.md palette categories for the new node groups", () => {
        registerCoreBlueprintNodes();

        expect(eventHeadBlueprintNodes.every(def => def.category === "Events")).toBe(true);
        expect(broadcastBlueprintNodes.every(def => def.category === "Events")).toBe(true);
        expect(frameBlueprintNodes.every(def => def.category === "Page")).toBe(true);
        expect(controlFlowBlueprintNodes.every(def => def.category === "Flow")).toBe(true);
        const stateVariableNodeTypes = new Set<string>([
            BLUEPRINT_NODE_TYPE_STATE_GET,
            BLUEPRINT_NODE_TYPE_STATE_SET,
        ]);
        expect(
            stateBlueprintNodes
                .filter(def => stateVariableNodeTypes.has(def.type))
                .every(def => def.category === "Variables"),
        ).toBe(true);
        const jsonNodeTypes = new Set<string>([
            BLUEPRINT_NODE_TYPE_LITERAL_JSON,
            BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
            BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON,
            BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
            BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
            BLUEPRINT_NODE_TYPE_DATA_JSON_HAS,
            BLUEPRINT_NODE_TYPE_DATA_JSON_SET,
            BLUEPRINT_NODE_TYPE_DATA_JSON_REMOVE,
            BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
            BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
            BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH,
            BLUEPRINT_NODE_TYPE_DATA_JSON_MERGE_OBJECT,
            BLUEPRINT_NODE_TYPE_DATA_JSON_CLONE,
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
                        __jsonObjectInputPins: [
                            "field_1_name",
                            "field_1_value",
                            "field_2_name",
                            "field_2_value",
                        ],
                        field_1_name: "name",
                        field_1_value: "Ada",
                        field_2_name: "score",
                        field_2_value: 42,
                    },
                },
                legacyObject: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
                    params: {
                        __jsonObjectInputPins: ["field_1", "field_2"],
                        __jsonObjectFieldNames: { field_1: "legacyName", field_2: "legacyScore" },
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
        expect(resolveDataPinValue(graph, "legacyObject", "result", graph.nodes.legacyObject.params, undefined)).toEqual({
            legacyName: "Ada",
            legacyScore: 42,
        });
        expect(resolveDataPinValue(graph, "array", "result", graph.nodes.array.params, undefined)).toEqual([
            true,
            null,
        ]);
        expect(resolveDataPinValue(graph, "length", "length", graph.nodes.length.params, undefined)).toBe(2);
    });

    it("resolves JSON set, remove, merge object, and clone nodes", () => {
        registerCoreBlueprintNodes();

        const graph = {
            nodes: {
                set: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_SET,
                    params: {
                        json: { user: { name: "Ada" }, items: [10] },
                        path: "user.score",
                        value: 42,
                    },
                },
                remove: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_REMOVE,
                    params: {
                        json: { user: { name: "Ada", score: 42 }, items: [10, 20] },
                        path: "items.0",
                    },
                },
                merge: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_MERGE_OBJECT,
                    params: {
                        a: { name: "Ada", score: 1 },
                        b: { score: 42, ok: true },
                    },
                },
                clone: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_CLONE,
                    params: {
                        value: { nested: { enabled: true } },
                    },
                },
            },
            edges: [],
        };

        expect(resolveDataPinValue(graph, "set", "result", graph.nodes.set.params, undefined)).toEqual({
            user: { name: "Ada", score: 42 },
            items: [10],
        });
        expect(resolveDataPinValue(graph, "remove", "result", graph.nodes.remove.params, undefined)).toEqual({
            user: { name: "Ada", score: 42 },
            items: [20],
        });
        expect(resolveDataPinValue(graph, "merge", "result", graph.nodes.merge.params, undefined)).toEqual({
            name: "Ada",
            score: 42,
            ok: true,
        });
        const cloned = resolveDataPinValue(graph, "clone", "result", graph.nodes.clone.params, undefined);
        expect(cloned).toEqual({ nested: { enabled: true } });
        expect(cloned).not.toBe(graph.nodes.clone.params.value);
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

    it("scopes Blueprint Value event heads and return nodes to value blueprints", () => {
        registerCoreBlueprintNodes();

        const valuePaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetValue", surfaceId: "surface", elementId: "text", propPath: "text" },
                widgetElementType: "nl.text",
                isBlueprintValueGraph: true,
            }).map(entry => entry.type),
        );
        const widgetPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "text" },
                widgetElementType: "nl.text",
            }).map(entry => entry.type),
        );

        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_STATE_GET)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_STATE_SET)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_FLOW_DELAY)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_LOG)).toBe(false);

        expect(widgetPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)).toBe(true);
        expect(widgetPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH)).toBe(false);
        expect(widgetPaletteTypes.has(BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)).toBe(false);
    });

    it("exposes Blueprint Value nodes through the editor palette facade", () => {
        const entries = listBlueprintNodePaletteEntries({
            graphKind: "event",
            owner: { kind: "widgetValue", surfaceId: "surface", elementId: "text", propPath: "text" },
            widgetElementType: "nl.text",
            isBlueprintValueGraph: true,
        });
        const byType = new Map(entries.map(entry => [entry.type, entry]));

        expect(byType.get(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)?.category).toBe("Events");
        expect(byType.get(BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH)?.category).toBe("Events");
        expect(byType.get(BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)?.category).toBe("Data");
        expect(byType.get(BLUEPRINT_NODE_TYPE_STATE_GET)?.category).toBe("Variables");
        expect(byType.has(BLUEPRINT_NODE_TYPE_STATE_SET)).toBe(false);
        expect(byType.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(false);
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

    it("scopes event heads by owner and widget capability without duplicate click aliases", () => {
        registerCoreBlueprintNodes();

        const globalPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "globalMain" },
            }).map(entry => entry.type),
        );
        const surfacePaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "surfaceMain", surfaceId: "surface" },
            }).map(entry => entry.type),
        );
        const buttonPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                widgetElementType: "nl.button",
            }).map(entry => entry.type),
        );
        const listPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "list" },
                widgetElementType: "nl.list",
            }).map(entry => entry.type),
        );
        const framePaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "frame" },
                widgetElementType: "nl.frame",
            }).map(entry => entry.type),
        );
        const allTypes = new Set(blueprintNodeRegistry.list().map(def => def.type));

        expect(allTypes.has("blueprint.event.head.click")).toBe(false);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT)).toBe(true);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT)).toBe(false);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);

        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT)).toBe(false);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT)).toBe(false);

        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT)).toBe(false);

        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);

        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST)).toBe(true);
    });

    it("filters widget event heads by the active event layer slot when provided", () => {
        registerCoreBlueprintNodes();

        const listScrollPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "list" },
                widgetElementType: "nl.list",
                widgetEventLayerSlots: ["scroll"],
            }).map(entry => entry.type),
        );

        expect(listScrollPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL)).toBe(true);
        expect(listScrollPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)).toBe(false);
        expect(listScrollPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toBe(false);
        expect(listScrollPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);

        const listItemClickPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "list" },
                widgetElementType: "nl.list",
                widgetEventLayerSlots: ["itemClick"],
            }).map(entry => entry.type),
        );

        expect(listItemClickPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toBe(true);
        expect(listItemClickPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL)).toBe(false);
        expect(listItemClickPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED)).toBe(false);
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
