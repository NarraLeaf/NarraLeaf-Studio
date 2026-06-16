import "@xyflow/react/dist/style.css";
import { memo } from "react";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import {
    Background,
    Handle,
    Position,
    ReactFlow,
    ReactFlowProvider,
    type Edge,
    type Node,
    type NodeProps,
    type NodeTypes,
} from "@xyflow/react";

const PREVIEW_NODE_TYPE = "blueprintMini";
const PREVIEW_SOURCE_HANDLE = "out";
const PREVIEW_TARGET_HANDLE = "in";
const FALLBACK_NODE_SIZE = { width: 220, height: 82 };

type MiniPreviewRole = "event" | "function" | "data" | "normal";

type MiniPreviewNodeData = {
    role: MiniPreviewRole;
    width: number;
    height: number;
};

export type BlueprintLayerPreviewModel = {
    graphName: string | null;
    emptyLabel?: string;
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

function inferNodeRole(node: BlueprintGraphNode): MiniPreviewRole {
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

function inferEdgeColor(fromPort: string, toPort: string): string {
    const port = `${fromPort}:${toPort}`.toLowerCase();
    return port.includes("value") || port.includes("result") || port.includes("data") ? "#f59e0b" : "#22d3ee";
}

function resolvePreviewNodeSize(
    node: BlueprintGraphNode,
    nodeCatalog: BlueprintNodeCatalogService | null,
): { width: number; height: number } {
    const entry = nodeCatalog?.resolveCatalogEntryForNode(node.type, node.params ?? {});
    if (!entry) {
        return FALLBACK_NODE_SIZE;
    }

    const leftPins = entry.pins.filter(pin => pin.kind === "input").length;
    const rightPins = entry.pins.filter(pin => pin.kind === "output").length;
    const pinRows = Math.max(leftPins, rightPins, entry.supportsDynamicInputPins ? 1 : 0);
    const inspectorRows = entry.inspectorParams?.length ?? 0;
    const width = entry.role === "eventHead" ? 240 : entry.role === "dataLiteral" ? 200 : 220;
    const height = Math.max(58, 44 + pinRows * 22 + inspectorRows * 28);

    return { width, height };
}

function buildPreviewModel(
    ir: BlueprintGraphIr | undefined,
    graphName: string | undefined,
    nodeCatalog: BlueprintNodeCatalogService | null,
): BlueprintLayerPreviewModel {
    const graphNodes = Object.values(ir?.nodes ?? {});
    if (graphNodes.length === 0) {
        return {
            graphName: graphName ?? null,
            emptyLabel: "Empty layer",
            nodes: [],
            edges: [],
        };
    }

    const nodes: Node<MiniPreviewNodeData>[] = graphNodes.map((node, index) => {
        const size = resolvePreviewNodeSize(node, nodeCatalog);
        return {
            id: node.id,
            type: PREVIEW_NODE_TYPE,
            position: readLayout(node, index, graphNodes.length),
            width: size.width,
            height: size.height,
            data: {
                role: inferNodeRole(node),
                ...size,
            },
            draggable: false,
            selectable: false,
            focusable: false,
            connectable: false,
        };
    });

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
        nodes,
        edges,
    };
}

export function resolveFirstBlueprintLayerPreview(
    localBp: LocalBlueprintService | null,
    nodeCatalog: BlueprintNodeCatalogService | null,
    blueprintId: string | undefined,
): BlueprintLayerPreviewModel | null {
    if (!localBp || !blueprintId) {
        return null;
    }
    const blueprint = localBp.getBlueprintDocument().blueprints[blueprintId];
    if (!blueprint || blueprint.program.kind !== "graph") {
        return null;
    }
    const firstLayer = Object.values(blueprint.program.graphs.events ?? {})[0];
    if (!firstLayer) {
        return {
            graphName: null,
            emptyLabel: "No layer",
            nodes: [],
            edges: [],
        };
    }
    return buildPreviewModel(firstLayer.graph, firstLayer.name, nodeCatalog);
}

function miniNodeClass(role: MiniPreviewRole): string {
    if (role === "event") {
        return "border-cyan-200/80 bg-cyan-500/80";
    }
    if (role === "function") {
        return "border-violet-200/75 bg-violet-500/75";
    }
    if (role === "data") {
        return "border-amber-200/75 bg-amber-500/75";
    }
    return "border-slate-200/70 bg-slate-500/80";
}

const MiniBlueprintNode = memo(function MiniBlueprintNode({ data }: NodeProps<Node<MiniPreviewNodeData>>) {
    return (
        <div
            className={`rounded-[5px] border shadow-sm ${miniNodeClass(data.role)}`}
            style={{ width: data.width, height: data.height }}
        >
            <Handle
                type="target"
                id={PREVIEW_TARGET_HANDLE}
                position={Position.Left}
                isConnectable={false}
                className="!h-0 !w-0 !border-0 !bg-transparent"
            />
            <Handle
                type="source"
                id={PREVIEW_SOURCE_HANDLE}
                position={Position.Right}
                isConnectable={false}
                className="!h-0 !w-0 !border-0 !bg-transparent"
            />
        </div>
    );
});

const miniNodeTypes: NodeTypes = {
    [PREVIEW_NODE_TYPE]: MiniBlueprintNode,
};

export function BlueprintLayerPreview({ model }: { model: BlueprintLayerPreviewModel | null }) {
    const hasLayer = model !== null;
    const hasNodes = Boolean(model?.nodes.length);
    const nodes = model?.nodes ?? [];
    const edges = model?.edges ?? [];
    const flowKey = `${nodes
        .map(node => `${node.id}:${node.position.x}:${node.position.y}:${node.width}:${node.height}`)
        .join("|")}::${edges.map(edge => edge.id).join("|")}`;

    return (
        <div className="relative h-[112px] w-full overflow-hidden rounded-md border border-white/10 bg-[#05060a]">
            <ReactFlowProvider>
                <ReactFlow
                    key={flowKey}
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={miniNodeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.22, minZoom: 0.08, maxZoom: 0.85, duration: 0 }}
                    minZoom={0.08}
                    maxZoom={0.85}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable={false}
                    edgesFocusable={false}
                    nodesFocusable={false}
                    panOnDrag={false}
                    zoomOnScroll={false}
                    zoomOnPinch={false}
                    zoomOnDoubleClick={false}
                    preventScrolling={false}
                    proOptions={{ hideAttribution: true }}
                    onlyRenderVisibleElements
                    className="pointer-events-none bg-[#05060a]"
                >
                    <Background color="rgba(148, 163, 184, 0.18)" gap={18} size={1} />
                </ReactFlow>
            </ReactFlowProvider>
            {!hasLayer || !hasNodes ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">
                    {!hasLayer ? "No blueprint" : model?.emptyLabel ?? "Empty layer"}
                </div>
            ) : null}
            {model?.graphName ? (
                <div className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-16px)] truncate text-[10px] text-slate-500">
                    {model.graphName}
                </div>
            ) : null}
        </div>
    );
}
