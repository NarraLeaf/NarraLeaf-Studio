import { describe, expect, it } from "vitest";
import type { BlueprintDocument, BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_PARAM_FN_NAME,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_IDS,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_LABELS,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_TYPES,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_IDS,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_LABELS,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_TYPES,
    BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FN_RETURN,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_NORMALIZED_VALUE,
    BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_VALUE,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_LOG,
    BLUEPRINT_NODE_TYPE_SOUND_PLAY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_INDEX,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_SAVED_GET,
    BLUEPRINT_NODE_TYPE_SAVED_SET,
    BLUEPRINT_NODE_TYPE_SCENE_GET,
    BLUEPRINT_NODE_TYPE_STRING_FORMAT,
    BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
} from "@shared/types/blueprint/graph";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { buildBlueprintGraphContext } from "@/lib/ui-editor/blueprint-nodes/graphContext";
import { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { createBlueprintFnRef } from "./fnCatalog";
import { ownerRefToIndexKey } from "./ownerKeys";
import {
    validateBlueprintDocumentGraphs,
    validateBlueprintGraphIr,
    type BlueprintGraphEditorDiagnostic,
} from "./graphValidation";

describe("blueprint graph validation", () => {
    it("reports multiple outgoing edges from one output pin", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                source: { id: "source", type: BLUEPRINT_NODE_TYPE_LOCAL_GET },
                first: { id: "first", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
                second: { id: "second", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
            },
            edges: [
                { from: { nodeId: "source", port: "value" }, to: { nodeId: "first", port: "value" } },
                { from: { nodeId: "source", port: "value" }, to: { nodeId: "second", port: "value" } },
            ],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
        });

        expect(diagnostics.map(d => d.code)).toContain("edge.pin_multiple");
    });

    it("accepts the Story Action On Call head as a valid event head", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL },
            },
            edges: [],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "onCall",
            blueprintOwner: { kind: "storyAction", blueprintId: "bp", mode: "value" },
        });

        expect(diagnostics.map(d => d.code)).not.toContain("event.missing_event_nodes");
    });

    it("allows multiple outgoing edges from literal output pins", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                source: { id: "source", type: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER },
                first: { id: "first", type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING },
                second: { id: "second", type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING },
            },
            edges: [
                { from: { nodeId: "source", port: "value" }, to: { nodeId: "first", port: "value" } },
                { from: { nodeId: "source", port: "value" }, to: { nodeId: "second", port: "value" } },
            ],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
        });

        expect(diagnostics.map(d => d.code)).not.toContain("edge.pin_multiple");
    });

    it("reports multiple incoming edges to one input pin", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                firstSource: { id: "firstSource", type: BLUEPRINT_NODE_TYPE_LOCAL_GET },
                secondSource: { id: "secondSource", type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING },
                target: { id: "target", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
            },
            edges: [
                { from: { nodeId: "firstSource", port: "value" }, to: { nodeId: "target", port: "value" } },
                { from: { nodeId: "secondSource", port: "result" }, to: { nodeId: "target", port: "value" } },
            ],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
        });

        expect(diagnostics.map(d => d.code)).toContain("edge.pin_multiple");
    });

    it("allows multiple outgoing exec pins to connect to one exec input pin", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                firstBranch: { id: "firstBranch", type: "if" },
                secondBranch: { id: "secondBranch", type: "if" },
                target: { id: "target", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
            },
            edges: [
                { from: { nodeId: "firstBranch", port: "true" }, to: { nodeId: "target", port: "in" } },
                { from: { nodeId: "secondBranch", port: "false" }, to: { nodeId: "target", port: "in" } },
            ],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
        });

        expect(diagnostics.map(d => d.code)).not.toContain("edge.pin_multiple");
    });

    it("reports direct self-connections", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                node: { id: "node", type: "delay" },
            },
            edges: [{ from: { nodeId: "node", port: "next" }, to: { nodeId: "node", port: "in" } }],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
        });

        expect(diagnostics.map(d => d.code)).toContain("edge.self_connection");
    });

    it("reports semantically invalid existing edges", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                source: { id: "source", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
                target: { id: "target", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
            },
            edges: [{ from: { nodeId: "source", port: "next" }, to: { nodeId: "target", port: "value" } }],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
        });

        expect(diagnostics.map(d => d.code)).toContain("edge.connection_invalid");
    });

    it("reports invalid persistent variable references", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                persistent: {
                    id: "persistent",
                    type: BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
                    params: { persistentVariableId: "missing" },
                },
            },
            edges: [],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
            validPersistentVariableIds: new Set(["known"]),
        });

        expect(diagnostics.map(d => d.code)).toContain("node.persistent_variable_id_invalid");
    });

    // The saved twin of the rule above. The node card only ever offers ids the registry holds, so the
    // two ways to end up outside that set are an author who never picked (empty) and a variable that was
    // deleted after the pick (dangling) - the second being the one a picker alone cannot prevent.
    it("reports saved variable references that are empty or name a variable the registry lost", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                dangling: {
                    id: "dangling",
                    type: BLUEPRINT_NODE_TYPE_SAVED_GET,
                    params: { savedVariableId: "deleted" },
                },
                empty: { id: "empty", type: BLUEPRINT_NODE_TYPE_SAVED_SET, params: {} },
            },
            edges: [],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
            validSavedVariableIds: new Set(["known"]),
        });

        const savedDiagnostics = diagnostics.filter(d => d.code === "node.saved_variable_id_invalid");
        expect(savedDiagnostics.map(d => d.target?.kind === "node" ? d.target.nodeId : undefined).sort())
            .toEqual(["dangling", "empty"]);
    });

    it("leaves a saved variable reference the registry still holds alone", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                get: { id: "get", type: BLUEPRINT_NODE_TYPE_SAVED_GET, params: { savedVariableId: "known" } },
                set: { id: "set", type: BLUEPRINT_NODE_TYPE_SAVED_SET, params: { savedVariableId: "known" } },
            },
            edges: [],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
            validSavedVariableIds: new Set(["known"]),
        });

        expect(diagnostics.map(d => d.code)).not.toContain("node.saved_variable_id_invalid");
    });

    it("validates Get Var references against Var declaration nodes", () => {
        registerCoreBlueprintNodes();
        const doc: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                widget: {
                    id: "widget",
                    name: "Widget",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                    members: { variables: {}, fields: {}, functions: {} },
                    graphs: {
                        events: {
                            init: {
                                id: "init",
                                graph: {
                                    nodes: {
                                        declare: {
                                            id: "declare",
                                            type: BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
                                            params: { variableId: "score", name: "Score", valueType: "integer", defaultValue: 0 },
                                        },
                                        get: {
                                            id: "get",
                                            type: BLUEPRINT_NODE_TYPE_LOCAL_GET,
                                            params: { variableId: "score" },
                                        },
                                    },
                                    edges: [],
                                },
                            },
                        },
                        functions: {},
                    },
                },
            },
            ownerRecords: {},
        };

        expect(validateBlueprintDocumentGraphs(doc, "widget").map(d => d.code)).not.toContain("node.variable_id_invalid");
        const widget = doc.blueprints.widget!;
        {
            delete widget.graphs.events.init!.graph!.nodes!.declare;
        }
        expect(validateBlueprintDocumentGraphs(doc, "widget").map(d => d.code)).toContain("node.variable_id_invalid");
    });

    it("reports inferred Var type mismatches without removing existing edges", () => {
        registerCoreBlueprintNodes();
        const doc: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                widget: {
                    id: "widget",
                    name: "Widget",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                    members: { variables: {}, fields: {}, functions: {} },
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
                                                variableId: "score",
                                                name: "Score",
                                                valueType: "integer",
                                                defaultValue: 0,
                                            },
                                        },
                                        get: {
                                            id: "get",
                                            type: BLUEPRINT_NODE_TYPE_LOCAL_GET,
                                            params: { variableId: "score" },
                                        },
                                        format: { id: "format", type: BLUEPRINT_NODE_TYPE_STRING_FORMAT },
                                    },
                                    edges: [
                                        {
                                            from: { nodeId: "get", port: "value" },
                                            to: { nodeId: "format", port: "values" },
                                        },
                                    ],
                                },
                            },
                        },
                        functions: {},
                    },
                },
            },
            ownerRecords: {},
        };

        const diagnostics = validateBlueprintDocumentGraphs(doc, "widget");
        expect(diagnostics.map(d => d.code)).toContain("edge.connection_invalid");
        expect(diagnostics.find(d => d.code === "edge.connection_invalid")?.message).toContain(
            "Type mismatch: integer -> json",
        );
        const graph = doc.blueprints.widget?.graphs.events.init?.graph;
        expect(graph?.edges).toHaveLength(1);

        const declare = graph?.nodes?.declare;
        if (declare) {
            declare.params = { ...declare.params, valueType: "json", defaultValue: {} };
        }
        expect(validateBlueprintDocumentGraphs(doc, "widget").map(d => d.code)).not.toContain(
            "edge.connection_invalid",
        );
        expect(graph?.edges).toHaveLength(1);
    });

    it("reports float output connected to a json input", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                source: { id: "source", type: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER },
                target: { id: "target", type: BLUEPRINT_NODE_TYPE_STRING_FORMAT },
            },
            edges: [{ from: { nodeId: "source", port: "value" }, to: { nodeId: "target", port: "values" } }],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
        });

        expect(diagnostics.map(d => d.code)).toContain("edge.connection_invalid");
    });

    it("allows float output connected to a string input", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                source: { id: "source", type: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER },
                target: { id: "target", type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING },
            },
            edges: [{ from: { nodeId: "source", port: "value" }, to: { nodeId: "target", port: "value" } }],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
        });

        expect(diagnostics.map(d => d.code)).not.toContain("edge.connection_invalid");
    });

    it("reports nodes that are disallowed for the current blueprint owner context", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                returnValue: { id: "returnValue", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE },
            },
            edges: [],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "init",
            blueprintOwner: { kind: "widgetMain", surfaceId: "surface", elementId: "text" },
            widgetElementType: "nl.text",
        });

        const contextError = diagnostics.find(d => d.code === "node.context_invalid");
        expect(contextError?.message).toContain("Return Value only belongs in Blueprint Value graphs.");
        expect(contextError?.target).toEqual({
            kind: "node",
            graphKind: "event",
            graphId: "init",
            nodeId: "returnValue",
        });
    });

    it("allows Return Value inside Blueprint Value owner graphs", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                returnValue: { id: "returnValue", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE },
            },
            edges: [],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "init",
            blueprintOwner: {
                kind: "widgetValue",
                surfaceId: "surface",
                elementId: "text",
                propPath: "props.text",
            },
            widgetElementType: "nl.text",
        });

        expect(diagnostics.map(d => d.code)).not.toContain("node.context_invalid");
    });

    it("allows element-targeted nodes outside their own widget owner scope without automatic connections", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                getValue: { id: "getValue", type: BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_VALUE },
            },
            edges: [],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
            blueprintOwner: { kind: "surfaceMain", surfaceId: "surface" },
        });

        expect(diagnostics.map(d => d.code)).not.toContain("node.context_invalid");
    });

    it("allows Element Flush element outputs to feed multiple derived nodes", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                flush: {
                    id: "flush",
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
                    params: { surfaceId: "surface", elementId: "slider", elementType: "nl.slider" },
                },
                getValue: { id: "getValue", type: BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_VALUE },
                getNormalized: { id: "getNormalized", type: BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_NORMALIZED_VALUE },
            },
            edges: [
                { from: { nodeId: "flush", port: "element" }, to: { nodeId: "getValue", port: "slider" } },
                { from: { nodeId: "flush", port: "element" }, to: { nodeId: "getNormalized", port: "slider" } },
            ],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
            blueprintOwner: { kind: "surfaceMain", surfaceId: "surface" },
        });

        expect(diagnostics.map(d => d.code)).not.toContain("edge.pin_multiple");
        expect(diagnostics.map(d => d.code)).not.toContain("node.context_invalid");
    });

    it("allows Element Click element outputs to feed multiple derived nodes", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                click: {
                    id: "click",
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
                    params: { surfaceId: "surface", elementId: "slider", elementType: "nl.slider" },
                },
                getValue: { id: "getValue", type: BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_VALUE },
                getNormalized: { id: "getNormalized", type: BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_NORMALIZED_VALUE },
            },
            edges: [
                { from: { nodeId: "click", port: "element" }, to: { nodeId: "getValue", port: "slider" } },
                { from: { nodeId: "click", port: "element" }, to: { nodeId: "getNormalized", port: "slider" } },
            ],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
            blueprintOwner: { kind: "surfaceMain", surfaceId: "surface" },
        });

        expect(diagnostics.map(d => d.code)).not.toContain("edge.pin_multiple");
        expect(diagnostics.map(d => d.code)).not.toContain("node.context_invalid");
    });
});

