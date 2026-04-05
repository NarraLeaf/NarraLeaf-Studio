import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { executeGraph } from "@/lib/ui-editor/behavior-graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
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
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
}): Record<string, unknown> {
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
            debug,
            getSurfaceState,
            setSurfaceState,
        });
        try {
            await Promise.resolve(fn(ctx));
            debug.emit({ type: "execution.finished", executionId, blueprintId: binding.blueprintId });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            debug.emit({ type: "execution.error", executionId, message });
        }
        return;
    }

    if (bp.program.kind !== "graph") {
        return;
    }

    const eventGraph = bp.program.graphs.events?.[binding.eventId];
    const ir = eventGraph?.graph;
    if (!ir || !ir.nodes || Object.keys(ir.nodes).length === 0) {
        return;
    }

    const graph = adaptBlueprintGraphIr(ir, `blueprintEvent:${binding.blueprintId}:${binding.eventId}`);
    let entry;
    try {
        entry = pickBehaviorGraphEntry(graph);
    } catch {
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
        });
        debug.emit({ type: "execution.finished", executionId, blueprintId: binding.blueprintId });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        debug.emit({ type: "execution.error", executionId, message });
    }
}
