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
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { behaviorNodeRegistry } from "./BehaviorNodeRegistry";
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

    /**
     * The mirror of the two tests above, on the output side. A plugin node publishes data outputs
     * exactly as a built-in does - `outputValues` from `execute()` - but the read side is a
     * whitelist of built-in node types that a plugin cannot add itself to, so every downstream read
     * of a plugin node's output pin used to resolve to `undefined`. Silently, which is the same way
     * the built-in half of this failed before it was found.
     */
    it("lets a downstream node read a data output pin a plugin node published", () => {
        registerCoreBlueprintNodes();
        let captured: unknown = "not-run";
        defineBlueprintNode({
            type: "test.plugin.publishesOutput",
            displayName: "Publishes Output",
            category: "Test",
            graphKinds: ["event", "function", "macro"],
            isPure: false,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
                { id: "rows", kind: "output", semantic: "data", valueType: "array", label: "Rows" },
            ],
            execute: () => ({ nextPort: "next", outputValues: { rows: ["a", "b"] } }),
        });
        defineBlueprintNode({
            type: "test.plugin.consumesArray",
            displayName: "Consumes Array",
            category: "Test",
            graphKinds: ["event", "function", "macro"],
            isPure: false,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "items", kind: "input", semantic: "data", valueType: "array", label: "Items" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            execute: ctx => {
                captured = ctx.resolveInput?.("items");
                return { nextPort: "next" };
            },
        });

        const g = graph(
            {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
                producer: { id: "producer", type: "test.plugin.publishesOutput", params: {} },
                consumer: { id: "consumer", type: "test.plugin.consumesArray", params: {} },
            },
            [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "producer", port: "in" } },
                { from: { nodeId: "producer", port: "next" }, to: { nodeId: "consumer", port: "in" } },
                { from: { nodeId: "producer", port: "rows" }, to: { nodeId: "consumer", port: "items" } },
            ],
        );

        executeGraphSync({
            graph: g,
            entry: { start: { nodeId: "head", port: "then" } },
            hostAdapter,
        });

        expect(captured).toEqual(["a", "b"]);
    });

    /**
     * The shipped-game shape of the same wiring. A runtime plugin entry registers only
     * `type` / `displayName` / `execute`, so its nodes have no pin catalogue at all there and
     * nothing can recognise `rows` as an output port - the value has to come from what the node
     * published under its own id.
     */
    it("reads a published output pin of a node that has no registered pin catalogue", () => {
        registerCoreBlueprintNodes();
        let captured: unknown = "not-run";
        behaviorNodeRegistry.register({
            type: "test.runtimePlugin.publishesOutput",
            displayName: "Publishes Output",
            execute: () => ({ nextPort: "next", outputValues: { rows: ["x"] } }),
        }, { quietOverwrite: true });
        behaviorNodeRegistry.register({
            type: "test.runtimePlugin.consumesArray",
            displayName: "Consumes Array",
            execute: ctx => {
                captured = ctx.resolveInput?.("items");
                return { nextPort: "next" };
            },
        }, { quietOverwrite: true });

        const g = graph(
            {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
                producer: { id: "producer", type: "test.runtimePlugin.publishesOutput", params: {} },
                consumer: { id: "consumer", type: "test.runtimePlugin.consumesArray", params: {} },
            },
            [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "producer", port: "in" } },
                { from: { nodeId: "producer", port: "next" }, to: { nodeId: "consumer", port: "in" } },
                { from: { nodeId: "producer", port: "rows" }, to: { nodeId: "consumer", port: "items" } },
            ],
        );

        executeGraphSync({
            graph: g,
            entry: { start: { nodeId: "head", port: "then" } },
            hostAdapter,
        });

        expect(captured).toEqual(["x"]);
    });
});
