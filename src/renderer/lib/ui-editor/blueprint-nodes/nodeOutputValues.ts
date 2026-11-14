/**
 * Per-execution data outputs produced by exec nodes.
 * Comments in English per project convention.
 */

import { parseBlueprintRunGraphId } from "@shared/blueprint/blueprintRunGraphId";
import { BLUEPRINT_MEMO_RECORD_KEY } from "../blueprint-runtime/blueprintWidgetLocals";

export const BLUEPRINT_NODE_OUTPUT_VALUES_KEY = "__nlBlueprintNodeOutputValues";

export type NodeOutputStore = Record<string, Record<string, unknown>>;

type OutputFrame = { graphId?: string; nodeOutputs: Map<string, Record<string, unknown>> };

// Pending outputs follow the blueprint instance across its events. Each invocation retains its own
// entry so an older pending output becomes visible again when a newer invocation finishes.
type PublishedOutput = { nodeId: string; values: Record<string, unknown> };
const publishedOutputs = new WeakMap<Record<string, unknown>, Map<OutputFrame, PublishedOutput>>();

function outputOwner(locals: Record<string, unknown>): Record<string, unknown> {
    const owner = locals[BLUEPRINT_MEMO_RECORD_KEY];
    return owner && typeof owner === "object" ? owner as Record<string, unknown> : locals;
}

function readStore(blueprintLocals: Record<string, unknown> | undefined): NodeOutputStore | undefined {
    const raw = blueprintLocals?.[BLUEPRINT_NODE_OUTPUT_VALUES_KEY];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    return raw as NodeOutputStore;
}

function getOrCreateStore(blueprintLocals: Record<string, unknown>): NodeOutputStore {
    const existing = readStore(blueprintLocals);
    if (existing) {
        return existing;
    }
    const store: NodeOutputStore = {};
    blueprintLocals[BLUEPRINT_NODE_OUTPUT_VALUES_KEY] = store;
    return store;
}

export function writeBlueprintNodeOutputValues(
    blueprintLocals: Record<string, unknown>,
    nodeId: string,
    outputValues: Record<string, unknown>,
): void {
    getOrCreateStore(blueprintLocals)[nodeId] = { ...outputValues };
}

/** Publish an output before its node finishes, so other events can act on it while it waits. */
export function publishBlueprintNodeOutputValues(
    blueprintLocals: Record<string, unknown>,
    nodeId: string,
    outputValues: Record<string, unknown>,
    frame?: OutputFrame,
): void {
    const values = { ...outputValues };
    getOrCreateStore(blueprintLocals)[nodeId] = values;
    if (frame?.graphId !== undefined) {
        const owner = outputOwner(blueprintLocals);
        let frames = publishedOutputs.get(owner);
        if (!frames) {
            frames = new Map();
            publishedOutputs.set(owner, frames);
        }
        frames.delete(frame);
        frames.set(frame, { nodeId, values });
    }
    frame?.nodeOutputs.set(nodeId, values);
}

/** Remove a waiting output when its node finishes, fails or its graph is cancelled. */
export function unpublishBlueprintNodeOutputValues(
    blueprintLocals: Record<string, unknown>,
    nodeId: string,
    frame: OutputFrame,
): void {
    const owner = outputOwner(blueprintLocals);
    const frames = publishedOutputs.get(owner);
    if (frames?.get(frame)?.nodeId !== nodeId) return;
    frames.delete(frame);
    if (frames.size === 0) publishedOutputs.delete(owner);
}

export function readPublishedBlueprintNodeOutputValueStore(
    blueprintLocals: Record<string, unknown> | undefined,
    graphId: string | undefined,
): NodeOutputStore | undefined {
    if (!blueprintLocals || graphId === undefined) return undefined;
    const frames = publishedOutputs.get(outputOwner(blueprintLocals));
    if (!frames) return undefined;
    const graphRef = parseBlueprintRunGraphId(graphId);
    const outputs: NodeOutputStore = {};
    for (const [frame, output] of frames) {
        const publishedRef = parseBlueprintRunGraphId(frame.graphId);
        if (frame.graphId === graphId || (graphRef && publishedRef &&
            graphRef.blueprintId === publishedRef.blueprintId && graphRef.graphId === publishedRef.graphId)) {
            outputs[output.nodeId] = output.values;
        }
    }
    return outputs;
}

/** Everything one execution's nodes have produced so far; the debugger's node-output scope view. */
export function readBlueprintNodeOutputValueStore(
    blueprintLocals: Record<string, unknown> | undefined,
): NodeOutputStore | undefined {
    return readStore(blueprintLocals);
}

export function readBlueprintNodeOutputValue(
    blueprintLocals: Record<string, unknown> | undefined,
    nodeId: string,
    portId: string,
    frame?: OutputFrame,
): unknown {
    const values = frame
        ? frame.nodeOutputs.get(nodeId) ?? readPublishedBlueprintNodeOutputValueStore(blueprintLocals, frame.graphId)?.[nodeId]
        : readStore(blueprintLocals)?.[nodeId];
    if (!values || !Object.prototype.hasOwnProperty.call(values, portId)) {
        return undefined;
    }
    return values[portId];
}
