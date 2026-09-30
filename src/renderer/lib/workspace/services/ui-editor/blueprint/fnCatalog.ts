/**
 * Fn catalog: derive callable fn declarations by scanning blueprint event graphs
 * for Fn head nodes. Single source of truth for the Call Fn dropdown, validation,
 * and the runtime dispatcher. Fn identity is the head node id.
 * Comments in English per project convention.
 */

import type {
    Blueprint,
    BlueprintDocument,
    BlueprintGraphIr,
    BlueprintOwnerRef,
} from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import {
    BLUEPRINT_NODE_PARAM_FN_NAME,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_IDS,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_LABELS,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_TYPES,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_IDS,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_LABELS,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_TYPES,
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FN_RETURN,
    readBlueprintFnSignatureSnapshot,
} from "@shared/types/blueprint/graph";
import type { BlueprintFnSignatureSnapshot } from "@shared/types/blueprint/graph";
import { blueprintScope } from "@shared/blueprint/ownerShape";
import {
    readDynamicInputPinIds,
    readDynamicInputPinLabels,
    readDynamicInputPinValueTypes,
} from "@/lib/ui-editor/blueprint-nodes/effectivePins";
// Resolve pins through the low-level registry (not the workspace catalog service) so this
// module stays importable from the runtime bundle. See build-runtime.js allowedExact.
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import type { BlueprintInspectorParamSelectOption } from "@/lib/ui-editor/blueprint-nodes/types";
import { ownerRefToIndexKey } from "./ownerKeys";

export const BLUEPRINT_FN_DEFAULT_NAME = "Fn";
/** Fallback matches the fn head dynamicInputPins template valueType. */
export const BLUEPRINT_FN_DEFAULT_PIN_VALUE_TYPE = "string";

export type BlueprintFnPinDecl = {
    pinId: string;
    name: string;
    valueType: string;
};

export type BlueprintFnDeclaration = {
    fnRef: string;
    blueprintId: string;
    owner: BlueprintOwnerRef;
    graphId: string;
    headNodeId: string;
    name: string;
    params: BlueprintFnPinDecl[];
    returns: BlueprintFnPinDecl[];
    /** Graph IR containing the head node; used by the runtime dispatcher to execute the body. */
    ir: BlueprintGraphIr;
};

// ---------------------------------------------------------------------------
// fnRef encoding (mirrors createExplicitBlueprintVariableRef)
// ---------------------------------------------------------------------------

const BLUEPRINT_FN_REF_PREFIX = "fn:";

function encodePart(value: string): string {
    return encodeURIComponent(value);
}

function decodePart(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export function createBlueprintFnRef(blueprintId: string, headNodeId: string): string {
    return `${BLUEPRINT_FN_REF_PREFIX}${encodePart(blueprintId)}:${encodePart(headNodeId)}`;
}

export function parseBlueprintFnRef(raw: unknown): { blueprintId: string; headNodeId: string } | null {
    const value = String(raw ?? "").trim();
    if (!value.startsWith(BLUEPRINT_FN_REF_PREFIX)) {
        return null;
    }
    const rest = value.slice(BLUEPRINT_FN_REF_PREFIX.length);
    const splitAt = rest.indexOf(":");
    if (splitAt <= 0 || splitAt >= rest.length - 1) {
        return null;
    }
    return {
        blueprintId: decodePart(rest.slice(0, splitAt)),
        headNodeId: decodePart(rest.slice(splitAt + 1)),
    };
}

// ---------------------------------------------------------------------------
// Declaration scanning
// ---------------------------------------------------------------------------

/**
 * Owners whose blueprint may declare a Fn.
 *
 * A Fn is factoring inside one blueprint - `findBlueprintFnByRef` resolves it by the blueprint id
 * baked into the ref, and calls never cross a blueprint - so the list is about which owners write
 * graphs big enough to want it rather than about anything a Fn can reach. `componentWidgetMain` is
 * on it for that reason: a definition's graph runs once per instance, which makes it the *most*
 * likely place for one chain to be needed from three call sites.
 */
const FN_DECL_OWNER_KINDS: ReadonlySet<BlueprintOwnerRef["kind"]> = new Set([
    "globalMain",
    "surfaceMain",
    "widgetMain",
    "componentWidgetMain",
    "storyAction",
]);

function readPinDecls(
    params: Record<string, unknown> | undefined,
    idsKey: string,
    labelsKey: string,
    typesKey: string,
): BlueprintFnPinDecl[] {
    const ids = readDynamicInputPinIds(params, idsKey);
    const labels = readDynamicInputPinLabels(params, labelsKey);
    const valueTypes = readDynamicInputPinValueTypes(params, typesKey);
    return ids.map(pinId => ({
        pinId,
        name: labels[pinId] ?? pinId,
        valueType: valueTypes[pinId] ?? BLUEPRINT_FN_DEFAULT_PIN_VALUE_TYPE,
    }));
}

/** Exec-flow reachability from an entry node, following exec output ports only. */
export function collectExecReachableNodeIds(ir: BlueprintGraphIr, entryNodeId: string): Set<string> {
    const nodes = ir.nodes ?? {};
    const edges = ir.edges ?? [];
    const reached = new Set<string>();
    const queue: string[] = [entryNodeId];
    while (queue.length > 0) {
        const nodeId = queue.pop() as string;
        if (reached.has(nodeId)) {
            continue;
        }
        reached.add(nodeId);
        const node = nodes[nodeId];
        if (!node) {
            continue;
        }
        let execOutputPortIds: Set<string>;
        try {
            registerCoreBlueprintNodes();
            const entry = blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, node.params);
            execOutputPortIds = new Set(
                entry.pins.filter(p => p.kind === "output" && p.semantic === "exec").map(p => p.id),
            );
        } catch {
            continue;
        }
        for (const edge of edges) {
            if (edge.from.nodeId === nodeId && execOutputPortIds.has(edge.from.port) && !reached.has(edge.to.nodeId)) {
                queue.push(edge.to.nodeId);
            }
        }
    }
    return reached;
}

