import type { Blueprint, BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD,
    BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
} from "@shared/types/blueprint/graph";
import type { UIElement } from "@shared/types/ui-editor/document";
import { pickBehaviorGraphEntry } from "@/lib/ui-editor/blueprint-runtime/pickBehaviorGraphEntry";
import { adaptBlueprintGraphIr } from "@/lib/ui-editor/blueprint-runtime/adaptBlueprintGraphIr";
import { behaviorNodeRegistry } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import { resolveBlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";

export type BlueprintGraphDiagnosticTarget =
    | { kind: "graph"; graphKind: "event" | "function"; graphId: string }
    | { kind: "node"; graphKind: "event" | "function"; graphId: string; nodeId: string }
    | { kind: "binding"; bindingId: string }
    | { kind: "declaration"; declarationId: string };

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

/**
 * Cross-checks widget UI `blueprintEvent` hooks against blueprint event graph slots (Workspace-only).
 */
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
    const hooks = collectBlueprintEventHooks(element);
    const uiHookCount = hooks.length;

    if (bp.program.kind !== "graph") {
        if (uiHookCount > 0) {
            out.push({
                severity: "error",
                code: "blueprint.ui_events_non_graph_program",
                message:
                    "Widget UI events are wired to this blueprint, but its program is not a visual graph — Dev Mode cannot run event graphs here.",
            });
        }
        return out;
    }

    const eventGraphs = bp.program.graphs.events ?? {};
    const eventGraphIds = Object.keys(eventGraphs);
    const eventGraphCount = eventGraphIds.length;

    if (eventGraphCount > 0 && uiHookCount === 0) {
        out.push({
            severity: "warning",
            code: "blueprint.event_graphs_not_wired_to_ui",
            message:
                "This blueprint has stored event graph slot(s), but no widget UI event is wired to them. Use Properties → Blueprint events to attach supported events so Dev Mode can dispatch.",
            target: { kind: "graph", graphKind: "event", graphId: eventGraphIds[0]! },
        });
    }

    if (uiHookCount > 0 && eventGraphCount === 0) {
        out.push({
            severity: "error",
            code: "blueprint.ui_events_without_graph_slots",
            message:
                "Widget UI events reference this blueprint, but it has no event graph slots — the UI document and blueprint may be out of sync.",
        });
    }

    for (const h of hooks) {
        if (h.binding.blueprintId !== blueprintId) {
            out.push({
                severity: "error",
                code: "blueprint.event_wiring_wrong_blueprint",
                message: `UI event "${h.slotName}" targets blueprint "${h.binding.blueprintId}" but the open editor is "${blueprintId}".`,
            });
            continue;
        }
        if (!eventGraphs[h.binding.eventId]) {
            out.push({
                severity: "error",
                code: "blueprint.event_wiring_missing_graph",
                message: `UI event "${h.slotName}" references missing event graph slot "${h.binding.eventId}".`,
                target: { kind: "graph", graphKind: "event", graphId: h.binding.eventId },
            });
        }
    }

    return out;
}

function entryKeys(ir: BlueprintGraphIr): string[] {
    return Object.keys(ir.entries ?? {});
}

export function validateBlueprintGraphIr(
    ir: BlueprintGraphIr,
    ctx: { blueprintId: string; graphKind: "event" | "function"; graphId: string },
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
        const headNodes = Object.entries(nodes).filter(([, n]) => n.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD);
        if (headNodes.length === 0) {
            out.push({
                severity: "error",
                code: "event.missing_head",
                message: "Event graph must contain exactly one Event head node.",
                target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
            });
        } else if (headNodes.length > 1) {
            out.push({
                severity: "error",
                code: "event.multiple_heads",
                message: "Event graph has more than one Event head — keep a single entry.",
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

    const keys = entryKeys(ir);
    if (keys.length === 0) {
        out.push({
            severity: "error",
            code: "graph.no_entry",
            message: "Event graph has no entry — add an entry or run may not start.",
            target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
        });
    } else {
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
            } else if (ctx.graphKind === "event") {
                const start = nodes[entry.start.nodeId];
                if (start && start.type !== BLUEPRINT_NODE_TYPE_EVENT_HEAD) {
                    out.push({
                        severity: "error",
                        code: "event.entry_not_head",
                        message: "entries.main must point to the Event head node so runtime dispatch is unambiguous.",
                        target: { kind: "node", graphKind: ctx.graphKind, graphId: ctx.graphId, nodeId: entry.start.nodeId },
                    });
                }
            } else if (ctx.graphKind === "function") {
                const start = nodes[entry.start.nodeId];
                if (start && start.type !== BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY) {
                    out.push({
                        severity: "error",
                        code: "function.entry_not_entry_node",
                        message: "entries.main must point to the Function entry node.",
                        target: { kind: "node", graphKind: ctx.graphKind, graphId: ctx.graphId, nodeId: entry.start.nodeId },
                    });
                }
            }
        } catch {
            out.push({
                severity: "error",
                code: "graph.entry_invalid",
                message: "Graph entry configuration is invalid.",
                target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
            });
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
            const ok = resolveBlueprintNodeEditorCatalogEntry(fromNode.type);
            const itk = resolveBlueprintNodeEditorCatalogEntry(toNode.type);
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
        if (n.type === "blueprint.state.set") {
            const key = String(n.params?.key ?? "").trim();
            if (!key) {
                out.push({
                    severity: "warning",
                    code: "node.params.key_required",
                    message: `Node "${nid}" (Set surface state) should set parameter "key".`,
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
    const decls = bp.members?.declarations ?? {};
    const out: BlueprintGraphEditorDiagnostic[] = [];
    for (const b of Object.values(bp.bindings)) {
        if (b.status === "broken") {
            const detail = b.brokenReason?.trim()
                ? ` (${b.brokenReason})`
                : " — fix or recreate the declaration, or clear the binding.";
            out.push({
                severity: "error",
                code: "binding.broken",
                message: `Binding "${b.id}" is marked broken${detail}`,
                target: { kind: "binding", bindingId: b.id },
            });
            continue;
        }
        if (b.source.kind !== "declaration") {
            continue;
        }
        if (b.source.blueprintId !== blueprintId) {
            continue;
        }
        if (!decls[b.source.declarationId]) {
            out.push({
                severity: "error",
                code: "binding.missing_declaration",
                message: `Binding targets missing declaration "${b.source.declarationId}".`,
                target: { kind: "declaration", declarationId: b.source.declarationId },
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
    const out: BlueprintGraphEditorDiagnostic[] = [];
    for (const [eventId, eg] of Object.entries(bp.program.graphs.events ?? {})) {
        out.push(...validateBlueprintGraphIr(ensureIr(eg.graph), { blueprintId, graphKind: "event", graphId: eventId }));
    }
    for (const [fnId, fg] of Object.entries(bp.program.graphs.functions ?? {})) {
        out.push(...validateBlueprintGraphIr(ensureIr(fg.graph), { blueprintId, graphKind: "function", graphId: fnId }));
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
        entries: ir?.entries ?? {},
        nodes: ir?.nodes ?? {},
        edges: ir?.edges ?? [],
        variables: ir?.variables,
        meta: ir?.meta,
    };
}
