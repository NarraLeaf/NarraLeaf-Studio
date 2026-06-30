import type { Blueprint, BlueprintDocument, BlueprintEventGraph, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    collectBlueprintEventHeadNodeIdsForDispatch,
    collectSurfaceEventHeadNodeIdsForDispatch,
    collectGlobalEventHeadNodeIdsForDispatch,
    isBlueprintEventDispatchHeadType,
} from "@shared/types/blueprint/graph";
import type { BlueprintElementRef } from "@shared/types/blueprint/valueTypes";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import { getWidgetLogicEvent, getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { executeGraph } from "@/lib/ui-editor/behavior-graph";
import {
    BlueprintGraphExecutionError,
    isBlueprintGraphExecutionCancelledError,
    throwIfBlueprintExecutionCancelled,
} from "@/lib/ui-editor/behavior-graph/GraphExecutionError";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { BlueprintHostApiRuntime } from "./BlueprintHostApiBridge";
import type { BlueprintExecutionHandle, BlueprintExecutionManager } from "./BlueprintExecutionManager";
import { adaptBlueprintGraphIr } from "./adaptBlueprintGraphIr";
import { acquireBlueprintExecutionLocals } from "./blueprintWidgetLocals";
import type { DebugBridge } from "./DebugBridge";
import { truncateDebugEventMessage } from "./DebugBridge";
import {
    widgetMainOwnerKey,
    surfaceMainOwnerKey,
    GLOBAL_MAIN_OWNER_KEY,
} from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import { readBlueprintElementRefParams } from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";

const DEFAULT_MAX_STEPS = 512;

type CancellableDispatchOptions = {
    executionManager?: BlueprintExecutionManager;
    allowClosedScopeExecution?: boolean;
};

function beginTrackedExecution(input: {
    executionManager?: BlueprintExecutionManager;
    executionId: string;
    runtimeScopeId?: string;
    blueprintId?: string;
    eventId?: string;
    allowClosedScopeExecution?: boolean;
}): BlueprintExecutionHandle | null {
    return input.executionManager?.beginExecution({
        executionId: input.executionId,
        runtimeScopeId: input.runtimeScopeId,
        blueprintId: input.blueprintId,
        eventId: input.eventId,
        allowClosedScope: input.allowClosedScopeExecution,
    }) ?? null;
}

function emitExecutionCancelled(input: {
    debug: DebugBridge;
    executionId: string;
    blueprintId?: string;
    eventId?: string;
    graphId?: string;
    nodeId?: string;
    reason?: string;
}): void {
    input.debug.emit({
        type: "execution.cancelled",
        executionId: input.executionId,
        blueprintId: input.blueprintId,
        eventId: input.eventId,
        graphId: input.graphId,
        nodeId: input.nodeId,
        reason: input.reason,
    });
}

function newExecutionId(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createScriptExecutionContext(input: {
    hostApi?: BlueprintHostApiRuntime;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    eventPayload?: Record<string, unknown>;
    signal?: AbortSignal;
}): Record<string, unknown> {
    const api = input.hostApi;
    if (api) {
        return {
            event: input.eventPayload ?? {},
            runtime: {
                signal: input.signal,
                isCancelled: () => input.signal?.aborted === true,
                throwIfCancelled: () => throwIfBlueprintExecutionCancelled(input.signal),
            },
            host: {
                navigation: api.navigation,
                widget: api.widget,
                game: api.game,
                frame: api.frame,
                persistence: api.persistence,
                devtools: {
                    log: (msg: string) => {
                        api.devtools.log("info", truncateDebugEventMessage(String(msg)));
                    },
                },
            },
            state: {
                surface: {
                    get: (key: string) => api.state.get("surface", key),
                    set: (key: string, value: unknown) => {
                        api.state.set("surface", key, value);
                    },
                },
                global: {
                    get: (key: string) => api.state.get("global", key),
                    set: (key: string, value: unknown) => {
                        api.state.set("global", key, value);
                    },
                },
            },
        };
    }
    return {
        event: input.eventPayload ?? {},
        runtime: {
            signal: input.signal,
            isCancelled: () => input.signal?.aborted === true,
            throwIfCancelled: () => throwIfBlueprintExecutionCancelled(input.signal),
        },
        host: {
            devtools: {
                log: async (msg: string) => {
                    input.debug.emit({ type: "function.call", functionId: "devtools.log" });
                    const safeMessage = truncateDebugEventMessage(String(msg));
                    input.debug.emit({ type: "devtools.log", level: "info", message: safeMessage });
                    console.info(`[Blueprint] ${safeMessage}`);
                    input.debug.emit({ type: "function.return", functionId: "devtools.log" });
                },
            },
            navigation: {
                openSurface: async (_surfaceId: string) => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.openSurface" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.openSurface" });
                },
            },
            game: {
                startStory: async (_request: { storyId: string; sceneId: string }) => {
                    input.debug.emit({ type: "function.call", functionId: "game.startStory" });
                    input.debug.emit({ type: "function.return", functionId: "game.startStory" });
                },
            },
        },
        state: {
            surface: {
                get: (key: string) => {
                    input.debug.emit({ type: "state.read", scope: "surface", key });
                    return input.getSurfaceState(key);
                },
                set: (key: string, value: unknown) => {
                    input.setSurfaceState(key, value);
                    input.debug.emit({ type: "state.write", scope: "surface", key });
                },
            },
        },
    };
}

