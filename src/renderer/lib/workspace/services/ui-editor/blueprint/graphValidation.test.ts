import { describe, expect, it } from "vitest";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_STRING_FORMAT,
    BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
} from "@shared/types/blueprint/graph";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { validateBlueprintGraphIr } from "./graphValidation";

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
});
