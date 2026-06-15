import { describe, expect, it } from "vitest";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import { applyBlueprintIrConnection, isValidBlueprintIrExecConnection } from "./graphEditing";

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
});
