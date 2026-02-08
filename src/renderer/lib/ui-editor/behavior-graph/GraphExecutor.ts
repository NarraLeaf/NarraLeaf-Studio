import type { UIHostAdapter } from "../runtime/types";
import type { UIGraph, UIGraphEntry, UIGraphNode } from "@shared/types/ui-editor/graph";
import { behaviorNodeRegistry } from "./BehaviorNodeRegistry";
import type { BehaviorNodeExecutionContext } from "./BehaviorNodeRegistry";

export type ExecuteGraphOptions = {
    graph: UIGraph;
    entry: UIGraphEntry;
    hostAdapter: UIHostAdapter;
    maxSteps?: number;
};

const DEFAULT_MAX_STEPS = 1024;

export async function executeGraph(options: ExecuteGraphOptions): Promise<void> {
    const { entry, graph, hostAdapter } = options;
    let cursorNodeId = entry.start.nodeId;
    let steps = 0;

    while (true) {
        steps += 1;
        if (steps > (options.maxSteps ?? DEFAULT_MAX_STEPS)) {
            throw new Error(`Behavior graph execution exceeded ${options.maxSteps ?? DEFAULT_MAX_STEPS} steps`);
        }

        const node = graph.nodes[cursorNodeId];
        if (!node) {
            throw new Error(`Behavior graph node not found: ${cursorNodeId}`);
        }

        const definition = behaviorNodeRegistry.get(node.type);
        if (!definition) {
            throw new Error(`Behavior node definition missing: ${node.type}`);
        }

        const context: BehaviorNodeExecutionContext = {
            graph,
            entry,
            node,
            params: node.params ?? {},
            hostAdapter,
        };

        const result = await Promise.resolve(definition.execute(context));
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
