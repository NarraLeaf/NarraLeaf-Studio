import { describe, expect, it } from "vitest";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import {
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
} from "@shared/types/blueprint/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { defineBlueprintNode } from "@/lib/ui-editor/blueprint-nodes/defineBlueprintNode";
import { AsyncNodeInSyncGraphError, executeGraphSync } from "./executeGraphSync";

const hostAdapter = { host: "player" } as unknown as UIHostAdapter;

function graph(nodes: UIGraph["nodes"], edges: UIGraph["edges"]): UIGraph {
    return { id: "g", entries: {}, nodes, edges };
}

describe("executeGraphSync", () => {
    it("evaluates a synchronous On Call graph and captures the Return Value", () => {
        const g = graph(
            {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
                lit: { id: "lit", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "Hello" } },
                ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
            },
            [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "ret", port: "in" } },
                { from: { nodeId: "lit", port: "value" }, to: { nodeId: "ret", port: "value" } },
            ],
        );

        const result = executeGraphSync({
            graph: g,
            entry: { start: { nodeId: "head", port: "then" } },
            hostAdapter,
        });

        expect(result.returnValueSet).toBe(true);
        expect(result.returnValue).toBe("Hello");
    });

    it("throws AsyncNodeInSyncGraphError when it reaches an async (latent) node", () => {
        const g = graph(
            {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
                delay: { id: "delay", type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { durationMs: 10 } },
            },
            [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "delay", port: "in" } }],
        );

        expect(() =>
            executeGraphSync({
                graph: g,
                entry: { start: { nodeId: "head", port: "then" } },
                hostAdapter,
            }),
        ).toThrow(AsyncNodeInSyncGraphError);
    });

    /**
     * Plugin-provided nodes cannot import the core data pin resolver, so without
     * ctx.resolveInput any input pin they declare is dead: they could emit
     * output values but never read a wired input.
     */
    it("resolves a declared data input pin through ctx.resolveInput", () => {
        let captured: unknown = "not-run";
        defineBlueprintNode({
            type: "test.plugin.readsInput",
            displayName: "Reads Input",
            category: "Test",
            graphKinds: ["event", "function", "macro"],
            isPure: false,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "amount", kind: "input", semantic: "data", valueType: "string", label: "Amount" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            execute: ctx => {
                captured = ctx.resolveInput?.("amount");
                return { nextPort: "next" };
            },
        });

        const g = graph(
            {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
                lit: { id: "lit", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "wired" } },
                reader: { id: "reader", type: "test.plugin.readsInput", params: {} },
            },
            [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "reader", port: "in" } },
                { from: { nodeId: "lit", port: "value" }, to: { nodeId: "reader", port: "amount" } },
            ],
        );

        executeGraphSync({
            graph: g,
            entry: { start: { nodeId: "head", port: "then" } },
            hostAdapter,
        });

        expect(captured).toBe("wired");
    });

    it("resolves an unwired data input pin to undefined", () => {
        let captured: unknown = "not-run";
        defineBlueprintNode({
            type: "test.plugin.readsUnwiredInput",
            displayName: "Reads Unwired Input",
            category: "Test",
            graphKinds: ["event", "function", "macro"],
            isPure: false,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "amount", kind: "input", semantic: "data", valueType: "string", label: "Amount" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            execute: ctx => {
                captured = ctx.resolveInput?.("amount");
                return { nextPort: "next" };
            },
        });

        const g = graph(
            {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
                reader: { id: "reader", type: "test.plugin.readsUnwiredInput", params: {} },
            },
            [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "reader", port: "in" } }],
        );

        executeGraphSync({
            graph: g,
            entry: { start: { nodeId: "head", port: "then" } },
            hostAdapter,
        });

        expect(captured).toBeUndefined();
    });
});
