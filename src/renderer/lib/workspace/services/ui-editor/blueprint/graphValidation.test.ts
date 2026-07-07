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
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_STRING_FORMAT,
    BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
} from "@shared/types/blueprint/graph";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { createBlueprintFnRef } from "./fnCatalog";
import { ownerRefToIndexKey } from "./ownerKeys";
import { validateBlueprintDocumentGraphs, validateBlueprintGraphIr } from "./graphValidation";

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

    it("validates Get Var references against Var declaration nodes", () => {
        registerCoreBlueprintNodes();
        const doc: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
            blueprints: {
                widget: {
                    id: "widget",
                    name: "Widget",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
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
            },
            ownerRecords: {},
        };

        expect(validateBlueprintDocumentGraphs(doc, "widget").map(d => d.code)).not.toContain("node.variable_id_invalid");
        const widget = doc.blueprints.widget!;
        if (widget.program.kind === "graph") {
            delete widget.program.graphs.events.init!.graph!.nodes!.declare;
        }
        expect(validateBlueprintDocumentGraphs(doc, "widget").map(d => d.code)).toContain("node.variable_id_invalid");
    });

    it("reports inferred Var type mismatches without removing existing edges", () => {
        registerCoreBlueprintNodes();
        const doc: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
            blueprints: {
                widget: {
                    id: "widget",
                    name: "Widget",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
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
            },
            ownerRecords: {},
        };

        const diagnostics = validateBlueprintDocumentGraphs(doc, "widget");
        expect(diagnostics.map(d => d.code)).toContain("edge.connection_invalid");
        expect(diagnostics.find(d => d.code === "edge.connection_invalid")?.message).toContain(
            "Type mismatch: integer -> json",
        );
        const graph = doc.blueprints.widget?.program.kind === "graph"
            ? doc.blueprints.widget.program.graphs.events.init?.graph
            : undefined;
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
            isBlueprintValueGraph: false,
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
            isBlueprintValueGraph: true,
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
                frontend: "visual",
                programKind: "graph",
                members: { variables: {}, fields: {}, functions: {} },
                bindings: {},
                program: {
                    kind: "graph",
                    graphs: { events: { main: { id: "main", graph: entry.ir } }, functions: {} },
                },
            };
            ownerRecords[ownerRefToIndexKey(entry.owner)] = {
                activeBlueprintId: id,
                privateBlueprintIds: [id],
            };
        }
        return {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
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
});
