import { describe, expect, it } from "vitest";
import { buildBlueprintRunGraphId } from "@shared/blueprint/blueprintRunGraphId";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP,
    BLUEPRINT_NODE_TYPE_FLOW_SEQUENCE,
    BLUEPRINT_NODE_TYPE_FLOW_WHILE,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
    BLUEPRINT_NODE_TYPE_MATH_INCREMENT,
    BLUEPRINT_NODE_TYPE_STRING_TO_UPPER,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import { startTogether } from "../blueprint-runtime/startTogether";
import { BlueprintDebugSession } from "../blueprint-runtime/BlueprintDebugSession";
import { controlFlowBlueprintNodes } from "../blueprint-nodes/built-in/controlFlowNodes";
import { allBuiltinBlueprintNodes } from "../blueprint-nodes/built-in";
import { resolveDataPinValue } from "../blueprint-nodes/built-in/graphParamResolvers";
import { writeBlueprintNodeOutputValues } from "../blueprint-nodes/nodeOutputValues";
import { registerCoreBlueprintNodes } from "../blueprint-nodes/registerCoreBlueprintNodes";
import type { UIHostAdapter } from "../runtime/types";
import { behaviorNodeRegistry } from "./BehaviorNodeRegistry";
import { executeGraph } from "./GraphExecutor";
import { executeGraphSync } from "./executeGraphSync";
import { setBlueprintDebugController, type BlueprintExecutionDebugController } from "./debugControl";
import { createGraphExecutionFrame, readGraphNodeOutputs } from "./graphExecutionFrame";

const CAPTURE = "test.concurrentLoops.capture";
const hostAdapter = { host: "player" } as UIHostAdapter;

function loopGraph(type: string, params: Record<string, unknown>, backEdge = true): UIGraph {
    return {
        id: "concurrent-loops",
        entries: {},
        nodes: {
            h1: { id: "h1", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY, params: {} },
            h2: { id: "h2", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY, params: {} },
            loop: { id: "loop", type, params },
            capture: { id: "capture", type: CAPTURE, params: {} },
            condition: { id: "condition", type: BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN, params: { value: true } },
            increment: { id: "increment", type: BLUEPRINT_NODE_TYPE_MATH_INCREMENT, params: {} },
            uppercase: { id: "uppercase", type: BLUEPRINT_NODE_TYPE_STRING_TO_UPPER, params: {} },
        },
        edges: [
            { from: { nodeId: "h1", port: "then" }, to: { nodeId: "loop", port: "in" } },
            { from: { nodeId: "h2", port: "then" }, to: { nodeId: "loop", port: "in" } },
            { from: { nodeId: "loop", port: "loop" }, to: { nodeId: "capture", port: "in" } },
            { from: { nodeId: "loop", port: "index" }, to: { nodeId: "capture", port: "index" } },
            { from: { nodeId: "loop", port: "item" }, to: { nodeId: "capture", port: "item" } },
            { from: { nodeId: "loop", port: "index" }, to: { nodeId: "increment", port: "value" } },
            { from: { nodeId: "increment", port: "result" }, to: { nodeId: "capture", port: "indirect" } },
            { from: { nodeId: "loop", port: "item" }, to: { nodeId: "uppercase", port: "value" } },
            { from: { nodeId: "uppercase", port: "result" }, to: { nodeId: "capture", port: "indirectItem" } },
            ...(type === BLUEPRINT_NODE_TYPE_FLOW_WHILE
                ? [{ from: { nodeId: "condition", port: "value" }, to: { nodeId: "loop", port: "condition" } }]
                : []),
            ...(backEdge ? [{ from: { nodeId: "capture", port: "next" }, to: { nodeId: "loop", port: "in" } }] : []),
        ],
    } as UIGraph;
}

function nestedLoopGraph(): UIGraph {
    return {
        id: "nested-loops",
        entries: {},
        nodes: {
            h1: { id: "h1", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY, params: {} },
            h2: { id: "h2", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY, params: {} },
            sequence: { id: "sequence", type: BLUEPRINT_NODE_TYPE_FLOW_SEQUENCE, params: {} },
            outer: { id: "outer", type: BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP, params: { start: 0, end: 1, step: 1 } },
            inner: { id: "inner", type: BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH, params: { items: ["a", "b"] } },
            capture: { id: "capture", type: CAPTURE, params: {} },
        },
        edges: [
            { from: { nodeId: "h1", port: "then" }, to: { nodeId: "sequence", port: "in" } },
            { from: { nodeId: "h2", port: "then" }, to: { nodeId: "sequence", port: "in" } },
            { from: { nodeId: "sequence", port: "then0" }, to: { nodeId: "outer", port: "in" } },
            { from: { nodeId: "sequence", port: "then1" }, to: { nodeId: "outer", port: "in" } },
            { from: { nodeId: "outer", port: "loop" }, to: { nodeId: "inner", port: "in" } },
            { from: { nodeId: "inner", port: "loop" }, to: { nodeId: "capture", port: "in" } },
            { from: { nodeId: "capture", port: "next" }, to: { nodeId: "inner", port: "in" } },
            { from: { nodeId: "inner", port: "completed" }, to: { nodeId: "outer", port: "in" } },
            { from: { nodeId: "outer", port: "index" }, to: { nodeId: "capture", port: "outerIndex" } },
            { from: { nodeId: "inner", port: "index" }, to: { nodeId: "capture", port: "innerIndex" } },
            { from: { nodeId: "inner", port: "item" }, to: { nodeId: "capture", port: "item" } },
        ],
    } as UIGraph;
}

