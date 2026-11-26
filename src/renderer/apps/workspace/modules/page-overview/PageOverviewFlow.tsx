import "@xyflow/react/dist/style.css";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    Background,
    Handle,
    MiniMap,
    PanOnScrollMode,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useNodesInitialized,
    useReactFlow,
    useUpdateNodeInternals,
    type Edge,
    type Node,
    type NodeChange,
    type NodeProps,
} from "@xyflow/react";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import { useTranslation } from "@/lib/i18n";
import type { SelectOption } from "@/lib/components/elements";
import { BLUEPRINT_EXEC_EDGE_COLOR, BLUEPRINT_EDGE_STROKE_WIDTH } from "@/lib/ui-editor/blueprint-graph-edge-style";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { BLUEPRINT_MINIMAP_SIZES } from "../blueprint-lite/flow/blueprintMinimapPreference";
import { LivePreviewFrame } from "../ui-editor/panel/LivePreviewFrame";
import { OverviewGroupCard, type OverviewBlueprintPreviewSource } from "./OverviewGroupCard";
import { OverviewPagePreview } from "./OverviewPagePreview";
import type { OverviewEditServices } from "./pageOverviewEdits";
import {
    buildOverviewGraph,
    exitHandleId,
    IN_HANDLE,
    layoutOverviewGraph,
    OVERVIEW_DEST_W,
    OVERVIEW_HEADER_PIN_Y,
    OVERVIEW_PAGE_W,
    ownHandleId,
    pageNodeId,
    type OverviewBlock,
    type OverviewNodeSpec,
    type OverviewSize,
} from "./pageOverviewGraph";
import { PAGE_EXITS_GROUP_KEY, type OverviewDestination } from "./pageOverviewLayout";
import type { PageOverview, PageOverviewExit, PageOverviewGroup } from "./pageOverviewModel";
import type { PageOverviewMode } from "./pageOverviewTabId";
import { destinationKind, destinationName, destinationNote, type OverviewNames } from "./pageOverviewText";

/** Pins drawn exactly as the blueprint editor draws an exec pin. */
const EXEC_HANDLE_CLASS = "!h-2 !w-2 !border border-edge-strong !bg-primary";
/** The pins an ownership line joins: quieter, since that line says where a control is, not where it goes. */
const OWN_HANDLE_CLASS = "!h-2 !w-2 !border border-edge-strong !bg-surface-overlay";
/** As the blueprint editor pans: the middle button drags, the wheel scrolls, a pinch zooms. */
const PAN_BUTTONS = [1, 2];
const PREVIEW_W = OVERVIEW_PAGE_W - 16;

/** Everything a node needs that is not its own id: the overview's data and the actions it can take. */
export type PageOverviewFlowEnv = {
    document: UIDocument;
    documentService: UIDocumentService | null;
    names: OverviewNames;
    headTitle: (headType: string) => string;
    renderSurface: (surface: UISurface) => ReactNode;
    surfaceRevision: (surfaceId: string) => number;
    selection: { surfaceId: string; elementId: string } | null;
    onSelectFromPreview: (surfaceId: string, elementId: string) => void;
    expanded: ReadonlySet<string>;
    onToggle: (key: string, elementId: string | null, surfaceId: string) => void;
    edit: OverviewEditServices | null;
    blueprintPreview: OverviewBlueprintPreviewSource;
    readOnly: boolean;
    retargetFor: (surfaceId: string, group: PageOverviewGroup | null, overview: PageOverview, exits: readonly PageOverviewExit[]) => { exit: PageOverviewExit; value: string; options: SelectOption[]; onChange: (surfaceId: string) => void } | null;
    onOpenLogic: (surface: UISurface, overview: PageOverview, group: PageOverviewGroup | null, exit?: PageOverviewExit) => void;
    onMoreProperties: (surfaceId: string, elementId: string) => void;
    onDestination: (destination: OverviewDestination) => void;
};

type FlowContextValue = PageOverviewFlowEnv & {
    blocks: ReadonlyMap<string, OverviewBlock>;
    onPins: (surfaceId: string, pins: ReadonlyArray<{ elementId: string; y: number }>) => void;
    pins: ReadonlyMap<string, ReadonlyArray<{ elementId: string; y: number }>>;
};

const FlowContext = createContext<FlowContextValue | null>(null);

function useFlowEnv(): FlowContextValue {
    const value = useContext(FlowContext);
    if (!value) {
        throw new Error("Page Overview node rendered outside its canvas");
    }
    return value;
}

