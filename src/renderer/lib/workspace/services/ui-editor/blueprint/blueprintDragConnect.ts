/**
 * Pure helpers for the "drag off a pin onto empty canvas → create a compatible node
 * and wire it up" interaction. Kept free of React/DOM so the compatibility logic is
 * unit-testable and shares a single source of truth with connection validation.
 * Comments in English per project convention.
 */

import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/blueprint-nodes/types";
import {
    isValidBlueprintPinConnection,
    resolveBlueprintNodeEditorCatalogEntryForNode,
} from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import {
    withInferredBlueprintVariableValueTypeParam,
    type BlueprintGraphVariableTypeInferenceContext,
} from "./graphVariableTypeInference";

/**
 * Which of the three independent drag-to-create toggles a dragged pin is gated by.
 * The distinction is (handle direction × exec/data) collapsed to the settings the user sees:
 * output+exec, output+data, and any input.
 */
export type BlueprintDragConnectKind = "execOutput" | "dataOutput" | "input";

/** Per-kind enablement, mirroring the three settings switches. */
export type BlueprintDragConnectEnablement = Record<BlueprintDragConnectKind, boolean>;

/** Global-state keys backing the three drag-to-create toggles (see appSettings.ts). */
export const BLUEPRINT_DRAG_CONNECT_SETTING_KEYS: Record<BlueprintDragConnectKind, string> = {
    execOutput: "blueprint.dragConnect.execOutput",
    dataOutput: "blueprint.dragConnect.dataOutput",
    input: "blueprint.dragConnect.input",
};

/** Resolved description of the pin a drag started from. */
export type BlueprintDragConnectSource = {
    nodeId: string;
    /** The pin (handle) id the drag started from. */
    handleId: string;
    /** React Flow handle type: "source" = output pin, "target" = input pin. */
    handleType: "source" | "target";
    nodeType: string;
    /** Node params with variable value types inferred (matches connection validation). */
    params: Record<string, unknown> | undefined;
    /** True when the source pin carries execution flow rather than data. */
    isExec: boolean;
    /** Data value type of the source pin, when known (for the menu chip only). */
    valueType?: string;
    kind: BlueprintDragConnectKind;
};

/**
 * Resolve the dragged pin into a source descriptor, or null when it cannot be resolved
 * (node or pin gone). Variable Get/Set pins get their concrete value type inferred so a
 * data drag from e.g. a string variable only matches string-accepting inputs.
 */
export function resolveBlueprintDragConnectSource(
    ir: BlueprintGraphIr,
    nodeId: string | null | undefined,
    handleId: string | null | undefined,
    handleType: "source" | "target" | null | undefined,
    variableTypeContext?: BlueprintGraphVariableTypeInferenceContext,
): BlueprintDragConnectSource | null {
    if (!nodeId || !handleId || !handleType) {
        return null;
    }
    const node = ir.nodes?.[nodeId];
    if (!node) {
        return null;
    }
    const params = withInferredBlueprintVariableValueTypeParam(node.type, node.params, variableTypeContext);
    const entry = resolveBlueprintNodeEditorCatalogEntryForNode(node.type, params);
    const wantKind = handleType === "source" ? "output" : "input";
    const pin = entry.pins.find(candidate => candidate.id === handleId && candidate.kind === wantKind);
    if (!pin) {
        return null;
    }
    const isExec = pin.semantic === "exec";
    const kind: BlueprintDragConnectKind =
        handleType === "target" ? "input" : isExec ? "execOutput" : "dataOutput";
    return {
        nodeId,
        handleId,
        handleType,
        nodeType: node.type,
        params,
        isExec,
        valueType: pin.valueType,
        kind,
    };
}

/**
 * Pick the pin on a freshly created `entry` node that the source pin should wire to,
 * or null when the entry cannot accept this connection. Semantic (exec/data) and data
 * value-type compatibility are enforced by {@link isValidBlueprintPinConnection}; we only
 * pick the opposite direction here and return the first pin that passes. Candidate nodes
 * are evaluated with empty params, matching the palette's declared pins.
 */
export function pickBlueprintDragConnectTargetPin(
    source: BlueprintDragConnectSource,
    entry: BlueprintNodeEditorCatalogEntry,
): string | null {
    const wantKind = source.handleType === "source" ? "input" : "output";
    for (const pin of entry.pins) {
        if (pin.kind !== wantKind) {
            continue;
        }
        const ok =
            source.handleType === "source"
                ? isValidBlueprintPinConnection({
                      sourceType: source.nodeType,
                      sourcePort: source.handleId,
                      targetType: entry.type,
                      targetPort: pin.id,
                      sourceParams: source.params,
                      targetParams: {},
                  })
                : isValidBlueprintPinConnection({
                      sourceType: entry.type,
                      sourcePort: pin.id,
                      targetType: source.nodeType,
                      targetPort: source.handleId,
                      sourceParams: {},
                      targetParams: source.params,
                  });
        if (ok) {
            return pin.id;
        }
    }
    return null;
}

/** Whether an entry can accept a connection from `source` (menu filter predicate). */
export function isBlueprintDragConnectCompatible(
    source: BlueprintDragConnectSource,
    entry: BlueprintNodeEditorCatalogEntry,
): boolean {
    return pickBlueprintDragConnectTargetPin(source, entry) !== null;
}
