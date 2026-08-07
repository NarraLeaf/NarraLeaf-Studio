import { afterEach, describe, expect, it } from "vitest";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import { buildBlueprintRunGraphId } from "@shared/blueprint/blueprintRunGraphId";
import type { BlueprintBreakpoint } from "@shared/types/blueprint/breakpoints";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { defineBlueprintNode } from "@/lib/ui-editor/blueprint-nodes/defineBlueprintNode";
import { BlueprintDebugSession } from "@/lib/ui-editor/blueprint-runtime/BlueprintDebugSession";
import { isBlueprintGraphExecutionCancelledError } from "./GraphExecutionError";
import { executeGraph } from "./GraphExecutor";
import { setBlueprintDebugController } from "./debugControl";

const hostAdapter = { host: "player" } as unknown as UIHostAdapter;

const BLUEPRINT_ID = "bp-debug";
const GRAPH_ID = "graph-main";
const SUB_GRAPH_ID = "graph-fn";

/** Records the order nodes actually ran in, so a pause can be told from a slow resume. */
const ran: string[] = [];

const TEST_NODE_SHAPE = {
    category: "Test",
    graphKinds: ["event", "function", "macro"] as const,
    isPure: false,
    pins: [
        { id: "in", kind: "input", semantic: "exec", label: "In" },
        { id: "next", kind: "output", semantic: "exec", label: "Next" },
    ] as const,
};

defineBlueprintNode({
    ...TEST_NODE_SHAPE,
    graphKinds: [...TEST_NODE_SHAPE.graphKinds],
    pins: [...TEST_NODE_SHAPE.pins],
    type: "test.debug.mark",
    displayName: "Mark",
    execute: ctx => {
        ran.push(ctx.node.id);
        return { nextPort: "next" };
    },
});

/**
 * Calls a second graph the way the dispatcher's fn call does: same signal, one level deeper. That
 * is what the debugger reconstructs a call stack out of.
 */
defineBlueprintNode({
    ...TEST_NODE_SHAPE,
    graphKinds: [...TEST_NODE_SHAPE.graphKinds],
    pins: [...TEST_NODE_SHAPE.pins],
    type: "test.debug.call",
    displayName: "Call",
    execute: async ctx => {
        ran.push(ctx.node.id);
        await executeGraph({
            graph: subGraph(),
            entry: { start: { nodeId: "sub1", port: "then" } },
            hostAdapter,
            signal: ctx.signal,
            fnCallDepth: (ctx.fnCallDepth ?? 0) + 1,
            trace: {
                executionId: "exec-1",
                graphId: SUB_GRAPH_ID,
                blueprintId: BLUEPRINT_ID,
                emit: () => undefined,
            },
        });
        return { nextPort: "next" };
    },
});

function mainGraph(): UIGraph {
    return {
        id: buildBlueprintRunGraphId("blueprintEvent", BLUEPRINT_ID, GRAPH_ID),
        entries: {},
        nodes: {
            n1: { id: "n1", type: "test.debug.mark", params: {} },
            n2: { id: "n2", type: "test.debug.call", params: {} },
            n3: { id: "n3", type: "test.debug.mark", params: {} },
        },
        edges: [
            { from: { nodeId: "n1", port: "next" }, to: { nodeId: "n2", port: "in" } },
            { from: { nodeId: "n2", port: "next" }, to: { nodeId: "n3", port: "in" } },
        ],
    };
}

function subGraph(): UIGraph {
    return {
        id: buildBlueprintRunGraphId("fnCall", BLUEPRINT_ID, SUB_GRAPH_ID),
        entries: {},
        nodes: {
            sub1: { id: "sub1", type: "test.debug.mark", params: {} },
            sub2: { id: "sub2", type: "test.debug.mark", params: {} },
        },
        edges: [{ from: { nodeId: "sub1", port: "next" }, to: { nodeId: "sub2", port: "in" } }],
    };
}

function run(session: BlueprintDebugSession | null, signal?: AbortSignal, locals?: Record<string, unknown>) {
    setBlueprintDebugController(session);
    return executeGraph({
        graph: mainGraph(),
        entry: { start: { nodeId: "n1", port: "then" } },
        hostAdapter,
        signal,
        blueprintLocals: locals,
        trace: { executionId: "exec-1", graphId: GRAPH_ID, blueprintId: BLUEPRINT_ID, emit: () => undefined },
    });
}

function breakpoint(nodeId: string, extra?: Partial<BlueprintBreakpoint>): BlueprintBreakpoint {
    return { blueprintId: BLUEPRINT_ID, graphId: GRAPH_ID, nodeId, enabled: true, ...extra };
}

/** Let the executor advance as far as it can; a paused graph settles with nothing else queued. */
async function settle(): Promise<void> {
    for (let i = 0; i < 8; i += 1) {
        await Promise.resolve();
    }
}

afterEach(() => {
    setBlueprintDebugController(null);
    ran.length = 0;
});

