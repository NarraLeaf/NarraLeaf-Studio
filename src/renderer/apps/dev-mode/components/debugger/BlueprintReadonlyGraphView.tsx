/**
 * The blueprint graph, drawn inside the running game, read-only.
 *
 * Not the editor canvas. `BlueprintFlowCanvas` and its node card are built on the workspace
 * context and the assets service - neither exists in a Dev Mode window - and every control on
 * that card edits the document, which this view must not do. What is drawn here is the same IR at
 * the same authored positions, with only what a debugger needs on it: where the breakpoints are,
 * and which node the execution is stopped on.
 *
 * Breakpoints can be set from here as well as from the editor. That is the point of showing the
 * graph at all: the moment an author wants a breakpoint is usually while watching the game do the
 * wrong thing, and making them go back to the editor window to place it costs the run they were
 * watching.
 */

import { useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import {
    Background,
    Handle,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    type Edge,
    type Node,
    type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { BlueprintBreakpoint } from "@shared/types/blueprint/breakpoints";
import { blueprintBreakpointKey } from "@shared/types/blueprint/breakpoints";
import { getBlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { blueprintEdgeStyle } from "@/lib/ui-editor/blueprint-graph-edge-style";
import { readNodeEditorLayout } from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import { useTranslation } from "@/lib/i18n";
import {
    resolveBlueprintLabel,
    resolveBlueprintNodeTitle,
} from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";

export type BlueprintReadonlyGraphNodeData = {
    title: string;
    inputs: { id: string; label: string; exec: boolean }[];
    outputs: { id: string; label: string; exec: boolean }[];
    breakpoint?: BlueprintBreakpoint;
    /** True on the node the debugger is stopped on. */
    paused: boolean;
    /** True when this graph can never stop - an inline value or condition graph. */
    pausable: boolean;
    [key: string]: unknown;
};

const EXEC_HANDLE_CLASS = "!h-2 !w-2 !border !border-edge-strong !bg-primary";
const DATA_HANDLE_CLASS = "!h-2 !w-2 !border !border-amber-200/35 !bg-amber-500";

function ReadonlyGraphNode({ data }: NodeProps) {
    const node = data as BlueprintReadonlyGraphNodeData;
    const rows = Math.max(node.inputs.length, node.outputs.length);
    return (
        <div
            className={`min-w-[9rem] max-w-[16rem] rounded-md border bg-surface-raised text-2xs shadow-sm ${
                node.paused
                    ? "border-primary ring-2 ring-primary/60"
                    : node.breakpoint
                      ? "border-danger/70"
                      : "border-edge"
            }`}
        >
            <div className="flex items-center gap-1.5 border-b border-edge px-2 py-1">
                {node.breakpoint ? (
                    <span
                        aria-hidden
                        className={`h-2 w-2 shrink-0 rounded-full ${
                            !node.breakpoint.enabled || !node.pausable
                                ? "border border-fg-subtle bg-transparent"
                                : node.breakpoint.condition || node.breakpoint.hitCountTarget
                                  ? "bg-warning"
                                  : "bg-danger"
                        }`}
                    />
                ) : null}
                <span className="min-w-0 flex-1 truncate font-medium text-fg">{node.title}</span>
            </div>
            <div className="flex gap-2 px-2 py-1">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {node.inputs.map(pin => (
                        <div key={pin.id} className="relative truncate pl-2 text-fg-muted">
                            <Handle
                                type="target"
                                position={Position.Left}
                                id={pin.id}
                                isConnectable={false}
                                className={`${pin.exec ? EXEC_HANDLE_CLASS : DATA_HANDLE_CLASS} !left-0 !top-1/2 !-translate-y-1/2`}
                            />
                            {pin.label}
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
                                className={`${pin.exec ? EXEC_HANDLE_CLASS : DATA_HANDLE_CLASS} !right-0 !top-1/2 !-translate-y-1/2`}
                            />
                        </div>
                    ))}
                </div>
            </div>
            {rows === 0 ? <div className="px-2 pb-1" /> : null}
        </div>
    );
}

const nodeTypes = { blueprintDebug: ReadonlyGraphNode };

export type BlueprintReadonlyGraphViewProps = {
    ir: BlueprintGraphIr | undefined;
    blueprintId: string;
    graphId: string;
    breakpointsByKey: Map<string, BlueprintBreakpoint>;
    /** False for graphs the executor can never suspend (inline value / condition blueprints). */
    pausable: boolean;
    pausedNodeId?: string;
    /** Bumped by the caller to re-centre on the paused node; ignored while unchanged. */
    focusNonce?: number;
    onNodeContextMenu: (event: ReactMouseEvent, nodeId: string) => void;
    className?: string;
};

function BlueprintReadonlyGraphViewInner(props: BlueprintReadonlyGraphViewProps) {
    const { ir, blueprintId, graphId, breakpointsByKey, pausable, pausedNodeId, focusNonce } = props;
    const { t } = useTranslation();
    const flow = useReactFlow();
    const lastFocusRef = useRef<string | null>(null);

    const nodes = useMemo<Node<BlueprintReadonlyGraphNodeData>[]>(() => {
        return Object.values(ir?.nodes ?? {}).map(node => {
            const catalog = getBlueprintNodeEditorCatalogEntry(node.type);
            const pins = catalog?.pins ?? [];
            return {
                id: node.id,
                type: "blueprintDebug",
                position: readNodeEditorLayout(node),
                draggable: false,
                connectable: false,
                data: {
                    title: catalog
                        ? resolveBlueprintNodeTitle(catalog.displayName, t)
                        : node.type,
                    inputs: pins
                        .filter(pin => pin.kind === "input")
                        .map(pin => ({
                            id: pin.id,
                            label: resolveBlueprintLabel(pin.label ?? pin.id, t),
                            exec: pin.semantic === "exec",
                        })),
                    outputs: pins
                        .filter(pin => pin.kind === "output")
                        .map(pin => ({
                            id: pin.id,
                            label: resolveBlueprintLabel(pin.label ?? pin.id, t),
                            exec: pin.semantic === "exec",
                        })),
                    breakpoint: breakpointsByKey.get(blueprintBreakpointKey({ blueprintId, graphId, nodeId: node.id })),
                    paused: node.id === pausedNodeId,
                    pausable,
                },
            };
        });
    }, [ir, blueprintId, graphId, breakpointsByKey, pausedNodeId, pausable, t]);

    const edges = useMemo<Edge[]>(() => {
        return (ir?.edges ?? []).map((edge, index) => ({
            id: `e:${index}:${edge.from.nodeId}:${edge.from.port}->${edge.to.nodeId}:${edge.to.port}`,
            source: edge.from.nodeId,
            target: edge.to.nodeId,
            sourceHandle: edge.from.port,
            targetHandle: edge.to.port,
            selectable: false,
            focusable: false,
            style: blueprintEdgeStyle(false),
        }));
    }, [ir]);

    // Centre on wherever the game stopped, once per stop. Re-centring on every render would fight
    // an author who has panned away to look at something else while still paused.
    useEffect(() => {
        const focusKey = pausedNodeId ? `${graphId}:${pausedNodeId}:${focusNonce ?? 0}` : null;
        if (!focusKey || focusKey === lastFocusRef.current) {
            return;
        }
        const node = nodes.find(entry => entry.id === pausedNodeId);
        if (!node) {
            return;
        }
        lastFocusRef.current = focusKey;
        void flow.setCenter(node.position.x + 90, node.position.y + 40, { zoom: 1, duration: 220 });
    }, [flow, nodes, pausedNodeId, graphId, focusNonce]);

    const onNodeContextMenu = useCallback(
        (event: ReactMouseEvent, node: Node) => {
            event.preventDefault();
            props.onNodeContextMenu(event, node.id);
        },
        [props],
    );

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            edgesFocusable={false}
            proOptions={{ hideAttribution: true }}
            fitView={!pausedNodeId}
            minZoom={0.2}
            maxZoom={2}
            onNodeContextMenu={onNodeContextMenu}
        >
            <Background gap={16} size={1} />
        </ReactFlow>
    );
}

export function BlueprintReadonlyGraphView(props: BlueprintReadonlyGraphViewProps) {
    return (
        <div className={props.className ?? "h-full w-full"}>
            <ReactFlowProvider>
                <BlueprintReadonlyGraphViewInner {...props} />
            </ReactFlowProvider>
        </div>
    );
}
