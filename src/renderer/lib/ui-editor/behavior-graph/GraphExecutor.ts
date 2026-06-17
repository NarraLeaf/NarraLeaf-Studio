import type { UIHostAdapter } from "../runtime/types";
import type { UIGraph, UIGraphEntry, UIGraphNode } from "@shared/types/ui-editor/graph";
import { registerCoreBlueprintNodes } from "../blueprint-nodes/registerCoreBlueprintNodes";
import { behaviorNodeRegistry } from "./BehaviorNodeRegistry";
import type { BehaviorGraphExecutionTrace, BehaviorNodeExecutionContext } from "./BehaviorNodeRegistry";
import { BlueprintGraphExecutionError } from "./GraphExecutionError";

export type ExecuteGraphOptions = {
    graph: UIGraph;
    entry: UIGraphEntry;
    hostAdapter: UIHostAdapter;
    maxSteps?: number;
    trace?: BehaviorGraphExecutionTrace;
    blueprintLocals?: Record<string, unknown>;
    eventPayload?: Record<string, unknown>;
    executionOwner?: BehaviorNodeExecutionContext["executionOwner"];
};

const DEFAULT_MAX_STEPS = 1024;

export async function executeGraph(options: ExecuteGraphOptions): Promise<void> {
    registerCoreBlueprintNodes();
    const { entry, graph, hostAdapter } = options;
    let cursorNodeId = entry.start.nodeId;
    let steps = 0;

    while (true) {
        steps += 1;
        if (steps > (options.maxSteps ?? DEFAULT_MAX_STEPS)) {
            const message = `Behavior graph execution exceeded ${options.maxSteps ?? DEFAULT_MAX_STEPS} steps`;
            const trace = options.trace;
            if (trace) {
                trace.emit({
                    type: "execution.error",
                    executionId: trace.executionId,
                    message,
                    blueprintId: trace.blueprintId,
                    eventId: trace.eventId,
                    graphId: trace.graphId,
                    nodeId: cursorNodeId,
                });
            }
            throw new BlueprintGraphExecutionError(message, cursorNodeId);
        }

        const node = graph.nodes[cursorNodeId];
        if (!node) {
            throw new BlueprintGraphExecutionError(`Behavior graph node not found: ${cursorNodeId}`, cursorNodeId);
        }

        const definition = behaviorNodeRegistry.get(node.type);
        if (!definition) {
            throw new BlueprintGraphExecutionError(`Behavior node definition missing: ${node.type}`, cursorNodeId);
        }

        const trace = options.trace;
        if (trace) {
            trace.emit({ type: "node.enter", executionId: trace.executionId, nodeId: node.id });
        }

        const context: BehaviorNodeExecutionContext = {
            graph,
            entry,
            node,
            params: node.params ?? {},
            hostAdapter,
            trace,
            blueprintLocals: options.blueprintLocals,
            eventPayload: options.eventPayload,
            executionOwner: options.executionOwner,
        };

        let result: Awaited<ReturnType<NonNullable<typeof definition.execute>>>;
        try {
            result = await Promise.resolve(definition.execute(context));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const nodeId = err instanceof BlueprintGraphExecutionError ? err.nodeId : node.id;
            if (trace) {
                trace.emit({
                    type: "execution.error",
                    executionId: trace.executionId,
                    message,
                    blueprintId: trace.blueprintId,
                    eventId: trace.eventId,
                    graphId: trace.graphId,
                    nodeId,
                });
            }
            throw err instanceof BlueprintGraphExecutionError ? err : new BlueprintGraphExecutionError(message, nodeId);
        } finally {
            if (trace) {
                trace.emit({ type: "node.exit", executionId: trace.executionId, nodeId: node.id });
            }
        }
        const nextPort = result?.nextPort ?? "next";

        const nextEdge = graph.edges.find(
            edge => edge.from.nodeId === cursorNodeId && edge.from.port === nextPort
        );
        if (!nextEdge) {
            return;
        }

        cursorNodeId = nextEdge.to.nodeId;
    }
}
