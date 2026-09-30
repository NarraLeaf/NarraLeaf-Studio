/**
 * The executor's step budget stops a loop that never waits, and only that.
 *
 * A circle of exec wires through nodes that return without waiting holds the window forever - every
 * node is awaited, but an await on something already settled lets nothing but other microtasks run.
 * That is what the budget is for. A circle through a node that really waits (a `Delay` of a tenth of a
 * second polling for something) gives the window back on every pass, and the budget used to count
 * those passes too: a polling loop an author wrote on purpose stopped after a few hundred of them,
 * and the display it drove froze with nothing on screen saying why.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import { BLUEPRINT_NODE_TYPE_FLOW_DELAY } from "@shared/types/blueprint/graph";
import { buildBlueprintRunGraphId } from "@shared/blueprint/blueprintRunGraphId";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { defineBlueprintNode } from "@/lib/ui-editor/blueprint-nodes/defineBlueprintNode";
import {
    BlueprintStepLimitError,
    isBlueprintGraphExecutionCancelledError,
} from "./GraphExecutionError";
import { executeGraph } from "./GraphExecutor";

const hostAdapter = { host: "player" } as unknown as UIHostAdapter;

/** Passes through the loop's first node, across every run in a test. */
let passes = 0;
/** Stops the loop from inside once it has gone far enough, so a run that never stops ends. */
let stopAfter = Number.POSITIVE_INFINITY;
let controller = new AbortController();

const EXEC_PINS = [
    { id: "in", kind: "input", semantic: "exec", label: "In" },
    { id: "next", kind: "output", semantic: "exec", label: "Next" },
] as const;

defineBlueprintNode({
    type: "test.stepBudget.head",
    displayName: "Test Head",
    category: "Test",
    graphKinds: ["event"],
    isPure: false,
    pins: [{ id: "next", kind: "output", semantic: "exec", label: "Next" }],
    execute: () => ({ nextPort: "next" }),
});

defineBlueprintNode({
    type: "test.stepBudget.count",
    displayName: "Count Pass",
    category: "Test",
    graphKinds: ["event"],
    isPure: false,
    pins: [...EXEC_PINS],
    execute: () => {
        passes += 1;
        if (passes >= stopAfter) {
            controller.abort();
        }
        return { nextPort: "next" };
    },
});

/** Async on paper, answered at once: a host call served from memory looks exactly like this. */
defineBlueprintNode({
    type: "test.stepBudget.settled",
    displayName: "Answered At Once",
    category: "Test",
    graphKinds: ["event"],
    isPure: false,
    isLatent: true,
    pins: [...EXEC_PINS],
    execute: async () => ({ nextPort: "next" }),
});

/** head -> count -> <waiter> -> back to count, forever. */
function loopThrough(waiter: { type: string; params?: Record<string, unknown>; out: string }): UIGraph {
    return {
        id: buildBlueprintRunGraphId("blueprintEvent", "bp-loop", "graph-loop"),
        entries: {},
        nodes: {
            head: { id: "head", type: "test.stepBudget.head", params: {} },
            count: { id: "count", type: "test.stepBudget.count", params: {} },
            wait: { id: "wait", type: waiter.type, params: waiter.params ?? {} },
        },
        edges: [
            { from: { nodeId: "head", port: "next" }, to: { nodeId: "count", port: "in" } },
            { from: { nodeId: "count", port: "next" }, to: { nodeId: "wait", port: "in" } },
            { from: { nodeId: "wait", port: waiter.out }, to: { nodeId: "count", port: "in" } },
        ],
    };
}

function run(graph: UIGraph, maxSteps: number, events: BlueprintDebugEvent[] = []) {
    return executeGraph({
        graph,
        entry: { start: { nodeId: "head", port: "then" } },
        hostAdapter,
        maxSteps,
        signal: controller.signal,
        trace: {
            executionId: "exec-loop",
            graphId: graph.id,
            blueprintId: "bp-loop",
            emit: event => events.push(event),
        },
    });
}

afterEach(() => {
    passes = 0;
    stopAfter = Number.POSITIVE_INFINITY;
    controller = new AbortController();
});

describe("the executor's step budget", () => {
    it("lets a loop that waits on every pass run past it", async () => {
        // Two nodes a pass and a budget of twenty: the old per-run count stopped this after ten
        // passes. It has to still be going at sixty, and only stop when it is cancelled.
        stopAfter = 60;
        const events: BlueprintDebugEvent[] = [];
        const outcome = await run(
            loopThrough({ type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { duration: 0.001 }, out: "completed" }),
            20,
            events,
        ).then(() => null, (error: unknown) => error);

        expect(passes).toBe(60);
        expect(isBlueprintGraphExecutionCancelledError(outcome)).toBe(true);
        expect(events.filter(event => event.type === "execution.error")).toEqual([]);
    });

    it("stops a loop through a Delay of zero, which never waits", async () => {
        const events: BlueprintDebugEvent[] = [];
        const outcome = await run(
            loopThrough({ type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { duration: 0 }, out: "completed" }),
            20,
            events,
        ).then(() => null, (error: unknown) => error);

        expect(outcome).toBeInstanceOf(BlueprintStepLimitError);
        // The head, then ten passes of two nodes: the twenty-first node - the Delay - is refused.
        expect(passes).toBe(10);
        const stop = outcome as BlueprintStepLimitError;
        expect(stop.headName).toBe("Test Head");
        expect(stop.nodeName).toBe("Delay");
        expect(stop.steps).toBe(20);

        const reported = events.filter(event => event.type === "execution.error");
        expect(reported).toHaveLength(1);
        expect(reported[0]).toMatchObject({
            type: "execution.error",
            nodeId: "wait",
            message: stop.message,
            stepLimit: { steps: 20, nodeName: "Delay", headName: "Test Head" },
        });
    });

    it("stops a loop through a node that is async but answers at once", async () => {
        const outcome = await run(
            loopThrough({ type: "test.stepBudget.settled", out: "next" }),
            20,
        ).then(() => null, (error: unknown) => error);

        expect(outcome).toBeInstanceOf(BlueprintStepLimitError);
        expect(passes).toBe(10);
    });
});