describe("blueprint fn validation", () => {
    function fnHeadNode(name: string): { type: string; params: Record<string, unknown> } {
        return {
            type: BLUEPRINT_NODE_TYPE_FN_HEAD,
            params: {
                [BLUEPRINT_NODE_PARAM_FN_NAME]: name,
                [BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_IDS]: ["param_1_value"],
                [BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_LABELS]: { param_1_value: "input" },
                [BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_TYPES]: { param_1_value: "string" },
            },
        };
    }

    function fnReturnNode(valueType = "string"): { type: string; params: Record<string, unknown> } {
        return {
            type: BLUEPRINT_NODE_TYPE_FN_RETURN,
            params: {
                [BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_IDS]: ["ret_1_value"],
                [BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_LABELS]: { ret_1_value: "result" },
                [BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_TYPES]: { ret_1_value: valueType },
            },
        };
    }

    function fnDocument(
        blueprints: Record<string, { owner: BlueprintOwnerRef; ir: BlueprintGraphIr }>,
    ): BlueprintDocument {
        const docBlueprints: BlueprintDocument["blueprints"] = {};
        const ownerRecords: BlueprintDocument["ownerRecords"] = {};
        for (const [id, entry] of Object.entries(blueprints)) {
            docBlueprints[id] = {
                id,
                name: id,
                owner: entry.owner,
                members: { variables: {}, fields: {}, functions: {} },
                bindings: {},
                graphs: { events: { main: { id: "main", graph: entry.ir } }, functions: {} },
            };
            ownerRecords[ownerRefToIndexKey(entry.owner)] = {
                blueprintId: id,
            };
        }
        return {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: docBlueprints,
            ownerRecords,
        };
    }

    it("accepts event graphs containing only fn declarations", () => {
        registerCoreBlueprintNodes();
        const doc = fnDocument({
            "bp-a": {
                owner: { kind: "surfaceMain", surfaceId: "s1" },
                ir: { nodes: { head: { id: "head", ...fnHeadNode("Echo") } }, edges: [] },
            },
        });

        const diagnostics = validateBlueprintDocumentGraphs(doc, "bp-a");
        expect(diagnostics.map(d => d.code)).not.toContain("event.missing_event_nodes");
    });

    it("reports fn.call_target_not_found for calls pasted into another surface", () => {
        registerCoreBlueprintNodes();
        const fnRef = createBlueprintFnRef("bp-a", "head");
        const doc = fnDocument({
            "bp-a": {
                owner: { kind: "widgetMain", surfaceId: "s1", elementId: "button" },
                ir: { nodes: { head: { id: "head", ...fnHeadNode("Echo") } }, edges: [] },
            },
            "bp-b": {
                owner: { kind: "surfaceMain", surfaceId: "s2" },
                ir: {
                    nodes: {
                        init: { id: "init", type: "blueprint.event.head.surfaceInit" },
                        call: { id: "call", type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { fnRef } },
                    },
                    edges: [],
                },
            },
        });

        const diagnostics = validateBlueprintDocumentGraphs(doc, "bp-b");
        const notFound = diagnostics.find(d => d.code === "fn.call_target_not_found");
        expect(notFound?.severity).toBe("error");
        expect(notFound?.target).toMatchObject({ kind: "node", nodeId: "call" });

        // Same fnRef is fine when called from the declaring surface.
        const sameSurface = fnDocument({
            "bp-a": {
                owner: { kind: "widgetMain", surfaceId: "s1", elementId: "button" },
                ir: { nodes: { head: { id: "head", ...fnHeadNode("Echo") } }, edges: [] },
            },
            "bp-c": {
                owner: { kind: "surfaceMain", surfaceId: "s1" },
                ir: {
                    nodes: {
                        init: { id: "init", type: "blueprint.event.head.surfaceInit" },
                        call: { id: "call", type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { fnRef } },
                    },
                    edges: [],
                },
            },
        });
        expect(validateBlueprintDocumentGraphs(sameSurface, "bp-c").map(d => d.code)).not.toContain(
            "fn.call_target_not_found",
        );
    });

    it("reports fn.call_unset for calls without a picked function", () => {
        registerCoreBlueprintNodes();
        const doc = fnDocument({
            "bp-a": {
                owner: { kind: "surfaceMain", surfaceId: "s1" },
                ir: {
                    nodes: {
                        init: { id: "init", type: "blueprint.event.head.surfaceInit" },
                        call: { id: "call", type: BLUEPRINT_NODE_TYPE_FN_CALL },
                    },
                    edges: [],
                },
            },
        });
        expect(validateBlueprintDocumentGraphs(doc, "bp-a").map(d => d.code)).toContain("fn.call_unset");
    });

    it("reports fn.call_signature_stale when the cached snapshot drifts", () => {
        registerCoreBlueprintNodes();
        const fnRef = createBlueprintFnRef("bp-a", "head");
        const doc = fnDocument({
            "bp-a": {
                owner: { kind: "surfaceMain", surfaceId: "s1" },
                ir: {
                    nodes: {
                        head: { id: "head", ...fnHeadNode("Echo") },
                        call: {
                            id: "call",
                            type: BLUEPRINT_NODE_TYPE_FN_CALL,
                            params: {
                                fnRef,
                                [BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT]: {
                                    name: "Echo",
                                    params: [{ pinId: "param_1_value", name: "input", valueType: "integer" }],
                                    returns: [],
                                },
                            },
                        },
                    },
                    edges: [],
                },
            },
        });
        expect(validateBlueprintDocumentGraphs(doc, "bp-a").map(d => d.code)).toContain("fn.call_signature_stale");
    });

    it("reports orphan and multi-owner Fn Return nodes", () => {
        registerCoreBlueprintNodes();
        const orphan = fnDocument({
            "bp-a": {
                owner: { kind: "surfaceMain", surfaceId: "s1" },
                ir: {
                    nodes: {
                        head: { id: "head", ...fnHeadNode("Echo") },
                        ret: { id: "ret", ...fnReturnNode() },
                    },
                    edges: [],
                },
            },
        });
        expect(validateBlueprintDocumentGraphs(orphan, "bp-a").map(d => d.code)).toContain("fn.return_orphan");

        const shared = fnDocument({
            "bp-a": {
                owner: { kind: "surfaceMain", surfaceId: "s1" },
                ir: {
                    nodes: {
                        headA: { id: "headA", ...fnHeadNode("A") },
                        headB: { id: "headB", ...fnHeadNode("B") },
                        ret: { id: "ret", ...fnReturnNode() },
                    },
                    edges: [
                        { from: { nodeId: "headA", port: "then" }, to: { nodeId: "ret", port: "in" } },
                        { from: { nodeId: "headB", port: "then" }, to: { nodeId: "ret", port: "in" } },
                    ],
                },
            },
        });
        expect(validateBlueprintDocumentGraphs(shared, "bp-a").map(d => d.code)).toContain("fn.return_orphan");
    });

    it("reports conflicting Fn Return signatures for one head", () => {
        registerCoreBlueprintNodes();
        const doc = fnDocument({
            "bp-a": {
                owner: { kind: "surfaceMain", surfaceId: "s1" },
                ir: {
                    nodes: {
                        head: { id: "head", ...fnHeadNode("Echo") },
                        branch: { id: "branch", type: "blueprint.flow.sequence" },
                        ret1: { id: "ret1", ...fnReturnNode("string") },
                        ret2: { id: "ret2", ...fnReturnNode("integer") },
                    },
                    edges: [
                        { from: { nodeId: "head", port: "then" }, to: { nodeId: "branch", port: "in" } },
                        { from: { nodeId: "branch", port: "then0" }, to: { nodeId: "ret1", port: "in" } },
                        { from: { nodeId: "branch", port: "then1" }, to: { nodeId: "ret2", port: "in" } },
                    ],
                },
            },
        });
        expect(validateBlueprintDocumentGraphs(doc, "bp-a").map(d => d.code)).toContain(
            "fn.return_signature_conflict",
        );
    });

    it("warns on duplicate fn names in the same scope", () => {
        registerCoreBlueprintNodes();
        const doc = fnDocument({
            "bp-a": {
                owner: { kind: "surfaceMain", surfaceId: "s1" },
                ir: {
                    nodes: {
                        headA: { id: "headA", ...fnHeadNode("Echo") },
                        headB: { id: "headB", ...fnHeadNode("echo") },
                    },
                    edges: [],
                },
            },
        });
        const diagnostics = validateBlueprintDocumentGraphs(doc, "bp-a");
        expect(diagnostics.filter(d => d.code === "fn.duplicate_name").length).toBeGreaterThan(0);
    });

    it("warns on statically recursive fn calls", () => {
        registerCoreBlueprintNodes();
        const fnRef = createBlueprintFnRef("bp-a", "head");
        const doc = fnDocument({
            "bp-a": {
                owner: { kind: "surfaceMain", surfaceId: "s1" },
                ir: {
                    nodes: {
                        head: { id: "head", ...fnHeadNode("Loop") },
                        call: { id: "call", type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { fnRef } },
                    },
                    edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "call", port: "in" } }],
                },
            },
        });
        expect(validateBlueprintDocumentGraphs(doc, "bp-a").map(d => d.code)).toContain("fn.recursive_call");
    });

    it("rejects fn heads in Blueprint Value graphs via node.context_invalid", () => {
        registerCoreBlueprintNodes();
        const doc = fnDocument({
            "bp-a": {
                owner: { kind: "widgetValue", surfaceId: "s1", elementId: "text", propPath: "props.text" },
                ir: { nodes: { head: { id: "head", ...fnHeadNode("Echo") } }, edges: [] },
            },
        });
        const diagnostics = validateBlueprintDocumentGraphs(doc, "bp-a");
        const contextInvalid = diagnostics.find(d => d.code === "node.context_invalid");
        expect(contextInvalid?.target).toMatchObject({ kind: "node", nodeId: "head" });
    });

    it("flags an unknown node type with node.unknown_type, not node.no_runtime", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                mystery: { id: "mystery", type: "com.example.plugin.doThing" },
            },
            edges: [],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
        });

        const unknown = diagnostics.find(d => d.code === "node.unknown_type");
        expect(unknown?.target).toMatchObject({ kind: "node", nodeId: "mystery" });
        expect(unknown?.severity).toBe("warning");
        expect(diagnostics.map(d => d.code)).not.toContain("node.no_runtime");
    });

    it("anchors edge.port_mismatch on the node missing the pin, not its upstream neighbour", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                getter: { id: "getter", type: BLUEPRINT_NODE_TYPE_LOCAL_GET },
                mystery: { id: "mystery", type: "com.example.plugin.doThing" },
            },
            // Feeds a pin the unknown stub does not expose. The value node upstream is healthy; the
            // mismatch belongs to the unknown node downstream.
            edges: [{ from: { nodeId: "getter", port: "value" }, to: { nodeId: "mystery", port: "value" } }],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
        });

        const mismatch = diagnostics.find(d => d.code === "edge.port_mismatch");
        expect(mismatch?.target).toMatchObject({ kind: "node", nodeId: "mystery" });
    });
});

