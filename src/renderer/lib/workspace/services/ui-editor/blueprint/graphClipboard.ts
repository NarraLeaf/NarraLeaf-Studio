import type { AssetTransferManifestEntry } from "@shared/types/assetTransfer";
import type { BlueprintGraphEdge, BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
} from "@shared/types/blueprint/graph";
import { createBlueprintFnRef, parseBlueprintFnRef } from "./fnCatalog";
import { readNodeEditorLayout, writeNodeEditorLayout } from "./graphEditing";

export const BLUEPRINT_GRAPH_CLIPBOARD_VERSION = 1 as const;

/**
 * What a payload calls itself.
 *
 * A graph fragment now travels on the system clipboard, so one can arrive written by another
 * project's window - or by another Studio of another version. The private format name says the
 * bytes are Studio's; this says what they are. A payload without it was built in this window and
 * never left it.
 */
export const BLUEPRINT_GRAPH_CLIPBOARD_KIND = "narraleaf.blueprint.nodes" as const;

const DEFAULT_PASTE_OFFSET = { x: 48, y: 48 };
const MAX_PASTE_OFFSET_ATTEMPTS = 20;

/**
 * The project a copy was made in.
 *
 * `path` is the identity and the only field compared - normalised through `normalizeProjectPath`,
 * the one key every project-path comparison in Studio agrees on. The identifier and the name travel
 * for display: two projects can carry the same identifier, so it settles nothing.
 */
export type BlueprintGraphClipboardSource = {
    path: string;
    identifier: string;
    name: string;
};

/** The files a copied fragment references, as a manifest plus the token that stands for them. */
export type BlueprintGraphClipboardAssets = {
    token: string;
    entries: AssetTransferManifestEntry[];
};

export type BlueprintGraphClipboardPayload = {
    v: typeof BLUEPRINT_GRAPH_CLIPBOARD_VERSION;
    /** Absent on a payload that never left this window. See {@link BLUEPRINT_GRAPH_CLIPBOARD_KIND}. */
    kind?: typeof BLUEPRINT_GRAPH_CLIPBOARD_KIND;
    /**
     * Identifies this copy, so a paste can tell the clipboard's payload from the one this window
     * holds in memory. Equal ids mean the two are the same copy and the in-memory one is used
     * verbatim, which is what keeps a same-project paste exactly what it has always been.
     */
    copyId?: string;
    /** Absent on a payload written before the field existed, which can only be this window's own. */
    source?: BlueprintGraphClipboardSource;
    /** Absent when the copied fragment references no importable file. */
    assets?: BlueprintGraphClipboardAssets;
    nodeIds: string[];
    nodes: Record<string, BlueprintGraphNode>;
    edges: BlueprintGraphEdge[];
};

let inMemoryClipboard: BlueprintGraphClipboardPayload | null = null;

function cloneGraphClipboardValue<T>(value: T): T {
    return value == null ? value : JSON.parse(JSON.stringify(value)) as T;
}

function positionKey(position: { x: number; y: number }): string {
    return `${Math.round(position.x * 1000) / 1000}:${Math.round(position.y * 1000) / 1000}`;
}

function resolveUniqueNodeId(generateId: () => string, usedNodeIds: Set<string>): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const id = generateId();
        if (!usedNodeIds.has(id)) {
            usedNodeIds.add(id);
            return id;
        }
    }
    throw new Error("Unable to generate a unique Blueprint node id");
}

function hasPastePositionCollision(
    ir: BlueprintGraphIr,
    payload: BlueprintGraphClipboardPayload,
    offset: { x: number; y: number },
): boolean {
    const occupied = new Set(
        Object.values(ir.nodes ?? {}).map(node => positionKey(readNodeEditorLayout(node))),
    );
    return payload.nodeIds.some(nodeId => {
        const node = payload.nodes[nodeId];
        if (!node) {
            return false;
        }
        const pos = readNodeEditorLayout(node);
        return occupied.has(positionKey({ x: pos.x + offset.x, y: pos.y + offset.y }));
    });
}

function resolvePasteOffset(
    ir: BlueprintGraphIr,
    payload: BlueprintGraphClipboardPayload,
    requestedOffset?: { x: number; y: number },
): { x: number; y: number } {
    if (requestedOffset) {
        return requestedOffset;
    }
    for (let attempt = 1; attempt <= MAX_PASTE_OFFSET_ATTEMPTS; attempt += 1) {
        const offset = {
            x: DEFAULT_PASTE_OFFSET.x * attempt,
            y: DEFAULT_PASTE_OFFSET.y * attempt,
        };
        if (!hasPastePositionCollision(ir, payload, offset)) {
            return offset;
        }
    }
    return {
        x: DEFAULT_PASTE_OFFSET.x * (MAX_PASTE_OFFSET_ATTEMPTS + 1),
        y: DEFAULT_PASTE_OFFSET.y * (MAX_PASTE_OFFSET_ATTEMPTS + 1),
    };
}

