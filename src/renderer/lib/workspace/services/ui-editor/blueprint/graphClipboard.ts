import type { BlueprintGraphEdge, BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR } from "@shared/types/blueprint/graph";
import { readNodeEditorLayout, writeNodeEditorLayout } from "./graphEditing";

export const BLUEPRINT_GRAPH_CLIPBOARD_VERSION = 1 as const;

const DEFAULT_PASTE_OFFSET = { x: 48, y: 48 };
const MAX_PASTE_OFFSET_ATTEMPTS = 20;

export type BlueprintGraphClipboardPayload = {
    v: typeof BLUEPRINT_GRAPH_CLIPBOARD_VERSION;
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
        nodeIds,
        nodes: copiedNodes,
        edges: copiedEdges,
    };
}

export function pasteBlueprintGraphClipboardPayload(input: {
    ir: BlueprintGraphIr;
    payload: BlueprintGraphClipboardPayload | null;
    generateId: () => string;
    offset?: { x: number; y: number };
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