type BlueprintModuleSink = { events: Record<string, unknown>; bound: Record<string, unknown> };

function getMountedBlueprintModule(blueprintId: string): BlueprintModuleSink | undefined {
    const g = globalThis as typeof globalThis & { __NL_BP_MODULES__?: Record<string, BlueprintModuleSink> };
    return g.__NL_BP_MODULES__?.[blueprintId];
}

/**
 * Dispatch a UI element behavior event into a blueprint event graph or TypeScript module (M3-min + M5).
 */
export async function dispatchBlueprintUiEvent(options: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    surfaceId: string;
    runtimeScopeId?: string;
    elementId: string;
    eventName: string;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    eventPayload?: Record<string, unknown>;
    listItemScope?: UIListItemScope | null;
    instanceKey?: string;
    maxSteps?: number;
} & CancellableDispatchOptions): Promise<void> {
    const {
        document,
        blueprintDocument,
        surfaceId,
        runtimeScopeId,
        elementId,
        eventName,
        hostAdapter,
        debug,
        getSurfaceState,
        setSurfaceState,
        eventPayload,
        listItemScope,
        instanceKey,
    } = options;
    const el = document.elements[elementId];
    if (!el) {
        return;
    }
    const widgetLogicApi = getWidgetLogicApi(el.type);
    const widgetOwnerKey = widgetLogicApi?.supportsPrivateBlueprint ? widgetMainOwnerKey(surfaceId, elementId) : undefined;
    const activeWidgetBlueprintId = widgetOwnerKey ? blueprintDocument.ownerRecords[widgetOwnerKey]?.activeBlueprintId : undefined;
    const widgetPrivateEventSupported = Boolean(getWidgetLogicEvent(el.type, eventName));
    const legacyBinding = el.behavior?.events?.[eventName];

    const blueprintId =
        widgetPrivateEventSupported && activeWidgetBlueprintId
            ? activeWidgetBlueprintId
            : legacyBinding?.kind === "blueprintEvent"
              ? legacyBinding.blueprintId
              : undefined;
    if (!blueprintId) {
        return;
    }
    const bp = blueprintDocument.blueprints[blueprintId];
    if (!bp) {
        return;
    }
    if (bp.program.kind === "scriptModule") {
        const mod = getMountedBlueprintModule(blueprintId);
        const fn =
            mod?.events?.[eventName] ??
            (legacyBinding?.kind === "blueprintEvent" ? mod?.events?.[legacyBinding.eventId] : undefined);
        if (typeof fn !== "function") {
            return;
        }
        const executionId = newExecutionId();
        const execution = beginTrackedExecution({
            executionManager: options.executionManager,
            executionId,
            runtimeScopeId,
            blueprintId,
            eventId: eventName,
            allowClosedScopeExecution: options.allowClosedScopeExecution,
        });
        debug.emit({ type: "execution.started", executionId, blueprintId });
        const ctx = createScriptExecutionContext({
            hostApi: hostAdapter.blueprintRuntime?.hostApi,
            debug,
            getSurfaceState,
            setSurfaceState,
            eventPayload,
            signal: execution?.signal,
        });
        try {
            throwIfBlueprintExecutionCancelled(execution?.signal);
            await Promise.resolve(fn(ctx));
            throwIfBlueprintExecutionCancelled(execution?.signal);
            debug.emit({ type: "execution.finished", executionId, blueprintId });
        } catch (err) {
            if (isBlueprintGraphExecutionCancelledError(err)) {
                emitExecutionCancelled({
                    debug,
                    executionId,
                    blueprintId,
                    eventId: eventName,
                    reason: err.message,
                });
                return;
            }
            const message = err instanceof Error ? err.message : String(err);
            debug.emit({
                type: "execution.error",
                executionId,
                message,
                blueprintId,
                eventId: eventName,
            });
        } finally {
            execution?.finish();
        }
        return;
    }

    if (bp.program.kind !== "graph") {
        return;
    }

    const widgetElementType = el?.type;
    const candidateGraphs = Object.values(bp.program.graphs.events ?? {});
    const matchingGraphs = candidateGraphs
        .map(eventGraph => {
            const ir = eventGraph.graph;
            const headIds = collectBlueprintEventHeadNodeIdsForDispatch(
                ir?.nodes,
                eventName,
                widgetElementType,
                eventPayload,
            );
            return headIds.length > 0 ? { eventGraph, ir, headIds } : null;
        })
        .filter((entry): entry is { eventGraph: NonNullable<typeof candidateGraphs[number]>; ir: NonNullable<typeof candidateGraphs[number]["graph"]>; headIds: string[] } => Boolean(entry));

    if (matchingGraphs.length === 0) {
        return;
    }
    const executionId = newExecutionId();
    const execution = beginTrackedExecution({
        executionManager: options.executionManager,
        executionId,
        runtimeScopeId,
        blueprintId,
        eventId: eventName,
        allowClosedScopeExecution: options.allowClosedScopeExecution,
    });
    debug.emit({ type: "execution.started", executionId, blueprintId });

    const blueprintLocals = acquireBlueprintExecutionLocals({
        blueprintDocument,
        currentBlueprintId: blueprintId,
        surfaceId,
        runtimeScopeId,
        elementId,
        elementInstanceKey: instanceKey,
    });

    try {
        for (const { eventGraph, ir, headIds } of matchingGraphs) {
            const graph = adaptBlueprintGraphIr(ir, `blueprintEvent:${blueprintId}:${eventGraph.id}`);
            for (const headId of headIds) {
                const entry = { start: { nodeId: headId, port: "then" as const } };
                const startNode = graph.nodes[headId];
                if (!startNode || !isBlueprintEventDispatchHeadType(startNode.type)) {
                    continue;
                }
                await executeGraph({
                    graph,
                    entry,
                    hostAdapter,
                    blueprintLocals,
                    eventPayload,
                    listItemScope,
                    instanceKey,
                    executionOwner: { surfaceId, elementId, blueprintId },
                    persistentVariables: blueprintDocument.persistentVariables,
                    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
                    signal: execution?.signal,
                    trace: {
                        executionId,
                        graphId: graph.id,
                        blueprintId,
                        eventId: eventName,
                        emit: e => debug.emit(e),
                    },
                });
            }
        }
        debug.emit({ type: "execution.finished", executionId, blueprintId });
    } catch (err) {
        if (isBlueprintGraphExecutionCancelledError(err)) {
            emitExecutionCancelled({
                debug,
                executionId,
                blueprintId,
                eventId: eventName,
                nodeId: err.nodeId,
                reason: err.message,
            });
            return;
        }
        if (err instanceof BlueprintGraphExecutionError) {
            debug.emit({
                type: "execution.error",
                executionId,
                message: err.message,
                blueprintId,
                eventId: eventName,
                nodeId: err.nodeId,
            });
            return;
        }
        const message = err instanceof Error ? err.message : String(err);
        debug.emit({
            type: "execution.error",
            executionId,
            message,
            blueprintId,
            eventId: eventName,
        });
    } finally {
        execution?.finish();
    }
}

