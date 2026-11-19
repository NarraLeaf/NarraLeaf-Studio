import { describe, expect, it, vi } from "vitest";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "../runtime/types";
import { behaviorNodeRegistry } from "./BehaviorNodeRegistry";
import { isBlueprintGraphExecutionCancelledError } from "./GraphExecutionError";
import { executeGraph } from "./GraphExecutor";
import { AsyncNodeInSyncGraphError, executeGraphSync } from "./executeGraphSync";

const hostAdapter = { host: "player" } as unknown as UIHostAdapter;

function graph(type: string): UIGraph {
    return {
        id: "rejection-graph",
        entries: {},
        nodes: { node: { id: "node", type, params: {} } },
        edges: [],
    };
}

function options(type: string) {
    return { graph: graph(type), entry: { start: { nodeId: "node", port: "in" } }, hostAdapter };
}

describe("node promise ownership", () => {
    it("observes a rejection from a node that cancels its own execution", async () => {
        const controller = new AbortController();
        behaviorNodeRegistry.register({
            type: "test.rejection.cancelDuringNode",
            displayName: "Cancel during node",
            execute: () => {
                controller.abort();
                return Promise.reject(new Error("node rejected after cancellation"));
            },
        }, { quietOverwrite: true });

        await expect(executeGraph({
            ...options("test.rejection.cancelDuringNode"),
            signal: controller.signal,
        })).rejects.toSatisfy(isBlueprintGraphExecutionCancelledError);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    it("observes a rejection from an async node refused by the synchronous executor", async () => {
        behaviorNodeRegistry.register({
            type: "test.rejection.asyncInSync",
            displayName: "Async in sync graph",
            execute: () => Promise.reject(new Error("async node rejected")),
        }, { quietOverwrite: true });

        expect(() => executeGraphSync(options("test.rejection.asyncInSync")))
            .toThrow(AsyncNodeInSyncGraphError);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    it("continues observing node work that rejects after cancellation has been reported", async () => {
        const controller = new AbortController();
        let rejectWork!: (reason: Error) => void;
        const work = new Promise<never>((_, reject) => { rejectWork = reject; });
        behaviorNodeRegistry.register({
            type: "test.rejection.lateAfterCancel",
            displayName: "Late rejection after cancellation",
            execute: () => {
                controller.abort();
                return work;
            },
        }, { quietOverwrite: true });

        await expect(executeGraph({
            ...options("test.rejection.lateAfterCancel"),
            signal: controller.signal,
        })).rejects.toSatisfy(isBlueprintGraphExecutionCancelledError);
        rejectWork(new Error("late cancellation failure"));
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    it("continues observing async node work after the synchronous graph rejects it", async () => {
        let rejectWork!: (reason: Error) => void;
        const work = new Promise<never>((_, reject) => { rejectWork = reject; });
        behaviorNodeRegistry.register({
            type: "test.rejection.lateAfterSync",
            displayName: "Late rejection after synchronous graph",
            execute: () => work,
        }, { quietOverwrite: true });

        expect(() => executeGraphSync(options("test.rejection.lateAfterSync")))
            .toThrow(AsyncNodeInSyncGraphError);
        rejectWork(new Error("late async node failure"));
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    it("reports an uncancelled node rejection with its node id", async () => {
        behaviorNodeRegistry.register({
            type: "test.rejection.failure",
            displayName: "Failing node",
            execute: () => Promise.reject(new Error("node failed")),
        }, { quietOverwrite: true });

        await expect(executeGraph(options("test.rejection.failure")))
            .rejects.toMatchObject({ message: "node failed", nodeId: "node" });
    });

    it("does not run a node when cancellation precedes execution", async () => {
        const execute = vi.fn(() => ({}));
        const controller = new AbortController();
        behaviorNodeRegistry.register({ type: "test.rejection.preCancelled", displayName: "Pre-cancelled", execute }, { quietOverwrite: true });
        controller.abort();

        await expect(executeGraph({
            ...options("test.rejection.preCancelled"),
            signal: controller.signal,
        })).rejects.toSatisfy(isBlueprintGraphExecutionCancelledError);
        expect(execute).not.toHaveBeenCalled();
    });
});