/**
 * The palette decides what an author may drop on the canvas; this validator decides what a saved
 * graph may hold. When the two part company the author gets a node that is an error the moment it
 * lands and cannot be cleared, and `blueprint apply` then refuses to write that blueprint at all -
 * so the command-line tools are locked out of a graph the editor itself made. These tests build a
 * graph out of exactly what the palette offered and expect this validator to accept all of it.
 */
describe("palette and validator agreement", () => {
    function surfaceDocument(): Pick<UIDocument, "elements"> {
        const layout = { x: 0, y: 0, width: 10, height: 10 };
        const element = (id: string, type: string, parentId: string | null, childrenIds: string[]): UIElement => ({
            id,
            type,
            parentId,
            childrenIds,
            layout,
        });
        return {
            elements: {
                root: element("root", "nl.root", null, ["list", "loose"]),
                list: element("list", "nl.list", "root", ["row"]),
                row: element("row", "nl.container", "list", ["label"]),
                label: element("label", "nl.text", "row", []),
                loose: element("loose", "nl.text", "root", []),
            },
        };
    }

    /** Every node type the add-node palette offers for this owner, on this element. */
    function paletteTypes(owner: BlueprintOwnerRef, elementId?: string): string[] {
        registerCoreBlueprintNodes();
        const document = surfaceDocument();
        return BlueprintNodeCatalogService.getInstance()
            .listPaletteEntries(buildBlueprintGraphContext({
                graphKind: "event",
                owner,
                widgetElement: elementId ? document.elements[elementId] : undefined,
                uiDocument: document,
                // No layer wired yet, which is what the head picker asks about: offer every head
                // this widget can carry rather than the ones one open layer is wired to.
                widgetEventLayerSlots: elementId ? [] : undefined,
            }))
            .map(entry => entry.type);
    }

    /** One event graph holding all of `types`, judged the way the editor judges a saved graph. */
    function contextRefusals(
        owner: BlueprintOwnerRef,
        types: readonly string[],
        elementId?: string,
    ): BlueprintGraphEditorDiagnostic[] {
        registerCoreBlueprintNodes();
        const document = surfaceDocument();
        const nodes: NonNullable<BlueprintGraphIr["nodes"]> = {};
        for (const type of types) {
            nodes[type] = { id: type, type };
        }
        const doc: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                bp: {
                    id: "bp",
                    name: "Blueprint",
                    owner,
                    members: { variables: {}, fields: {}, functions: {} },
                    graphs: { events: { layer: { id: "layer", graph: { nodes, edges: [] } } }, functions: {} },
                },
            },
            ownerRecords: {},
        };
        return validateBlueprintDocumentGraphs(doc, "bp", {
            widgetElement: elementId ? document.elements[elementId] : undefined,
            uiDocument: document,
            widgetSurfaceId: "surface",
        }).filter(d => d.code === "node.context_invalid");
    }

    const CASES: Array<{ name: string; owner: BlueprintOwnerRef; elementId?: string }> = [
        {
            name: "a story control-flow condition",
            owner: { kind: "storyAction", blueprintId: "bp", mode: "condition" },
        },
        {
            name: "a story inline value",
            owner: { kind: "storyAction", blueprintId: "bp", mode: "value" },
        },
        {
            name: "a story action",
            owner: { kind: "storyAction", blueprintId: "bp" },
        },
        {
            name: "an element a list draws once per row",
            owner: { kind: "widgetMain", surfaceId: "surface", elementId: "row" },
            elementId: "row",
        },
        {
            name: "the list itself",
            owner: { kind: "widgetMain", surfaceId: "surface", elementId: "list" },
            elementId: "list",
        },
        {
            name: "an element no list draws",
            owner: { kind: "widgetMain", surfaceId: "surface", elementId: "loose" },
            elementId: "loose",
        },
        {
            name: "a widget value binding",
            owner: { kind: "widgetValue", surfaceId: "surface", elementId: "label", propPath: "props.text" },
            elementId: "label",
        },
        {
            name: "a surface",
            owner: { kind: "surfaceMain", surfaceId: "surface" },
        },
    ];

    for (const testCase of CASES) {
        it(`accepts every node the palette offers for ${testCase.name}`, () => {
            const offered = paletteTypes(testCase.owner, testCase.elementId);
            expect(offered.length).toBeGreaterThan(0);
            expect(contextRefusals(testCase.owner, offered, testCase.elementId).map(d => d.message)).toEqual([]);
        });
    }

    it("lets a story condition read a scene variable and return it", () => {
        const owner: BlueprintOwnerRef = { kind: "storyAction", blueprintId: "bp", mode: "condition" };
        const wanted = [
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL,
            BLUEPRINT_NODE_TYPE_SCENE_GET,
            BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
        ];
        expect(paletteTypes(owner)).toEqual(expect.arrayContaining(wanted));
        expect(contextRefusals(owner, wanted)).toEqual([]);
    });

    it("offers the List Item Refresh head where a list draws the element, and accepts it there", () => {
        const owner: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: "surface", elementId: "row" };
        expect(paletteTypes(owner, "row")).toContain(BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH);
        expect(contextRefusals(owner, [BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH], "row")).toEqual([]);
    });

    it("offers list row readers on the list's own blueprint, where its item heads supply the row", () => {
        const owner: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: "surface", elementId: "list" };
        expect(paletteTypes(owner, "list")).toContain(BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD);
        expect(contextRefusals(owner, [BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD], "list")).toEqual([]);
    });

    it("hides and refuses list row readers where nothing draws a row", () => {
        const owner: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: "surface", elementId: "loose" };
        expect(paletteTypes(owner, "loose")).not.toContain(BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_INDEX);
        const refused = contextRefusals(owner, [BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_INDEX], "loose");
        expect(refused).toHaveLength(1);
        expect(refused[0]?.target).toMatchObject({ kind: "node", nodeId: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_INDEX });
    });

    it("does not refuse a list row reader when there was no document to walk", () => {
        // The command-line tools check blueprints without an interface document to hand. A scope
        // nothing established is not a scope that is absent, and refusing on one would lock those
        // tools out of graphs the editor writes happily.
        registerCoreBlueprintNodes();
        const doc: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                bp: {
                    id: "bp",
                    name: "Blueprint",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "loose" },
                    members: { variables: {}, fields: {}, functions: {} },
                    graphs: {
                        events: {
                            layer: {
                                id: "layer",
                                graph: {
                                    nodes: {
                                        read: { id: "read", type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_INDEX },
                                    },
                                    edges: [],
                                },
                            },
                        },
                        functions: {},
                    },
                },
            },
            ownerRecords: {},
        };

        expect(validateBlueprintDocumentGraphs(doc, "bp").map(d => d.code)).not.toContain("node.context_invalid");
    });
});