describe("concurrent graph heads", () => {
    it("covers the built-in loop nodes and their data outputs", () => {
        const loops = allBuiltinBlueprintNodes.filter(node =>
            node.pins.some(pin => pin.id === "loop" && pin.kind === "output" && pin.semantic === "exec"),
        );
        expect(loops.map(node => node.type).sort()).toEqual([
            BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
            BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP,
            BLUEPRINT_NODE_TYPE_FLOW_WHILE,
        ].sort());
        const outputsOf = (type: string) => loops.find(node => node.type === type)!.pins
            .filter(pin => pin.kind === "output" && pin.semantic === "data")
            .map(pin => pin.id).sort();
        expect(outputsOf(BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP)).toEqual(["index"]);
        expect(outputsOf(BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH)).toEqual(["index", "item"]);
        expect(outputsOf(BLUEPRINT_NODE_TYPE_FLOW_WHILE)).toEqual([]);
    });

    it.each([
        {
            name: "For Loop",
            type: BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP,
            params: { start: 0, end: 2, step: 1, maxIterations: 10 },
            expected: [0, 1, 2],
            pin: "index",
        },
        {
            name: "For Each",
            type: BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
            params: { items: ["a", "b", "c"], maxIterations: 10 },
            expected: ["a", "b", "c"],
            pin: "item",
        },
        {
            name: "While",
            type: BLUEPRINT_NODE_TYPE_FLOW_WHILE,
            params: { condition: true, maxIterations: 3 },
            expected: ["tick", "tick", "tick"],
            pin: null,
        },
    ])("keeps $name progress per head while sharing author locals", async ({ type, params, expected, pin }) => {
        const graph = loopGraph(type, params);
        const locals: Record<string, unknown> = { count: 0 };
        const seen: Record<string, unknown[]> = { h1: [], h2: [] };
        const indices: Record<string, unknown[]> = { h1: [], h2: [] };
        const indirect: Record<string, unknown[]> = { h1: [], h2: [] };
        const indirectItems: Record<string, unknown[]> = { h1: [], h2: [] };
        const observedCounts: number[] = [];
        behaviorNodeRegistry.register({
            type: CAPTURE,
            displayName: "Capture",
            execute: ctx => {
                expect(ctx.blueprintLocals).toBe(locals);
                locals.count = Number(locals.count) + 1;
                observedCounts.push(Number(locals.count));
                seen[ctx.entry.start.nodeId]!.push(pin ? ctx.resolveInput?.(pin) : "tick");
                if (pin) {
                    indices[ctx.entry.start.nodeId]!.push(ctx.resolveInput?.("index"));
                    indirect[ctx.entry.start.nodeId]!.push(ctx.resolveInput?.("indirect"));
                    if (type === BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH) {
                        indirectItems[ctx.entry.start.nodeId]!.push(ctx.resolveInput?.("indirectItem"));
                    }
                }
                return { nextPort: "next" };
            },
        }, { quietOverwrite: true });

        const outcomes = await startTogether(["h1", "h2"].map(nodeId => () => executeGraph({
            graph,
            entry: { start: { nodeId, port: "then" } },
            hostAdapter,
            blueprintLocals: locals,
            maxSteps: 40,
        })));

        expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
        expect(seen).toEqual({ h1: expected, h2: expected });
        if (pin) {
            expect(indices).toEqual({ h1: [0, 1, 2], h2: [0, 1, 2] });
            expect(indirect).toEqual({ h1: [1, 2, 3], h2: [1, 2, 3] });
        }
        if (type === BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH) {
            expect(indirectItems).toEqual({ h1: ["A", "B", "C"], h2: ["A", "B", "C"] });
        }
        expect(observedCounts).toEqual([1, 2, 3, 4, 5, 6]);
        expect(locals.count).toBe(6);
    });

    it("starts a fresh synchronous loop when an earlier execution left its body", () => {
        const graph = loopGraph(BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP, { start: 0, end: 2, step: 1 }, false);
        const locals: Record<string, unknown> = { count: 0 };
        const seen: unknown[] = [];
        const indirect: unknown[] = [];
        behaviorNodeRegistry.register({
            type: CAPTURE,
            displayName: "Capture",
            execute: ctx => {
                seen.push(ctx.resolveInput?.("index"));
                indirect.push(ctx.resolveInput?.("indirect"));
                locals.count = Number(locals.count) + 1;
                return { nextPort: "next" };
            },
        }, { quietOverwrite: true });

        const options = { graph, entry: { start: { nodeId: "h1", port: "then" as const } }, hostAdapter, blueprintLocals: locals };
        executeGraphSync(options);
        executeGraphSync(options);
        expect(seen).toEqual([0, 0]);
        expect(indirect).toEqual([1, 1]);
        expect(locals.count).toBe(2);
    });

    it.each([
        { type: BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP, params: { start: 0, end: 2 }, values: [0, 1] },
        { type: BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH, params: { items: ["a", "b"] }, values: ["a", "b"] },
        { type: BLUEPRINT_NODE_TYPE_FLOW_WHILE, params: { maxIterations: 2 }, values: ["loop", "loop"] },
    ])("keeps direct node calls without an execution frame for $type", ({ type, params, values }) => {
        registerCoreBlueprintNodes();
        const graph = loopGraph(type, params);
        const locals: Record<string, unknown> = {};
        const definition = controlFlowBlueprintNodes.find(node => node.type === type)!;
        const context = {
            graph,
            entry: { start: { nodeId: "loop", port: "in" as const } },
            node: graph.nodes.loop!,
            params: graph.nodes.loop!.params ?? {},
            hostAdapter,
            blueprintLocals: locals,
        };
        const first = definition.execute(context);
        const second = definition.execute(context);
        if (type === BLUEPRINT_NODE_TYPE_FLOW_WHILE) {
            expect([first, second]).toEqual(values.map(nextPort => ({ nextPort })));
            expect(definition.execute(context)).toEqual({ nextPort: "completed" });
        } else {
            const pin = type === BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH ? "item" : "index";
            expect(first).toMatchObject({ outputValues: { [pin]: values[0] } });
            expect(second).toMatchObject({ outputValues: { [pin]: values[1] } });
            writeBlueprintNodeOutputValues(locals, "loop", { index: 7, item: "saved" });
            expect(resolveDataPinValue(graph, "capture", "index", {}, locals)).toBe(7);
            expect(resolveDataPinValue(graph, "capture", "indirect", {}, locals)).toBe(8);
            if (type === BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH) {
                expect(resolveDataPinValue(graph, "capture", "item", {}, locals)).toBe("saved");
                expect(resolveDataPinValue(graph, "capture", "indirectItem", {}, locals)).toBe("SAVED");
            }
        }
    });

    it("does not read another execution's loop output before this frame reaches the loop", () => {
        registerCoreBlueprintNodes();
        const graph = loopGraph(BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP, { start: 0, end: 2 });
        const locals: Record<string, unknown> = {};
        writeBlueprintNodeOutputValues(locals, "loop", { index: 7 });
        const frame = createGraphExecutionFrame();
        expect(resolveDataPinValue(graph, "capture", "index", {}, locals, 0, { executionFrame: frame })).toBeUndefined();
        expect(readGraphNodeOutputs(frame, locals)).toEqual({});
    });

    it("keeps nested loops and repeated entries independent in both heads", async () => {
        const graph = nestedLoopGraph();
        const locals: Record<string, unknown> = { count: 0 };
        const seen: Record<string, unknown[][]> = { h1: [], h2: [] };
        behaviorNodeRegistry.register({
            type: CAPTURE,
            displayName: "Capture",
            execute: ctx => {
                seen[ctx.entry.start.nodeId]!.push([
                    ctx.resolveInput?.("outerIndex"),
                    ctx.resolveInput?.("innerIndex"),
                    ctx.resolveInput?.("item"),
                ]);
                ctx.blueprintLocals!.count = Number(ctx.blueprintLocals!.count) + 1;
                return { nextPort: "next" };
            },
        }, { quietOverwrite: true });
        const outcomes = await startTogether(["h1", "h2"].map(nodeId => () => executeGraph({
            graph,
            entry: { start: { nodeId, port: "then" } },
            hostAdapter,
            blueprintLocals: locals,
            maxSteps: 120,
        })));
        const once = [[0, 0, "a"], [0, 1, "b"], [1, 0, "a"], [1, 1, "b"]];
        expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
        expect(seen).toEqual({ h1: [...once, ...once], h2: [...once, ...once] });
        expect(locals.count).toBe(16);
    });

    it("keeps nested and repeated loops independent in synchronous execution", () => {
        const graph = nestedLoopGraph();
        const seen: unknown[][] = [];
        behaviorNodeRegistry.register({
            type: CAPTURE,
            displayName: "Capture",
            execute: ctx => {
                seen.push([ctx.resolveInput?.("outerIndex"), ctx.resolveInput?.("innerIndex"), ctx.resolveInput?.("item")]);
                return { nextPort: "next" };
            },
        }, { quietOverwrite: true });
        executeGraphSync({ graph, entry: { start: { nodeId: "h1", port: "then" } }, hostAdapter, maxSteps: 120 });
        const once = [[0, 0, "a"], [0, 1, "b"], [1, 0, "a"], [1, 1, "b"]];
        expect(seen).toEqual([...once, ...once]);
    });

    it("shows the current loop output in the paused frame", async () => {
        const graph = loopGraph(BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP, { start: 3, end: 4, step: 1 }, false);
        graph.id = buildBlueprintRunGraphId("blueprintEvent", "bp-loop", "loop-graph");
        behaviorNodeRegistry.register({
            type: CAPTURE,
            displayName: "Capture",
            execute: () => ({ nextPort: "next" }),
        }, { quietOverwrite: true });
        const session = new BlueprintDebugSession();
        session.setBreakpoints([{ blueprintId: "bp-loop", graphId: "loop-graph", nodeId: "capture", enabled: true }]);
        setBlueprintDebugController(session);
        try {
            const done = executeGraph({
                graph,
                entry: { start: { nodeId: "h1", port: "then" } },
                hostAdapter,
                blueprintLocals: { count: 0 },
            });
            for (let i = 0; i < 30 && session.getSnapshot().status !== "paused"; i++) {
                await Promise.resolve();
            }
            const paused = session.getSnapshot();
            expect(paused.status).toBe("paused");
            const scope = session.readFrameScope(paused.pausedFrameId!);
            expect(scope?.nodeOutputs).toContainEqual({ nodeId: "loop", values: [{ name: "index", value: 3 }] });
            expect(scope?.variables).toEqual([{ name: "count", value: 0 }]);
            session.resume();
            await done;
        } finally {
            session.dispose();
            setBlueprintDebugController(null);
        }
    });

    it("shows each concurrent frame's own loop output in the debugger", async () => {
        const graph = loopGraph(BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP, { start: 0, end: 2, step: 1 });
        graph.id = buildBlueprintRunGraphId("blueprintEvent", "bp-two-loops", "loop-graph");
        let releaseFirst = () => {};
        const firstWait = new Promise<void>(resolve => { releaseFirst = resolve; });
        let firstHeld = false;
        behaviorNodeRegistry.register({
            type: CAPTURE,
            displayName: "Capture",
            execute: ctx => {
                if (ctx.entry.start.nodeId === "h1" && !firstHeld) {
                    firstHeld = true;
                    return firstWait.then(() => ({ nextPort: "next" }));
                }
                return { nextPort: "next" };
            },
        }, { quietOverwrite: true });
        const session = new BlueprintDebugSession();
        session.setBreakpoints([{
            blueprintId: "bp-two-loops", graphId: "loop-graph", nodeId: "capture", enabled: true, hitCountTarget: 3,
        }]);
        const frames = new Map<string, number>();
        const controller: BlueprintExecutionDebugController = {
            enterFrame: info => {
                const token = session.enterFrame(info);
                frames.set(info.entryNodeId, token.frameId);
                return token;
            },
            exitFrame: token => session.exitFrame(token),
            beforeNode: (token, node) => session.beforeNode(token, node),
        };
        setBlueprintDebugController(controller);
        try {
            const locals = { count: 0 };
            const done = startTogether(["h1", "h2"].map(nodeId => () => executeGraph({
                graph,
                entry: { start: { nodeId, port: "then" } },
                hostAdapter,
                blueprintLocals: locals,
                maxSteps: 40,
            })));
            for (let i = 0; i < 200 && session.getSnapshot().status !== "paused"; i++) {
                await Promise.resolve();
            }
            expect(session.getSnapshot().status).toBe("paused");
            expect(session.readFrameScope(frames.get("h1")!)?.nodeOutputs)
                .toContainEqual({ nodeId: "loop", values: [{ name: "index", value: 0 }] });
            expect(session.readFrameScope(frames.get("h2")!)?.nodeOutputs)
                .toContainEqual({ nodeId: "loop", values: [{ name: "index", value: 1 }] });
            session.setBreakpoints([]);
            session.resume();
            releaseFirst();
            expect((await done).map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
        } finally {
            releaseFirst();
            session.dispose();
            setBlueprintDebugController(null);
        }
    });
});