function collectSurfaceElementIds(document: UIDocument, surfaceId: string): string[] {
    const surface = document.surfaces.find(s => s.id === surfaceId);
    const rootId = surface?.rootElementId;
    if (!rootId) {
        return [];
    }
    const out: string[] = [];
    const visit = (elementId: string) => {
        const el = document.elements[elementId];
        if (!el) {
            return;
        }
        out.push(elementId);
        for (const childId of el.childrenIds ?? []) {
            visit(childId);
        }
    };
    visit(rootId);
    return out;
}

function matchesElementFlushTarget(
    node: { type: string; params?: Record<string, unknown> },
    target: BlueprintElementRef,
): boolean {
    if (node.type !== BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH) {
        return false;
    }
    const ref = readBlueprintElementRefParams(node.params);
    return Boolean(
        ref &&
        ref.surfaceId === target.surfaceId &&
        ref.elementId === target.elementId &&
        ref.elementType === target.elementType,
    );
}

function collectElementFlushHeadNodeIds(
    nodes: Record<string, { type: string; params?: Record<string, unknown> }> | undefined,
    target: BlueprintElementRef,
): string[] {
    const n = nodes ?? {};
    return Object.entries(n)
        .filter(([, node]) => matchesElementFlushTarget(node, target))
        .map(([id]) => id)
        .sort();
}