describe("node.input_missing", () => {
    /** A click head wired into one node, which is the shape every one of these cases shares. */
    function graphWith(
        node: { id: string; type: string; params?: Record<string, unknown> },
        extraEdges: BlueprintGraphIr["edges"] = [],
        extraNodes: BlueprintGraphIr["nodes"] = {},
    ): BlueprintGraphIr {
        return {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                ...extraNodes,
                [node.id]: node,
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: node.id, port: "in" } },
                ...(extraEdges ?? []),
            ],
        };
    }

    function validate(ir: BlueprintGraphIr): BlueprintGraphEditorDiagnostic[] {
        registerCoreBlueprintNodes();
        return validateBlueprintGraphIr(ir, { blueprintId: "bp", graphKind: "event", graphId: "mouseClick" });
    }

    it("warns about a required data input with nothing wired to it", () => {
        const diagnostics = validate(
            graphWith({ id: "setText", type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, params: { text: "Hello" } }),
        );

        const missing = diagnostics.filter(d => d.code === "node.input_missing");
        expect(missing).toHaveLength(1);
        expect(missing[0].severity).toBe("warning");
        // Named by what the card says, never by the node id.
        expect(missing[0].message).toContain("Set Text");
        expect(missing[0].message).toContain("Element");
        expect(missing[0].target).toMatchObject({ kind: "node", nodeId: "setText" });
    });

    it("says nothing once the pin is wired", () => {
        const diagnostics = validate(
            graphWith(
                { id: "setText", type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, params: { text: "Hello" } },
                [{ from: { nodeId: "element", port: "element" }, to: { nodeId: "setText", port: "element" } }],
                { element: { id: "element", type: BLUEPRINT_NODE_TYPE_ELEMENT_REF, params: { elementId: "label" } } },
            ),
        );

        expect(diagnostics.map(d => d.code)).not.toContain("node.input_missing");
    });

    it("says nothing about a pin the card carries a value for", () => {
        // `Log`'s Value is an inline literal, and an author who cleared it chose the empty string.
        const withValue = validate(graphWith({ id: "log", type: BLUEPRINT_NODE_TYPE_LOG, params: { value: "" } }));
        expect(withValue.map(d => d.code)).not.toContain("node.input_missing");

        const withoutValue = validate(graphWith({ id: "log", type: BLUEPRINT_NODE_TYPE_LOG }));
        expect(withoutValue.map(d => d.code)).toContain("node.input_missing");
    });

    it("says nothing about a pin the definition marks optional", () => {
        // Play Sound takes its asset, volume, loop and fade from the inspector when unwired, and
        // says so on the pins - which is the only place a node may say it.
        const diagnostics = validate(graphWith({ id: "play", type: BLUEPRINT_NODE_TYPE_SOUND_PLAY }));

        expect(diagnostics.map(d => d.code)).not.toContain("node.input_missing");
    });

    it("leaves an unfinished draft alone", () => {
        // Nothing reaches it, so `blueprint/unreachable-node` is the one report it gets.
        const ir: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                setText: { id: "setText", type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT },
            },
            edges: [],
        };

        expect(validate(ir).map(d => d.code)).not.toContain("node.input_missing");
    });

    it("leaves Return Value to the condition check", () => {
        // One node with two explanations is worse than one; `condition.return_missing` owns this pin.
        const ir: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL },
                ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE },
            },
            edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "ret", port: "in" } }],
        };
        registerCoreBlueprintNodes();
        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "onCall",
            blueprintOwner: { kind: "storyAction", blueprintId: "bp", mode: "condition" },
        });

        expect(diagnostics.map(d => d.code)).toContain("condition.return_missing");
        expect(diagnostics.map(d => d.code)).not.toContain("node.input_missing");
    });
});
