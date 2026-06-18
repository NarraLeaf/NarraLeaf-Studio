import { describe, expect, it } from "vitest";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_STRING_FORMAT,
    BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
} from "@shared/types/blueprint/graph";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { applyBlueprintIrConnection, createGraphNodeForPalette, isValidBlueprintIrExecConnection } from "./graphEditing";

describe("blueprint graph editing", () => {
    it("replaces an existing outgoing exec edge from the same source port", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                source: { id: "source", type: "delay" },
                first: { id: "first", type: "blueprint.state.set" },
                second: { id: "second", type: "blueprint.state.set" },
            },
            edges: [{ from: { nodeId: "source", port: "next" }, to: { nodeId: "first", port: "in" } }],
        };

        const edges = applyBlueprintIrConnection(ir, {
            source: "source",
            sourceHandle: "next",
            target: "second",
            targetHandle: "in",
        });

        expect(edges).toEqual([
            { from: { nodeId: "source", port: "next" }, to: { nodeId: "second", port: "in" } },
        ]);
    });

    it("replaces an existing outgoing data edge from the same source port", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                source: { id: "source", type: "blueprint.state.get" },
                first: { id: "first", type: "blueprint.state.set" },
                second: { id: "second", type: "blueprint.state.set" },
            },
            edges: [{ from: { nodeId: "source", port: "result" }, to: { nodeId: "first", port: "value" } }],
        };

        const edges = applyBlueprintIrConnection(ir, {
            source: "source",
            sourceHandle: "result",
            target: "second",
            targetHandle: "value",
        });

        expect(edges).toEqual([
            { from: { nodeId: "source", port: "result" }, to: { nodeId: "second", port: "value" } },
        ]);
    });

    it("allows literal output pins to connect to multiple targets", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                source: { id: "source", type: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER },
                first: { id: "first", type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING },
                second: { id: "second", type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING },
            },
            edges: [{ from: { nodeId: "source", port: "value" }, to: { nodeId: "first", port: "value" } }],
        };

        const edges = applyBlueprintIrConnection(ir, {
            source: "source",
            sourceHandle: "value",
            target: "second",
            targetHandle: "value",
        });

        expect(edges).toEqual([
            { from: { nodeId: "source", port: "value" }, to: { nodeId: "first", port: "value" } },
            { from: { nodeId: "source", port: "value" }, to: { nodeId: "second", port: "value" } },
        ]);
    });

    it("replaces an existing incoming edge to the same target port", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                firstSource: { id: "firstSource", type: "blueprint.state.get" },
                secondSource: { id: "secondSource", type: "blueprint.persistence.get" },
                target: { id: "target", type: "blueprint.state.set" },
            },
            edges: [{ from: { nodeId: "firstSource", port: "result" }, to: { nodeId: "target", port: "value" } }],
        };

        const edges = applyBlueprintIrConnection(ir, {
            source: "secondSource",
            sourceHandle: "result",
            target: "target",
            targetHandle: "value",
        });

        expect(edges).toEqual([
            { from: { nodeId: "secondSource", port: "result" }, to: { nodeId: "target", port: "value" } },
        ]);
    });

    it("allows multiple exec outputs to connect to one exec input", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                branch: { id: "branch", type: "if" },
                target: { id: "target", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
            },
            edges: [{ from: { nodeId: "branch", port: "true" }, to: { nodeId: "target", port: "in" } }],
        };

        const edges = applyBlueprintIrConnection(ir, {
            source: "branch",
            sourceHandle: "false",
            target: "target",
            targetHandle: "in",
        });

        expect(edges).toEqual([
            { from: { nodeId: "branch", port: "true" }, to: { nodeId: "target", port: "in" } },
            { from: { nodeId: "branch", port: "false" }, to: { nodeId: "target", port: "in" } },
        ]);
    });

    it("does not duplicate an existing edge", () => {
        const edge = { from: { nodeId: "source", port: "next" }, to: { nodeId: "target", port: "in" } };
        const ir: BlueprintGraphIr = {
            nodes: {
                source: { id: "source", type: "delay" },
                target: { id: "target", type: "blueprint.state.set" },
            },
            edges: [edge],
        };

        const edges = applyBlueprintIrConnection(ir, {
            source: "source",
            sourceHandle: "next",
            target: "target",
            targetHandle: "in",
        });

        expect(edges).toEqual([edge]);
    });

    it("rejects direct self-connections", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                node: { id: "node", type: "delay" },
            },
            edges: [],
        };

        expect(
            isValidBlueprintIrExecConnection(ir, {
                source: "node",
                sourceHandle: "next",
                target: "node",
                targetHandle: "in",
            }),
        ).toBe(false);
        expect(
            applyBlueprintIrConnection(ir, {
                source: "node",
                sourceHandle: "next",
                target: "node",
                targetHandle: "in",
            }),
        ).toEqual([]);
    });

    it("rejects float output to json input unless explicitly converted", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                floatValue: { id: "floatValue", type: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER },
                jsonValue: { id: "jsonValue", type: BLUEPRINT_NODE_TYPE_DATA_TO_JSON },
                format: { id: "format", type: BLUEPRINT_NODE_TYPE_STRING_FORMAT },
                stringify: { id: "stringify", type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING },
            },
            edges: [],
        };

        expect(
            isValidBlueprintIrExecConnection(ir, {
                source: "floatValue",
                sourceHandle: "value",
                target: "format",
                targetHandle: "values",
            }),
        ).toBe(false);
        expect(
            isValidBlueprintIrExecConnection(ir, {
                source: "jsonValue",
                sourceHandle: "result",
                target: "format",
                targetHandle: "values",
            }),
        ).toBe(true);
        expect(
            isValidBlueprintIrExecConnection(ir, {
                source: "floatValue",
                sourceHandle: "value",
                target: "stringify",
                targetHandle: "value",
            }),
        ).toBe(true);
    });

    it("creates Make JSON Object with one editable field pair", () => {
        const node = createGraphNodeForPalette(BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT, "jsonObject");

        expect(node.params).toMatchObject({
            __jsonObjectInputPins: ["field_1_name", "field_1_value"],
            __inlineLiteralPins: ["field_1_name"],
            field_1_name: "field1",
        });
    });
});
