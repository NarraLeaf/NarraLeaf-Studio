import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { executeGraph } from "@/lib/ui-editor/behavior-graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { adaptBlueprintGraphIr } from "./adaptBlueprintGraphIr";
import type { DebugBridge } from "./DebugBridge";
import { pickBehaviorGraphEntry } from "./pickBehaviorGraphEntry";

const DEFAULT_MAX_STEPS = 512;

/**
 * Dispatch a UI element behavior event into a blueprint event graph (M3-min).
 */
export async function dispatchBlueprintUiEvent(options: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    surfaceId: string;
    elementId: string;
    eventName: string;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    maxSteps?: number;
}): Promise<void> {
    const { document, blueprintDocument, elementId, eventName, hostAdapter, debug } = options;
    const el = document.elements[elementId];
    const binding = el?.behavior?.events?.[eventName];
    if (!binding || binding.kind !== "blueprintEvent") {
        return;
    }

    const bp = blueprintDocument.blueprints[binding.blueprintId];
    if (!bp || bp.program.kind !== "graph") {
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

    const executionId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
