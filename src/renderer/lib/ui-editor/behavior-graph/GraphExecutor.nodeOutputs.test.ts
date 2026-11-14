import { describe, expect, it, vi } from "vitest";
import { buildBlueprintRunGraphId } from "@shared/blueprint/blueprintRunGraphId";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_FLOW_NOOP,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_CURRENT_RUN,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FN_RETURN,
    BLUEPRINT_NODE_PARAM_FN_NAME,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_IDS,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_LABELS,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_TYPES,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_IDS,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_LABELS,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_TYPES,
    BLUEPRINT_NODE_TYPE_STRING_TO_UPPER,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "../runtime/types";
import { dispatchGlobalBlueprintEvent, invokeBlueprintFnCall } from "../blueprint-runtime/BlueprintDispatcher";
import { BlueprintDebugSession } from "../blueprint-runtime/BlueprintDebugSession";
import { DebugBridge } from "../blueprint-runtime/DebugBridge";
import { startTogether } from "../blueprint-runtime/startTogether";
import { createBlueprintFnRef } from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import { blueprintNodeRegistry } from "../blueprint-nodes/BlueprintNodeRegistry";
import { resolveEffectiveBlueprintNodePins } from "../blueprint-nodes/effectivePins";
import { registerCoreBlueprintNodes } from "../blueprint-nodes/registerCoreBlueprintNodes";
import { resolveDataPinValue } from "../blueprint-nodes/built-in/graphParamResolvers";
import { behaviorNodeRegistry } from "./BehaviorNodeRegistry";
import { executeGraph } from "./GraphExecutor";
import { executeGraphSync } from "./executeGraphSync";
import { setBlueprintDebugController, type BlueprintExecutionDebugController } from "./debugControl";
import { createGraphExecutionFrame, writeGraphNodeOutputs } from "./graphExecutionFrame";

const OUTPUT = "test.executionOutput.produce";
const WAIT = "test.executionOutput.wait";
const READ = "test.executionOutput.read";
const HOST = { host: "player" } as UIHostAdapter;

function sharedOutputGraph(): UIGraph {
    return {
        id: "shared-outputs",
        entries: {},
        nodes: {
            first: { id: "first", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP, params: {} },
            second: { id: "second", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP, params: {} },
            produce: { id: "produce", type: OUTPUT, params: {} },
            wait: { id: "wait", type: WAIT, params: {} },
            read: { id: "read", type: READ, params: {} },
            upper: { id: "upper", type: BLUEPRINT_NODE_TYPE_STRING_TO_UPPER, params: {} },
        },
        edges: [
            { from: { nodeId: "first", port: "next" }, to: { nodeId: "produce", port: "in" } },
            { from: { nodeId: "second", port: "next" }, to: { nodeId: "produce", port: "in" } },
            { from: { nodeId: "produce", port: "next" }, to: { nodeId: "wait", port: "in" } },
            { from: { nodeId: "wait", port: "next" }, to: { nodeId: "read", port: "in" } },
            { from: { nodeId: "produce", port: "value" }, to: { nodeId: "read", port: "direct" } },
            { from: { nodeId: "produce", port: "value" }, to: { nodeId: "upper", port: "value" } },
            { from: { nodeId: "upper", port: "result" }, to: { nodeId: "read", port: "indirect" } },
        ],
    };
}

function registerOutputProducer(): void {
    behaviorNodeRegistry.register({
        type: OUTPUT,
        displayName: "Produce",
        execute: ctx => ({ nextPort: "next", outputValues: { value: ctx.entry.start.nodeId } }),
    }, { quietOverwrite: true });
}