describe("blueprint breakpoints", () => {
    it("stops before the node runs and resumes where it left off", async () => {
        const session = new BlueprintDebugSession();
        session.setBreakpoints([breakpoint("n2")]);
        const done = run(session);

        await settle();
        expect(ran).toEqual(["n1"]);
        expect(session.getSnapshot().status).toBe("paused");
        expect(session.getSnapshot().pausedNodeId).toBe("n2");
        expect(session.getSnapshot().reason).toBe("breakpoint");

        session.resume();
        await done;
        expect(ran).toEqual(["n1", "n2", "sub1", "sub2", "n3"]);
        expect(session.getSnapshot().status).toBe("running");
    });

    it("ignores a disabled breakpoint", async () => {
        const session = new BlueprintDebugSession();
        session.setBreakpoints([breakpoint("n2", { enabled: false })]);
        await run(session);
        expect(ran).toEqual(["n1", "n2", "sub1", "sub2", "n3"]);
    });

    it("only stops once its condition holds", async () => {
        const session = new BlueprintDebugSession();
        session.setBreakpoints([breakpoint("n2", { condition: { variableId: "hp", op: "<", value: 10 } })]);

        await run(session, undefined, { hp: 50 });
        expect(ran).toEqual(["n1", "n2", "sub1", "sub2", "n3"]);

        ran.length = 0;
        const done = run(session, undefined, { hp: 3 });
        await settle();
        expect(session.getSnapshot().status).toBe("paused");
        session.resume();
        await done;
    });

    it("counts hits and stops on the Nth", async () => {
        const session = new BlueprintDebugSession();
        session.setBreakpoints([breakpoint("n1", { hitCountTarget: 3 })]);

        await run(session);
        await run(session);
        expect(session.getSnapshot().status).toBe("running");

        const done = run(session);
        await settle();
        expect(session.getSnapshot().status).toBe("paused");
        expect(session.getSnapshot().hitCount).toBe(3);
        session.resume();
        await done;
    });

    it("steps over a call without stopping inside it", async () => {
        const session = new BlueprintDebugSession();
        session.setBreakpoints([breakpoint("n2")]);
        const done = run(session);
        await settle();

        session.stepOver();
        await settle();
        expect(session.getSnapshot().pausedNodeId).toBe("n3");
        // The call ran to completion while stepping over it.
        expect(ran).toEqual(["n1", "n2", "sub1", "sub2"]);

        session.resume();
        await done;
    });

    it("steps into a call and reports the caller in the stack", async () => {
        const session = new BlueprintDebugSession();
        session.setBreakpoints([breakpoint("n2")]);
        const done = run(session);
        await settle();

        session.stepInto();
        await settle();
        const snapshot = session.getSnapshot();
        expect(snapshot.pausedNodeId).toBe("sub1");
        expect(snapshot.stack.map(frame => frame.kind)).toEqual(["blueprintEvent", "fnCall"]);
        expect(snapshot.stack[0].currentNodeId).toBe("n2");
        expect(ran).toEqual(["n1", "n2"]);

        session.resume();
        await done;
    });

    it("steps out of a call and stops at the caller's next node", async () => {
        const session = new BlueprintDebugSession();
        session.setBreakpoints([{ blueprintId: BLUEPRINT_ID, graphId: SUB_GRAPH_ID, nodeId: "sub1", enabled: true }]);
        const done = run(session);
        await settle();
        expect(session.getSnapshot().pausedNodeId).toBe("sub1");

        session.stepOut();
        await settle();
        expect(session.getSnapshot().pausedNodeId).toBe("n3");
        expect(ran).toEqual(["n1", "n2", "sub1", "sub2"]);

        session.resume();
        await done;
    });

    it("the pause button stops at the next node of any execution", async () => {
        const session = new BlueprintDebugSession();
        session.requestPause();
        expect(session.getSnapshot().pausePending).toBe(true);

        const done = run(session);
        await settle();
        expect(session.getSnapshot().status).toBe("paused");
        expect(session.getSnapshot().reason).toBe("step");
        expect(ran).toEqual([]);

        session.resume();
        await done;
        expect(ran).toEqual(["n1", "n2", "sub1", "sub2", "n3"]);
    });

    it("a paused execution is still cancellable", async () => {
        const session = new BlueprintDebugSession();
        session.setBreakpoints([breakpoint("n2")]);
        const controller = new AbortController();
        const done = run(session, controller.signal);
        await settle();
        expect(session.getSnapshot().status).toBe("paused");

        controller.abort();
        await expect(done).rejects.toSatisfy(isBlueprintGraphExecutionCancelledError);
        expect(ran).toEqual(["n1"]);
    });

    it("disposing releases whatever it had stopped", async () => {
        const session = new BlueprintDebugSession();
        session.setBreakpoints([breakpoint("n2")]);
        const done = run(session);
        await settle();

        session.dispose();
        await done;
        expect(ran).toEqual(["n1", "n2", "sub1", "sub2", "n3"]);
    });

    it("does nothing at all when no controller is installed", async () => {
        const session = new BlueprintDebugSession();
        session.setBreakpoints([breakpoint("n2")]);
        await run(null);
        expect(ran).toEqual(["n1", "n2", "sub1", "sub2", "n3"]);
        expect(session.getSnapshot().status).toBe("running");
    });

    it("exposes the paused frame's variables and node outputs", async () => {
        const session = new BlueprintDebugSession();
        session.setBreakpoints([breakpoint("n3")]);
        const done = run(session, undefined, { hp: 7 });
        await settle();

        const frameId = session.getSnapshot().pausedFrameId!;
        const scope = session.readFrameScope(frameId);
        expect(scope?.variables).toEqual([{ name: "hp", value: 7 }]);

        session.resume();
        await done;
    });
});