/** Return pin declarations on a single Fn Return node (validation compares these across returns). */
export function readBlueprintFnReturnPinDecls(
    params: Record<string, unknown> | undefined,
): BlueprintFnPinDecl[] {
    return readPinDecls(
        params,
        BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_IDS,
        BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_LABELS,
        BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_TYPES,
    );
}

/**
 * Return pins declared by the first (sorted by node id) Fn Return node exec-reachable
 * from the head. Validation reports conflicts between multiple Return nodes separately.
 */
export function resolveBlueprintFnReturnDecls(ir: BlueprintGraphIr, headNodeId: string): BlueprintFnPinDecl[] {
    const nodes = ir.nodes ?? {};
    const reachable = collectExecReachableNodeIds(ir, headNodeId);
    const returnNodeIds = Object.keys(nodes)
        .filter(nodeId => nodes[nodeId]?.type === BLUEPRINT_NODE_TYPE_FN_RETURN && reachable.has(nodeId))
        .sort();
    const firstReturn = returnNodeIds.length > 0 ? nodes[returnNodeIds[0]] : undefined;
    if (!firstReturn) {
        return [];
    }
    return readPinDecls(
        firstReturn.params,
        BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_IDS,
        BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_LABELS,
        BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_TYPES,
    );
}

/**
 * Signature snapshot straight from a graph IR (no document access).
 * Used by the editor to keep same-graph Call Fn snapshots in sync on every commit.
 */
export function buildBlueprintFnSignatureSnapshotFromIr(
    ir: BlueprintGraphIr,
    headNodeId: string,
): BlueprintFnSignatureSnapshot | null {
    const headNode = ir.nodes?.[headNodeId];
    if (!headNode || headNode.type !== BLUEPRINT_NODE_TYPE_FN_HEAD) {
        return null;
    }
    const rawName = headNode.params?.[BLUEPRINT_NODE_PARAM_FN_NAME];
    return {
        name: typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim() : BLUEPRINT_FN_DEFAULT_NAME,
        params: readPinDecls(
            headNode.params,
            BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_IDS,
            BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_LABELS,
            BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_TYPES,
        ),
        returns: resolveBlueprintFnReturnDecls(ir, headNodeId),
    };
}

function buildFnDeclaration(input: {
    blueprintId: string;
    owner: BlueprintOwnerRef;
    graphId: string;
    headNodeId: string;
    ir: BlueprintGraphIr;
}): BlueprintFnDeclaration {
    const snapshot = buildBlueprintFnSignatureSnapshotFromIr(input.ir, input.headNodeId);
    return {
        fnRef: createBlueprintFnRef(input.blueprintId, input.headNodeId),
        blueprintId: input.blueprintId,
        owner: input.owner,
        graphId: input.graphId,
        headNodeId: input.headNodeId,
        name: snapshot?.name ?? BLUEPRINT_FN_DEFAULT_NAME,
        params: snapshot?.params ?? [],
        returns: snapshot?.returns ?? [],
        ir: input.ir,
    };
}

function isActiveBlueprintForOwner(doc: BlueprintDocument, bp: Blueprint): boolean {
    return doc.ownerRecords[ownerRefToIndexKey(bp.owner)]?.blueprintId === bp.id;
}