/** The key an expanded card is remembered by, unique across pages for "All pages". */
export function overviewGroupKey(surfaceId: string, groupKey: string): string {
    return `${surfaceId}\u0000${groupKey}`;
}

type SpecData = { spec: OverviewNodeSpec };

/** The page: where a run starts, drawn like an event head - the accent edge on the left. */
const PageNode = memo(function PageNode({ id, data }: NodeProps<Node<SpecData>>) {
    const env = useFlowEnv();
    const { t, tn } = useTranslation();
    const updateNodeInternals = useUpdateNodeInternals();
    const spec = data.spec;
    const block = env.blocks.get(spec.surfaceId);
    const surface = env.document.surfaces.find(candidate => candidate.id === spec.surfaceId);
    const pins = env.pins.get(spec.surfaceId) ?? [];
    const elementIds = useMemo(() => block?.overview.groups.map(group => group.elementId) ?? [], [block]);
    const elementNames = useMemo(() => new Map(block?.overview.groups.map(group => [group.elementId, group.name]) ?? []), [block]);
    const onPins = useCallback((next: ReadonlyArray<{ elementId: string; y: number }>) => env.onPins(spec.surfaceId, next), [env, spec.surfaceId]);
    useEffect(() => {
        updateNodeInternals(id);
    }, [id, pins, updateNodeInternals]);
    if (!block || !surface) {
        return null;
    }
    const overview = block.overview;
    return (
        <div
            className="relative rounded-md border border-l-2 border-edge border-l-primary/70 bg-surface-raised text-xs shadow-md"
            style={{ width: OVERVIEW_PAGE_W }}
            data-page-overview-page={surface.id}
        >
            <Handle type="target" position={Position.Left} id={IN_HANDLE} className={EXEC_HANDLE_CLASS} style={{ top: OVERVIEW_HEADER_PIN_Y }} isConnectable={false} />
            <div className="border-b border-edge-subtle px-2 py-1.5">
                <div className="text-2xs text-fg-muted">{t("uiEditor.pageOverview.target.pageKind")}</div>
                <div className="truncate font-medium leading-tight text-fg">{overview.name}</div>
            </div>
            <div className="p-2">
                <OverviewPagePreview
                    surface={surface}
                    document={env.document}
                    elementIds={elementIds}
                    elementNames={elementNames}
                    width={PREVIEW_W}
                    contentRevision={env.surfaceRevision(surface.id)}
                    renderSurface={env.renderSurface}
                    selectedElementId={env.selection?.surfaceId === surface.id ? env.selection.elementId : null}
                    onSelect={elementId => env.onSelectFromPreview(surface.id, elementId)}
                    edit={env.readOnly ? null : env.edit}
                    onPins={onPins}
                />
            </div>
            <div className="flex flex-col gap-0.5 px-2 pb-2 text-2xs text-fg-subtle">
                <span>{tn("uiEditor.pageOverview.elements", overview.groups.length)}</span>
                {overview.hiddenCount > 0 ? <span>{tn("uiEditor.pageOverview.hidden", overview.hiddenCount)}</span> : null}
                {!env.readOnly && overview.groups.length > 0 ? <span>{t("uiEditor.pageOverview.dragHint")}</span> : null}
            </div>
            {/* A pin beside each control, at the height it is drawn in the preview. */}
            {pins.map(pin => (
                <Handle
                    key={pin.elementId}
                    type="source"
                    position={Position.Right}
                    id={ownHandleId(pin.elementId)}
                    className={OWN_HANDLE_CLASS}
                    style={{ top: pin.y }}
                    isConnectable={false}
                />
            ))}
        </div>
    );
});

