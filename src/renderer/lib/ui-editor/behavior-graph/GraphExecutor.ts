import type { UIHostAdapter } from "../runtime/types";
import type { BlueprintPersistentVariable } from "@shared/types/blueprint/document";
import type { UIGraph, UIGraphEntry } from "@shared/types/ui-editor/graph";
import { registerCoreBlueprintNodes } from "../blueprint-nodes/registerCoreBlueprintNodes";
import { behaviorNodeRegistry } from "./BehaviorNodeRegistry";
import type {
    BehaviorGraphEventControl,
    BehaviorGraphExecutionTrace,
    BehaviorNodeExecuteResult,
    BehaviorNodeExecutionContext,
} from "./BehaviorNodeRegistry";
import {
    abortablePromise,
    BlueprintGraphExecutionError,
    isBlueprintGraphExecutionCancelledError,
    throwIfBlueprintExecutionCancelled,
} from "./GraphExecutionError";
import { writeBlueprintNodeOutputValues } from "../blueprint-nodes/nodeOutputValues";

export type ExecuteGraphOptions = {
    graph: UIGraph;
    entry: UIGraphEntry;
    hostAdapter: UIHostAdapter;
    maxSteps?: number;
    trace?: BehaviorGraphExecutionTrace;
    blueprintLocals?: Record<string, unknown>;
    eventName?: string;
    eventPayload?: Record<string, unknown>;
    eventControl?: BehaviorGraphEventControl;
    listItemScope?: BehaviorNodeExecutionContext["listItemScope"];
    instanceKey?: string;
    executionOwner?: BehaviorNodeExecutionContext["executionOwner"];
    persistentVariables?: Record<string, BlueprintPersistentVariable>;
    valueExecution?: Pick<NonNullable<BehaviorNodeExecutionContext["valueExecution"]>, "trackDependency">;
    signal?: AbortSignal;
};

export type ExecuteGraphResult = {
    returnValueSet: boolean;
    returnValue: unknown;
};

const DEFAULT_MAX_STEPS = 1024;

function resolveNextPorts(result: BehaviorNodeExecuteResult | void): string[] | null {
    if (result && Object.prototype.hasOwnProperty.call(result, "nextPorts")) {
        return result.nextPorts ?? [];
    }
    const hasNextPort = Boolean(result && Object.prototype.hasOwnProperty.call(result, "nextPort"));
    const nextPort = hasNextPort ? result?.nextPort : "next";
    return nextPort == null ? null : [nextPort];
}

export async function executeGraph(options: ExecuteGraphOptions): Promise<ExecuteGraphResult> {
    registerCoreBlueprintNodes();
    const { entry, graph, hostAdapter } = options;
    const blueprintLocals = options.blueprintLocals ?? {};
    const valueResult: ExecuteGraphResult = { returnValueSet: false, returnValue: undefined };
    const valueExecution = {
        returnValue: (value: unknown) => {
            valueResult.returnValueSet = true;
            valueResult.returnValue = value;
        },
        trackDependency: options.valueExecution?.trackDependency,
    };
    let cursor: string | undefined = entry.start.nodeId;
    const pendingCursors: string[] = [];
    let steps = 0;

    while (cursor) {
        const currentCursor: string = cursor;
        throwIfBlueprintExecutionCancelled(options.signal, currentCursor);
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
                    nodeId: currentCursor,
                });
            }
            throw new BlueprintGraphExecutionError(message, currentCursor);
        }

        const node = graph.nodes[currentCursor];
        if (!node) {
            throw new BlueprintGraphExecutionError(`Behavior graph node not found: ${currentCursor}`, currentCursor);
        }

        const definition = behaviorNodeRegistry.get(node.type);
        if (!definition) {
            throw new BlueprintGraphExecutionError(`Behavior node definition missing: ${node.type}`, currentCursor);
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
            blueprintLocals,
            eventName: options.eventName,
            eventPayload: options.eventPayload,
            eventControl: options.eventControl,
            signal: options.signal,
            listItemScope: options.listItemScope,
            instanceKey: options.instanceKey,
            executionOwner: options.executionOwner,
            persistentVariables: options.persistentVariables,
            valueExecution,
        };

        let result: BehaviorNodeExecuteResult | void;
        try {
            result = await abortablePromise(Promise.resolve(definition.execute(context)), options.signal, node.id);
            throwIfBlueprintExecutionCancelled(options.signal, node.id);
        } catch (err) {
            if (isBlueprintGraphExecutionCancelledError(err)) {
                throw err;
            }
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
        if (result && Object.prototype.hasOwnProperty.call(result, "outputValues")) {
            writeBlueprintNodeOutputValues(blueprintLocals, node.id, result.outputValues ?? {});
        }
        throwIfBlueprintExecutionCancelled(options.signal, node.id);
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