export function getBlueprintGraphClipboard(): BlueprintGraphClipboardPayload | null {
    return inMemoryClipboard;
}

export function setBlueprintGraphClipboard(payload: BlueprintGraphClipboardPayload | null): void {
    inMemoryClipboard = payload ? cloneGraphClipboardValue(payload) : null;
}

export function clearBlueprintGraphClipboard(): void {
    inMemoryClipboard = null;
}

export function buildBlueprintGraphClipboardPayload(
    ir: BlueprintGraphIr,
    selectedNodeIds: readonly string[],
    stamp: {
        /** Identifies this copy. Omitted only where nothing will ever compare two payloads. */
        copyId?: string;
        /** The project the copy is made in, so a window pasting it can tell whose ids these are. */
        source?: BlueprintGraphClipboardSource;
    } = {},
): BlueprintGraphClipboardPayload | null {
    const nodes = ir.nodes ?? {};
    const nodeIds = [...new Set(selectedNodeIds)].filter(id => nodes[id] != null);
    if (nodeIds.length === 0) {
        return null;
    }

    const selected = new Set(nodeIds);
    const copiedNodes: Record<string, BlueprintGraphNode> = {};
    for (const nodeId of nodeIds) {
        copiedNodes[nodeId] = cloneGraphClipboardValue(nodes[nodeId]!);
    }

    const copiedEdges = (ir.edges ?? [])
        .filter(edge => selected.has(edge.from.nodeId) && selected.has(edge.to.nodeId))
        .map(edge => cloneGraphClipboardValue(edge));

    return {
        v: BLUEPRINT_GRAPH_CLIPBOARD_VERSION,
        kind: BLUEPRINT_GRAPH_CLIPBOARD_KIND,
        ...(stamp.copyId ? { copyId: stamp.copyId } : {}),
        ...(stamp.source ? { source: stamp.source } : {}),
        nodeIds,
        nodes: copiedNodes,
        edges: copiedEdges,
    };
}

/**
 * A payload read back off the system clipboard, or null when what is there is not one.
 *
 * Rebuilt rather than trusted. The JSON was written by another process - another project's window,
 * or another Studio of another version - and the paste that consumes it indexes into `nodes`,
 * clones each one and remaps every edge endpoint. An entry that is not shaped like a node is
 * dropped here rather than allowed to throw half-way through a graph mutation.
 *
 * Only the structure is judged. Every *id* inside a node's params is left exactly as it arrived:
 * whether a reference resolves in this project is the paste's question, and one it answers by
 * importing what it can and reporting what it cannot - never by emptying a param.
 */
export function readBlueprintGraphClipboardPayload(json: string): BlueprintGraphClipboardPayload | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") {
        return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (candidate.kind !== BLUEPRINT_GRAPH_CLIPBOARD_KIND || candidate.v !== BLUEPRINT_GRAPH_CLIPBOARD_VERSION) {
        return null;
    }
    const nodes = readNodeTable(candidate.nodes);
    const nodeIds = readStringArray(candidate.nodeIds).filter(id => nodes[id]);
    if (nodeIds.length === 0) {
        return null;
    }
    const selected = new Set(nodeIds);
    const source = readSource(candidate.source);
    const assets = readAssets(candidate.assets);
    return {
        v: BLUEPRINT_GRAPH_CLIPBOARD_VERSION,
        kind: BLUEPRINT_GRAPH_CLIPBOARD_KIND,
        ...(typeof candidate.copyId === "string" && candidate.copyId ? { copyId: candidate.copyId } : {}),
        ...(source ? { source } : {}),
        ...(assets ? { assets } : {}),
        nodeIds,
        nodes,
        edges: readEdges(candidate.edges, selected),
    };
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
        : [];
}

/**
 * The nodes of a parsed payload, keeping only what the paste can actually place.
 *
 * `type` is the one field read without asking first - the paste branches on it, and so does every
 * catalogue lookup downstream. Everything else on a node is carried through untouched, params a
 * plugin contributed included: a node from a plugin the pasting project also has must survive the
 * trip whole.
 */
function readNodeTable(value: unknown): Record<string, BlueprintGraphNode> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const nodes: Record<string, BlueprintGraphNode> = {};
    for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
        if (!id || !entry || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
        }
        const node = entry as Partial<BlueprintGraphNode>;
        if (typeof node.type !== "string" || !node.type) {
            continue;
        }
        nodes[id] = { ...(node as BlueprintGraphNode), id };
    }
    return nodes;
}

/** Edges of a parsed payload, kept only where both ends are nodes the payload carries. */
function readEdges(value: unknown, nodeIds: ReadonlySet<string>): BlueprintGraphEdge[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const edges: BlueprintGraphEdge[] = [];
    for (const entry of value) {
        const edge = entry as Partial<BlueprintGraphEdge> | null;
        const from = edge?.from;
        const to = edge?.to;
        if (!from || !to || typeof from.nodeId !== "string" || typeof to.nodeId !== "string") {
            continue;
        }
        if (typeof from.port !== "string" || typeof to.port !== "string") {
            continue;
        }
        if (!nodeIds.has(from.nodeId) || !nodeIds.has(to.nodeId)) {
            continue;
        }
        edges.push({
            from: { nodeId: from.nodeId, port: from.port },
            to: { nodeId: to.nodeId, port: to.port },
        });
    }
    return edges;
}

