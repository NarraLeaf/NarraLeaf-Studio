import type { BlueprintDocument } from "@shared/types/blueprint/document";
import {
    collectBlueprintEventHeadNodeIdsForDispatch,
    collectSurfaceEventHeadNodeIdsForDispatch,
    collectGlobalEventHeadNodeIdsForDispatch,
    isBlueprintEventDispatchHeadType,
} from "@shared/types/blueprint/graph";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { getWidgetLogicEvent, getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { executeGraph } from "@/lib/ui-editor/behavior-graph";
import { BlueprintGraphExecutionError } from "@/lib/ui-editor/behavior-graph/GraphExecutionError";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { BlueprintHostApiRuntime } from "./BlueprintHostApiBridge";
import { adaptBlueprintGraphIr } from "./adaptBlueprintGraphIr";
import { acquireBlueprintWidgetLocals } from "./blueprintWidgetLocals";
import type { DebugBridge } from "./DebugBridge";
import { truncateDebugEventMessage } from "./DebugBridge";
import {
    widgetMainOwnerKey,
    surfaceMainOwnerKey,
    GLOBAL_MAIN_OWNER_KEY,
} from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";

const DEFAULT_MAX_STEPS = 512;

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
}): Record<string, unknown> {
    const api = input.hostApi;
    if (api) {
        return {
            host: {
                navigation: api.navigation,
                widget: api.widget,
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
    elementId: string;
    eventName: string;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
}): Promise<void> {
    const {
        document,
        blueprintDocument,
        surfaceId,
        elementId,
        eventName,
        hostAdapter,
        debug,
        getSurfaceState,
        setSurfaceState,
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
        debug.emit({ type: "execution.started", executionId, blueprintId });
        const ctx = createScriptExecutionContext({
            hostApi: hostAdapter.blueprintRuntime?.hostApi,
            debug,
            getSurfaceState,
            setSurfaceState,
        });
        try {
            await Promise.resolve(fn(ctx));
            debug.emit({ type: "execution.finished", executionId, blueprintId });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            debug.emit({
                type: "execution.error",
                executionId,
                message,
                blueprintId,
                eventId: eventName,
            });
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
            const headIds = collectBlueprintEventHeadNodeIdsForDispatch(ir?.nodes, eventName, widgetElementType);
            return headIds.length > 0 ? { eventGraph, ir, headIds } : null;
        })
        .filter((entry): entry is { eventGraph: NonNullable<typeof candidateGraphs[number]>; ir: NonNullable<typeof candidateGraphs[number]["graph"]>; headIds: string[] } => Boolean(entry));

    if (matchingGraphs.length === 0) {
        return;
    }
    const executionId = newExecutionId();
    debug.emit({ type: "execution.started", executionId, blueprintId });

    const blueprintLocals = acquireBlueprintWidgetLocals(surfaceId, elementId, blueprintId, bp);

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
                    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
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
    eventName: string;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
}): Promise<void> {
    const { blueprintDocument, surfaceId, eventName, hostAdapter, debug, getSurfaceState, setSurfaceState } = options;

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
        debug.emit({ type: "execution.started", executionId, blueprintId });
        const ctx = createScriptExecutionContext({
            hostApi: hostAdapter.blueprintRuntime?.hostApi,
            debug,
            getSurfaceState,
            setSurfaceState,
        });
        try {
            await Promise.resolve(fn(ctx));
            debug.emit({ type: "execution.finished", executionId, blueprintId });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            debug.emit({ type: "execution.error", executionId, message, blueprintId, eventId: eventName });
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
            const headIds = collectSurfaceEventHeadNodeIdsForDispatch(ir?.nodes, eventName);
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
    debug.emit({ type: "execution.started", executionId, blueprintId });

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
                    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
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
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
}): Promise<void> {
    const { blueprintDocument, eventName, hostAdapter, debug, getSurfaceState, setSurfaceState } = options;

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
        debug.emit({ type: "execution.started", executionId, blueprintId });
        const ctx = createScriptExecutionContext({
            hostApi: hostAdapter.blueprintRuntime?.hostApi,
            debug,
            getSurfaceState,
            setSurfaceState,
        });
        try {
            await Promise.resolve(fn(ctx));
            debug.emit({ type: "execution.finished", executionId, blueprintId });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            debug.emit({ type: "execution.error", executionId, message, blueprintId, eventId: eventName });
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
            const headIds = collectGlobalEventHeadNodeIdsForDispatch(ir?.nodes, eventName);
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
    debug.emit({ type: "execution.started", executionId, blueprintId });

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
                    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
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
    }
}
