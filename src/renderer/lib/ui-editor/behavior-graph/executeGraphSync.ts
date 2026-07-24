/**
 * Synchronous behavior-graph interpreter.
 *
 * `executeGraph` (async) wraps every node in `Promise.resolve(...)`, so even an all-synchronous graph
 * only settles on a microtask - unusable where a value must be produced in the same tick (e.g. a
 * NarraLeaf-React dynamic `Word`, which is `(ctx) => value`). This is a faithful, synchronous fork of
 * that loop for the restricted case of an async-free graph: if any node's `execute` returns a thenable,
 * we throw `AsyncNodeInSyncGraphError` instead of silently dropping the result. Keep this in step with
 * `executeGraph` when the execution model changes. Comments in English per project convention.
 */

import type { UIHostAdapter } from "../runtime/types";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import type { UIGraph, UIGraphEntry } from "@shared/types/ui-editor/graph";
import { registerCoreBlueprintNodes } from "../blueprint-nodes/registerCoreBlueprintNodes";
import { behaviorNodeRegistry } from "./BehaviorNodeRegistry";
import type { BehaviorNodeExecuteResult, BehaviorNodeExecutionContext } from "./BehaviorNodeRegistry";
import { BlueprintGraphExecutionError } from "./GraphExecutionError";
import { writeBlueprintNodeOutputValues } from "../blueprint-nodes/nodeOutputValues";
import { resolveBehaviorNodeInput } from "./dataPinResolver";
import type { ExecuteGraphResult } from "./GraphExecutor";

export type ExecuteGraphSyncOptions = {
    graph: UIGraph;
    entry: UIGraphEntry;
    hostAdapter: UIHostAdapter;
    maxSteps?: number;
    blueprintLocals?: Record<string, unknown>;
    eventName?: string;
    eventPayload?: Record<string, unknown>;
    executionOwner?: BehaviorNodeExecutionContext["executionOwner"];
    persistentVariables?: PersistentVariableRuntimeTable;
};

const DEFAULT_MAX_STEPS = 1024;

/** Thrown when a graph evaluated synchronously reaches a node whose `execute` is asynchronous. */
export class AsyncNodeInSyncGraphError extends BlueprintGraphExecutionError {
    constructor(public readonly nodeType: string, nodeId: string) {
        super(`Async blueprint node "${nodeType}" cannot be evaluated synchronously`, nodeId);
        this.name = "AsyncNodeInSyncGraphError";
    }
}

function isThenable(value: unknown): value is Promise<unknown> {
    return Boolean(value) && typeof (value as { then?: unknown }).then === "function";
}

function resolveNextPorts(result: BehaviorNodeExecuteResult | void): string[] | null {
    if (result && Object.prototype.hasOwnProperty.call(result, "nextPorts")) {
        return result.nextPorts ?? [];
    }
    const hasNextPort = Boolean(result && Object.prototype.hasOwnProperty.call(result, "nextPort"));
    const nextPort = hasNextPort ? result?.nextPort : "next";
    return nextPort == null ? null : [nextPort];
}

/**
 * Run an async-free graph synchronously and capture its Return Value (via `valueExecution.returnValue`).
 * Throws `AsyncNodeInSyncGraphError` if any traversed node executes asynchronously.
 */
export function executeGraphSync(options: ExecuteGraphSyncOptions): ExecuteGraphResult {
    registerCoreBlueprintNodes();
    const { entry, graph, hostAdapter } = options;
    const blueprintLocals = options.blueprintLocals ?? {};
    const valueResult: ExecuteGraphResult = { returnValueSet: false, returnValue: undefined };
    const valueExecution = {
        returnValue: (value: unknown) => {
            valueResult.returnValueSet = true;
            valueResult.returnValue = value;
        },
    };

    let cursor: string | undefined = entry.start.nodeId;
    const pendingCursors: string[] = [];
    let steps = 0;

    while (cursor) {
        const currentCursor: string = cursor;
        steps += 1;
        if (steps > (options.maxSteps ?? DEFAULT_MAX_STEPS)) {
            throw new BlueprintGraphExecutionError(
                `Behavior graph execution exceeded ${options.maxSteps ?? DEFAULT_MAX_STEPS} steps`,
                currentCursor,
            );
        }

        const node = graph.nodes[currentCursor];
        if (!node) {
            throw new BlueprintGraphExecutionError(`Behavior graph node not found: ${currentCursor}`, currentCursor);
        }
        const definition = behaviorNodeRegistry.get(node.type);
        if (!definition) {
            throw new BlueprintGraphExecutionError(`Behavior node definition missing: ${node.type}`, currentCursor);
        }

        const context: BehaviorNodeExecutionContext = {
            graph,
            entry,
            node,
            params: node.params ?? {},
            hostAdapter,
            blueprintLocals,
            eventName: options.eventName,
            eventPayload: options.eventPayload,
            executionOwner: options.executionOwner,
            persistentVariables: options.persistentVariables,
            valueExecution,
        };
        context.resolveInput = pinId => resolveBehaviorNodeInput(context, pinId);

        const raw = definition.execute(context);
        if (isThenable(raw)) {
            throw new AsyncNodeInSyncGraphError(node.type, node.id);
        }
        const result = raw as BehaviorNodeExecuteResult | void;

        if (result && Object.prototype.hasOwnProperty.call(result, "outputValues")) {
            writeBlueprintNodeOutputValues(blueprintLocals, node.id, result.outputValues ?? {});
        }

        const nextPorts = resolveNextPorts(result);
        if (nextPorts == null) {
            return valueResult;
        }

        const nextCursors: string[] = nextPorts
            .map(port => graph.edges.find(edge => edge.from.nodeId === currentCursor && edge.from.port === port))
            .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge))
            .map(edge => edge.to.nodeId);

        if (nextCursors.length === 0) {
            cursor = pendingCursors.shift();
            if (!cursor) {
                return valueResult;
            }
            continue;
        }

        pendingCursors.unshift(...nextCursors.slice(1));
        cursor = nextCursors[0];
    }

    return valueResult;
}
