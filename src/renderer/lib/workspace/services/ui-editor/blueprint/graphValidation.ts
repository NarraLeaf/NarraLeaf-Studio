import type { Blueprint, BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { listWidgetLogicEventIds } from "@shared/types/ui-editor/widgetLogic";
import {
    BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    isBlueprintEventDispatchHeadType,
} from "@shared/types/blueprint/graph";
import { listUiSlotsWiredToBlueprintLayer } from "@/lib/ui-editor/blueprint-runtime/widgetBlueprintLayerSlots";
import type { UIElement } from "@shared/types/ui-editor/document";
import { pickBehaviorGraphEntry } from "@/lib/ui-editor/blueprint-runtime/pickBehaviorGraphEntry";
import { adaptBlueprintGraphIr } from "@/lib/ui-editor/blueprint-runtime/adaptBlueprintGraphIr";
import { behaviorNodeRegistry } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import { resolveBlueprintNodeEditorCatalogEntryForNode } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";

export type BlueprintGraphDiagnosticTarget =
    | { kind: "graph"; graphKind: "event" | "function"; graphId: string }
    | { kind: "node"; graphKind: "event" | "function"; graphId: string; nodeId: string }
    | { kind: "binding"; bindingId: string }
    | { kind: "field"; fieldId: string };

export type BlueprintGraphEditorDiagnostic = {
    severity: "error" | "warning" | "info";
    message: string;
    code?: string;
    target?: BlueprintGraphDiagnosticTarget;
};

/** Optional UI document context when validating a widgetMain blueprint from the graph editor. */
export type ValidateBlueprintDocumentGraphsOptions = {
    widgetElement?: UIElement | null;
    /** Surface id for the widget; used with widgetElement to match blueprint owner. */
    widgetSurfaceId?: string;
};

type BlueprintEventHook = {
    slotName: string;
    binding: { kind: "blueprintEvent"; blueprintId: string; eventId: string };
};

function collectBlueprintEventHooks(element: UIElement): BlueprintEventHook[] {
    const events = element.behavior?.events;
    if (!events) {
        return [];
    }
    const out: BlueprintEventHook[] = [];
    for (const [slotName, b] of Object.entries(events)) {
        if (b?.kind === "blueprintEvent") {
            out.push({ slotName, binding: b });
        }
    }
    return out;
}

/** Cross-checks widget private blueprint compatibility and any legacy event hooks (Workspace-only). */
export function validateBlueprintWidgetMainEventWiring(
    doc: BlueprintDocument,
    blueprintId: string,
    ctx: { element: UIElement; surfaceId: string } | null | undefined,
): BlueprintGraphEditorDiagnostic[] {
    if (!ctx?.element) {
        return [];
    }
    const { element, surfaceId } = ctx;
    const bp: Blueprint | undefined = doc.blueprints[blueprintId];
    if (!bp || bp.owner.kind !== "widgetMain") {
        return [];
    }
    if (bp.owner.elementId !== element.id || bp.owner.surfaceId !== surfaceId) {
        return [];
    }

    const out: BlueprintGraphEditorDiagnostic[] = [];
    const legacyHooks = collectBlueprintEventHooks(element);
    const supportedEventIds = new Set(listWidgetLogicEventIds(element.type));

    if (bp.program.kind !== "graph") {
        if (legacyHooks.length > 0) {
            out.push({
                severity: "warning",
                code: "blueprint.widget_legacy_hooks_present",
                message:
                    "Legacy widget event hooks are still stored in uidoc. The active private revision is not a visual graph, so these hooks are compatibility-only.",
            });
        }
        return out;
    }

    for (const hook of legacyHooks) {
        if (hook.binding.blueprintId !== blueprintId) {
            out.push({
                severity: "warning",
                code: "blueprint.widget_legacy_hook_wrong_blueprint",
                message: `Legacy UI hook "${hook.slotName}" still points to blueprint "${hook.binding.blueprintId}" instead of the active private blueprint.`,
            });
            continue;
        }
        if (!supportedEventIds.has(hook.slotName)) {
            out.push({
                severity: "warning",
                code: "blueprint.widget_legacy_hook_unsupported_slot",
                message: `Legacy UI hook "${hook.slotName}" is not a supported widget event for ${element.type}.`,
            });
            continue;
        }
    }

    return out;
}

export function validateBlueprintGraphIr(
    ir: BlueprintGraphIr,
    ctx: {
        blueprintId: string;
        graphKind: "event" | "function";
        graphId: string;
        validVariableIds?: ReadonlySet<string>;
        /** Widget UI slots referencing this event layer (when known). */
        layerUiSlots?: string[];
        widgetElementType?: string;
    },
): BlueprintGraphEditorDiagnostic[] {
    const out: BlueprintGraphEditorDiagnostic[] = [];
    const nodes = ir.nodes ?? {};
    const edges = ir.edges ?? [];
    const nodeIds = new Set(Object.keys(nodes));

    if (Object.keys(nodes).length === 0) {
        out.push({
            severity: "info",
            code: "graph.empty",
            message: "Graph has no nodes yet.",
            target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
        });
        return out;
    }

    if (ctx.graphKind === "event") {
        const headNodes = Object.entries(nodes).filter(([, n]) => isBlueprintEventDispatchHeadType(n.type));
        if (headNodes.length === 0) {
            out.push({
                severity: "error",
                code: "event.missing_event_nodes",
                message:
                    "Add an event head (On widget initialize and/or On button click — right-click the canvas → Add node) so this layer can run.",
                target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
            });
        }
    }

    if (ctx.graphKind === "function") {
        const entries = Object.entries(nodes).filter(([, n]) => n.type === BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY);
        if (entries.length === 0) {
            out.push({
                severity: "error",
                code: "function.missing_entry",
                message: "Function graph must contain a Function entry node.",
                target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
            });
        } else if (entries.length > 1) {
            out.push({
                severity: "error",
                code: "function.multiple_entries",
                message: "Function graph has more than one Function entry node.",
                target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
            });
        }
    }

    if (ctx.graphKind === "function") {
        const fnEntryCount = Object.values(nodes).filter(n => n.type === BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY).length;
        if (fnEntryCount === 1) {
            try {
                const graph = adaptBlueprintGraphIr(ir, `validate:${ctx.blueprintId}:${ctx.graphId}`);
                const entry = pickBehaviorGraphEntry(graph);
                if (!nodeIds.has(entry.start.nodeId)) {
                    out.push({
                        severity: "error",
                        code: "graph.entry_missing_node",
                        message: `Entry points to missing node "${entry.start.nodeId}".`,
                        target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
                    });
                } else {
                    const start = nodes[entry.start.nodeId];
                    if (start && start.type !== BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY) {
                        out.push({
                            severity: "error",
                            code: "function.entry_not_entry_node",
                            message: "Function execution entry must be the Function entry node.",
                            target: {
                                kind: "node",
                                graphKind: ctx.graphKind,
                                graphId: ctx.graphId,
                                nodeId: entry.start.nodeId,
                            },
                        });
                    }
                }
            } catch {
                out.push({
                    severity: "error",
                    code: "graph.entry_invalid",
                    message: "Function graph entry resolution failed.",
                    target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
                });
            }
        }
    }

    for (const edge of edges) {
        if (!nodeIds.has(edge.from.nodeId)) {
            out.push({
                severity: "error",
                code: "edge.from_unknown",
                message: `Edge references missing source node "${edge.from.nodeId}".`,
                target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
            });
        }
        if (!nodeIds.has(edge.to.nodeId)) {
            out.push({
                severity: "error",
                code: "edge.to_unknown",
                message: `Edge references missing target node "${edge.to.nodeId}".`,
                target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
            });
        }
        const fromNode = nodes[edge.from.nodeId];
        const toNode = nodes[edge.to.nodeId];
        if (fromNode && toNode) {
            const ok = resolveBlueprintNodeEditorCatalogEntryForNode(fromNode.type, fromNode.params);
            const itk = resolveBlueprintNodeEditorCatalogEntryForNode(toNode.type, toNode.params);
            const hasOut = ok.pins.some(p => p.id === edge.from.port && p.kind === "output");
            const hasIn = itk.pins.some(p => p.id === edge.to.port && p.kind === "input");
            if (!hasOut || !hasIn) {
                out.push({
                    severity: "warning",
                    code: "edge.port_mismatch",
                    message: `Edge ${edge.from.nodeId}.${edge.from.port} → ${edge.to.nodeId}.${edge.to.port} may not match node pins.`,
                    target: { kind: "node", graphKind: ctx.graphKind, graphId: ctx.graphId, nodeId: edge.from.nodeId },
                });
            }
        }
    }

    for (const [nid, n] of Object.entries(nodes)) {
        if (!behaviorNodeRegistry.get(n.type)) {
            out.push({
                severity: "warning",
                code: "node.no_runtime",
                message: `Node "${nid}" type "${n.type}" has no runtime executor registered.`,
                target: { kind: "node", graphKind: ctx.graphKind, graphId: ctx.graphId, nodeId: nid },
            });
        }
        if (
            (n.type === BLUEPRINT_NODE_TYPE_LOCAL_SET || n.type === BLUEPRINT_NODE_TYPE_LOCAL_GET) &&
            ctx.validVariableIds
        ) {
            const vid = String(n.params?.variableId ?? "").trim();
            if (!vid || !ctx.validVariableIds.has(vid)) {
                out.push({
                    severity: "warning",
                    code: "node.variable_id_invalid",
                    message: `Node "${nid}" should select a valid execution local variable.`,
                    target: { kind: "node", graphKind: ctx.graphKind, graphId: ctx.graphId, nodeId: nid },
                });
            }
        }
    }

    return out;
}

export function validateBlueprintBindingsForBlueprint(doc: BlueprintDocument, blueprintId: string): BlueprintGraphEditorDiagnostic[] {
    const bp: Blueprint | undefined = doc.blueprints[blueprintId];
    if (!bp?.bindings) {
        return [];
    }
    const fields = bp.members?.fields ?? {};
    const out: BlueprintGraphEditorDiagnostic[] = [];
    for (const b of Object.values(bp.bindings)) {
        if (b.status === "broken") {
            const detail = b.brokenReason?.trim()
                ? ` (${b.brokenReason})`
                : " — fix or recreate the field, or clear the binding.";
            out.push({
                severity: "error",
                code: "binding.broken",
                message: `Binding "${b.id}" is marked broken${detail}`,
                target: { kind: "binding", bindingId: b.id },
            });
            continue;
        }
        if (b.source.kind !== "field") {
            continue;
        }
        if (b.source.blueprintId !== blueprintId) {
            continue;
        }
        if (!fields[b.source.fieldId]) {
            out.push({
                severity: "error",
                code: "binding.missing_field",
                message: `Binding targets missing field "${b.source.fieldId}".`,
                target: { kind: "field", fieldId: b.source.fieldId },
            });
        }
    }
    return out;
}

export function validateBlueprintDocumentGraphs(
    doc: BlueprintDocument,
    blueprintId: string,
    options?: ValidateBlueprintDocumentGraphsOptions,
): BlueprintGraphEditorDiagnostic[] {
    const bp = doc.blueprints[blueprintId];
    if (!bp || bp.program.kind !== "graph") {
        const base =
            bp && bp.program.kind !== "graph"
                ? validateBlueprintBindingsForBlueprint(doc, blueprintId)
                : [];
        const wiring =
            bp && options?.widgetElement && options.widgetSurfaceId
                ? validateBlueprintWidgetMainEventWiring(doc, blueprintId, {
                      element: options.widgetElement,
                      surfaceId: options.widgetSurfaceId,
                  })
                : [];
        return [...base, ...wiring];
    }
    const validVariableIds = new Set(Object.keys(bp.members?.variables ?? {}));
    const out: BlueprintGraphEditorDiagnostic[] = [];
    for (const [eventId, eg] of Object.entries(bp.program.graphs.events ?? {})) {
        const layerUiSlots =
            options?.widgetElement && options.widgetSurfaceId
                ? listUiSlotsWiredToBlueprintLayer(options.widgetElement, blueprintId, eventId)
                : undefined;
        out.push(
            ...validateBlueprintGraphIr(ensureIr(eg.graph), {
                blueprintId,
                graphKind: "event",
                graphId: eventId,
                validVariableIds,
                layerUiSlots,
                widgetElementType: options?.widgetElement?.type,
            }),
        );
    }
    for (const [fnId, fg] of Object.entries(bp.program.graphs.functions ?? {})) {
        out.push(
            ...validateBlueprintGraphIr(ensureIr(fg.graph), {
                blueprintId,
                graphKind: "function",
                graphId: fnId,
                validVariableIds,
            }),
        );
    }
    out.push(...validateBlueprintBindingsForBlueprint(doc, blueprintId));
    if (options?.widgetElement && options.widgetSurfaceId) {
        out.push(
            ...validateBlueprintWidgetMainEventWiring(doc, blueprintId, {
                element: options.widgetElement,
                surfaceId: options.widgetSurfaceId,
            }),
        );
    }
    return out;
}

function ensureIr(ir: BlueprintGraphIr | undefined): BlueprintGraphIr {
    return {
        nodes: ir?.nodes ?? {},
        edges: ir?.edges ?? [],
        variables: ir?.variables,
        meta: ir?.meta,
    };
}
