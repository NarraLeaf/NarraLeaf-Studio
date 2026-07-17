import type {
    Blueprint,
    BlueprintDocument,
    BlueprintGraphEdge,
    BlueprintGraphIr,
    BlueprintOwnerRef,
} from "@shared/types/blueprint/document";
import { isStorySyncValueOwner } from "@shared/types/blueprint/document";
import { listWidgetLogicEventIds } from "@shared/types/ui-editor/widgetLogic";
import { translate } from "@/lib/i18n";
import {
    BLUEPRINT_NODE_PARAM_FN_NAME,
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FN_RETURN,
    BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
    isBlueprintEventDispatchHeadType,
    isStoryActionCallHeadType,
    readBlueprintFnSignatureSnapshot,
} from "@shared/types/blueprint/graph";
import {
    collectDeclaredBlueprintFns,
    collectExecReachableNodeIds,
    findBlueprintFnByRef,
    isBlueprintFnSnapshotStale,
    isBlueprintFnVisibleToOwner,
    readBlueprintFnReturnPinDecls,
    type BlueprintFnDeclaration,
} from "./fnCatalog";
import { listUiSlotsWiredToBlueprintLayer } from "@/lib/ui-editor/blueprint-runtime/widgetBlueprintLayerSlots";
import type { UIElement } from "@shared/types/ui-editor/document";
import { pickBehaviorGraphEntry } from "@/lib/ui-editor/blueprint-runtime/pickBehaviorGraphEntry";
import { adaptBlueprintGraphIr } from "@/lib/ui-editor/blueprint-runtime/adaptBlueprintGraphIr";
import { behaviorNodeRegistry } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import { buildAccessibleBlueprintVariableOptions, createExplicitBlueprintVariableRef } from "./blueprintVariableRefs";
import {
    withInferredBlueprintVariableValueTypeParam,
    type BlueprintVariableTypeOption,
} from "./graphVariableTypeInference";
import { isBlueprintFanOutOutputPin } from "./graphEditing";
import {
    isValidBlueprintExecConnection,
    resolveBlueprintNodeEditorCatalogEntryForNode,
} from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { isBlueprintNodeAllowedInGraphContext } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import type {
    BlueprintNodeDef,
    BlueprintPaletteContext,
    BlueprintWidgetEventCapabilityRef,
} from "@/lib/ui-editor/blueprint-nodes/types";
import { BlueprintNodeCatalogService } from "../BlueprintNodeCatalogService";

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
    /** Runtime widget event catalog used to validate scoped event-head nodes. */
    widgetBlueprintEvents?: readonly BlueprintWidgetEventCapabilityRef[];
    /** Component definition graphs use Element references scoped to the component editor surface. */
    isComponentDefinitionGraph?: boolean;
};

type BlueprintEventHook = {
    slotName: string;
    binding: { kind: "blueprintEvent"; blueprintId: string; eventId: string };
};

function reportDuplicatePinConnection(
    out: BlueprintGraphEditorDiagnostic[],
    seenPins: Map<string, BlueprintGraphEdge>,
    input: {
        key: string;
        nodeId: string;
        port: string;
        direction: "input" | "output";
        graphKind: "event" | "function";
        graphId: string;
        edge: BlueprintGraphEdge;
    },
): void {
    if (seenPins.has(input.key)) {
        out.push({
            severity: "error",
            code: "edge.pin_multiple",
            message: translate(
                input.direction === "input"
                    ? "blueprint.diagnostics.graph.pinMultipleInput"
                    : "blueprint.diagnostics.graph.pinMultipleOutput",
                { node: input.nodeId, port: input.port },
            ),
            target: {
                kind: "node",
                graphKind: input.graphKind,
                graphId: input.graphId,
                nodeId: input.nodeId,
            },
        });
        return;
    }
    seenPins.set(input.key, input.edge);
}

function isExecInputEdge(
    nodes: NonNullable<BlueprintGraphIr["nodes"]>,
    edge: BlueprintGraphEdge,
): boolean {
    const toNode = nodes[edge.to.nodeId];
    if (!toNode) {
        return false;
    }
    const entry = resolveBlueprintNodeEditorCatalogEntryForNode(toNode.type, toNode.params);
    return entry.pins.some(pin => pin.id === edge.to.port && pin.kind === "input" && pin.semantic === "exec");
}

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
 * Owners whose "On Call" graph produces a value via a Return Value node: widget value bindings and
 * synchronous story blueprints (inline value interpolations + control-flow conditions).
 */