function collectElementFlushTargets(input: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    surfaceId: string;
    target: BlueprintElementRef;
}): Array<{
    elementId?: string;
    blueprintId: string;
    eventGraph: BlueprintEventGraph;
    ir: BlueprintGraphIr;
    headIds: string[];
}> {
    const out: Array<{
        elementId?: string;
        blueprintId: string;
        eventGraph: BlueprintEventGraph;
        ir: BlueprintGraphIr;
        headIds: string[];
    }> = [];

    const surfaceOwnerKey = surfaceMainOwnerKey(input.surfaceId);
    const surfaceBlueprintId = input.blueprintDocument.ownerRecords[surfaceOwnerKey]?.activeBlueprintId;
    const surfaceBlueprint = surfaceBlueprintId ? input.blueprintDocument.blueprints[surfaceBlueprintId] : undefined;
    if (surfaceBlueprintId && surfaceBlueprint?.program.kind === "graph") {
        for (const eventGraph of Object.values(surfaceBlueprint.program.graphs.events ?? {})) {
            const ir = eventGraph.graph;
            const headIds = collectElementFlushHeadNodeIds(ir?.nodes, input.target);
            if (ir && headIds.length > 0) {
                out.push({ blueprintId: surfaceBlueprintId, eventGraph, ir, headIds });
            }
        }
    }

    for (const elementId of collectSurfaceElementIds(input.document, input.surfaceId)) {
        const el = input.document.elements[elementId];
        const widgetLogicApi = getWidgetLogicApi(el?.type);
        if (!widgetLogicApi?.supportsPrivateBlueprint) {
            continue;
        }
        const ownerKey = widgetMainOwnerKey(input.surfaceId, elementId);
        const blueprintId = input.blueprintDocument.ownerRecords[ownerKey]?.activeBlueprintId;
        const bp = blueprintId ? input.blueprintDocument.blueprints[blueprintId] : undefined;
        if (!blueprintId || !bp || bp.program.kind !== "graph") {
            continue;
        }
        for (const eventGraph of Object.values(bp.program.graphs.events ?? {})) {
            const ir = eventGraph.graph;
            const headIds = collectElementFlushHeadNodeIds(ir?.nodes, input.target);
            if (ir && headIds.length > 0) {
                out.push({ elementId, blueprintId, eventGraph, ir, headIds });
            }
        }
    }

    return out;
}

export async function dispatchBlueprintElementFlushEvent(options: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    surfaceId: string;
    runtimeScopeId?: string;
    target: BlueprintElementRef;
    eventPayload?: Record<string, unknown>;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
} & CancellableDispatchOptions): Promise<void> {
    const {
        document,
        blueprintDocument,
        surfaceId,
        runtimeScopeId,
        target,
        eventPayload,
        hostAdapter,
        debug,
    } = options;
    const payload = eventPayload ?? { element: target };
    const targets = collectElementFlushTargets({ document, blueprintDocument, surfaceId, target });

    for (const listener of targets) {
        const executionId = newExecutionId();
        const execution = beginTrackedExecution({
            executionManager: options.executionManager,
            executionId,
            runtimeScopeId,
            blueprintId: listener.blueprintId,
            eventId: "elementFlush",
            allowClosedScopeExecution: options.allowClosedScopeExecution,
        });
        debug.emit({ type: "execution.started", executionId, blueprintId: listener.blueprintId });
        const blueprintLocals = acquireBlueprintExecutionLocals({
            blueprintDocument,
            currentBlueprintId: listener.blueprintId,
            surfaceId,
            runtimeScopeId,
            elementId: listener.elementId,
        });
        try {
            for (const headId of listener.headIds) {
                const graph = adaptBlueprintGraphIr(
                    listener.ir,
                    `elementFlush:${listener.blueprintId}:${listener.eventGraph.id}`,
                );
                const startNode = graph.nodes[headId];
                if (!startNode || !isBlueprintEventDispatchHeadType(startNode.type)) {
                    continue;
                }
                await executeGraph({
                    graph,
                    entry: { start: { nodeId: headId, port: "then" as const } },
                    hostAdapter,
                    blueprintLocals,
                    eventPayload: payload,
                    executionOwner: { surfaceId, elementId: listener.elementId, blueprintId: listener.blueprintId },
                    persistentVariables: blueprintDocument.persistentVariables,
                    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
                    signal: execution?.signal,
                    trace: {
                        executionId,
                        graphId: graph.id,
                        blueprintId: listener.blueprintId,
                        eventId: "elementFlush",
                        emit: e => debug.emit(e),
                    },
                });
            }
            debug.emit({ type: "execution.finished", executionId, blueprintId: listener.blueprintId });
        } catch (err) {
            if (isBlueprintGraphExecutionCancelledError(err)) {
                emitExecutionCancelled({
                    debug,
                    executionId,
                    blueprintId: listener.blueprintId,
                    eventId: "elementFlush",
                    nodeId: err.nodeId,
                    reason: err.message,
                });
                continue;
            }
            if (err instanceof BlueprintGraphExecutionError) {
                debug.emit({
                    type: "execution.error",
                    executionId,
                    message: err.message,
                    blueprintId: listener.blueprintId,
                    eventId: "elementFlush",
                    nodeId: err.nodeId,
                });
                continue;
            }
            const message = err instanceof Error ? err.message : String(err);
            debug.emit({ type: "execution.error", executionId, message, blueprintId: listener.blueprintId, eventId: "elementFlush" });
        } finally {
            execution?.finish();
        }
    }
}

