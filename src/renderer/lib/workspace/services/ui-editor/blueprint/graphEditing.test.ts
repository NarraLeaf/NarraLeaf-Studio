import { describe, expect, it } from "vitest";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_FLOW_COMMENT,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
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
                first: { id: "first", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
                second: { id: "second", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
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
                source: { id: "source", type: BLUEPRINT_NODE_TYPE_LOCAL_GET },
                first: { id: "first", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
                second: { id: "second", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
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
            { from: { nodeId: "source", port: "value" }, to: { nodeId: "second", port: "value" } },
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

    it("allows fn head param pins to connect to multiple targets", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_FN_HEAD },
                first: { id: "first", type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING },
                second: { id: "second", type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING },
            },
            edges: [{ from: { nodeId: "head", port: "param_1_value" }, to: { nodeId: "first", port: "value" } }],
        };

        const edges = applyBlueprintIrConnection(ir, {
            source: "head",
            sourceHandle: "param_1_value",
            target: "second",
            targetHandle: "value",
        });

        expect(edges).toEqual([
            { from: { nodeId: "head", port: "param_1_value" }, to: { nodeId: "first", port: "value" } },
            { from: { nodeId: "head", port: "param_1_value" }, to: { nodeId: "second", port: "value" } },
        ]);
    });

    it("replaces an existing outgoing body exec edge from a fn head", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_FN_HEAD },
                first: { id: "first", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
                second: { id: "second", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
            },
            edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "first", port: "in" } }],
        };

        const edges = applyBlueprintIrConnection(ir, {
            source: "head",
            sourceHandle: "then",
            target: "second",
            targetHandle: "in",
        });

        expect(edges).toEqual([
            { from: { nodeId: "head", port: "then" }, to: { nodeId: "second", port: "in" } },
        ]);
    });

    it("replaces an existing incoming edge to the same target port", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                firstSource: { id: "firstSource", type: BLUEPRINT_NODE_TYPE_LOCAL_GET },
                secondSource: { id: "secondSource", type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING },
                target: { id: "target", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
            },
            edges: [{ from: { nodeId: "firstSource", port: "value" }, to: { nodeId: "target", port: "value" } }],
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
                target: { id: "target", type: BLUEPRINT_NODE_TYPE_LOCAL_SET },
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

    it("validates Get Var connections from inferred variable types without mutating params", () => {
        registerCoreBlueprintNodes();
        const ir: BlueprintGraphIr = {
            nodes: {
                getScore: {
                    id: "getScore",
                    type: BLUEPRINT_NODE_TYPE_LOCAL_GET,
                    params: { variableId: "score" },
                },
                format: { id: "format", type: BLUEPRINT_NODE_TYPE_STRING_FORMAT },
            },
            edges: [],
        };

        expect(
            isValidBlueprintIrExecConnection(
                ir,
                {
                    source: "getScore",
                    sourceHandle: "value",
                    target: "format",
                    targetHandle: "values",
                },
                { memberVariables: [{ value: "score", valueType: "float" }] },
            ),
        ).toBe(false);
        expect(
            isValidBlueprintIrExecConnection(
                ir,
                {
                    source: "getScore",
                    sourceHandle: "value",
                    target: "format",
                    targetHandle: "values",
                },
                { memberVariables: [{ value: "score", valueType: "json" }] },
            ),
        ).toBe(true);
        expect(ir.nodes?.getScore?.params).toEqual({ variableId: "score" });
    });

    it("creates Make JSON Object with one editable field pair", () => {
        const node = createGraphNodeForPalette(BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT, "jsonObject");

        expect(node.params).toMatchObject({
            __jsonObjectInputPins: ["field_1_name", "field_1_value"],
            __inlineLiteralPins: ["field_1_name"],
            field_1_name: "field1",
        });
    });

    it("creates Var declarations with stable variable defaults", () => {
        const node = createGraphNodeForPalette(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR, "varNode");

        expect(node.params).toMatchObject({
            variableId: "varNode",
            name: "var_varNode",
            valueType: "string",
            defaultValue: "",
        });
    });

    it("creates Comment with editable note-box defaults", () => {
        const node = createGraphNodeForPalette(BLUEPRINT_NODE_TYPE_FLOW_COMMENT, "comment");

        expect(node.params).toMatchObject({
            text: "Comment",
            color: "amber",
            background: true,
            width: 360,
            height: 180,
        });
    });

    it("creates Displayable Animate Property with editable motion defaults", () => {
        expect(createGraphNodeForPalette(BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY, "animate").params).toEqual({
            property: "opacity",
            from: 0,
            to: 100,
            duration: 0.3,
            delay: 0,
            easing: "easeOut",
            after: "hold",
        });
        expect(createGraphNodeForPalette(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY, "animateElement").params)
            .toMatchObject({
                property: "opacity",
                duration: 0.3,
                easing: "easeOut",
            });
    });

    it("creates Displayable Get/Set Property with compact editor defaults", () => {
        expect(createGraphNodeForPalette(BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY, "getProperty").params).toEqual({
            property: "position",
        });
        expect(createGraphNodeForPalette(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY, "getElementProperty").params)
            .toEqual({
                property: "position",
        });
        expect(createGraphNodeForPalette(BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY, "setProperty").params).toEqual({
            property: "opacity",
            value: 100,
        });
        expect(createGraphNodeForPalette(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY, "setElementProperty").params)
            .toEqual({
                property: "opacity",
                value: 100,
            });
        expect(createGraphNodeForPalette(BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT, "setVariant").params).toEqual({
            waitForTransition: "continue",
        });
        expect(createGraphNodeForPalette(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT, "setElementVariant").params)
            .toEqual({
                waitForTransition: "continue",
            });
    });
});
