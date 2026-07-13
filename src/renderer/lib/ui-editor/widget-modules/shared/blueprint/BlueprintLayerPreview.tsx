import "@xyflow/react/dist/style.css";
import { memo } from "react";
import { useTranslation } from "@/lib/i18n";
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
    /** Real node title + data-pin labels, shown only in the `detailed` variant. */
    title?: string;
    inputs?: string[];
    outputs?: string[];
    detailed?: boolean;
};

export type BlueprintLayerPreviewModel = {
    graphName: string | null;
    emptyReason?: "noLayer" | "emptyLayer";
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

type PreviewNodeDescriptor = {
    width: number;
    height: number;
    title?: string;
    inputs?: string[];
    outputs?: string[];
};

function describePreviewNode(
    node: BlueprintGraphNode,
    nodeCatalog: BlueprintNodeCatalogService | null,
): PreviewNodeDescriptor {
    const entry = nodeCatalog?.resolveCatalogEntryForNode(node.type, node.params ?? {});
    if (!entry) {
        return { ...FALLBACK_NODE_SIZE };
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

    return { width, height, title: entry.displayName ?? node.type, inputs, outputs };
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
            emptyReason: "emptyLayer",
            nodes: [],
            edges: [],
        };
    }

    const nodes: Node<MiniPreviewNodeData>[] = graphNodes.map((node, index) => {
        const descriptor = describePreviewNode(node, nodeCatalog);
        return {
            id: node.id,
            type: PREVIEW_NODE_TYPE,
            position: readLayout(node, index, graphNodes.length),
            width: descriptor.width,
            height: descriptor.height,
            data: {
                role: inferNodeRole(node),
                width: descriptor.width,
                height: descriptor.height,
                title: descriptor.title,
                inputs: descriptor.inputs,
                outputs: descriptor.outputs,
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
            emptyReason: "noLayer",
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

function detailedHeaderClass(role: MiniPreviewRole): string {
    if (role === "event") {
        return "bg-cyan-500/85 text-cyan-50";
    }
    if (role === "function") {
        return "bg-violet-500/80 text-violet-50";
    }
    if (role === "data") {
        return "bg-amber-500/80 text-amber-950";
    }
    return "bg-slate-500/85 text-slate-50";
}

const MiniBlueprintNode = memo(function MiniBlueprintNode({ data }: NodeProps<Node<MiniPreviewNodeData>>) {
    const { t } = useTranslation();
    const handles = (
        <>
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
        </>
    );

    if (data.detailed) {
        const inputs = data.inputs ?? [];
        const outputs = data.outputs ?? [];
        const rows = Math.max(inputs.length, outputs.length);
        return (
            <div
                className="flex flex-col overflow-hidden rounded-md border border-slate-200/25 bg-[#1b1f27] shadow-md"
                style={{ width: data.width, height: data.height }}
            >
                {handles}
                <div className={`truncate px-2 py-1 text-[13px] font-medium ${detailedHeaderClass(data.role)}`}>
                    {data.title ?? t("widgetChrome.blueprint.node")}
                </div>
                {rows > 0 ? (
                    <div className="flex flex-1 justify-between gap-2 px-2 py-1.5">
                        <div className="flex min-w-0 flex-col gap-1">
                            {inputs.map((label, index) => (
                                <span key={`in-${index}`} className="flex items-center gap-1 truncate text-[11px] text-slate-300">
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                                    {label}
                                </span>
                            ))}
                        </div>
                        <div className="flex min-w-0 flex-col items-end gap-1">
                            {outputs.map((label, index) => (
                                <span key={`out-${index}`} className="flex items-center gap-1 truncate text-[11px] text-slate-300">
                                    {label}
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                                </span>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <div
            className={`rounded-[5px] border shadow-sm ${miniNodeClass(data.role)}`}
            style={{ width: data.width, height: data.height }}
        >
            {handles}
        </div>
    );
});

const miniNodeTypes: NodeTypes = {
    [PREVIEW_NODE_TYPE]: MiniBlueprintNode,
};

export function BlueprintLayerPreview({
    model,
    heightClassName,
    variant = "mini",
}: {
    model: BlueprintLayerPreviewModel | null;
    heightClassName?: string;
    /**
     * "mini" (default): abstract role-colored boxes — compact entry cards. "detailed": each box shows
     * the real node title + data-pin labels, sized larger so the graph is actually readable.
     */
    variant?: "mini" | "detailed";
}) {
    const { t } = useTranslation();
    const detailed = variant === "detailed";
    const resolvedHeight = heightClassName ?? (detailed ? "h-[200px]" : "h-[112px]");
    const hasLayer = model !== null;
    const hasNodes = Boolean(model?.nodes.length);
    const nodes = detailed
        ? (model?.nodes ?? []).map(node => ({ ...node, data: { ...node.data, detailed: true } }))
        : (model?.nodes ?? []);
    const edges = model?.edges ?? [];
    const flowKey = `${nodes
        .map(node => `${node.id}:${node.position.x}:${node.position.y}:${node.width}:${node.height}`)
        .join("|")}::${edges.map(edge => edge.id).join("|")}`;

    return (
        <div
            className={`relative ${resolvedHeight} w-full overflow-hidden rounded-md border border-edge bg-surface-canvas`}
        >
            <ReactFlowProvider>
                <ReactFlow
                    key={flowKey}
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={miniNodeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.22, minZoom: 0.08, maxZoom: detailed ? 1 : 0.85, duration: 0 }}
                    minZoom={0.08}
                    maxZoom={detailed ? 1 : 0.85}
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
                    className="pointer-events-none bg-surface-canvas"
                >
                    <Background color="rgba(148, 163, 184, 0.18)" gap={18} size={1} />
                </ReactFlow>
            </ReactFlowProvider>
            {!hasLayer || !hasNodes ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xs text-fg-subtle">
                    {!hasLayer
                        ? t("widgetChrome.blueprint.noBlueprint")
                        : model?.emptyReason === "noLayer"
                          ? t("widgetChrome.blueprint.noLayer")
                          : t("widgetChrome.blueprint.emptyLayer")}
                </div>
            ) : null}
            {model?.graphName ? (
                <div className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-16px)] truncate text-2xs text-fg-subtle">
                    {model.graphName}
                </div>
            ) : null}
        </div>
    );
}