function collectBroadcastHeadNodeIds(
    nodes: Record<string, { type: string; params?: Record<string, unknown> }> | undefined,
    eventName: string,
): string[] {
    const n = nodes ?? {};
    return Object.entries(n)
        .filter(([, node]) => {
            if (node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST) {
                return true;
            }
            if (node.type !== BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST) {
                return false;
            }
            return String(node.params?.event ?? "").trim() === eventName;
        })
        .map(([id]) => id)
        .sort();
}

function collectBroadcastTargets(input: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    surfaceId: string;
    eventName: string;
}): Array<{
    elementId?: string;
    blueprintId: string;
    bp: Blueprint;
    eventGraph: BlueprintEventGraph;
    ir: BlueprintGraphIr;
    headIds: string[];
}> {
    const out: Array<{
        elementId?: string;
        blueprintId: string;
        bp: Blueprint;
        eventGraph: BlueprintEventGraph;
        ir: BlueprintGraphIr;
        headIds: string[];
    }> = [];

    const surfaceOwnerKey = surfaceMainOwnerKey(input.surfaceId);
    const surfaceBlueprintId = input.blueprintDocument.ownerRecords[surfaceOwnerKey]?.activeBlueprintId;
    const surfaceBlueprint = surfaceBlueprintId ? input.blueprintDocument.blueprints[surfaceBlueprintId] : undefined;
    if (surfaceBlueprintId && surfaceBlueprint?.program.kind === "graph") {
        for (const eventGraph of Object.values(surfaceBlueprint.program.graphs.events ?? {})) {
            const ir = eventGraph.graph;
            const headIds = collectBroadcastHeadNodeIds(ir?.nodes, input.eventName);
            if (ir && headIds.length > 0) {
                out.push({
                    blueprintId: surfaceBlueprintId,
                    bp: surfaceBlueprint,
                    eventGraph,
                    ir,
                    headIds,
                });
            }
        }
    }

    for (const elementId of collectSurfaceElementIds(input.document, input.surfaceId)) {
        const el = input.document.elements[elementId];
        const widgetLogicApi = getWidgetLogicApi(el?.type);
        if (!widgetLogicApi?.supportsPrivateBlueprint) {
            continue;
        }
        const ownerKey = widgetMainOwnerKey(input.surfaceId, elementId);
        const blueprintId = input.blueprintDocument.ownerRecords[ownerKey]?.activeBlueprintId;
        const bp = blueprintId ? input.blueprintDocument.blueprints[blueprintId] : undefined;
        if (!blueprintId || !bp || bp.program.kind !== "graph") {
            continue;
        }
        for (const eventGraph of Object.values(bp.program.graphs.events ?? {})) {
            const ir = eventGraph.graph;
            const headIds = collectBroadcastHeadNodeIds(ir?.nodes, input.eventName);
            if (ir && headIds.length > 0) {
                out.push({ elementId, blueprintId, bp, eventGraph, ir, headIds });
            }
        }
    }
    return out;
}

export function countBlueprintBroadcastListeners(options: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    surfaceId: string;
    eventName: string;
}): number {
    return collectBroadcastTargets(options).reduce((sum, target) => sum + target.headIds.length, 0);
}

