import {
    readPublishedBlueprintNodeOutputValueStore,
    writeBlueprintNodeOutputValues,
    type NodeOutputStore,
} from "../blueprint-nodes/nodeOutputValues";

/** State owned by one graph invocation, while its author variables remain shared. */
export type BehaviorGraphExecutionFrame = {
    graphId?: string;
    loopStates: Map<string, unknown>;
    nodeOutputs: Map<string, Record<string, unknown>>;
};

export function createGraphExecutionFrame(
    graphId?: string,
    entryNodeId?: string,
    entryOutputs?: Record<string, unknown>,
): BehaviorGraphExecutionFrame {
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    if (entryNodeId && entryOutputs) nodeOutputs.set(entryNodeId, { ...entryOutputs });
    return { graphId, loopStates: new Map(), nodeOutputs };
}

/** Keep each node's result with the invocation that produced it. */
export function writeGraphNodeOutputs(
    frame: BehaviorGraphExecutionFrame,
    locals: Record<string, unknown>,
    node: { id: string; type: string },
    outputs: Record<string, unknown>,
): void {
    frame.nodeOutputs.set(node.id, { ...outputs });
    writeBlueprintNodeOutputValues(locals, node.id, outputs);
}

/** The node outputs visible to this invocation, for the debugger. */
export function readGraphNodeOutputs(
    frame: BehaviorGraphExecutionFrame,
    locals: Record<string, unknown>,
): NodeOutputStore {
    const outputs = { ...readPublishedBlueprintNodeOutputValueStore(locals, frame.graphId) };
    for (const [nodeId, values] of frame.nodeOutputs) {
        outputs[nodeId] = values;
    }
    return outputs;
}
