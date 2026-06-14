import { describe, expect, it } from "vitest";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import { validateBlueprintGraphIr } from "./graphValidation";

describe("blueprint graph validation", () => {
    it("reports multiple outgoing edges from one output pin", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                source: { id: "source", type: "blueprint.state.get" },
                first: { id: "first", type: "blueprint.state.set" },
                second: { id: "second", type: "blueprint.state.set" },
            },
            edges: [
                { from: { nodeId: "source", port: "result" }, to: { nodeId: "first", port: "value" } },
                { from: { nodeId: "source", port: "result" }, to: { nodeId: "second", port: "value" } },
            ],
        };

        const diagnostics = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "event",
        });

        expect(diagnostics.map(d => d.code)).toContain("edge.pin_multiple");
    });

    it("reports multiple incoming edges to one input pin", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                firstSource: { id: "firstSource", type: "blueprint.state.get" },
                secondSource: { id: "secondSource", type: "blueprint.persistence.get" },
                target: { id: "target", type: "blueprint.state.set" },
            },
            edges: [
                { from: { nodeId: "firstSource", port: "result" }, to: { nodeId: "target", port: "value" } },
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
                source: { id: "source", type: "delay" },
                target: { id: "target", type: "blueprint.state.set" },
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
});