export async function dispatchBlueprintBroadcastEvent(options: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    surfaceId: string;
    runtimeScopeId?: string;
    eventName: string;
    data: unknown;
    sender?: string;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
} & CancellableDispatchOptions): Promise<void> {
    const {
        document,
        blueprintDocument,
        surfaceId,
        runtimeScopeId,
        eventName,
        data,
        sender,
        hostAdapter,
        debug,
        getSurfaceState,
        setSurfaceState,
    } = options;
    const eventPayload = { event: eventName, data, sender: sender ?? "" };
    const targets = collectBroadcastTargets({ document, blueprintDocument, surfaceId, eventName });

    for (const target of targets) {
        const executionId = newExecutionId();
        const execution = beginTrackedExecution({
            executionManager: options.executionManager,
            executionId,
            runtimeScopeId,
            blueprintId: target.blueprintId,
            eventId: eventName,
            allowClosedScopeExecution: options.allowClosedScopeExecution,
        });
        debug.emit({ type: "execution.started", executionId, blueprintId: target.blueprintId });
        const blueprintLocals = acquireBlueprintExecutionLocals({
            blueprintDocument,
            currentBlueprintId: target.blueprintId,
            surfaceId,
            runtimeScopeId,
            elementId: target.elementId,
        });
        try {
            for (const headId of target.headIds) {
                const graph = adaptBlueprintGraphIr(
                    target.ir,
                    `broadcastEvent:${target.blueprintId}:${target.eventGraph.id}`,
                );
                const startNode = graph.nodes[headId];
                if (!startNode || !isBlueprintEventDispatchHeadType(startNode.type)) {
                    continue;
                }
                await executeGraph({
                    graph,
                    entry: { start: { nodeId: headId, port: "then" as const } },
                    hostAdapter,
                    blueprintLocals,
                    eventPayload,
                    executionOwner: { surfaceId, elementId: target.elementId, blueprintId: target.blueprintId },
                    persistentVariables: blueprintDocument.persistentVariables,
                    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
                    signal: execution?.signal,
                    trace: {
                        executionId,
                        graphId: graph.id,
                        blueprintId: target.blueprintId,
                        eventId: eventName,
                        emit: e => debug.emit(e),
                    },
                });
            }
            debug.emit({ type: "execution.finished", executionId, blueprintId: target.blueprintId });
        } catch (err) {
            if (isBlueprintGraphExecutionCancelledError(err)) {
                emitExecutionCancelled({
                    debug,
                    executionId,
                    blueprintId: target.blueprintId,
                    eventId: eventName,
                    nodeId: err.nodeId,
                    reason: err.message,
                });
                continue;
            }
            if (err instanceof BlueprintGraphExecutionError) {
                debug.emit({
                    type: "execution.error",
                    executionId,
                    message: err.message,
                    blueprintId: target.blueprintId,
                    eventId: eventName,
                    nodeId: err.nodeId,
                });
                continue;
            }
            const message = err instanceof Error ? err.message : String(err);
            debug.emit({ type: "execution.error", executionId, message, blueprintId: target.blueprintId, eventId: eventName });
        } finally {
            execution?.finish();
        }
    }
}

// ---------------------------------------------------------------------------
// Surface lifecycle dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a lifecycle event into the surfaceMain blueprint for a given surface.
 * Used for events like "surfaceInit" that fire when a page is entered.
 */
