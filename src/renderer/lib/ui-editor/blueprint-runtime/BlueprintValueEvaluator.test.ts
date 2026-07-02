import { describe, expect, it } from "vitest";
import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_VALUE,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { createExplicitBlueprintVariableRef } from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";
import { evaluateBlueprintValue, validateBlueprintValueGraphSafe } from "./BlueprintValueEvaluator";

function returnGraph(value: string): BlueprintGraphIr {
    return {
        nodes: {
            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, params: {} },
            value: { id: "value", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value } },
            ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
        },
        edges: [
            { from: { nodeId: "head", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "value", port: "value" }, to: { nodeId: "ret", port: "value" } },
        ],
    };
}

function valueDocument(graph: BlueprintGraphIr): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        persistentVariables: {},
        blueprints: {
            "bp-value": {
                id: "bp-value",
                name: "Text value",
                owner: { kind: "widgetValue", surfaceId: "surface", elementId: "text-a", propPath: "text" },
                frontend: "visual",
                programKind: "graph",
                members: { variables: {}, fields: {}, functions: {} },
                program: {
                    kind: "graph",
                    graphs: {
                        events: {
                            init: { id: "init", name: "Init", graph },
                        },
                        functions: {},
                    },
                },
            },
        },
        ownerRecords: {
            "widgetValue:surface:text-a:text": {
                activeBlueprintId: "bp-value",
                privateBlueprintIds: ["bp-value"],
                initializedFrontend: "visual",
            },
        },
    };
}

function hostAdapter(text = "Bound text", onSetText?: () => void, sliderValue = 37): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: {
            surfaceId: "surface",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: {
                widget: {
                    getTextProperties: () => ({
                        text,
                        fontAssetId: null,
                        fontSize: 16,
                        fontWeight: "normal",
                        color: "#ffffff",
                        textAlign: "left",
                        textVerticalAlign: "start",
                        lineHeight: 1.4,
                        textWrapMode: "word",
                        effects: {},
                    }),
                    setTextProperties: async () => {
                        onSetText?.();
                    },
                    getDisplayableProperties: () => ({
                        position: { x: 0, y: 0 },
                        offset: { x: 0, y: 0 },
                        size: { width: 100, height: 40 },
                        bounds: { x: 0, y: 0, width: 100, height: 40 },
                        rotation: 0,
                        opacity: 1,
                        display: true,
                        visible: true,
                    }),
                    getSliderProperties: () => ({
                        value: sliderValue,
                        normalizedValue: sliderValue / 100,
                        min: 0,
                        max: 100,
                        step: 1,
                    }),
                },
            },
        },
    } as unknown as UIHostAdapter;
}

async function evalValue(doc: BlueprintDocument, adapter = hostAdapter()) {
    return evaluateBlueprintValue({
        blueprintDocument: doc,
        blueprintId: "bp-value",
        surfaceId: "surface",
        elementId: "text-a",
        hostAdapter: adapter,
    });
}