/** A control: a card with an exec pin per place its logic leads. */
const GroupNode = memo(function GroupNode({ data }: NodeProps<Node<SpecData>>) {
    const env = useFlowEnv();
    const { t } = useTranslation();
    const spec = data.spec;
    if (spec.kind !== "group") {
        return null;
    }
    const block = env.blocks.get(spec.surfaceId);
    const surface = env.document.surfaces.find(candidate => candidate.id === spec.surfaceId);
    if (!block || !surface) {
        return null;
    }
    const overview = block.overview;
    const isPage = spec.groupKey === PAGE_EXITS_GROUP_KEY;
    const group = isPage ? null : overview.groups.find(candidate => candidate.elementId === spec.groupKey) ?? null;
    if (!isPage && !group) {
        return null;
    }
    const key = overviewGroupKey(surface.id, spec.groupKey);
    const expanded = env.expanded.has(key);
    const exits = group ? group.exits : overview.pageExits;
    const notes: string[] = [];
    if (group?.hasScriptLayer) {
        notes.push(t("uiEditor.pageOverview.group.scriptLayer"));
    }
    if (group?.linkedComponent) {
        notes.push(t("uiEditor.pageOverview.group.component"));
    }
    return (
        <OverviewGroupCard
            groupKey={spec.groupKey}
            title={group ? group.name : t("uiEditor.pageOverview.pageEvents")}
            caption={group ? widgetModuleRegistry.get(group.widgetType)?.displayName ?? group.widgetType : overview.name}
            exits={exits}
            names={env.names}
            headTitle={env.headTitle}
            expanded={expanded}
            selected={Boolean(group) && env.selection?.surfaceId === surface.id && env.selection.elementId === group?.elementId}
            onToggle={() => env.onToggle(key, group?.elementId ?? null, surface.id)}
            element={group ? env.document.elements[group.elementId] : undefined}
            revision={env.surfaceRevision(surface.id)}
            surfaceId={surface.id}
            documentService={env.documentService}
            hasBlueprint={Boolean(group ? group.blueprintId : overview.pageBlueprintId)}
            blueprintId={group ? group.blueprintId : overview.pageBlueprintId}
            preview={env.blueprintPreview}
            notes={notes}
            readOnly={env.readOnly}
            retarget={expanded ? env.retargetFor(surface.id, group, overview, exits) : null}
            onOpenLogic={exit => env.onOpenLogic(surface, overview, group, exit)}
            onMoreProperties={group ? () => env.onMoreProperties(surface.id, group.elementId) : undefined}
            inHandle={isPage ? undefined : (
                <Handle type="target" position={Position.Left} id={IN_HANDLE} className={OWN_HANDLE_CLASS} style={{ top: OVERVIEW_HEADER_PIN_Y }} isConnectable={false} />
            )}
            renderExitHandle={exit => (
                <Handle type="source" position={Position.Right} id={exitHandleId(exit)} className={EXEC_HANDLE_CLASS} isConnectable={false} />
            )}
        />
    );
});

/** Where a run ends, drawn like a terminal node - the accent edge on the right. */
const DestinationNode = memo(function DestinationNode({ data }: NodeProps<Node<SpecData>>) {
    const env = useFlowEnv();
    const { t } = useTranslation();
    const spec = data.spec;
    if (spec.kind !== "dest") {
        return null;
    }
    const destination = spec.destination;
    const target = destination.target;
    const page = target.kind === "page" && !target.missing ? env.document.surfaces.find(surface => surface.id === target.surfaceId) : undefined;
    const followable = Boolean(page) || (target.kind === "story" && Boolean(target.sceneId));
    const uncertain = target.kind === "dynamic" || target.kind === "unset" || (target.kind === "page" && target.missing);
    const note = destinationNote(destination, t);
    return (
        <div
            className={`relative rounded-md border border-r-2 bg-surface-raised text-xs shadow-md ${
                uncertain ? "border-dashed border-warning/80" : "border-edge border-r-primary/70"
            }`}
            style={{ width: OVERVIEW_DEST_W }}
            data-page-overview-destination={destination.key}
        >
            <Handle type="target" position={Position.Left} id={IN_HANDLE} className={EXEC_HANDLE_CLASS} style={{ top: OVERVIEW_HEADER_PIN_Y }} isConnectable={false} />
            <button
                type="button"
                className={`block w-full rounded-t-md border-b border-edge-subtle px-2 py-1.5 text-left ${followable ? "hover:bg-fill-subtle" : "cursor-default"}`}
                onClick={followable ? () => env.onDestination(destination) : undefined}
                data-tip={page ? t("uiEditor.pageOverview.target.jumpToPage") : undefined}
            >
                <span className={`block text-2xs ${uncertain ? "text-warning" : "text-fg-muted"}`}>{destinationKind(destination, t)}</span>
                <span className="block truncate font-medium leading-tight text-fg">{destinationName(target, destination.verb, env.names, t)}</span>
            </button>
            {page ? (
                <div className="p-2">
                    <LivePreviewFrame
                        previewId={`overview-destination:${page.id}`}
                        contentRevision={env.surfaceRevision(page.id)}
                        render={() => env.renderSurface(page)}
                        designWidth={page.designSize.width}
                        designHeight={page.designSize.height}
                        frameHeight={Math.round(((OVERVIEW_DEST_W - 16) * page.designSize.height) / Math.max(1, page.designSize.width))}
                        className="overflow-hidden rounded-sm bg-surface-canvas"
                    />
                </div>
            ) : null}
            {note ? <div className="px-2 py-1.5 text-2xs text-fg-muted">{note}</div> : null}
        </div>
    );
});