export async function dispatchSurfaceBlueprintEvent(options: {
    blueprintDocument: BlueprintDocument;
    surfaceId: string;
    runtimeScopeId?: string;
    eventName: string;
    eventPayload?: Record<string, unknown>;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
} & CancellableDispatchOptions): Promise<void> {
    const {
        blueprintDocument,
        surfaceId,
        runtimeScopeId,
        eventName,
        eventPayload,
        hostAdapter,
        debug,
        getSurfaceState,
        setSurfaceState,
    } = options;

    const ownerKey = surfaceMainOwnerKey(surfaceId);
    const ownerRecord = blueprintDocument.ownerRecords[ownerKey];
    const blueprintId = ownerRecord?.activeBlueprintId;
    if (!blueprintId) {
        return;
    }
    const bp = blueprintDocument.blueprints[blueprintId];
    if (!bp) {
        return;
    }

    if (bp.program.kind === "scriptModule") {
        const mod = getMountedBlueprintModule(blueprintId);
        const fn = mod?.events?.[eventName];
        if (typeof fn !== "function") {
            return;
        }
        const executionId = newExecutionId();
        const execution = beginTrackedExecution({
            executionManager: options.executionManager,
            executionId,
            runtimeScopeId,
            blueprintId,
            eventId: eventName,
            allowClosedScopeExecution: options.allowClosedScopeExecution,
        });
        debug.emit({ type: "execution.started", executionId, blueprintId });
        const ctx = createScriptExecutionContext({
            hostApi: hostAdapter.blueprintRuntime?.hostApi,
            debug,
            getSurfaceState,
            setSurfaceState,
            eventPayload: eventPayload ?? {},
            signal: execution?.signal,
        });
        try {
            throwIfBlueprintExecutionCancelled(execution?.signal);
            await Promise.resolve(fn(ctx));
            throwIfBlueprintExecutionCancelled(execution?.signal);
            debug.emit({ type: "execution.finished", executionId, blueprintId });
        } catch (err) {
            if (isBlueprintGraphExecutionCancelledError(err)) {
                emitExecutionCancelled({
                    debug,
                    executionId,
                    blueprintId,
                    eventId: eventName,
                    reason: err.message,
                });
                return;
            }
            const message = err instanceof Error ? err.message : String(err);
            debug.emit({ type: "execution.error", executionId, message, blueprintId, eventId: eventName });
        } finally {
            execution?.finish();
        }
        return;
    }

    if (bp.program.kind !== "graph") {
        return;
    }

    const candidateGraphs = Object.values(bp.program.graphs.events ?? {});
    const matchingGraphs = candidateGraphs
        .map(eventGraph => {
            const ir = eventGraph.graph;
            const headIds = collectSurfaceEventHeadNodeIdsForDispatch(ir?.nodes, eventName, eventPayload);
            return headIds.length > 0 ? { eventGraph, ir, headIds } : null;
        })
        .filter(
            (
                entry,
            ): entry is {
                eventGraph: NonNullable<(typeof candidateGraphs)[number]>;
                ir: NonNullable<(typeof candidateGraphs)[number]["graph"]>;
                headIds: string[];
            } => Boolean(entry),
        );

    if (matchingGraphs.length === 0) {
        return;
    }

    const executionId = newExecutionId();
    const execution = beginTrackedExecution({
        executionManager: options.executionManager,
        executionId,
        runtimeScopeId,
        blueprintId,
        eventId: eventName,
        allowClosedScopeExecution: options.allowClosedScopeExecution,
    });
    debug.emit({ type: "execution.started", executionId, blueprintId });
    const blueprintLocals = acquireBlueprintExecutionLocals({
        blueprintDocument,
        currentBlueprintId: blueprintId,
        surfaceId,
        runtimeScopeId,
    });

    try {
        for (const { eventGraph, ir, headIds } of matchingGraphs) {
            const graph = adaptBlueprintGraphIr(ir, `surfaceEvent:${blueprintId}:${eventGraph.id}`);
            for (const headId of headIds) {
                const entry = { start: { nodeId: headId, port: "then" as const } };
                const startNode = graph.nodes[headId];
                if (!startNode || !isBlueprintEventDispatchHeadType(startNode.type)) {
                    continue;
                }
                await executeGraph({
                    graph,
                    entry,
                    hostAdapter,
                    blueprintLocals,
                    eventPayload: eventPayload ?? {},
                    executionOwner: { surfaceId, blueprintId },
                    persistentVariables: blueprintDocument.persistentVariables,
                    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
                    signal: execution?.signal,
                    trace: {
                        executionId,
                        graphId: graph.id,
                        blueprintId,
                        eventId: eventName,
                        emit: e => debug.emit(e),
                    },
                });
            }
        }
        debug.emit({ type: "execution.finished", executionId, blueprintId });
    } catch (err) {
        if (isBlueprintGraphExecutionCancelledError(err)) {
            emitExecutionCancelled({
                debug,
                executionId,
                blueprintId,
                eventId: eventName,
                nodeId: err.nodeId,
                reason: err.message,
            });
            return;
        }
        if (err instanceof BlueprintGraphExecutionError) {
            debug.emit({
                type: "execution.error",
                executionId,
                message: err.message,
                blueprintId,
                eventId: eventName,
                nodeId: err.nodeId,
            });
            return;
        }
        const message = err instanceof Error ? err.message : String(err);
        debug.emit({ type: "execution.error", executionId, message, blueprintId, eventId: eventName });
    } finally {
        execution?.finish();
    }
}

// ---------------------------------------------------------------------------
// Global lifecycle dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a lifecycle event into the globalMain blueprint.
 * Used for the "appBoot" event that fires once on application start.
 */