function readSource(value: unknown): BlueprintGraphClipboardSource | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path : "";
    if (!path.trim()) {
        return undefined;
    }
    return {
        path,
        identifier: typeof record.identifier === "string" ? record.identifier : "",
        name: typeof record.name === "string" ? record.name : "",
    };
}

function readAssets(value: unknown): BlueprintGraphClipboardAssets | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.token !== "string" || !record.token || !Array.isArray(record.entries)) {
        return undefined;
    }
    const entries: AssetTransferManifestEntry[] = [];
    for (const entry of record.entries) {
        const manifest = entry as Partial<AssetTransferManifestEntry> | null;
        if (!manifest || typeof manifest.assetId !== "string" || !manifest.assetId) {
            continue;
        }
        entries.push({
            assetId: manifest.assetId,
            fileName: typeof manifest.fileName === "string" ? manifest.fileName : "",
            type: typeof manifest.type === "string" ? manifest.type : "",
            ...(typeof manifest.size === "number" ? { size: manifest.size } : {}),
        });
    }
    return { token: record.token, entries };
}

export function pasteBlueprintGraphClipboardPayload(input: {
    ir: BlueprintGraphIr;
    payload: BlueprintGraphClipboardPayload | null;
    generateId: () => string;
    offset?: { x: number; y: number };
    /**
     * Blueprint that receives the paste. When a Call Fn node is pasted TOGETHER with its
     * Fn head, the call is re-pointed at the pasted head (which got a fresh node id).
     * A lone Call Fn keeps its fnRef untouched - validation reports fn.call_target_not_found
     * when the target is not visible from the destination: another surface, or another
     * project entirely. Keeping the ref is what leaves the author the name of the function
     * they were calling; blanking it would trade a reported break for a silent one.
     */
    targetBlueprintId?: string;
}): { ir: BlueprintGraphIr; newNodeIds: string[] } | null {
    const { payload } = input;
    if (!payload || payload.v !== BLUEPRINT_GRAPH_CLIPBOARD_VERSION || payload.nodeIds.length === 0) {
        return null;
    }

    const next = cloneGraphClipboardValue(input.ir);
    delete (next as { entries?: unknown }).entries;
    next.nodes = { ...(next.nodes ?? {}) };
    next.edges = [...(next.edges ?? [])];

    const offset = resolvePasteOffset(input.ir, payload, input.offset);
    const usedNodeIds = new Set(Object.keys(next.nodes));
    const idMap = new Map<string, string>();
    const newNodeIds: string[] = [];

    for (const oldNodeId of payload.nodeIds) {
        const node = payload.nodes[oldNodeId];
        if (!node) {
            continue;
        }
        const newNodeId = resolveUniqueNodeId(input.generateId, usedNodeIds);
        const nextNode = cloneGraphClipboardValue(node);
        nextNode.id = newNodeId;
        if (nextNode.type === BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR) {
            nextNode.params = { ...(nextNode.params ?? {}), variableId: newNodeId };
        }
        const pos = readNodeEditorLayout(nextNode);
        writeNodeEditorLayout(nextNode, { x: pos.x + offset.x, y: pos.y + offset.y });
        next.nodes[newNodeId] = nextNode;
        idMap.set(oldNodeId, newNodeId);
        newNodeIds.push(newNodeId);
    }

    if (newNodeIds.length === 0) {
        return null;
    }

    for (const newNodeId of newNodeIds) {
        const node = next.nodes[newNodeId];
        if (node?.type !== BLUEPRINT_NODE_TYPE_FN_CALL) {
            continue;
        }
        const parsed = parseBlueprintFnRef(node.params?.[BLUEPRINT_NODE_PARAM_FN_REF]);
        const pastedHeadId = parsed ? idMap.get(parsed.headNodeId) : undefined;
        if (!parsed || !pastedHeadId) {
            continue;
        }
        node.params = {
            ...(node.params ?? {}),
            [BLUEPRINT_NODE_PARAM_FN_REF]: createBlueprintFnRef(
                input.targetBlueprintId ?? parsed.blueprintId,
                pastedHeadId,
            ),
        };
    }

    const remappedEdges = payload.edges.flatMap(edge => {
        const fromNodeId = idMap.get(edge.from.nodeId);
        const toNodeId = idMap.get(edge.to.nodeId);
        if (!fromNodeId || !toNodeId) {
            return [];
        }
        return [{
            from: { nodeId: fromNodeId, port: edge.from.port },
            to: { nodeId: toNodeId, port: edge.to.port },
        }];
    });

    next.edges = [...next.edges, ...remappedEdges];
    return { ir: next, newNodeIds };
}
