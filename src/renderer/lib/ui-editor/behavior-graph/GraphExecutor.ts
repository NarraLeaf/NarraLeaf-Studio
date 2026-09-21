import type { UIHostAdapter } from "../runtime/types";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import type { UIGraph, UIGraphEntry, UIGraphNode } from "@shared/types/ui-editor/graph";
import { registerCoreBlueprintNodes } from "../blueprint-nodes/registerCoreBlueprintNodes";
import { behaviorNodeRegistry } from "./BehaviorNodeRegistry";
import type {
    BehaviorGraphEventControl,
    BehaviorGraphExecutionTrace,
    BehaviorGraphValueTracking,
    BehaviorNodeExecuteResult,
    BehaviorNodeExecutionContext,
} from "./BehaviorNodeRegistry";
import {
    abortablePromise,
    BlueprintGraphExecutionError,
    BlueprintStepLimitError,
    isBlueprintGraphExecutionCancelledError,
    stepLimitOfExecutionError,
    throwIfBlueprintExecutionCancelled,
} from "./GraphExecutionError";
import { eventLoopTurnedSince, readEventLoopTurn } from "./eventLoopTurns";
import { writeBlueprintNodeOutputValues } from "../blueprint-nodes/nodeOutputValues";
import { resolveBehaviorNodeInput } from "./dataPinResolver";
import {
    blueprintNodeDisplayName,
    listUnwiredRequiredInputPins,
} from "../blueprint-nodes/requiredInputPins";
import { getBlueprintDebugController } from "./debugControl";

export type ExecuteGraphOptions = {
    graph: UIGraph;
    entry: UIGraphEntry;
    hostAdapter: UIHostAdapter;
    /**
     * How many nodes may run in a row without the graph once waiting, before it is stopped.
     *
     * A budget between waits, not for the whole run - see {@link executeGraph}.
     */
    maxSteps?: number;
    trace?: BehaviorGraphExecutionTrace;
    blueprintLocals?: Record<string, unknown>;
    eventName?: string;
    eventPayload?: Record<string, unknown>;
    eventControl?: BehaviorGraphEventControl;
    listItemScope?: BehaviorNodeExecutionContext["listItemScope"];
    instanceKey?: string;
    executionOwner?: BehaviorNodeExecutionContext["executionOwner"];
    persistentVariables?: PersistentVariableRuntimeTable;
    valueExecution?: BehaviorGraphValueTracking;
    signal?: AbortSignal;
    fnCallDepth?: number;
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

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return Boolean(value) && typeof (value as { then?: unknown }).then === "function";
}