describe("node outputs across event heads", () => {
    it("lets each head inherit the game it captured before a wait", async () => {
        const blueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                bp: {
                    id: "bp",
                    name: "Global",
                    owner: { kind: "globalMain" },
                    members: { variables: {}, fields: {}, functions: {} },
                    bindings: {},
                    graphs: {
                        events: {
                            main: {
                                id: "main",
                                graph: {
                                    nodes: {
                                        first: { id: "first", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY, params: {} },
                                        second: { id: "second", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY, params: {} },
                                        capture: { id: "capture", type: BLUEPRINT_NODE_TYPE_GAME_SAVE_CURRENT_RUN, params: {} },
                                        wait: { id: "wait", type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { duration: 0 } },
                                        start: { id: "start", type: BLUEPRINT_NODE_TYPE_GAME_START_STORY, params: { storyId: "story", sceneId: "scene" } },
                                    },
                                    edges: [
                                        { from: { nodeId: "first", port: "then" }, to: { nodeId: "capture", port: "in" } },
                                        { from: { nodeId: "second", port: "then" }, to: { nodeId: "capture", port: "in" } },
                                        { from: { nodeId: "capture", port: "next" }, to: { nodeId: "wait", port: "in" } },
                                        { from: { nodeId: "wait", port: "completed" }, to: { nodeId: "start", port: "in" } },
                                        { from: { nodeId: "capture", port: "slot" }, to: { nodeId: "start", port: "inheritFrom" } },
                                    ],
                                },
                            },
                        },
                        functions: {},
                    },
                },
            },
            ownerRecords: { globalMain: { blueprintId: "bp" } },
        } as unknown as BlueprintDocument;
        let captured = 0;
        const inherited: number[] = [];
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                hostApi: {
                    game: {
                        captureRun: async () => ({ run: ++captured }),
                        startStory: async (_target: unknown, options: { inheritSavedGame: { run: number } }) => {
                            inherited.push(options.inheritSavedGame.run);
                        },
                    },
                },
            },
        } as unknown as UIHostAdapter;
        const debug = new DebugBridge();
        debug.setVerboseCaptureEnabled(true);

        await dispatchGlobalBlueprintEvent({
            blueprintDocument,
            persistentVariables: {},
            eventName: "gameReady",
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        expect(captured).toBe(2);
        expect(inherited).toEqual([1, 2]);
        expect(debug.snapshot().filter(event => event.type === "execution.error")).toEqual([]);
    });

    it("keeps direct and pure-node reads per invocation while sharing author variables", async () => {
        registerOutputProducer();
        const seen: Record<string, unknown[]> = {};
        const locals: Record<string, unknown> = { count: 0 };
        let arrivals = 0;
        let release = () => {};
        const barrier = new Promise<void>(resolve => { release = resolve; });
        behaviorNodeRegistry.register({
            type: WAIT,
            displayName: "Wait",
            execute: async () => {
                arrivals += 1;
                if (arrivals === 2) release();
                await barrier;
                return { nextPort: "next" };
            },
        }, { quietOverwrite: true });
        behaviorNodeRegistry.register({
            type: READ,
            displayName: "Read",
            execute: ctx => {
                expect(ctx.blueprintLocals).toBe(locals);
                locals.count = Number(locals.count) + 1;
                seen[ctx.entry.start.nodeId] = [ctx.resolveInput?.("direct"), ctx.resolveInput?.("indirect")];
                return { nextPort: "next" };
            },
        }, { quietOverwrite: true });
        const graph = sharedOutputGraph();
        const outcomes = await startTogether(["first", "second"].map(nodeId => () => executeGraph({
            graph,
            entry: { start: { nodeId, port: "in" } },
            hostAdapter: HOST,
            blueprintLocals: locals,
        })));
        expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
        expect(seen).toEqual({ first: ["first", "FIRST"], second: ["second", "SECOND"] });
        expect(locals.count).toBe(2);
    });

    it("keeps synchronous output when another graph runs reentrantly with the same locals", () => {
        registerOutputProducer();
        const graph = sharedOutputGraph();
        const locals: Record<string, unknown> = { count: 0 };
        const seen: Record<string, unknown[]> = {};
        behaviorNodeRegistry.register({
            type: WAIT,
            displayName: "Run nested graph",
            execute: ctx => {
                if (ctx.entry.start.nodeId === "first") {
                    executeGraphSync({ graph, entry: { start: { nodeId: "second", port: "in" } }, hostAdapter: HOST, blueprintLocals: locals });
                }
                return { nextPort: "next" };
            },
        }, { quietOverwrite: true });
        behaviorNodeRegistry.register({
            type: READ,
            displayName: "Read",
            execute: ctx => {
                locals.count = Number(locals.count) + 1;
                seen[ctx.entry.start.nodeId] = [ctx.resolveInput?.("direct"), ctx.resolveInput?.("indirect")];
                return { nextPort: "next" };
            },
        }, { quietOverwrite: true });
        executeGraphSync({ graph, entry: { start: { nodeId: "first", port: "in" } }, hostAdapter: HOST, blueprintLocals: locals });
        expect(seen).toEqual({ first: ["first", "FIRST"], second: ["second", "SECOND"] });
        expect(locals.count).toBe(2);
    });

    it("does not read a different invocation's completed output before running the node", async () => {
        registerOutputProducer();
        const graph = sharedOutputGraph();
        const locals: Record<string, unknown> = {};
        const seen: unknown[] = [];
        behaviorNodeRegistry.register({ type: WAIT, displayName: "Wait", execute: () => ({ nextPort: "next" }) }, { quietOverwrite: true });
        behaviorNodeRegistry.register({
            type: READ,
            displayName: "Read",
            execute: ctx => {
                seen.push(ctx.resolveInput?.("direct"));
                return { nextPort: "next" };
            },
        }, { quietOverwrite: true });
        await executeGraph({ graph, entry: { start: { nodeId: "first", port: "in" } }, hostAdapter: HOST, blueprintLocals: locals });
        await executeGraph({ graph, entry: { start: { nodeId: "read", port: "in" } }, hostAdapter: HOST, blueprintLocals: locals });
        expect(seen).toEqual(["first", undefined]);
    });

    it("keeps concurrent Fn arguments with their own calls across a wait", async () => {
        const blueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                bp: {
                    id: "bp", name: "Global", owner: { kind: "globalMain" },
                    members: { variables: {}, fields: {}, functions: {} }, bindings: {},
                    graphs: {
                        events: {
                            main: {
                                id: "main",
                                graph: {
                                    nodes: {
                                        head: {
                                            id: "head", type: BLUEPRINT_NODE_TYPE_FN_HEAD,
                                            params: {
                                                [BLUEPRINT_NODE_PARAM_FN_NAME]: "Echo",
                                                [BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_IDS]: ["param_1_value"],
                                                [BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_LABELS]: { param_1_value: "input" },
                                                [BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_TYPES]: { param_1_value: "string" },
                                            },
                                        },
                                        wait: { id: "wait", type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { duration: 0 } },
                                        ret: {
                                            id: "ret", type: BLUEPRINT_NODE_TYPE_FN_RETURN,
                                            params: {
                                                [BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_IDS]: ["ret_1_value"],
                                                [BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_LABELS]: { ret_1_value: "result" },
                                                [BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_TYPES]: { ret_1_value: "string" },
                                            },
                                        },
                                    },
                                    edges: [
                                        { from: { nodeId: "head", port: "then" }, to: { nodeId: "wait", port: "in" } },
                                        { from: { nodeId: "wait", port: "completed" }, to: { nodeId: "ret", port: "in" } },
                                        { from: { nodeId: "head", port: "param_1_value" }, to: { nodeId: "ret", port: "ret_1_value" } },
                                    ],
                                },
                            },
                        },
                        functions: {},
                    },
                },
            },
            ownerRecords: { globalMain: { blueprintId: "bp" } },
        } as unknown as BlueprintDocument;
        const call = (value: string) => invokeBlueprintFnCall({
            blueprintDocument,
            persistentVariables: {},
            fnRef: createBlueprintFnRef("bp", "head"),
            args: { param_1_value: value },
            depth: 0,
            hostAdapter: HOST,
            debug: new DebugBridge(),
        });
        const result = await Promise.all([call("first"), call("second")]);
        expect(result.map(value => value.returns)).toEqual([{ ret_1_value: "first" }, { ret_1_value: "second" }]);
    });

    it("resolves registered execution output pins with a frame", () => {
        registerCoreBlueprintNodes();
        const exempt = new Set([
            "blueprint.event.head.elementFlush.element",
            "blueprint.event.head.elementClick.element",
        ]);
        const unreadable: string[] = [];
        let checked = 0;
        for (const def of blueprintNodeRegistry.list()) {
            if (def.isPure || def.category === "Network" || def.type.includes("network") || def.type === "blueprint.app.openExternal") continue;
            for (const pin of resolveEffectiveBlueprintNodePins(def, {})) {
                if (pin.kind !== "output" || pin.semantic !== "data") continue;
                const name = `${def.type}.${pin.id}`;
                if (exempt.has(name)) continue;
                const graph = { id: "output-sweep", nodes: { node: { type: def.type, params: {} } }, edges: [] };
                const locals = {};
                const frame = createGraphExecutionFrame();
                writeGraphNodeOutputs(frame, locals, { id: "node", type: def.type }, { [pin.id]: "sentinel" });
                const value = resolveDataPinValue(graph, "node", pin.id, {}, locals, 0, { executionFrame: frame });
                checked += 1;
                if (value === undefined) unreadable.push(name);
            }
        }
        expect(checked).toBeGreaterThan(100);
        expect(unreadable).toEqual([]);
    });

    it("shows each invocation's own ordinary output in the debugger", async () => {
        registerOutputProducer();
        const graph = sharedOutputGraph();
        graph.id = buildBlueprintRunGraphId("blueprintEvent", "bp-output", "graph");
        let release = () => {};
        const held = new Promise<void>(resolve => { release = resolve; });
        behaviorNodeRegistry.register({
            type: WAIT,
            displayName: "Wait",
            execute: ctx => ctx.entry.start.nodeId === "first" ? held.then(() => ({ nextPort: "next" })) : { nextPort: "next" },
        }, { quietOverwrite: true });
        behaviorNodeRegistry.register({ type: READ, displayName: "Read", execute: () => ({ nextPort: "next" }) }, { quietOverwrite: true });
        const session = new BlueprintDebugSession();
        session.setBreakpoints([{ blueprintId: "bp-output", graphId: "graph", nodeId: "read", enabled: true }]);
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
            const locals = { count: 2 };
            const done = startTogether(["first", "second"].map(nodeId => () => executeGraph({
                graph,
                entry: { start: { nodeId, port: "in" } },
                hostAdapter: HOST,
                blueprintLocals: locals,
            })));
            for (let index = 0; index < 200 && session.getSnapshot().status !== "paused"; index += 1) await Promise.resolve();
            expect(session.getSnapshot().status).toBe("paused");
            expect(session.readFrameScope(frames.get("first")!)?.nodeOutputs)
                .toContainEqual({ nodeId: "produce", values: [{ name: "value", value: "first" }] });
            expect(session.readFrameScope(frames.get("second")!)?.nodeOutputs)
                .toContainEqual({ nodeId: "produce", values: [{ name: "value", value: "second" }] });
            expect(session.readFrameScope(frames.get("first")!)?.variables).toEqual([{ name: "count", value: 2 }]);
            session.setBreakpoints([]);
            session.resume();
            release();
            expect((await done).map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
        } finally {
            release();
            session.dispose();
            setBlueprintDebugController(null);
        }
    });

    it("exposes a pending animation token to another head so it can stop the animation", async () => {
        let finish = () => {};
        let resolvePending: (value: { id: string }) => void = () => {};
        const pending = new Promise<{ id: string }>(resolve => { resolvePending = resolve; });
        const animateDisplayable = vi.fn((_element: string, request: { id: string }) => {
            finish = () => resolvePending({ id: request.id });
            return pending;
        });
        const stopDisplayableAnimation = vi.fn(async () => { finish(); });
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                hostApi: {
                    widget: {
                        getDisplayableProperties: () => ({
                            position: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, size: { width: 1, height: 1 },
                            opacity: 1, rotation: 0,
                        }),
                        animateDisplayable,
                        stopDisplayableAnimation,
                    },
                },
            },
        } as unknown as UIHostAdapter;
        const graph: UIGraph = {
            id: "pending-animation",
            entries: {},
            nodes: {
                animate: { id: "animate", type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY, params: { duration: 1 } },
                stop: { id: "stop", type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION, params: {} },
            },
            edges: [{ from: { nodeId: "animate", port: "animation" }, to: { nodeId: "stop", port: "animation" } }],
        };
        const locals = {};
        const owner = { surfaceId: "surface", elementId: "element", blueprintId: "bp" };
        const running = executeGraph({ graph, entry: { start: { nodeId: "animate", port: "in" } }, hostAdapter, blueprintLocals: locals, executionOwner: owner });
        await executeGraph({ graph, entry: { start: { nodeId: "stop", port: "in" } }, hostAdapter, blueprintLocals: locals, executionOwner: owner });
        expect(stopDisplayableAnimation).toHaveBeenCalledWith(expect.stringMatching(/^animation:/));
        finish();
        await running;
    });

    it("does not expose an animation token to another graph with the same node id", async () => {
        let finish = () => {};
        let resolvePending: (value: { id: string }) => void = () => {};
        const pending = new Promise<{ id: string }>(resolve => { resolvePending = resolve; });
        const stopDisplayableAnimation = vi.fn();
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                hostApi: {
                    widget: {
                        getDisplayableProperties: () => ({
                            position: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, size: { width: 1, height: 1 },
                            opacity: 1, rotation: 0,
                        }),
                        animateDisplayable: (_element: string, request: { id: string }) => {
                            finish = () => resolvePending({ id: request.id });
                            return pending;
                        },
                        stopDisplayableAnimation,
                    },
                },
            },
        } as unknown as UIHostAdapter;
        const first: UIGraph = {
            id: "first-graph",
            entries: {},
            nodes: {
                animate: { id: "animate", type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY, params: {} },
                stop: { id: "stop", type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION, params: {} },
            },
            edges: [{ from: { nodeId: "animate", port: "animation" }, to: { nodeId: "stop", port: "animation" } }],
        };
        const second = { ...first, id: "second-graph" };
        const locals = {};
        const owner = { surfaceId: "surface", elementId: "element", blueprintId: "bp" };
        const running = executeGraph({ graph: first, entry: { start: { nodeId: "animate", port: "in" } }, hostAdapter, blueprintLocals: locals, executionOwner: owner });
        try {
            await executeGraph({ graph: second, entry: { start: { nodeId: "stop", port: "in" } }, hostAdapter, blueprintLocals: locals, executionOwner: owner });
            expect(stopDisplayableAnimation).not.toHaveBeenCalled();
        } finally {
            finish();
            await running;
        }
    });
});