function isBlueprintValueGraphOwner(owner: BlueprintOwnerRef | undefined): boolean {
    if (!owner) {
        return false;
    }
    if (owner.kind === "widgetValue") {
        return true;
    }
    return owner.kind === "storyAction" && (owner.mode === "value" || owner.mode === "condition");
}

/** True for a story condition blueprint whose Return Value must be typed boolean. */
function isStoryConditionOwner(owner: BlueprintOwnerRef | undefined): boolean {
    return owner?.kind === "storyAction" && owner.mode === "condition";
}

function buildNodeValidationPaletteContext(ctx: {
    graphKind: "event" | "function";
    blueprintOwner?: BlueprintOwnerRef;
    widgetElementType?: string;
    widgetBlueprintEvents?: readonly BlueprintWidgetEventCapabilityRef[];
    layerUiSlots?: string[];
    isBlueprintValueGraph?: boolean;
    isComponentDefinitionGraph?: boolean;
}): BlueprintPaletteContext | null {
    if (!ctx.blueprintOwner) {
        return null;
    }
    return {
        graphKind: ctx.graphKind,
        owner: ctx.blueprintOwner,
        widgetElementType: ctx.widgetElementType,
        widgetBlueprintEvents: ctx.widgetBlueprintEvents,
        widgetEventLayerSlots: ctx.layerUiSlots,
        isBlueprintValueGraph: ctx.isBlueprintValueGraph ?? isBlueprintValueGraphOwner(ctx.blueprintOwner),
        isSyncOnlyGraph: isStorySyncValueOwner(ctx.blueprintOwner),
        isComponentDefinitionGraph: ctx.isComponentDefinitionGraph,
        hasEventHead: false,
        hasFunctionEntry: false,
    };
}

function describeNodeContextError(def: BlueprintNodeDef, ctx: BlueprintPaletteContext): string {
    const valueGraphHint =
        def.role === "valueReturn"
            ? translate("blueprint.diagnostics.node.contextValueReturnHint")
            : "";
    return translate("blueprint.diagnostics.node.contextInvalid", {
        name: def.displayName,
        ownerKind: ctx.owner.kind,
        graphKind: ctx.graphKind,
        hint: valueGraphHint,
    });
}

function fnPinDeclSignature(decls: ReturnType<typeof readBlueprintFnReturnPinDecls>): string {
    return decls.map(d => `${d.pinId}\0${d.name}\0${d.valueType}`).join("\x1e");
}

/** fnRefs participating in a cycle of the document-wide fn call graph (fnRef transitively calls itself). */
function collectRecursiveFnRefs(decls: readonly BlueprintFnDeclaration[]): ReadonlySet<string> {
    const calleesByFnRef = new Map<string, string[]>();
    for (const decl of decls) {
        const reachable = collectExecReachableNodeIds(decl.ir, decl.headNodeId);
        const callees: string[] = [];
        for (const [nodeId, node] of Object.entries(decl.ir.nodes ?? {})) {
            if (node.type !== BLUEPRINT_NODE_TYPE_FN_CALL || !reachable.has(nodeId)) {
                continue;
            }
            const ref = node.params?.[BLUEPRINT_NODE_PARAM_FN_REF];
            if (typeof ref === "string" && ref.trim().length > 0) {
                callees.push(ref.trim());
            }
        }
        calleesByFnRef.set(decl.fnRef, callees);
    }
    const recursive = new Set<string>();
    for (const start of calleesByFnRef.keys()) {
        const stack = [...(calleesByFnRef.get(start) ?? [])];
        const visited = new Set<string>();
        while (stack.length > 0) {
            const current = stack.pop() as string;
            if (current === start) {
                recursive.add(start);
                break;
            }
            if (visited.has(current)) {
                continue;
            }
            visited.add(current);
            stack.push(...(calleesByFnRef.get(current) ?? []));
        }
    }
    return recursive;
}

/**
 * Fn node rules: head naming, Return ownership/consistency, Call target resolution
 * (incl. the paste-into-another-surface case), snapshot staleness, and static recursion.
 */
