import "@xyflow/react/dist/style.css";
import { memo, useId } from "react";
import { useTranslation } from "@/lib/i18n";
import {
    BLUEPRINT_COMMENT_COLORS,
    resolveBlueprintCommentColorKey,
} from "@/lib/ui-editor/blueprint-comment-colors";
import {
    PREVIEW_NODE_TYPE,
    PREVIEW_SOURCE_HANDLE,
    PREVIEW_TARGET_HANDLE,
    type BlueprintLayerPreviewModel,
    type MiniPreviewNodeData,
    type MiniPreviewRole,
} from "./blueprintLayerPreviewModel";
import {
    Background,
    Handle,
    Position,
    ReactFlow,
    ReactFlowProvider,
    type Node,
    type NodeProps,
    type NodeTypes,
} from "@xyflow/react";

export { resolveFirstBlueprintLayerPreview } from "./blueprintLayerPreviewModel";
export type { BlueprintLayerPreviewModel, MiniPreviewNodeData } from "./blueprintLayerPreviewModel";

function miniNodeClass(role: MiniPreviewRole): string {
    if (role === "event") {
        return "border-primary/90 bg-primary/70";
    }
    if (role === "function") {
        return "border-violet-200/75 bg-violet-500/75";
    }
    if (role === "data") {
        return "border-amber-200/75 bg-amber-500/75";
    }
    return "border-fg-subtle/70 bg-fg-muted/80";
}

function detailedHeaderClass(role: MiniPreviewRole): string {
    if (role === "event") {
        return "bg-primary/85 text-on-primary";
    }
    if (role === "function") {
        return "bg-violet-500/80 text-violet-50";
    }
    if (role === "data") {
        return "bg-amber-500/80 text-amber-950";
    }
    return "bg-fg-muted/85 text-fg";
}

/**
 * A group frame, in the colour the author painted it on the canvas.
 *
 * An outlined wash rather than a filled card: a frame is the region a set of cards sits in, and a
 * thumbnail that paints it solid hides exactly the cards it was drawn to gather.
 */
function MiniCommentRegion({ data }: { data: MiniPreviewNodeData }) {
    const color = BLUEPRINT_COMMENT_COLORS[resolveBlueprintCommentColorKey(data.colorKey)]!;
    const title = data.title?.split("\n")[0]?.trim();
    return (
        <div
            className="flex flex-col overflow-hidden rounded-md border"
            style={{
                width: data.width,
                height: data.height,
                borderColor: color.border,
                backgroundColor: color.background,
            }}
        >
            {data.detailed && title ? (
                <div
                    className="truncate px-2 py-1 text-2xs font-medium"
                    style={{ backgroundColor: color.header, color: color.text }}
                >
                    {title}
                </div>
            ) : null}
        </div>
    );
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

    if (data.role === "comment") {
        return (
            <>
                {handles}
                <MiniCommentRegion data={data} />
            </>
        );
    }

    if (data.detailed) {
        const inputs = data.inputs ?? [];
        const outputs = data.outputs ?? [];
        const rows = Math.max(inputs.length, outputs.length);
        return (
            <div
                className="flex flex-col overflow-hidden rounded-md border border-edge-strong bg-surface-raised shadow-md"
                style={{ width: data.width, height: data.height }}
            >
                {handles}
                <div className={`truncate px-2 py-1 text-xs font-medium ${detailedHeaderClass(data.role)}`}>
                    {data.title ?? t("widgetChrome.blueprint.node")}
                </div>
                {rows > 0 ? (
                    <div className="flex flex-1 justify-between gap-2 px-2 py-1.5">
                        <div className="flex min-w-0 flex-col gap-1">
                            {inputs.map((label, index) => (
                                <span key={`in-${index}`} className="flex items-center gap-1 truncate text-2xs text-fg-muted">
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg-muted" />
                                    {label}
                                </span>
                            ))}
                        </div>
                        <div className="flex min-w-0 flex-col items-end gap-1">
                            {outputs.map((label, index) => (
                                <span key={`out-${index}`} className="flex items-center gap-1 truncate text-2xs text-fg-muted">
                                    {label}
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
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
            className={`rounded-md border shadow-sm ${miniNodeClass(data.role)}`}
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
    // Unique per instance: React Flow scopes its document-wide ids (dot-grid `<pattern>`,
    // edge markers, handle ids) to this, defaulting every instance to "1" otherwise.
    // Several previews plus the main editor canvas coexist on one page, and the first
    // `pattern-1` in the DOM would otherwise win for all of them.
    const flowId = useId().replace(/:/g, "");
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
                    id={flowId}
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