/**
 * Run a graph from one entry until it ends, returns, fails or is cancelled.
 *
 * **The step budget counts nodes between waits, not nodes per run.** It exists to stop one failure:
 * exec wires that go round in a circle through nodes that never wait. Every node is awaited, but an
 * await on something already settled only lets other microtasks run, so such a circle holds the
 * window forever - no input, no paint, no way to close Dev Mode. A circle through a node that does
 * wait (a `Delay` of any real length, an animation, a file read) gives the window back on every pass;
 * it is a timer or a poll the author wrote, and counting its passes against a per-run total stopped
 * it after a few hundred of them with nothing on screen to say why. So the count starts again
 * whenever a node actually waited - measured, not declared, because a `Delay` of zero is latent on
 * paper and returns at once (see `eventLoopTurns`).
 */
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
        trackState: options.valueExecution?.trackState,
        stateOrigin: options.valueExecution?.stateOrigin,
    };
    let cursor: string | undefined = entry.start.nodeId;
    const pendingCursors: string[] = [];
    const stepBudget = options.maxSteps ?? DEFAULT_MAX_STEPS;
    /** Nodes run since the graph last waited; see the note on the budget above. */
    let stepsWithoutWaiting = 0;
    /**
     * Nodes already reported for an unconnected required input, so a node inside a loop says it
     * once per run rather than once per pass.
     */
    const inputMissingReported = new Set<string>();

    // Null in every build that is not a Dev Mode session; see debugControl.ts.
    const debugController = getBlueprintDebugController();
    const debugFrame = debugController?.enterFrame({
        runGraphId: graph.id,
        entryNodeId: entry.start.nodeId,
        fnCallDepth: options.fnCallDepth,
        executionId: options.trace?.executionId,
        signal: options.signal,
        blueprintId: options.trace?.blueprintId,
        eventName: options.eventName,
        blueprintLocals,
        eventPayload: options.eventPayload,
    });

    try {
        while (cursor) {
            const currentCursor: string = cursor;
            throwIfBlueprintExecutionCancelled(options.signal, currentCursor);
            stepsWithoutWaiting += 1;

            const node = graph.nodes[currentCursor];
            if (!node) {
                throw new BlueprintGraphExecutionError(`Behavior graph node not found: ${currentCursor}`, currentCursor);
            }

            if (stepsWithoutWaiting > stepBudget) {
                const headNode = graph.nodes[entry.start.nodeId];
                const error = new BlueprintStepLimitError(
                    stepBudget,
                    currentCursor,
                    blueprintNodeDisplayName(node.type),
                    headNode ? blueprintNodeDisplayName(headNode.type) : entry.start.nodeId,
                );
                const trace = options.trace;
                if (trace) {
                    trace.emit({
                        type: "execution.error",
                        executionId: trace.executionId,
                        message: error.message,
                        blueprintId: trace.blueprintId,
                        eventId: trace.eventId,
                        graphId: trace.graphId,
                        nodeId: currentCursor,
                        surfaceId: trace.surfaceId,
                        stepLimit: stepLimitOfExecutionError(error),
                    });
                }
                throw error;
            }

            const definition = behaviorNodeRegistry.get(node.type);
            if (!definition) {
                throw new BlueprintGraphExecutionError(`Behavior node definition missing: ${node.type}`, currentCursor);
            }

            const trace = options.trace;

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
                fnCallDepth: options.fnCallDepth,
            };
            context.resolveInput = pinId => resolveBehaviorNodeInput(context, pinId);

            // A breakpoint stops the graph *before* the node runs, and before `node.enter` is traced:
            // an author reading the output while paused should not see a node they have not stepped
            // over yet. Suspension is opt-in per node - the controller returns nothing when nothing
            // is armed, which is the case for every node of every graph until someone sets a
            // breakpoint.
            if (debugController && debugFrame) {
                const gate = debugController.beforeNode(debugFrame, node, context);
                if (gate) {
                    // Paused at a breakpoint is waiting as much as a Delay is: stepping through a
                    // loop one node at a time must not use up its budget.
                    const mark = readEventLoopTurn();
                    await abortablePromise(gate, options.signal, node.id);
                    throwIfBlueprintExecutionCancelled(options.signal, node.id);
                    if (eventLoopTurnedSince(mark)) {
                        stepsWithoutWaiting = 0;
                    }
                }
            }

            if (trace) {
                trace.emit({ type: "node.enter", executionId: trace.executionId, nodeId: node.id });
                reportUnwiredRequiredInputs(graph, node, trace, inputMissingReported);
            }

            let result: BehaviorNodeExecuteResult | void;
            try {
                const outcome = definition.execute(context);
                // Only a node that handed back a promise can have waited; a mark is taken for those
                // alone, so a run of synchronous nodes posts nothing.
                const mark = isThenable(outcome) ? readEventLoopTurn() : null;
                result = await abortablePromise(Promise.resolve(outcome), options.signal, node.id);
                throwIfBlueprintExecutionCancelled(options.signal, node.id);
                if (mark !== null && eventLoopTurnedSince(mark)) {
                    stepsWithoutWaiting = 0;
                }
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
                        surfaceId: trace.surfaceId,
                        stepLimit: stepLimitOfExecutionError(err),
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
    } finally {
        if (debugController && debugFrame) {
            debugController.exitFrame(debugFrame);
        }
    }
}

/**
 * Say, once per node per run, that a required data input has nothing feeding it.
 *
 * Only when the execution carries a trace, which is what keeps it off the hot path: an event
 * dispatch traces, a value binding does not - and a binding re-evaluates on every dependency change,
 * which would turn one unfinished pin into a line per frame.
 *
 * Reported before the node runs rather than from inside it, because the node itself cannot tell:
 * `resolveInput` answers `undefined` for a pin nobody wired exactly as it does for one whose source
 * legitimately produced nothing, and most nodes never ask at all.
 */
function reportUnwiredRequiredInputs(
    graph: UIGraph,
    node: UIGraphNode,
    trace: BehaviorGraphExecutionTrace,
    reported: Set<string>,
): void {
    if (reported.has(node.id)) {
        return;
    }
    reported.add(node.id);
    const missing = listUnwiredRequiredInputPins(
        node.type,
        node.params,
        pinId => graph.edges.some(edge => edge.to.nodeId === node.id && edge.to.port === pinId),
    );
    for (const pin of missing) {
        trace.emit({
            type: "node.input_missing",
            executionId: trace.executionId,
            nodeId: node.id,
            nodeName: blueprintNodeDisplayName(node.type),
            pinLabel: pin.label,
            blueprintId: trace.blueprintId,
            eventId: trace.eventId,
            graphId: trace.graphId,
            surfaceId: trace.surfaceId,
        });
    }
}