function validateBlueprintFnRules(
    ir: BlueprintGraphIr,
    ctx: {
        blueprintId: string;
        graphKind: "event" | "function";
        graphId: string;
        blueprintOwner?: BlueprintOwnerRef;
        blueprintDocument?: BlueprintDocument;
    },
    out: BlueprintGraphEditorDiagnostic[],
): void {
    const doc = ctx.blueprintDocument;
    if (!doc || ctx.graphKind !== "event") {
        return;
    }
    const nodes = ir.nodes ?? {};
    const headEntries = Object.entries(nodes)
        .filter(([, n]) => n.type === BLUEPRINT_NODE_TYPE_FN_HEAD)
        .sort(([a], [b]) => a.localeCompare(b));
    const returnEntries = Object.entries(nodes)
        .filter(([, n]) => n.type === BLUEPRINT_NODE_TYPE_FN_RETURN)
        .sort(([a], [b]) => a.localeCompare(b));
    const callEntries = Object.entries(nodes)
        .filter(([, n]) => n.type === BLUEPRINT_NODE_TYPE_FN_CALL)
        .sort(([a], [b]) => a.localeCompare(b));
    if (headEntries.length === 0 && returnEntries.length === 0 && callEntries.length === 0) {
        return;
    }
    const nodeTarget = (nodeId: string): BlueprintGraphDiagnosticTarget => ({
        kind: "node",
        graphKind: ctx.graphKind,
        graphId: ctx.graphId,
        nodeId,
    });

    const allDecls = collectDeclaredBlueprintFns(doc);
    const visibleDecls = ctx.blueprintOwner
        ? allDecls.filter(decl => isBlueprintFnVisibleToOwner(decl.owner, ctx.blueprintOwner!))
        : allDecls;

    for (const [nodeId, node] of headEntries) {
        const name = String(node.params?.[BLUEPRINT_NODE_PARAM_FN_NAME] ?? "").trim();
        if (!name) {
            out.push({
                severity: "warning",
                code: "fn.name_missing",
                message: translate("blueprint.diagnostics.fn.nameMissing", { node: nodeId }),
                target: nodeTarget(nodeId),
            });
            continue;
        }
        const nameKey = name.toLowerCase();
        const hasDuplicate = visibleDecls.some(
            decl =>
                decl.name.trim().toLowerCase() === nameKey &&
                !(decl.blueprintId === ctx.blueprintId && decl.headNodeId === nodeId),
        );
        if (hasDuplicate) {
            out.push({
                severity: "warning",
                code: "fn.duplicate_name",
                message: translate("blueprint.diagnostics.fn.duplicateName", { name }),
                target: nodeTarget(nodeId),
            });
        }
    }

    if (returnEntries.length > 0) {
        const reachableByHead = new Map(
            headEntries.map(([headId]) => [headId, collectExecReachableNodeIds(ir, headId)] as const),
        );
        for (const [nodeId] of returnEntries) {
            const owners = headEntries.filter(([headId]) => reachableByHead.get(headId)?.has(nodeId));
            if (owners.length === 0) {
                out.push({
                    severity: "error",
                    code: "fn.return_orphan",
                    message: translate("blueprint.diagnostics.fn.returnOrphan"),
                    target: nodeTarget(nodeId),
                });
            } else if (owners.length > 1) {
                out.push({
                    severity: "error",
                    code: "fn.return_orphan",
                    message: translate("blueprint.diagnostics.fn.returnMultipleHeads"),
                    target: nodeTarget(nodeId),
                });
            }
        }
        for (const [headId] of headEntries) {
            const reachable = reachableByHead.get(headId);
            const owned = returnEntries.filter(([returnId]) => reachable?.has(returnId));
            if (owned.length < 2) {
                continue;
            }
            const authoritative = fnPinDeclSignature(readBlueprintFnReturnPinDecls(owned[0][1].params));
            for (const [returnId, returnNode] of owned.slice(1)) {
                if (fnPinDeclSignature(readBlueprintFnReturnPinDecls(returnNode.params)) !== authoritative) {
                    out.push({
                        severity: "error",
                        code: "fn.return_signature_conflict",
                        message: translate("blueprint.diagnostics.fn.returnSignatureConflict", { node: returnId }),
                        target: nodeTarget(returnId),
                    });
                }
            }
        }
    }

    const recursiveFnRefs = callEntries.length > 0 ? collectRecursiveFnRefs(allDecls) : new Set<string>();
    for (const [nodeId, node] of callEntries) {
        const fnRefRaw = node.params?.[BLUEPRINT_NODE_PARAM_FN_REF];
        const fnRef = typeof fnRefRaw === "string" ? fnRefRaw.trim() : "";
        if (!fnRef) {
            out.push({
                severity: "warning",
                code: "fn.call_unset",
                message: translate("blueprint.diagnostics.fn.callUnset", { node: nodeId }),
                target: nodeTarget(nodeId),
            });
            continue;
        }
        const decl = findBlueprintFnByRef(doc, fnRef);
        const visible = decl && (!ctx.blueprintOwner || isBlueprintFnVisibleToOwner(decl.owner, ctx.blueprintOwner));
        if (!decl || !visible) {
            const snapshotName = readBlueprintFnSignatureSnapshot(node.params)?.name;
            out.push({
                severity: "error",
                code: "fn.call_target_not_found",
                message: translate("blueprint.diagnostics.fn.callTargetNotFound", { name: snapshotName ?? fnRef }),
                target: nodeTarget(nodeId),
            });
            continue;
        }
        if (isBlueprintFnSnapshotStale(readBlueprintFnSignatureSnapshot(node.params), decl)) {
            out.push({
                severity: "warning",
                code: "fn.call_signature_stale",
                message: translate("blueprint.diagnostics.fn.callSignatureStale", { name: decl.name }),
                target: nodeTarget(nodeId),
            });
        }
        if (recursiveFnRefs.has(decl.fnRef)) {
            out.push({
                severity: "warning",
                code: "fn.recursive_call",
                message: translate("blueprint.diagnostics.fn.recursiveCall", { name: decl.name }),
                target: nodeTarget(nodeId),
            });
        }
    }
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
                message: translate("blueprint.diagnostics.widget.legacyHooksPresent"),
            });
        }
        return out;
    }

    for (const hook of legacyHooks) {
        if (hook.binding.blueprintId !== blueprintId) {
            out.push({
                severity: "warning",
                code: "blueprint.widget_legacy_hook_wrong_blueprint",
                message: translate("blueprint.diagnostics.widget.legacyHookWrongBlueprint", { slot: hook.slotName }),
            });
            continue;
        }
        if (!supportedEventIds.has(hook.slotName)) {
            out.push({
                severity: "warning",
                code: "blueprint.widget_legacy_hook_unsupported_slot",
                message: translate("blueprint.diagnostics.widget.legacyHookUnsupported", { slot: hook.slotName, type: element.type }),
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
        validPersistentVariableIds?: ReadonlySet<string>;
        variableValueTypes?: readonly BlueprintVariableTypeOption[];
        persistentVariableValueTypes?: readonly BlueprintVariableTypeOption[];
        /** Widget UI slots referencing this event layer (when known). */
        layerUiSlots?: string[];
        widgetElementType?: string;
        widgetBlueprintEvents?: readonly BlueprintWidgetEventCapabilityRef[];
        blueprintOwner?: BlueprintOwnerRef;
        isBlueprintValueGraph?: boolean;
        isComponentDefinitionGraph?: boolean;
        /** Whole document; enables cross-blueprint checks such as Fn call target resolution. */
        blueprintDocument?: BlueprintDocument;
    },
): BlueprintGraphEditorDiagnostic[] {
    const out: BlueprintGraphEditorDiagnostic[] = [];
    const nodes = ir.nodes ?? {};
    const edges = ir.edges ?? [];
    const nodeIds = new Set(Object.keys(nodes));
    const variableTypeContext = {
        memberVariables: ctx.variableValueTypes,
        persistentVariables: ctx.persistentVariableValueTypes,
    };

    if (Object.keys(nodes).length === 0) {
        out.push({
            severity: "info",
            code: "graph.empty",
            message: translate("blueprint.diagnostics.graph.noNodes"),
            target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
        });
        return out;
    }

    if (ctx.graphKind === "event") {
        // Fn heads are valid entry points too — a graph containing only fn declarations is fine.
        // Story Action "On Call" is a valid head as well (it is deliberately kept out of the event
        // dispatch head set, so it must be recognized explicitly here).
        const headNodes = Object.entries(nodes).filter(
            ([, n]) =>
                isBlueprintEventDispatchHeadType(n.type) ||
                isStoryActionCallHeadType(n.type) ||
                n.type === BLUEPRINT_NODE_TYPE_FN_HEAD,
        );
        if (headNodes.length === 0) {
            out.push({
                severity: "error",
                code: "event.missing_event_nodes",
                message: translate("blueprint.diagnostics.event.missingHead"),
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
                message: translate("blueprint.diagnostics.function.missingEntry"),
                target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
            });
        } else if (entries.length > 1) {
            out.push({
                severity: "error",
                code: "function.multiple_entries",
                message: translate("blueprint.diagnostics.function.multipleEntries"),
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
                        message: translate("blueprint.diagnostics.graph.entryMissingNode", { node: entry.start.nodeId }),
                        target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
                    });
                } else {
                    const start = nodes[entry.start.nodeId];
                    if (start && start.type !== BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY) {
                        out.push({
                            severity: "error",
                            code: "function.entry_not_entry_node",
                            message: translate("blueprint.diagnostics.function.entryNotEntryNode"),
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
                    message: translate("blueprint.diagnostics.graph.entryInvalid"),
                    target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
                });
            }
        }
    }

    const seenPins = new Map<string, BlueprintGraphEdge>();
    for (const edge of edges) {
        if (edge.from.nodeId === edge.to.nodeId) {
            out.push({
                severity: "error",
                code: "edge.self_connection",
                message: translate("blueprint.diagnostics.edge.selfConnection", { node: edge.from.nodeId }),
                target: { kind: "node", graphKind: ctx.graphKind, graphId: ctx.graphId, nodeId: edge.from.nodeId },
            });
        }
        if (!nodeIds.has(edge.from.nodeId)) {
            out.push({
                severity: "error",
                code: "edge.from_unknown",
                message: translate("blueprint.diagnostics.edge.fromUnknown", { node: edge.from.nodeId }),
                target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
            });
        }
        if (!nodeIds.has(edge.to.nodeId)) {
            out.push({
                severity: "error",
                code: "edge.to_unknown",
                message: translate("blueprint.diagnostics.edge.toUnknown", { node: edge.to.nodeId }),
                target: { kind: "graph", graphKind: ctx.graphKind, graphId: ctx.graphId },
            });
        }
        const fromNode = nodes[edge.from.nodeId];
        const toNode = nodes[edge.to.nodeId];
        if (fromNode && toNode) {
            const sourceParams = withInferredBlueprintVariableValueTypeParam(
                fromNode.type,
                fromNode.params,
                variableTypeContext,
            );
            const targetParams = withInferredBlueprintVariableValueTypeParam(
                toNode.type,
                toNode.params,
                variableTypeContext,
            );
            const ok = resolveBlueprintNodeEditorCatalogEntryForNode(fromNode.type, sourceParams);
            const itk = resolveBlueprintNodeEditorCatalogEntryForNode(toNode.type, targetParams);
            const outPin = ok.pins.find(p => p.id === edge.from.port && p.kind === "output");
            const inPin = itk.pins.find(p => p.id === edge.to.port && p.kind === "input");
            if (!outPin || !inPin) {
                out.push({
                    severity: "warning",
                    code: "edge.port_mismatch",
                    message: translate("blueprint.diagnostics.edge.portMismatch", {
                        from: `${edge.from.nodeId}.${edge.from.port}`,
                        to: `${edge.to.nodeId}.${edge.to.port}`,
                    }),
                    target: { kind: "node", graphKind: ctx.graphKind, graphId: ctx.graphId, nodeId: edge.from.nodeId },
                });
            } else if (
                !isValidBlueprintExecConnection({
                    sourceType: fromNode.type,
                    sourcePort: edge.from.port,
                    targetType: toNode.type,
                    targetPort: edge.to.port,
                    sourceParams,
                    targetParams,
                })
            ) {
                const typeDetail =
                    outPin.semantic === "data" && inPin.semantic === "data" && outPin.valueType && inPin.valueType
                        ? translate("blueprint.diagnostics.edge.connectionTypeDetail", {
                              from: outPin.valueType,
                              to: inPin.valueType,
                          })
                        : "";
                out.push({
                    severity: "error",
                    code: "edge.connection_invalid",
                    message: translate("blueprint.diagnostics.edge.connectionInvalid", {
                        from: `${edge.from.nodeId}.${edge.from.port}`,
                        to: `${edge.to.nodeId}.${edge.to.port}`,
                        detail: typeDetail,
                    }),
                    target: { kind: "node", graphKind: ctx.graphKind, graphId: ctx.graphId, nodeId: edge.from.nodeId },
                });
            }
        }
        const fromNodeType = nodes[edge.from.nodeId]?.type ?? "";
        if (nodeIds.has(edge.from.nodeId) && !isBlueprintFanOutOutputPin(fromNodeType, edge.from.port)) {
            reportDuplicatePinConnection(out, seenPins, {
                key: `out\0${edge.from.nodeId}\0${edge.from.port}`,
                nodeId: edge.from.nodeId,
                port: edge.from.port,
                direction: "output",
                graphKind: ctx.graphKind,
                graphId: ctx.graphId,
                edge,
            });
        }
        if (nodeIds.has(edge.to.nodeId) && !isExecInputEdge(nodes, edge)) {
            reportDuplicatePinConnection(out, seenPins, {
                key: `in\0${edge.to.nodeId}\0${edge.to.port}`,
                nodeId: edge.to.nodeId,
                port: edge.to.port,
                direction: "input",
                graphKind: ctx.graphKind,
                graphId: ctx.graphId,
                edge,
            });
        }
    }

    const nodeValidationContext = buildNodeValidationPaletteContext(ctx);
    const nodeCatalog = BlueprintNodeCatalogService.getInstance();
    for (const [nid, n] of Object.entries(nodes)) {
        const def = nodeCatalog.get(n.type);
        const validationDef = def?.magicElementTarget ? { ...def, scope: undefined } : def;
        if (
            def &&
            validationDef &&
            nodeValidationContext &&
            !isBlueprintNodeAllowedInGraphContext(validationDef, nodeValidationContext)
        ) {
            out.push({
                severity: "error",
                code: "node.context_invalid",
                message: describeNodeContextError(def, nodeValidationContext),
                target: { kind: "node", graphKind: ctx.graphKind, graphId: ctx.graphId, nodeId: nid },
            });
        }
        if (!behaviorNodeRegistry.get(n.type)) {
            out.push({
                severity: "warning",
                code: "node.no_runtime",
                message: translate("blueprint.diagnostics.node.noRuntime", { node: nid, type: n.type }),
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
                    message: translate("blueprint.diagnostics.node.variableIdInvalid", { node: nid }),
                    target: { kind: "node", graphKind: ctx.graphKind, graphId: ctx.graphId, nodeId: nid },
                });
            }
        }
        if (
            (n.type === BLUEPRINT_NODE_TYPE_PERSISTENT_SET || n.type === BLUEPRINT_NODE_TYPE_PERSISTENT_GET) &&
            ctx.validPersistentVariableIds
        ) {
            const vid = String(n.params?.persistentVariableId ?? "").trim();
            if (!vid || !ctx.validPersistentVariableIds.has(vid)) {
                out.push({
                    severity: "warning",
                    code: "node.persistent_variable_id_invalid",
                    message: translate("blueprint.diagnostics.node.persistentVariableIdInvalid", { node: nid }),
                    target: { kind: "node", graphKind: ctx.graphKind, graphId: ctx.graphId, nodeId: nid },
                });
            }
        }
    }

    validateBlueprintFnRules(ir, ctx, out);

    if (ctx.graphKind === "event" && isStoryConditionOwner(ctx.blueprintOwner)) {
        validateStoryConditionReturnType(ir, ctx, out);
    }

    return out;
}

/**
 * Story condition blueprints (`storyAction` owner, `condition` mode) must feed a boolean into their
 * Return Value node. Any concretely-typed non-boolean source is a type error; an unwired Return Value
 * is a warning (nothing to evaluate). `any`/unknown source types are left alone — they coerce fine.
 */
function validateStoryConditionReturnType(
    ir: BlueprintGraphIr,
    ctx: {
        graphKind: "event" | "function";
        graphId: string;
        variableValueTypes?: readonly BlueprintVariableTypeOption[];
        persistentVariableValueTypes?: readonly BlueprintVariableTypeOption[];
    },
    out: BlueprintGraphEditorDiagnostic[],
): void {
    const nodes = ir.nodes ?? {};
    const edges = ir.edges ?? [];
    const variableTypeContext = {
        memberVariables: ctx.variableValueTypes,
        persistentVariables: ctx.persistentVariableValueTypes,
    };
    for (const [nodeId, node] of Object.entries(nodes)) {
        const entry = resolveBlueprintNodeEditorCatalogEntryForNode(node.type, node.params);
        if (entry.role !== "valueReturn") {
            continue;
        }
        const valueEdge = edges.find(edge => edge.to.nodeId === nodeId && edge.to.port === "value");
        if (!valueEdge) {
            out.push({
                severity: "warning",
                code: "condition.return_missing",
                message: translate("blueprint.diagnostics.condition.returnMissing"),
                target: { kind: "node", graphKind: ctx.graphKind, graphId: ctx.graphId, nodeId },
            });
            continue;
        }
        const sourceNode = nodes[valueEdge.from.nodeId];
        if (!sourceNode) {
            continue;
        }
        const sourceParams = withInferredBlueprintVariableValueTypeParam(
            sourceNode.type,
            sourceNode.params,
            variableTypeContext,
        );
        const sourceEntry = resolveBlueprintNodeEditorCatalogEntryForNode(sourceNode.type, sourceParams);
        const outPin = sourceEntry.pins.find(pin => pin.id === valueEdge.from.port && pin.kind === "output");
        const valueType = outPin?.valueType;
        if (valueType && valueType !== "boolean" && valueType !== "any") {
            out.push({
                severity: "error",
                code: "condition.return_not_boolean",
                message: translate("blueprint.diagnostics.condition.returnNotBoolean", { type: valueType }),
                target: { kind: "node", graphKind: ctx.graphKind, graphId: ctx.graphId, nodeId },
            });
        }
    }
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
            const detail = b.brokenReason?.trim() ? ` (${b.brokenReason})` : "";
            out.push({
                severity: "error",
                code: "binding.broken",
                message: translate("blueprint.diagnostics.binding.broken", { id: b.id, detail }),
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
                message: translate("blueprint.diagnostics.binding.missingField", { id: b.source.fieldId }),
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
    const accessibleVariables = buildAccessibleBlueprintVariableOptions({
        doc,
        currentBlueprintId: blueprintId,
        surfaceId: options?.widgetSurfaceId,
    });
    const variableValueTypes = accessibleVariables.map(option => ({
        value: option.value,
        valueType: option.valueType,
    }));
    const validVariableIds = buildValidVariableRefSetFromOptions(accessibleVariables);
    const validPersistentVariableIds = new Set(Object.keys(doc.persistentVariables ?? {}));
    const persistentVariableValueTypes = Object.values(doc.persistentVariables ?? {}).map(variable => ({
        value: variable.id,
        valueType: variable.valueType,
    }));
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
                validPersistentVariableIds,
                variableValueTypes,
                persistentVariableValueTypes,
                layerUiSlots,
                widgetElementType: options?.widgetElement?.type,
                widgetBlueprintEvents: options?.widgetBlueprintEvents,
                blueprintOwner: bp.owner,
                isBlueprintValueGraph: isBlueprintValueGraphOwner(bp.owner),
                isComponentDefinitionGraph: options?.isComponentDefinitionGraph,
                blueprintDocument: doc,
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
                validPersistentVariableIds,
                variableValueTypes,
                persistentVariableValueTypes,
                widgetElementType: options?.widgetElement?.type,
                widgetBlueprintEvents: options?.widgetBlueprintEvents,
                blueprintOwner: bp.owner,
                isBlueprintValueGraph: isBlueprintValueGraphOwner(bp.owner),
                isComponentDefinitionGraph: options?.isComponentDefinitionGraph,
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

function buildValidVariableRefSetFromOptions(
    options: ReturnType<typeof buildAccessibleBlueprintVariableOptions>,
): ReadonlySet<string> {
    const values = new Set<string>();
    for (const option of options) {
        values.add(option.value);
        values.add(createExplicitBlueprintVariableRef(option.blueprintId, option.variableId));
    }
    return values;
}

function ensureIr(ir: BlueprintGraphIr | undefined): BlueprintGraphIr {
    return {
        nodes: ir?.nodes ?? {},
        edges: ir?.edges ?? [],
        variables: ir?.variables,
        meta: ir?.meta,
    };
}
