/**
 * What a blueprint thumbnail draws: the model behind `BlueprintLayerPreview`.
 *
 * Separate from the component because it is the part with rules in it - which layer a card
 * summarises, how big a group frame is, what colour a node reads as - and those rules have to be
 * testable without a canvas.
 *
 * Comments in English per project convention.
 */

import type { Edge, Node } from "@xyflow/react";
import { listBlueprintEventIds, listBlueprintFunctionIds } from "@shared/blueprint/blueprintEventOrder";
import { readBlueprintCommentSize } from "@shared/blueprint/blueprintCommentGeometry";
import type { BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import { resolveBlueprintCommentColorKey } from "@/lib/ui-editor/blueprint-comment-colors";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";

export const PREVIEW_NODE_TYPE = "blueprintMini";
export const PREVIEW_SOURCE_HANDLE = "out";
export const PREVIEW_TARGET_HANDLE = "in";
const FALLBACK_NODE_SIZE = { width: 220, height: 82 };

/** Drawn behind the cards, so it sorts first and takes the lower rung. */
const PREVIEW_Z_COMMENT = 0;
const PREVIEW_Z_CARD = 1;

export type MiniPreviewRole = "event" | "function" | "data" | "comment" | "normal";

export type MiniPreviewNodeData = {
    role: MiniPreviewRole;
    width: number;
    height: number;
    /** Real node title + data-pin labels, shown only in the `detailed` variant. */
    title?: string;
    inputs?: string[];
    outputs?: string[];
    /** Which of the four group colours a comment is painted in; absent on every other role. */
    colorKey?: string;
    detailed?: boolean;
};

export type BlueprintLayerPreviewModel = {
    graphName: string | null;
    /**
     * Why there is nothing to draw. `script` is not an absence: the slot has logic, written as a
     * file rather than as a graph, and {@link scriptFileName} names it.
     */
    emptyReason?: "noLayer" | "emptyLayer" | "script";
    /** The file a script slot runs, without its directory. Set only when `emptyReason` is `script`. */
    scriptFileName?: string;
    nodes: Node<MiniPreviewNodeData>[];
    edges: Edge[];
};

function readLayout(node: BlueprintGraphNode, index: number, total: number): { x: number; y: number } {
    const raw = node.meta?.editorLayout;
    if (raw && typeof raw === "object" && "x" in raw && "y" in raw) {
        const x = Number((raw as { x: unknown }).x);
        const y = Number((raw as { y: unknown }).y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            return { x, y };
        }
    }

    const cols = Math.max(1, Math.ceil(Math.sqrt(total)));
    return {
        x: (index % cols) * 120,
        y: Math.floor(index / cols) * 76,
    };
}

/**
 * The role a node reads as when the catalogue has nothing to say about its type - a node left
 * behind by an uninstalled plugin, or one this Studio version does not know. A guess from the type
 * string, and only ever a guess: `blueprint.data.*` and `blueprint.game.setState` land in the same
 * bucket by spelling alone.
 */
function guessNodeRoleFromType(node: BlueprintGraphNode): MiniPreviewRole {
    if (node.type.includes("event")) {
        return "event";
    }
    if (node.type.includes("function")) {
        return "function";
    }
    if (node.type.includes("literal") || node.type.includes("state") || node.type.includes("data")) {
        return "data";
    }
    return "normal";
}

/** The catalogue's own role, mapped onto the four the thumbnail paints. */
function previewRoleForCatalogRole(role: string): MiniPreviewRole {
    switch (role) {
        case "eventHead":
        case "elementEventHead":
            return "event";
        case "fnHead":
        case "functionEntry":
            return "function";
        case "dataLiteral":
        case "elementLiteral":
        case "imageAssetLiteral":
            return "data";
        case "comment":
            return "comment";
        default:
            return "normal";
    }
}

function inferEdgeColor(fromPort: string, toPort: string): string {
    const port = `${fromPort}:${toPort}`.toLowerCase();
    return port.includes("value") || port.includes("result") || port.includes("data") ? "#f59e0b" : "#22d3ee";
}

type PreviewNodeDescriptor = {
    role: MiniPreviewRole;
    width: number;
    height: number;
    title?: string;
    inputs?: string[];
    outputs?: string[];
    colorKey?: string;
};

function describePreviewNode(
    node: BlueprintGraphNode,
    nodeCatalog: BlueprintNodeCatalogService | null,
): PreviewNodeDescriptor {
    const entry = nodeCatalog?.resolveCatalogEntryForNode(node.type, node.params ?? {});
    if (!entry) {
        return { role: guessNodeRoleFromType(node), ...FALLBACK_NODE_SIZE };
    }

    // A definition that declares no role is an ordinary node in the catalogue's terms, but the
    // guess is kept for it: it is the only thing that separates a plugin's data literal from its
    // side-effecting node when neither says which it is.
    const role = entry.role ? previewRoleForCatalogRole(entry.role) : guessNodeRoleFromType(node);
    // A comment - and therefore a group frame - carries its own size. Measured from the catalogue
    // instead, a frame drawn around half the graph would come out the size of one card, and every
    // thumbnail of a grouped graph would stop resembling the canvas.
    if (role === "comment") {
        return {
            role,
            ...readBlueprintCommentSize(node.params ?? {}),
            title: typeof node.params?.text === "string" ? node.params.text : undefined,
            colorKey: resolveBlueprintCommentColorKey(node.params?.color),
        };
    }

    const inputPins = entry.pins.filter(pin => pin.kind === "input");
    const outputPins = entry.pins.filter(pin => pin.kind === "output");
    const pinRows = Math.max(inputPins.length, outputPins.length, entry.supportsDynamicInputPins ? 1 : 0);
    const inspectorRows = entry.inspectorParams?.length ?? 0;
    const width = entry.role === "eventHead" ? 240 : entry.role === "dataLiteral" ? 200 : 220;
    const height = Math.max(58, 44 + pinRows * 22 + inspectorRows * 28);

    // Data-pin labels only — exec pins are rendered as the header accent, not as text rows.
    const inputs = inputPins.filter(pin => pin.semantic === "data").map(pin => pin.label ?? pin.id);
    const outputs = outputPins.filter(pin => pin.semantic === "data").map(pin => pin.label ?? pin.id);

    return { role, width, height, title: entry.displayName ?? node.type, inputs, outputs };
}

export function buildPreviewModel(
    ir: BlueprintGraphIr | undefined,
    graphName: string | undefined,
    nodeCatalog: BlueprintNodeCatalogService | null,
): BlueprintLayerPreviewModel {
    const graphNodes = Object.values(ir?.nodes ?? {});
    if (graphNodes.length === 0) {
        return {
            graphName: graphName ?? null,
            emptyReason: "emptyLayer",
            nodes: [],
            edges: [],
        };
    }

    const nodes: Node<MiniPreviewNodeData>[] = graphNodes.map((node, index) => {
        const descriptor = describePreviewNode(node, nodeCatalog);
        const isComment = descriptor.role === "comment";
        return {
            id: node.id,
            type: PREVIEW_NODE_TYPE,
            position: readLayout(node, index, graphNodes.length),
            width: descriptor.width,
            height: descriptor.height,
            zIndex: isComment ? PREVIEW_Z_COMMENT : PREVIEW_Z_CARD,
            data: {
                role: descriptor.role,
                width: descriptor.width,
                height: descriptor.height,
                title: descriptor.title,
                inputs: descriptor.inputs,
                outputs: descriptor.outputs,
                colorKey: descriptor.colorKey,
            },
            draggable: false,
            selectable: false,
            focusable: false,
            connectable: false,
        };
    });

    // Comments first, and stably: the region a frame describes belongs behind the cards it
    // encloses, and React Flow will draw whichever it is handed last on top.
    const ordered = [
        ...nodes.filter(node => node.data.role === "comment"),
        ...nodes.filter(node => node.data.role !== "comment"),
    ];

    const nodeIds = new Set(nodes.map(node => node.id));
    const edges: Edge[] = (ir?.edges ?? []).flatMap((edge, index): Edge[] => {
        if (!nodeIds.has(edge.from.nodeId) || !nodeIds.has(edge.to.nodeId)) {
            return [];
        }
        return [
            {
                id: `${index}:${edge.from.nodeId}:${edge.from.port}:${edge.to.nodeId}:${edge.to.port}`,
                source: edge.from.nodeId,
                target: edge.to.nodeId,
                sourceHandle: PREVIEW_SOURCE_HANDLE,
                targetHandle: PREVIEW_TARGET_HANDLE,
                selectable: false,
                focusable: false,
                interactionWidth: 1,
                style: {
                    stroke: inferEdgeColor(edge.from.port, edge.to.port),
                    strokeWidth: 1.4,
                    opacity: 0.58,
                },
            },
        ];
    });

    return {
        graphName: graphName ?? null,
        nodes: ordered,
        edges,
    };
}

/**
 * The layer a card summarises: the one the editor opens.
 *
 * Through `listBlueprintEventIds` rather than the key order of `graphs.events`, because those two
 * are not the same list. Key order is not a property the document format guarantees - canonical
 * serialization sorts keys, and the keys are UUIDs - so a card picking `Object.values(...)[0]`
 * could settle on a layer the author never opens, and then sit there unchanged however much they
 * edited the one in front of them. `eventIds[0]` is what the editor opens, and a thumbnail of a
 * different layer is a thumbnail of the wrong thing.
 *
 * A blueprint with no event layers falls through to its first function graph, which is likewise
 * what the editor opens for one.
 */
export function resolveFirstBlueprintLayerPreview(
    localBp: LocalBlueprintService | null,
    nodeCatalog: BlueprintNodeCatalogService | null,
    blueprintId: string | undefined,
): BlueprintLayerPreviewModel | null {
    if (!localBp || !blueprintId) {
        return null;
    }
    const blueprint = localBp.getBlueprintDocument().blueprints[blueprintId];
    if (!blueprint) {
        return null;
    }
    const graphs = blueprint.graphs;

    const eventId = listBlueprintEventIds(graphs)[0];
    const eventLayer = eventId ? graphs.events[eventId] : undefined;
    // A script layer has no graph, and answering "nothing" for it drew the same card as a slot with
    // no logic at all - the first place an author looks to ask whether a control does anything.
    if (eventLayer?.script) {
        const { scriptRef } = eventLayer.script;
        return {
            graphName: null,
            emptyReason: "script",
            scriptFileName: scriptRef.split("/").pop() ?? scriptRef,
            nodes: [],
            edges: [],
        };
    }
    if (eventLayer) {
        return buildPreviewModel(eventLayer.graph, eventLayer.name, nodeCatalog);
    }

    const functionId = listBlueprintFunctionIds(graphs)[0];
    const functionLayer = functionId ? graphs.functions[functionId] : undefined;
    if (functionLayer) {
        return buildPreviewModel(functionLayer.graph, functionLayer.name, nodeCatalog);
    }

    return {
        graphName: null,
        emptyReason: "noLayer",
        nodes: [],
        edges: [],
    };
}