function collectBlueprintFnsFromBlueprint(bp: Blueprint): BlueprintFnDeclaration[] {
    const out: BlueprintFnDeclaration[] = [];
    for (const eventGraph of Object.values(bp.graphs.events ?? {})) {
        const ir = eventGraph.graph;
        if (!ir?.nodes) {
            continue;
        }
        for (const [nodeId, node] of Object.entries(ir.nodes)) {
            if (node.type !== BLUEPRINT_NODE_TYPE_FN_HEAD) {
                continue;
            }
            out.push(
                buildFnDeclaration({
                    blueprintId: bp.id,
                    owner: bp.owner,
                    graphId: eventGraph.id,
                    headNodeId: nodeId,
                    ir,
                }),
            );
        }
    }
    return out;
}

/** All fn declarations in the document (active graph blueprints of eligible owners). */
export function collectDeclaredBlueprintFns(doc: BlueprintDocument): BlueprintFnDeclaration[] {
    const out: BlueprintFnDeclaration[] = [];
    for (const bp of Object.values(doc.blueprints)) {
        if (!FN_DECL_OWNER_KINDS.has(bp.owner.kind) || !isActiveBlueprintForOwner(doc, bp)) {
            continue;
        }
        out.push(...collectBlueprintFnsFromBlueprint(bp));
    }
    return out;
}