describe("Blueprint Value evaluator", () => {
    it("returns the literal seeded in the init graph", async () => {
        await expect(evalValue(valueDocument(returnGraph("literal")))).resolves.toEqual({
            returned: true,
            value: "literal",
            dependencies: [],
        });
    });

    it("evaluates value graphs from an On Flush head", async () => {
        const graph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH, params: {} },
                value: { id: "value", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "from-flush" } },
                ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "ret", port: "in" } },
                { from: { nodeId: "value", port: "value" }, to: { nodeId: "ret", port: "value" } },
            ],
        };

        await expect(evalValue(valueDocument(graph))).resolves.toMatchObject({
            returned: true,
            value: "from-flush",
        });
    });

    it("can write and read local variables in the init graph", async () => {
        const graph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, params: {} },
                input: { id: "input", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "from-var" } },
                set: { id: "set", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "title" } },
                get: { id: "get", type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "title" } },
                ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "set", port: "in" } },
                { from: { nodeId: "input", port: "value" }, to: { nodeId: "set", port: "value" } },
                { from: { nodeId: "set", port: "next" }, to: { nodeId: "ret", port: "in" } },
                { from: { nodeId: "get", port: "value" }, to: { nodeId: "ret", port: "value" } },
            ],
        };

        await expect(evalValue(valueDocument(graph))).resolves.toMatchObject({
            returned: true,
            value: "from-var",
        });
    });

    it("initializes accessible variables from non-Value Var declaration nodes", async () => {
        const surfaceVariableRef = createExplicitBlueprintVariableRef("bp-surface", "title");
        const graph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, params: {} },
                get: { id: "get", type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: surfaceVariableRef } },
                ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "ret", port: "in" } },
                { from: { nodeId: "get", port: "value" }, to: { nodeId: "ret", port: "value" } },
            ],
        };
        const doc = valueDocument(graph);
        doc.blueprints["bp-surface"] = {
            id: "bp-surface",
            name: "Surface",
            owner: { kind: "surfaceMain", surfaceId: "surface" },
            frontend: "visual",
            programKind: "graph",
            members: { variables: {}, fields: {}, functions: {} },
            program: {
                kind: "graph",
                graphs: {
                    events: {
                        init: {
                            id: "init",
                            graph: {
                                nodes: {
                                    declare: {
                                        id: "declare",
                                        type: BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
                                        params: {
                                            variableId: "title",
                                            name: "Title",
                                            valueType: "string",
                                            defaultValue: "from-default",
                                        },
                                    },
                                },
                                edges: [],
                            },
                        },
                    },
                    functions: {},
                },
            },
        };
        doc.ownerRecords["surfaceMain:surface"] = {
            activeBlueprintId: "bp-surface",
            privateBlueprintIds: ["bp-surface"],
            initializedFrontend: "visual",
        };

        await expect(evalValue(doc)).resolves.toMatchObject({
            returned: true,
            value: "from-default",
        });
    });

    it("tracks Element Text property dependencies while resolving return data pins", async () => {
        const graph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, params: {} },
                element: {
                    id: "element",
                    type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                    params: { surfaceId: "surface", elementId: "text-b", elementType: "nl.text" },
                },
                getText: { id: "getText", type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT, params: {} },
                ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "ret", port: "in" } },
                { from: { nodeId: "element", port: "element" }, to: { nodeId: "getText", port: "element" } },
                { from: { nodeId: "getText", port: "text" }, to: { nodeId: "ret", port: "value" } },
            ],
        };

        await expect(evalValue(valueDocument(graph), hostAdapter("From B"))).resolves.toEqual({
            returned: true,
            value: "From B",
            dependencies: [{ surfaceId: "surface", elementId: "text-b", propPath: "props.text" }],
        });
    });

    it("tracks Slider mapped value dependencies while resolving return data pins", async () => {
        const graph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, params: {} },
                element: {
                    id: "element",
                    type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                    params: { surfaceId: "surface", elementId: "slider-b", elementType: "nl.slider" },
                },
                getValue: { id: "getValue", type: BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_VALUE, params: {} },
                ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "ret", port: "in" } },
                { from: { nodeId: "element", port: "element" }, to: { nodeId: "getValue", port: "slider" } },
                { from: { nodeId: "getValue", port: "value" }, to: { nodeId: "ret", port: "value" } },
            ],
        };

        await expect(evalValue(valueDocument(graph), hostAdapter("Text", undefined, 42))).resolves.toEqual({
            returned: true,
            value: 42,
            dependencies: [{ surfaceId: "surface", elementId: "slider-b", propPath: "props.value" }],
        });
    });

    it("blocks effectful element write nodes before they can run", async () => {
        let setTextCalls = 0;
        const graph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, params: {} },
                setText: { id: "setText", type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, params: { text: "blocked" } },
            },
            edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "setText", port: "in" } }],
        };

        expect(validateBlueprintValueGraphSafe(graph)).toHaveLength(1);
        await expect(evalValue(valueDocument(graph), hostAdapter(undefined, () => { setTextCalls += 1; }))).rejects.toThrow(
            /not allowed in Blueprint Value/,
        );
        expect(setTextCalls).toBe(0);
    });
});
