import type { Blueprint, BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
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
): BlueprintGraphEditorDiagnostic[] {
    const bp = doc.blueprints[blueprintId];
    if (!bp || bp.program.kind !== "graph") {
        return [];
    }
    const out: BlueprintGraphEditorDiagnostic[] = [];
    for (const [eventId, eg] of Object.entries(bp.program.graphs.events ?? {})) {
        out.push(...validateBlueprintGraphIr(ensureIr(eg.graph), { blueprintId, graphKind: "event", graphId: eventId }));
    }
    for (const [fnId, fg] of Object.entries(bp.program.graphs.functions ?? {})) {
        out.push(...validateBlueprintGraphIr(ensureIr(fg.graph), { blueprintId, graphKind: "function", graphId: fnId }));
    }
    out.push(...validateBlueprintBindingsForBlueprint(doc, blueprintId));
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