/** Resolve one declaration by fnRef without scanning the whole document. */
export function findBlueprintFnByRef(doc: BlueprintDocument, fnRef: unknown): BlueprintFnDeclaration | null {
    const parsed = parseBlueprintFnRef(fnRef);
    if (!parsed) {
        return null;
    }
    const bp = doc.blueprints[parsed.blueprintId];
    if (!bp || !FN_DECL_OWNER_KINDS.has(bp.owner.kind) || !isActiveBlueprintForOwner(doc, bp)) {
        return null;
    }
    for (const eventGraph of Object.values(bp.graphs.events ?? {})) {
        const node = eventGraph.graph?.nodes?.[parsed.headNodeId];
        if (node?.type === BLUEPRINT_NODE_TYPE_FN_HEAD && eventGraph.graph) {
            return buildFnDeclaration({
                blueprintId: bp.id,
                owner: bp.owner,
                graphId: eventGraph.id,
                headNodeId: parsed.headNodeId,
                ir: eventGraph.graph,
            });
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * Scoping matrix, asked through {@link blueprintScope} because that is the question:
 * - project decls (globalMain): visible to every caller. A global helper that some owners cannot
 *   reach is a helper an author has to copy, which is the thing a global one exists to stop. Spelled
 *   as one `true` rather than as a list of every caller kind - the list was one nobody knew was a
 *   list, and a new owner would have been silently written out of the global pool.
 * - surface decls (surfaceMain / widgetMain): visible only to callers on the same surface. A widget's
 *   value binding is on that surface too, and calls with the identity of its host widget.
 * - component decls (componentWidgetMain): visible only inside the same component definition. A
 *   definition is instantiated wherever somebody places it, so "the same surface" is not a question
 *   that can be asked about it; the definition itself is the boundary, and it is the right one - a
 *   graph that runs once per instance is exactly where one chain gets wanted from three call sites.
 * - story decls: the editor catalog shows all story-action fns to story-action callers. Scene-scoped
 *   visibility is enforced at runtime by the story compiler's fn catalog, which is the only place
 *   that knows which scene is running.
 */
export function isBlueprintFnVisibleToOwner(
    declOwner: BlueprintOwnerRef,
    caller: BlueprintOwnerRef,
): boolean {
    const decl = blueprintScope(declOwner);
    const from = blueprintScope(caller);
    switch (decl.kind) {
        case "project":
            return true;
        case "surface":
            return from.kind === "surface" && from.surfaceId === decl.surfaceId;
        case "component":
            return from.kind === "component" && from.componentId === decl.componentId;
        case "story":
            return from.kind === "story";
        default: {
            const unscoped: never = decl;
            return unscoped;
        }
    }
}

export function listCallableBlueprintFns(
    doc: BlueprintDocument,
    caller: BlueprintOwnerRef,
): BlueprintFnDeclaration[] {
    return collectDeclaredBlueprintFns(doc).filter(decl => isBlueprintFnVisibleToOwner(decl.owner, caller));
}

// ---------------------------------------------------------------------------
// Call sites
// ---------------------------------------------------------------------------

/**
 * One `Call Fn` node: where it sits, what it names, and the word its card prints.
 *
 * `name` is the signature snapshot's, which is the only handle on the target that survives the
 * target's disappearance - the ref itself is a pair of ids. It is absent on a call stored before
 * snapshots existed, or one written by hand.
 */
export type BlueprintFnCallSite = {
    nodeId: string;
    fnRef: string;
    name?: string;
};

/**
 * Every `Call Fn` in a graph that names a function.
 *
 * A call with no ref set is skipped: it is an unfinished node rather than a broken one - visible in
 * the editor as an empty select, and reported there in those words. Whoever asks this for broken
 * targets would otherwise have to filter it out again, and one of the two would eventually forget.
 */
export function listBlueprintFnCallSites(ir: BlueprintGraphIr): BlueprintFnCallSite[] {
    const sites: BlueprintFnCallSite[] = [];
    for (const node of Object.values(ir.nodes ?? {})) {
        if (node.type !== BLUEPRINT_NODE_TYPE_FN_CALL) {
            continue;
        }
        const fnRef = String(node.params?.[BLUEPRINT_NODE_PARAM_FN_REF] ?? "").trim();
        if (!fnRef) {
            continue;
        }
        sites.push({ nodeId: node.id, fnRef, name: readBlueprintFnSignatureSnapshot(node.params)?.name });
    }
    return sites;
}

/**
 * Whether one `Call Fn` reaches a function, and which one. `null` is the whole of "this call is
 * broken".
 *
 * The single answer to that question in the project, and it has to be: it is asked from the graph
 * editor's validator, which draws `fn.call_target_not_found` on the canvas, and from the
 * `blueprint/fn-target-missing` lint rule, which is what makes a build refuse one. Two
 * implementations would be a panel and a report contradicting each other about the same node.
 *
 * Both halves are load-bearing. A call can name a head that is simply gone - a deleted function, or
 * a fragment pasted from another project, where the blueprint id is one that project minted - and
 * it can name a head that exists but is out of reach: fn visibility is decided by the *calling*
 * blueprint's owner, so one ref resolves from one surface and not from another. A `caller` of
 * `undefined` asks only the first half, for a graph validated with no owner in hand.
 */
export function resolveBlueprintFnCallTarget(
    doc: BlueprintDocument,
    fnRef: unknown,
    caller: BlueprintOwnerRef | undefined,
): BlueprintFnDeclaration | null {
    const decl = findBlueprintFnByRef(doc, fnRef);
    if (!decl) {
        return null;
    }
    return !caller || isBlueprintFnVisibleToOwner(decl.owner, caller) ? decl : null;
}

// ---------------------------------------------------------------------------
// Signature snapshot (cached on Call Fn nodes)
// ---------------------------------------------------------------------------

export function buildBlueprintFnSignatureSnapshot(decl: BlueprintFnDeclaration): BlueprintFnSignatureSnapshot {
    return {
        name: decl.name,
        params: decl.params.map(p => ({ pinId: p.pinId, name: p.name, valueType: p.valueType })),
        returns: decl.returns.map(r => ({ pinId: r.pinId, name: r.name, valueType: r.valueType })),
    };
}

function pinListsEqual(a: readonly BlueprintFnPinDecl[], b: readonly BlueprintFnPinDecl[]): boolean {
    return (
        a.length === b.length &&
        a.every(
            (pin, i) => pin.pinId === b[i].pinId && pin.name === b[i].name && pin.valueType === b[i].valueType,
        )
    );
}

export function isBlueprintFnSnapshotStale(
    snapshot: BlueprintFnSignatureSnapshot | undefined,
    decl: BlueprintFnDeclaration,
): boolean {
    if (!snapshot) {
        return true;
    }
    return (
        snapshot.name !== decl.name ||
        !pinListsEqual(snapshot.params, decl.params) ||
        !pinListsEqual(snapshot.returns, decl.returns)
    );
}

// ---------------------------------------------------------------------------
// Dropdown options
// ---------------------------------------------------------------------------

function fnScopeLabel(owner: BlueprintOwnerRef, uiDocument: UIDocument | undefined): string {
    switch (owner.kind) {
        case "globalMain":
            return "Global";
        case "surfaceMain": {
            const surface = uiDocument?.surfaces.find(s => s.id === owner.surfaceId);
            return surface?.name?.trim() || "Surface";
        }
        case "widgetMain": {
            const element = uiDocument?.elements[owner.elementId];
            return element?.name?.trim() || element?.type || "Widget";
        }
        default:
            return owner.kind;
    }
}

/** Options for the Call Fn "callableFns" dynamic select source. */
export function listCallableBlueprintFnOptions(input: {
    blueprintDocument: BlueprintDocument;
    uiDocument?: UIDocument;
    caller: BlueprintOwnerRef;
}): BlueprintInspectorParamSelectOption[] {
    return listCallableBlueprintFns(input.blueprintDocument, input.caller)
        .map(decl => ({
            value: decl.fnRef,
            label: `${decl.name} (${fnScopeLabel(decl.owner, input.uiDocument)})`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}
