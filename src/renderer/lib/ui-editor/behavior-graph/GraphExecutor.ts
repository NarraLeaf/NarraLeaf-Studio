import type { UIHostAdapter } from "../runtime/types";
import type { UIGraph, UIGraphEntry } from "@shared/types/ui-editor/graph";
import { registerCoreBlueprintNodes } from "../blueprint-nodes/registerCoreBlueprintNodes";
import { behaviorNodeRegistry } from "./BehaviorNodeRegistry";
import type {
    BehaviorGraphExecutionTrace,
    BehaviorNodeExecuteResult,
    BehaviorNodeExecutionContext,
} from "./BehaviorNodeRegistry";
import { BlueprintGraphExecutionError } from "./GraphExecutionError";
import { writeBlueprintNodeOutputValues } from "../blueprint-nodes/nodeOutputValues";

export type ExecuteGraphOptions = {
    graph: UIGraph;
    entry: UIGraphEntry;
    hostAdapter: UIHostAdapter;
    maxSteps?: number;
    trace?: BehaviorGraphExecutionTrace;
    blueprintLocals?: Record<string, unknown>;
    eventPayload?: Record<string, unknown>;
    listItemScope?: BehaviorNodeExecutionContext["listItemScope"];
    instanceKey?: string;
    executionOwner?: BehaviorNodeExecutionContext["executionOwner"];
    valueExecution?: Pick<NonNullable<BehaviorNodeExecutionContext["valueExecution"]>, "trackDependency">;
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
            eventPayload: options.eventPayload,
            listItemScope: options.listItemScope,
            instanceKey: options.instanceKey,
            executionOwner: options.executionOwner,
            valueExecution,
        };

        let result: BehaviorNodeExecuteResult | void;
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
