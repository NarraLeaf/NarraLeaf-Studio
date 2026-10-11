/**
 * A template's graph, drawn read-only, so an author sees what a template builds before adding it.
 *
 * The graph drawn is the one the template builds for this blueprint - the same nodes, pins and wires
 * at the same positions the layer will open on - rather than a picture kept beside the template, so
 * the preview cannot drift from what Add produces. The node cards are deliberately plainer than the
 * editor's: those are built on the workspace's edit services, and nothing here may edit anything.
 */

import { useMemo } from "react";
import {
    Handle,
    Position,
    ReactFlow,
    ReactFlowProvider,
    type Edge,
    type Node,
    type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import { resolveBlueprintNodeEditorCatalogEntryForNode } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { blueprintEdgeStyle } from "@/lib/ui-editor/blueprint-graph-edge-style";
import { readNodeEditorLayout } from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import { useTranslation, type UseTranslation } from "@/lib/i18n";
import { useFlowAriaLabels } from "@/lib/ui-editor/hooks/useFlowAriaLabels";
import { cn } from "@/lib/utils/cn";
import type { BlueprintInspectorParamDef } from "@/lib/ui-editor/blueprint-nodes/types";
import { resolveBlueprintLabel, resolveBlueprintNodeTitle } from "../blueprintNodeI18n";
import { formatBlueprintValueTypeLabel } from "@/lib/ui-editor/blueprint-nodes/structTypeLabels";

type PreviewPin = { id: string; label: string; exec: boolean; value?: string };

type PreviewField = { key: string; label: string; value: string };

type PreviewNodeData = {
    title: string;
    inputs: PreviewPin[];
    outputs: PreviewPin[];
    /** The fields the template sets, as the inspector would show them. */
    fields: PreviewField[];
    /** A node the author still has a choice to make on once the layer exists. */
    pending: boolean;
    [key: string]: unknown;
};

const EXEC_HANDLE_CLASS = "!h-2 !w-2 !border !border-edge-strong !bg-primary";
const DATA_HANDLE_CLASS = "!h-2 !w-2 !border !border-edge-strong !bg-warning";

function PreviewNode({ data }: NodeProps) {
    const node = data as PreviewNodeData;
    return (
        <div
            className={cn(
                // About as wide as the editor's own cards, which the template's positions are spaced
                // for; narrower ones read as nodes adrift on long wires.
                "w-52 rounded-md border bg-surface-raised text-xs shadow-sm",
                node.pending ? "border-primary" : "border-edge",
            )}
        >
            <div className="truncate border-b border-edge px-2 py-1 font-medium text-fg">{node.title}</div>
            <div className="flex gap-2 px-2 py-1">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {node.inputs.map(pin => (
                        <div key={pin.id} className="relative truncate pl-2 text-fg-muted">
                            <Handle
                                type="target"
                                position={Position.Left}
                                id={pin.id}
                                isConnectable={false}
                                className={cn(pin.exec ? EXEC_HANDLE_CLASS : DATA_HANDLE_CLASS, "!left-0 !top-1/2 !-translate-y-1/2")}
                            />
                            {pin.label}
                            {pin.value !== undefined ? <span className="text-fg"> {pin.value}</span> : null}
                        </div>
                    ))}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-right">
                    {node.outputs.map(pin => (
                        <div key={pin.id} className="relative truncate pr-2 text-fg-muted">
                            {pin.label}
                            <Handle
                                type="source"
                                position={Position.Right}
                                id={pin.id}
                                isConnectable={false}
                                className={cn(pin.exec ? EXEC_HANDLE_CLASS : DATA_HANDLE_CLASS, "!right-0 !top-1/2 !-translate-y-1/2")}
                            />
                        </div>
                    ))}
                </div>
            </div>
            {node.fields.length > 0 ? (
                <dl className="flex flex-col gap-0.5 border-t border-edge px-2 py-1">
                    {node.fields.map(field => (
                        <div key={field.key} className="flex min-w-0 gap-2">
                            <dt className="shrink-0 text-fg-subtle">{field.label}</dt>
                            <dd className="min-w-0 truncate text-fg">{field.value}</dd>
                        </div>
                    ))}
                </dl>
            ) : null}
        </div>
    );
}

/**
 * A value worth showing on a preview card, or nothing.
 *
 * Only what reads as itself: a number, a word from a fixed list, a line of text. A field whose
 * options come from the project - a page, an element, a sound, a track - holds an id, and the
 * interface never shows an id; those are the choices the detail view lists by name instead.
 */
function displayValue(value: unknown, param: BlueprintInspectorParamDef | undefined, t: UseTranslation["t"]): string | undefined {
    if (value === undefined || value === null || value === "" || typeof value === "object") {
        return undefined;
    }
    if (param?.kind === "select") {
        const option = param.options?.find(candidate => candidate.value === String(value));
        if (!option) {
            return undefined;
        }
        return param.optionsAreValueTypes
            ? formatBlueprintValueTypeLabel(option.value, t, "option")
            : resolveBlueprintLabel(option.label, t);
    }
    if (param && !["string", "number", "color", "keyboardBinding", "literal"].includes(param.kind)) {
        return undefined;
    }
    return String(value);
}

const nodeTypes = { templatePreview: PreviewNode };

type Props = {
    ir: BlueprintGraphIr;
    pendingNodeIds: readonly string[];
    className?: string;
};

function BlueprintTemplatePreviewInner({ ir, pendingNodeIds }: Props) {
    const { t } = useTranslation();
    const flowAriaLabels = useFlowAriaLabels();

    const { nodes, dataPins } = useMemo(() => {
        const pending = new Set(pendingNodeIds);
        const dataOutputs = new Set<string>();
        const projected: Node<PreviewNodeData>[] = Object.values(ir.nodes ?? {}).map(node => {
            const catalog = resolveBlueprintNodeEditorCatalogEntryForNode(node.type, node.params);
            const pins = (catalog.pins ?? []).map(pin => ({
                id: pin.id,
                kind: pin.kind,
                label: resolveBlueprintLabel(pin.label ?? pin.id, t),
                exec: pin.semantic === "exec",
                // A literal written into an unwired input, as the card shows it beside the pin.
                value: pin.kind === "input" && pin.semantic !== "exec" ? displayValue(node.params?.[pin.id], undefined, t) : undefined,
            }));
            const pinIds = new Set(pins.map(pin => pin.id));
            const fields = (catalog.inspectorParams ?? []).flatMap(param => {
                if (param.key.startsWith("__") || pinIds.has(param.key)) {
                    return [];
                }
                const value = displayValue(node.params?.[param.key], param, t);
                return value === undefined ? [] : [{ key: param.key, label: resolveBlueprintLabel(param.label, t), value }];
            });
            for (const pin of pins) {
                if (pin.kind === "output" && !pin.exec) {
                    dataOutputs.add(`${node.id}:${pin.id}`);
                }
            }
            return {
                id: node.id,
                type: "templatePreview",
                position: readNodeEditorLayout(node),
                draggable: false,
                connectable: false,
                selectable: false,
                data: {
                    title: resolveBlueprintNodeTitle(catalog.displayName, t),
                    inputs: pins.filter(pin => pin.kind === "input"),
                    outputs: pins.filter(pin => pin.kind === "output"),
                    pending: pending.has(node.id),
                    fields,
                },
            };
        });
        return { nodes: projected, dataPins: dataOutputs };
    }, [ir, pendingNodeIds, t]);

    const edges = useMemo<Edge[]>(
        () => (ir.edges ?? []).map((edge, index) => ({
            id: `e:${index}`,
            source: edge.from.nodeId,
            target: edge.to.nodeId,
            sourceHandle: edge.from.port,
            targetHandle: edge.to.port,
            selectable: false,
            focusable: false,
            style: blueprintEdgeStyle(dataPins.has(`${edge.from.nodeId}:${edge.from.port}`)),
        })),
        [dataPins, ir],
    );

    return (
        <ReactFlow
            ariaLabelConfig={flowAriaLabels}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            edgesFocusable={false}
            // Opened on the whole graph; a large one is small at that size, so the wheel zooms and a
            // drag pans, as on the canvas.
            fitView
            fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
        />
    );
}

export function BlueprintTemplatePreview(props: Props) {
    const { t } = useTranslation();
    return (
        <div className={props.className ?? "h-full w-full"} role="img" aria-label={t("blueprint.templateLibrary.previewLabel")}>
            <ReactFlowProvider>
                <BlueprintTemplatePreviewInner {...props} />
            </ReactFlowProvider>
        </div>
    );
}