const NODE_TYPES = { overviewPage: PageNode, overviewGroup: GroupNode, overviewDest: DestinationNode };

const KIND_TO_TYPE: Record<OverviewNodeSpec["kind"], keyof typeof NODE_TYPES> = {
    page: "overviewPage",
    group: "overviewGroup",
    dest: "overviewDest",
};

export type PageOverviewFlowProps = PageOverviewFlowEnv & {
    blocks: readonly OverviewBlock[];
    mode: PageOverviewMode;
    showJumps: boolean;
    showOwnership: boolean;
    /** Moves to bring a page into view: the page and a counter, so asking twice frames it twice. */
    focus: { surfaceId: string | null; nonce: number };
    /** Moves to throw away the positions the author dragged nodes to and arrange the canvas again. */
    arrangeNonce: number;
};

/** The blueprint canvas the overview is drawn on. */
export function PageOverviewFlow(props: PageOverviewFlowProps) {
    return (
        <ReactFlowProvider>
            <PageOverviewFlowInner {...props} />
        </ReactFlowProvider>
    );
}

function PageOverviewFlowInner(props: PageOverviewFlowProps) {
    const { blocks, mode, showJumps, showOwnership, focus, arrangeNonce, ...env } = props;
    const { t } = useTranslation();
    const flow = useReactFlow();
    const [sizes, setSizes] = useState<ReadonlyMap<string, OverviewSize>>(() => new Map());
    const [moved, setMoved] = useState<ReadonlyMap<string, { x: number; y: number }>>(() => new Map());
    const [pins, setPins] = useState<ReadonlyMap<string, ReadonlyArray<{ elementId: string; y: number }>>>(() => new Map());

    useEffect(() => {
        setMoved(new Map());
    }, [arrangeNonce, mode]);

    const onPins = useCallback((surfaceId: string, next: ReadonlyArray<{ elementId: string; y: number }>) => {
        setPins(previous => {
            const current = previous.get(surfaceId);
            if (current && current.length === next.length && current.every((pin, index) => pin.elementId === next[index].elementId && pin.y === next[index].y)) {
                return previous;
            }
            const copy = new Map(previous);
            copy.set(surfaceId, next);
            return copy;
        });
    }, []);

    const graph = useMemo(() => buildOverviewGraph(blocks, mode), [blocks, mode]);
    const positions = useMemo(() => layoutOverviewGraph(blocks, mode, sizes), [blocks, mode, sizes]);

    const nodes = useMemo<Node<SpecData>[]>(() => graph.nodes.map(spec => ({
        id: spec.id,
        type: KIND_TO_TYPE[spec.kind],
        data: { spec },
        position: moved.get(spec.id) ?? positions.get(spec.id) ?? { x: 0, y: 0 },
        ...(sizes.get(spec.id) ? { measured: sizes.get(spec.id) } : {}),
        selectable: false,
        connectable: false,
        deletable: false,
    })), [graph, moved, positions, sizes]);

    // Quieter than an exec wire, but drawn heavy enough to survive the canvas being zoomed out.
    const ownStyle = useMemo(() => ({ stroke: "rgb(var(--nl-fg-muted))", strokeWidth: 1.25, strokeDasharray: "4 3" }), []);
    const edges = useMemo<Edge[]>(() => graph.edges
        .filter(edge => (edge.kind === "own" ? showOwnership : showJumps))
        .map(edge => ({
            id: edge.id,
            source: edge.source,
            sourceHandle: edge.sourceHandle,
            target: edge.target,
            targetHandle: edge.targetHandle,
            selectable: false,
            focusable: false,
            style: edge.kind === "own"
                ? ownStyle
                : {
                    stroke: BLUEPRINT_EXEC_EDGE_COLOR,
                    strokeWidth: BLUEPRINT_EDGE_STROKE_WIDTH,
                    ...(edge.kind === "dynamic" ? { strokeDasharray: "5 4" } : {}),
                },
        })), [graph, ownStyle, showJumps, showOwnership]);

    const onNodesChange = useCallback((changes: NodeChange<Node<SpecData>>[]) => {
        let nextSizes: Map<string, OverviewSize> | null = null;
        let nextMoved: Map<string, { x: number; y: number }> | null = null;
        for (const change of changes) {
            if (change.type === "dimensions" && change.dimensions) {
                const current = (nextSizes ?? sizes).get(change.id);
                if (!current || Math.abs(current.width - change.dimensions.width) >= 0.5 || Math.abs(current.height - change.dimensions.height) >= 0.5) {
                    nextSizes ??= new Map(sizes);
                    nextSizes.set(change.id, { width: change.dimensions.width, height: change.dimensions.height });
                }
            } else if (change.type === "position" && change.position && change.dragging) {
                nextMoved ??= new Map(moved);
                nextMoved.set(change.id, change.position);
            }
        }
        if (nextSizes) {
            setSizes(nextSizes);
        }
        if (nextMoved) {
            setMoved(nextMoved);
        }
    }, [moved, sizes]);

    // Frame the canvas once its nodes have been measured, and again whenever a page is asked for.
    const initialized = useNodesInitialized();
    const framed = useRef<string | null>(null);
    useEffect(() => {
        if (!initialized) {
            return;
        }
        const key = `${mode}:${focus.surfaceId ?? ""}:${focus.nonce}:${blocks.length}`;
        if (framed.current === key) {
            return;
        }
        framed.current = key;
        const surfaceId = focus.surfaceId && blocks.some(block => block.surfaceId === focus.surfaceId) ? focus.surfaceId : blocks[0]?.surfaceId;
        if (!surfaceId) {
            return;
        }
        // The page and everything in its block: its own cards and boxes.
        const ids = graph.nodes.filter(spec => spec.surfaceId === surfaceId).map(spec => ({ id: spec.id }));
        void flow.fitView({ nodes: ids.length > 0 ? ids : [{ id: pageNodeId(surfaceId) }], padding: 0.12, maxZoom: 1, duration: 0 });
    }, [blocks, flow, focus, graph, initialized, mode]);

    const contextValue = useMemo<FlowContextValue>(() => ({
        ...env,
        blocks: new Map(blocks.map(block => [block.surfaceId, block])),
        onPins,
        pins,
        // `env` is rebuilt by the parent on every render; the fields that matter are listed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [blocks, onPins, pins, env.document, env.documentService, env.names, env.headTitle, env.renderSurface, env.surfaceRevision, env.selection, env.onSelectFromPreview, env.expanded, env.onToggle, env.edit, env.blueprintPreview, env.readOnly, env.retargetFor, env.onOpenLogic, env.onMoreProperties, env.onDestination]);

    return (
        <FlowContext.Provider value={contextValue}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                onNodesChange={onNodesChange}
                nodesConnectable={false}
                nodesDraggable
                elementsSelectable={false}
                deleteKeyCode={null}
                selectionKeyCode={null}
                multiSelectionKeyCode={null}
                panOnDrag={PAN_BUTTONS}
                panOnScroll
                panOnScrollMode={PanOnScrollMode.Free}
                panOnScrollSpeed={1}
                zoomOnScroll={false}
                zoomOnPinch
                zoomOnDoubleClick={false}
                minZoom={0.15}
                maxZoom={1.5}
                className="narraleaf-blueprint-flow bg-surface"
                proOptions={{ hideAttribution: true }}
                data-page-overview-flow=""
            >
                <Background color="rgb(var(--nl-fg-subtle))" gap={20} size={1} />
                <MiniMap
                    pannable
                    style={BLUEPRINT_MINIMAP_SIZES.medium}
                    ariaLabel={`${t("blueprint.minimap.label")} — ${t("blueprint.minimap.hint")}`}
                    nodeColor="rgb(var(--nl-fg-subtle) / 0.55)"
                    nodeStrokeColor="rgb(var(--nl-fg-muted))"
                    nodeStrokeWidth={2}
                    maskColor="rgb(var(--nl-surface-sunken) / 0.55)"
                    maskStrokeColor="rgb(var(--nl-primary))"
                    maskStrokeWidth={1}
                    className="!m-4 !rounded-md !border !border-edge-strong !bg-surface-overlay shadow-lg cursor-grab active:cursor-grabbing"
                />
            </ReactFlow>
        </FlowContext.Provider>
    );
}
