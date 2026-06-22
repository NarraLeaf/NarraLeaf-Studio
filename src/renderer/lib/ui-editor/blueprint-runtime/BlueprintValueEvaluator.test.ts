import { describe, expect, it } from "vitest";
import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
} from "@shared/types/blueprint/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import {
    BLUEPRINT_VALUE_EVENT_FLUSH,
    BLUEPRINT_VALUE_EVENT_INIT,
    evaluateBlueprintValue,
    validateBlueprintValueGraphSafe,
} from "./BlueprintValueEvaluator";

function returnGraph(headType: string, value: string): BlueprintGraphIr {
    return {
        nodes: {
            head: { id: "head", type: headType, params: {} },
            value: { id: "value", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value } },
            ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
        },
        edges: [
            { from: { nodeId: "head", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "value", port: "value" }, to: { nodeId: "ret", port: "value" } },
        ],
    };
}

function valueDocument(initGraph: BlueprintGraphIr, flushGraph?: BlueprintGraphIr): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {
            "bp-value": {
                id: "bp-value",
                name: "Text value",
                owner: { kind: "widgetValue", surfaceId: "surface", elementId: "text", propPath: "text" },
                frontend: "visual",
                programKind: "graph",
                members: { variables: {}, fields: {}, functions: {} },
                program: {
                    kind: "graph",
                    graphs: {
                        events: {
                            init: { id: "init", name: "Init", graph: initGraph },
                            ...(flushGraph
                                ? { flush: { id: "flush", name: "Flush", graph: flushGraph } }
                                : {}),
                        },
                        functions: {},
                    },
                },
            },
        },
        ownerRecords: {
            "widgetValue:surface:text:text": {
                activeBlueprintId: "bp-value",
                privateBlueprintIds: ["bp-value"],
                initializedFrontend: "visual",
            },
        },
    };
}

function hostAdapter(stateValue: unknown = undefined, onSetText?: () => void): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: {
            surfaceId: "surface",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: {
                state: {
                    get: () => stateValue,
                    set: () => undefined,
                },
                widget: {
                    setTextProperties: async () => {
                        onSetText?.();
                    },
                },
            },
        },
    } as unknown as UIHostAdapter;
}

async function evalValue(doc: BlueprintDocument, eventName: typeof BLUEPRINT_VALUE_EVENT_INIT | typeof BLUEPRINT_VALUE_EVENT_FLUSH, adapter = hostAdapter()) {
    return evaluateBlueprintValue({
        blueprintDocument: doc,
        blueprintId: "bp-value",
        surfaceId: "surface",
        elementId: "text",
        eventName,
        hostAdapter: adapter,
    });
}

describe("Blueprint Value evaluator", () => {
    it("returns the default literal seeded in the init graph and ignores missing flush", async () => {
        const doc = valueDocument(returnGraph(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, "literal"));

        await expect(evalValue(doc, BLUEPRINT_VALUE_EVENT_INIT)).resolves.toEqual({
            returned: true,
            value: "literal",
        });
        await expect(evalValue(doc, BLUEPRINT_VALUE_EVENT_FLUSH)).resolves.toEqual({
            returned: false,
            value: undefined,
        });
    });

    it("lets flush override init when both return values", async () => {
        const doc = valueDocument(
            returnGraph(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, "init"),
            returnGraph(BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH, "flush"),
        );

        const init = await evalValue(doc, BLUEPRINT_VALUE_EVENT_INIT);
        const flush = await evalValue(doc, BLUEPRINT_VALUE_EVENT_FLUSH);

        expect(init.value).toBe("init");
        expect(flush.value).toBe("flush");
    });

    it("reports no returned value when no return node executes", async () => {
        const doc = valueDocument(returnGraph(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, "init"), {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH, params: {} },
            },
            edges: [],
        });

        await expect(evalValue(doc, BLUEPRINT_VALUE_EVENT_FLUSH)).resolves.toEqual({
            returned: false,
            value: undefined,
        });
    });

    it("can write and read local variables", async () => {
        const flushGraph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH, params: {} },
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
        const doc = valueDocument(returnGraph(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, "init"), flushGraph);

        await expect(evalValue(doc, BLUEPRINT_VALUE_EVENT_FLUSH)).resolves.toEqual({
            returned: true,
            value: "from-var",
        });
    });

    it("blocks effectful widget nodes before they can run", async () => {
        let setTextCalls = 0;
        const flushGraph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH, params: {} },
                setText: { id: "setText", type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT, params: { text: "blocked" } },
            },
            edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "setText", port: "in" } }],
        };
        const doc = valueDocument(returnGraph(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, "init"), flushGraph);

        expect(validateBlueprintValueGraphSafe(flushGraph)).toHaveLength(1);
        await expect(evalValue(doc, BLUEPRINT_VALUE_EVENT_FLUSH, hostAdapter(undefined, () => { setTextCalls += 1; }))).rejects.toThrow(
            /not allowed in Blueprint Value/,
        );
        expect(setTextCalls).toBe(0);
    });
});
