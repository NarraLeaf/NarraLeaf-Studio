import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_EVENT_HEAD } from "@shared/types/blueprint/graph";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { executeGraph } from "@/lib/ui-editor/behavior-graph";
import { BlueprintGraphExecutionError } from "@/lib/ui-editor/behavior-graph/GraphExecutionError";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { BlueprintHostApiRuntime } from "./BlueprintHostApiBridge";
import { adaptBlueprintGraphIr } from "./adaptBlueprintGraphIr";
import type { DebugBridge } from "./DebugBridge";
import { pickBehaviorGraphEntry } from "./pickBehaviorGraphEntry";

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
                media: api.media,
                devtools: {
                    log: (msg: string) => {
                        api.devtools.log("info", String(msg));
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
                    console.info(`[Blueprint] ${msg}`);
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
        elementId,
        eventName,
        hostAdapter,
        debug,
        getSurfaceState,
        setSurfaceState,
    } = options;
    const el = document.elements[elementId];
    const binding = el?.behavior?.events?.[eventName];
    if (!binding || binding.kind !== "blueprintEvent") {
        return;
    }

    const bp = blueprintDocument.blueprints[binding.blueprintId];
    if (!bp) {
        return;
    }

    if (bp.program.kind === "scriptModule") {
        const mod = getMountedBlueprintModule(binding.blueprintId);
        const fn = mod?.events?.[binding.eventId];
        if (typeof fn !== "function") {
            return;
        }
        const executionId = newExecutionId();
        debug.emit({ type: "execution.started", executionId, blueprintId: binding.blueprintId });
        const ctx = createScriptExecutionContext({
            hostApi: hostAdapter.blueprintRuntime?.hostApi,
            debug,
            getSurfaceState,
            setSurfaceState,
        });
        try {
            await Promise.resolve(fn(ctx));
            debug.emit({ type: "execution.finished", executionId, blueprintId: binding.blueprintId });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            debug.emit({
                type: "execution.error",
                executionId,
                message,
                blueprintId: binding.blueprintId,
                eventId: binding.eventId,
            });
        }
        return;
    }

    if (bp.program.kind !== "graph") {
        return;
    }

    const eventGraph = bp.program.graphs.events?.[binding.eventId];
    const ir = eventGraph?.graph;
    if (!ir || !ir.nodes || Object.keys(ir.nodes).length === 0) {
        debug.emit({
            type: "execution.error",
            executionId: newExecutionId(),
            message: "Event graph is empty or missing — add an Event node and chain logic from it.",
            blueprintId: binding.blueprintId,
            eventId: binding.eventId,
        });
        return;
    }

    const graph = adaptBlueprintGraphIr(ir, `blueprintEvent:${binding.blueprintId}:${binding.eventId}`);
    let entry;
    try {
        entry = pickBehaviorGraphEntry(graph);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        debug.emit({
            type: "execution.error",
            executionId: newExecutionId(),
            message: `Invalid graph entry: ${message}`,
            blueprintId: binding.blueprintId,
            eventId: binding.eventId,
            graphId: graph.id,
        });
        return;
    }

    const startNode = graph.nodes[entry.start.nodeId];
    if (!startNode || startNode.type !== BLUEPRINT_NODE_TYPE_EVENT_HEAD) {
        debug.emit({
            type: "execution.error",
            executionId: newExecutionId(),
            message: `Event graph must start from an "${BLUEPRINT_NODE_TYPE_EVENT_HEAD}" node (fix entries.main in the blueprint editor).`,
            blueprintId: binding.blueprintId,
            eventId: binding.eventId,
            graphId: graph.id,
            nodeId: entry.start.nodeId,
        });
        return;
    }

    const executionId = newExecutionId();

    debug.emit({ type: "execution.started", executionId, blueprintId: binding.blueprintId });
    try {
        await executeGraph({
            graph,
            entry,
            hostAdapter,
            maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
            trace: {
                executionId,
                graphId: graph.id,
                blueprintId: binding.blueprintId,
                eventId: binding.eventId,
                emit: e => debug.emit(e),
            },
        });
        debug.emit({ type: "execution.finished", executionId, blueprintId: binding.blueprintId });
    } catch (err) {
        if (err instanceof BlueprintGraphExecutionError) {
            debug.emit({
                type: "execution.error",
                executionId,
                message: err.message,
                blueprintId: binding.blueprintId,
                eventId: binding.eventId,
                graphId: graph.id,
                nodeId: err.nodeId,
            });
            return;
        }
        const message = err instanceof Error ? err.message : String(err);
        debug.emit({
            type: "execution.error",
            executionId,
            message,
            blueprintId: binding.blueprintId,
            eventId: binding.eventId,
            graphId: graph.id,
        });
    }
}