export async function dispatchGlobalBlueprintEvent(options: {
    blueprintDocument: BlueprintDocument;
    eventName: string;
    eventPayload?: Record<string, unknown>;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
} & CancellableDispatchOptions): Promise<void> {
    const { blueprintDocument, eventName, eventPayload, hostAdapter, debug, getSurfaceState, setSurfaceState } = options;

    const ownerRecord = blueprintDocument.ownerRecords[GLOBAL_MAIN_OWNER_KEY];
    const blueprintId = ownerRecord?.activeBlueprintId;
    if (!blueprintId) {
        return;
    }
    const bp = blueprintDocument.blueprints[blueprintId];
    if (!bp) {
        return;
    }

    if (bp.program.kind === "scriptModule") {
        const mod = getMountedBlueprintModule(blueprintId);
        const fn = mod?.events?.[eventName];
        if (typeof fn !== "function") {
            return;
        }
        const executionId = newExecutionId();
        const execution = beginTrackedExecution({
            executionManager: options.executionManager,
            executionId,
            blueprintId,
            eventId: eventName,
            allowClosedScopeExecution: options.allowClosedScopeExecution,
        });
        debug.emit({ type: "execution.started", executionId, blueprintId });
        const ctx = createScriptExecutionContext({
            hostApi: hostAdapter.blueprintRuntime?.hostApi,
            debug,
            getSurfaceState,
            setSurfaceState,
            eventPayload: eventPayload ?? {},
            signal: execution?.signal,
        });
        try {
            throwIfBlueprintExecutionCancelled(execution?.signal);
            await Promise.resolve(fn(ctx));
            throwIfBlueprintExecutionCancelled(execution?.signal);
            debug.emit({ type: "execution.finished", executionId, blueprintId });
        } catch (err) {
            if (isBlueprintGraphExecutionCancelledError(err)) {
                emitExecutionCancelled({
                    debug,
                    executionId,
                    blueprintId,
                    eventId: eventName,
                    reason: err.message,
                });
                return;
            }
            const message = err instanceof Error ? err.message : String(err);
            debug.emit({ type: "execution.error", executionId, message, blueprintId, eventId: eventName });
        } finally {
            execution?.finish();
        }
        return;
    }

    if (bp.program.kind !== "graph") {
        return;
    }

    const candidateGraphs = Object.values(bp.program.graphs.events ?? {});
    const matchingGraphs = candidateGraphs
        .map(eventGraph => {
            const ir = eventGraph.graph;
            const headIds = collectGlobalEventHeadNodeIdsForDispatch(ir?.nodes, eventName, eventPayload);
            return headIds.length > 0 ? { eventGraph, ir, headIds } : null;
        })
        .filter(
            (
                entry,
            ): entry is {
                eventGraph: NonNullable<(typeof candidateGraphs)[number]>;
                ir: NonNullable<(typeof candidateGraphs)[number]["graph"]>;
                headIds: string[];
            } => Boolean(entry),
        );

    if (matchingGraphs.length === 0) {
        return;
    }

    const executionId = newExecutionId();
    const execution = beginTrackedExecution({
        executionManager: options.executionManager,
        executionId,
        blueprintId,
        eventId: eventName,
        allowClosedScopeExecution: options.allowClosedScopeExecution,
    });
    debug.emit({ type: "execution.started", executionId, blueprintId });
    const blueprintLocals = acquireBlueprintExecutionLocals({
        blueprintDocument,
        currentBlueprintId: blueprintId,
    });

    try {
        for (const { eventGraph, ir, headIds } of matchingGraphs) {
            const graph = adaptBlueprintGraphIr(ir, `globalEvent:${blueprintId}:${eventGraph.id}`);
            for (const headId of headIds) {
                const entry = { start: { nodeId: headId, port: "then" as const } };
                const startNode = graph.nodes[headId];
                if (!startNode || !isBlueprintEventDispatchHeadType(startNode.type)) {
                    continue;
                }
                await executeGraph({
                    graph,
                    entry,
                    hostAdapter,
                    blueprintLocals,
                    eventPayload: eventPayload ?? {},
                    executionOwner: { blueprintId },
                    persistentVariables: blueprintDocument.persistentVariables,
                    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
                    signal: execution?.signal,
                    trace: {
                        executionId,
                        graphId: graph.id,
                        blueprintId,
                        eventId: eventName,
                        emit: e => debug.emit(e),
                    },
                });
            }
        }
        debug.emit({ type: "execution.finished", executionId, blueprintId });
    } catch (err) {
        if (isBlueprintGraphExecutionCancelledError(err)) {
            emitExecutionCancelled({
                debug,
                executionId,
                blueprintId,
                eventId: eventName,
                nodeId: err.nodeId,
                reason: err.message,
            });
            return;
        }
        if (err instanceof BlueprintGraphExecutionError) {
            debug.emit({
                type: "execution.error",
                executionId,
                message: err.message,
                blueprintId,
                eventId: eventName,
                nodeId: err.nodeId,
            });
            return;
        }
        const message = err instanceof Error ? err.message : String(err);
        debug.emit({ type: "execution.error", executionId, message, blueprintId, eventId: eventName });
    } finally {
        execution?.finish();
    }
}
