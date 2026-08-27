import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type PointerEvent as ReactPointerEvent,
    type SetStateAction,
} from "react";
import { Maximize2 } from "lucide-react";
import type { DocumentChange, DocumentDiffEntry } from "@shared/documents/diff";
import type { TranslationKey, Translator } from "@shared/i18n";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import { uiGraphsSpec } from "@shared/documents/specs/uiGraphs";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { Select } from "@/lib/components/elements";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { getBlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import {
    resolveBlueprintLabel,
    resolveBlueprintNodeTitle,
} from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";
import type { RowReveal } from "../DocumentChangeList";
import { sidesOfEntry } from "./entrySides";
import {
    canvasReadFailure,
    CanvasColumn,
    CanvasNote,
    CanvasShell,
    MaskLegend,
    UnmarkedNote,
    useCanvasWidth,
    type CanvasSelection,
} from "./canvasShell";
import { CHANGE_MASK_CLASS, CHANGE_MASK_STROKE } from "./changeMask";
import { registerChangePresenter, type ChangePresenter, type ChangePresenterProps } from "./registry";
import { useSideDocument } from "./sideDocument";
import { RefusedAssetsNote, useVersionedAssets, VersionedAssetsProvider } from "./useVersionedAssets";
import {
    buildGraphDiffPlan,
    graphNodeBox,
    sharedGraphViewport,
    type GraphFacts,
    type GraphMask,
    type GraphViewport,
} from "./graphDiffPlan";
import {
    FITTED_GRAPH_NAV,
    frameGraphNavOn,
    graphNavBox,
    graphNavZoomFactor,
    isFittedGraphNav,
    panGraphNav,
    readableGraphNavZoom,
    zoomGraphNavAt,
    type GraphNav,
} from "./graphCanvasNav";
import {
    GRAPH_NODE_PIN_FONT,
    GRAPH_NODE_PIN_GUTTER,
    GRAPH_NODE_PIN_ROW,
    GRAPH_NODE_PIN_SIZE,
    GRAPH_NODE_SIDE_PADDING,
    GRAPH_NODE_TITLE_FONT,
    GRAPH_NODE_TITLE_HEIGHT,
    graphNodeShapes,
    graphPinPoint,
    graphShapeOf,
    type GraphNodeDescription,
    type GraphNodePinRow,
    type GraphNodeShape,
} from "./graphNodeShape";

/**
 * Two versions of one blueprint graph, side by side, with what changed washed over it.
 *
 * The interface canvas next door answers "what does the page look like now"; this answers the
 * question a list of node ids cannot even pose - **where** in the logic the edit landed. A blueprint
 * is a shape, and "the parameters of node `n_8f2c` changed" locates nothing.
 *
 * **Nothing is compiled to draw this.** The IR is in the file: a blueprint's event layer holds it at
 * `program.graphs.events[<id>].graph`, and every node carries the canvas position its author left it
 * at in `meta.editorLayout`. So a graph out of a revision is laid out from its own bytes, with no
 * workspace, no editor context and no build step between the two - which is what makes it drawable
 * inside a comparison pane at all.
 *
 * **It is a picture of a graph, not the editor's canvas.** A card is built the way the editor
 * builds one - a title bar over the pins the catalogue says the node has - and a wire ends on the
 * pin it is plugged into, because a wire that ended in the middle of a card's edge cannot say
 * which of five inputs the author rewired. What it is NOT is the editor: nothing here selects,
 * drags, edits or runs, no control on a card does anything, and the catalogue is consulted through
 * a lookup that is allowed to fail (see {@link describeGraphNode}).
 *
 * **Only what changed is in colour.** A node with no mark on it is drawn washed out, the way
 * Unreal's blueprint diff draws one, so that on a canvas of two hundred nodes the marked ones are
 * the only coloured things. A node that was merely dragged is marked and therefore keeps its
 * colour, even though its mark carries no hue - the weakest mark on the faintest card would be no
 * mark at all.
 *
 * **Both columns share one viewport.** Two graphs each fitted to their own column would put a node
 * that never moved in two different places, which an author reads as a change - so the box and the
 * scale are computed across both sides at once and a node only appears to move if it moved.
 *
 * **And one pan and zoom over it.** A graph of any size fitted into half a pane loses its titles
 * long before it loses its shape, so the picture can be dragged and magnified; the transform lives
 * here, above both columns, for the same reason the viewport does. See `graphCanvasNav.ts`.
 */

/** How tall the pair of graphs may get before the scale is pulled in. */
const CANVAS_MAX_HEIGHT = 360;

/** The gap between the two columns, in pixels - `gap-2`, where the scale can subtract it. */
const COLUMN_GAP = 8;

export function UIGraphsChangeDetail({ entry, change, sides }: ChangePresenterProps) {
    const { t, tn } = useTranslation();
    const requested = useMemo(() => sidesOfEntry(entry, sides), [entry, sides]);
    const base = useSideDocument<UIGraphDocument>(requested.before, entry.path, uiGraphsSpec);
    const head = useSideDocument<UIGraphDocument>(requested.after, entry.path, uiGraphsSpec);
    // One per column, for the reason the interface canvas next door gives. A graph card carries no
    // picture of its own today, but a node's title comes out of the catalogue and a node that names
    // an asset is one step away - and mounting the source per column is what makes it that step
    // rather than a second version of this decision.
    const baseAssets = useVersionedAssets(requested.before);
    const headAssets = useVersionedAssets(requested.after);

    const changes = entry.diff.changes;
    const plan = useMemo(
        () => buildGraphDiffPlan(changes, base.document, head.document),
        [changes, base.document, head.document],
    );

    const [chosenGraph, setChosenGraph] = useState<string | null>(null);
    const graphKey = plan.graphs.some(option => option.key === chosenGraph)
        ? chosenGraph
        : plan.defaultGraphKey;
    const option = plan.graphs.find(entryOption => entryOption.key === graphKey) ?? null;

    /**
     * The change the author singled out, and which way they reached it.
     *
     * A mark and a row ask opposite questions of one selection, and the answers differ: a mark asks
     * what changed on this node, which is answered by narrowing the list to that row; a row asks
     * where the change is, which is answered by moving the canvas onto it. Narrowing there would
     * take away the rows being stepped through, so which way it arrived has to be remembered - it
     * cannot be worked out afterwards from the index alone.
     */
    const [selection, setSelection] = useState<CanvasSelection | null>(null);
    const selected = selection?.index ?? null;
    const [frame, onFrame] = useCanvasWidth();
    // One transform for the pair. Held here rather than in either column, because a pan that moved
    // one side alone would break the one thing two columns are for.
    const [nav, setNav] = useState<GraphNav>(FITTED_GRAPH_NAV);

    const masks = useMemo(
        () => plan.masks.filter(mask => mask.graphKey === graphKey),
        [plan.masks, graphKey],
    );

    // Which drawn mark each row of the list belongs to, so a row can send the canvas to it. A leaf
    // under a change is entered as well as the change itself: the row an author reads is "moved on
    // the canvas", and the mark is on its parent. Anything not in here - a change on another graph,
    // one that belongs to no node - has nowhere to send them, and its row stays text.
    const revealable = useMemo(() => {
        const byChange = new Map<DocumentChange, GraphMask>();
        for (const mask of masks) {
            byChange.set(mask.change, mask);
            for (const child of mask.change.children ?? []) {
                byChange.set(child, mask);
            }
        }
        return byChange;
    }, [masks]);

    const baseGraph = graphKey ? plan.baseGraphs.get(graphKey) ?? null : null;
    const headGraph = graphKey ? plan.headGraphs.get(graphKey) ?? null : null;
    const columns = (baseGraph ? 1 : 0) + (headGraph ? 1 : 0);
    // One layout for the pair, for the reason there is one viewport: a card that came out a
    // different size on the two sides would be read as an edit to a node nobody touched.
    const shapes = useMemo(
        () => graphNodeShapes(
            [...(baseGraph?.nodes ?? []), ...(headGraph?.nodes ?? [])],
            [...(baseGraph?.edges ?? []), ...(headGraph?.edges ?? [])],
            type => describeGraphNode(type, t),
        ),
        [baseGraph, headGraph, t],
    );
    const viewport = sharedGraphViewport(
        [baseGraph?.nodes ?? [], headGraph?.nodes ?? []],
        {
            width: columns > 1 ? Math.max(0, (frame - COLUMN_GAP) / 2) : frame,
            height: CANVAS_MAX_HEIGHT,
        },
        node => graphShapeOf(shapes, node),
    );

    // A mark whose node is not in the graph it belongs to, on the side that has that graph. It
    // should not happen - the plan and the facts come out of one document - and is counted rather
    // than dropped, because "should not happen" is not a thing to leave a canvas silent about.
    const unplaced = masks.filter(mask => !placeable(mask, baseGraph, headGraph)).length;
    const failure = canvasReadFailure(base, head);

    /**
     * Go and look at one change: single it out, and bring what it is about into the middle.
     *
     * Two rules decide how close, and they pull against each other. Close enough to read, or the
     * author is put back where they started looking at a coloured speck - and one who has already
     * magnified past that picked their own magnification, which stepping to the next change must
     * not undo. But never so close that what is being shown does not fit: a node that was dragged
     * occupies two places in one picture, and a frame holding one of them answers a question nobody
     * asked. Fitting wins where they disagree, because the reading threshold is a preference and
     * half an answer is a wrong one.
     *
     * The floor is the fitted view. Every box here is part of a graph that fits whole at zoom 1, so
     * this can only ever be a way in.
     */
    const revealMask = useCallback((mask: GraphMask) => {
        setSelection({ index: mask.index, from: "row" });
        const box = graphMaskBox(mask, baseGraph, headGraph, shapes, viewport);
        if (!box) {
            return;
        }
        const frameBox = { width: viewport.width * viewport.scale, height: viewport.height * viewport.scale };
        const fits = Math.min(
            box.width > 0 ? frameBox.width / box.width : Number.POSITIVE_INFINITY,
            box.height > 0 ? frameBox.height / box.height : Number.POSITIVE_INFINITY,
        );
        const readable = readableGraphNavZoom(viewport.scale);
        setNav(current => frameGraphNavOn(
            box,
            frameBox,
            Math.max(1, Math.min(Math.max(current.zoom, readable), fits)),
        ));
    }, [baseGraph, headGraph, shapes, viewport]);

    const reveal = useMemo<RowReveal>(() => ({
        can: candidate => revealable.has(candidate),
        go: candidate => {
            const mask = revealable.get(candidate);
            if (mask) {
                revealMask(mask);
            }
        },
        label: t("documentDiff.canvas.markLabel"),
    }), [revealable, revealMask, t]);

    return (
        <CanvasShell
            entry={entry}
            change={change}
            selected={selection?.from === "mark" ? changes[selection.index] ?? null : null}
            onClearSelection={() => setSelection(null)}
            reveal={reveal}
            // Only for a selection that came from a row. A mark's selection has narrowed the list to
            // its one row already, and a fill under the only row on screen says nothing.
            activeChange={selection?.from === "row" ? changes[selection.index] ?? null : null}
            controls={(plan.graphs.length > 1 || option) && (
                <>
                    {plan.graphs.length > 1 && (
                        <Select
                            size="sm"
                            ariaLabel={t("documentDiff.canvas.graphLabel")}
                            value={graphKey ?? ""}
                            onChange={value => {
                                setChosenGraph(String(value));
                                setSelection(null);
                                // Another graph is another picture, and the pan that framed a node
                                // of this one frames nothing of that one.
                                setNav(FITTED_GRAPH_NAV);
                            }}
                            options={plan.graphs.map(graph => ({
                                value: graph.key,
                                label: [graph.blueprintName, graph.name ?? t("documentDiff.canvas.unnamed")]
                                    .filter(Boolean)
                                    .join(" · "),
                                secondaryLabel: graph.changes > 0
                                    ? tn("documentDiff.shell.changes", graph.changes)
                                    : undefined,
                            }))}
                        />
                    )}
                    {option && (
                        <ToolbarButton
                            size="sm"
                            bordered
                            disabled={isFittedGraphNav(nav)}
                            onClick={() => setNav(FITTED_GRAPH_NAV)}
                            aria-label={t("documentDiff.canvas.fitView")}
                            title={t("documentDiff.canvas.fitView")}
                            data-graph-fit
                        >
                            <Maximize2 className="h-3.5 w-3.5" />
                        </ToolbarButton>
                    )}
                </>
            )}
            legend={<MaskLegend tones={masks.map(mask => mask.tone)} />}
            notes={
                <>
                    {failure && <CanvasNote tone="danger">{t(failure.key, { error: failure.error })}</CanvasNote>}
                    <UnmarkedNote
                        elsewhere={plan.masks.length - masks.length}
                        elsewhereKey="documentDiff.canvas.onOtherGraphs"
                        offCanvas={plan.offCanvas.length}
                        unplaced={unplaced}
                    />
                    <RefusedAssetsNote sides={[baseAssets.refusals, headAssets.refusals]} />
                </>
            }
        >
            <div ref={onFrame} className="flex w-full items-start gap-2">
                {frame > 0 && option && (
                    <>
                        {baseGraph && (
                            <VersionedAssetsProvider source={baseAssets.source}>
                                <GraphColumn
                                    caption="documentDiff.canvas.before"
                                    graph={baseGraph}
                                    shapes={shapes}
                                    viewport={viewport}
                                    nav={nav}
                                    onNav={setNav}
                                    masks={masks.filter(mask => mask.onBase)}
                                    selected={selected}
                                    onSelect={index => setSelection({ index, from: "mark" })}
                                />
                            </VersionedAssetsProvider>
                        )}
                        {headGraph && (
                            <VersionedAssetsProvider source={headAssets.source}>
                                <GraphColumn
                                    caption="documentDiff.canvas.after"
                                    graph={headGraph}
                                    shapes={shapes}
                                    viewport={viewport}
                                    nav={nav}
                                    onNav={setNav}
                                    masks={masks.filter(mask => mask.onHead)}
                                    selected={selected}
                                    onSelect={index => setSelection({ index, from: "mark" })}
                                />
                            </VersionedAssetsProvider>
                        )}
                    </>
                )}
                {frame > 0 && !option && !failure && (
                    <p className="text-2xs text-fg-muted">{t("documentDiff.rows.loading")}</p>
                )}
            </div>
        </CanvasShell>
    );
}

/** Whether a side that is on screen holds the thing this mark is about. */
function placeable(mask: GraphMask, base: GraphFacts | null, head: GraphFacts | null): boolean {
    const sides = [mask.onBase ? base : null, mask.onHead ? head : null].filter(
        (graph): graph is GraphFacts => graph !== null,
    );
    if (sides.length === 0) {
        return false;
    }
    const target = mask.target;
    switch (target.kind) {
        case "graph":
            return true;
        case "node":
            return sides.some(graph => graph.nodes.some(node => node.id === target.nodeId));
        case "edge":
            return sides.some(graph => graph.edges.some(edge => edge.key === target.edgeKey));
    }
}

/** A rectangle of the fitted picture. */
interface Box {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

/** The smallest box holding all of them, or null when there are none. */
function boxUnion(boxes: readonly Box[]): Box | null {
    if (boxes.length === 0) {
        return null;
    }
    const left = Math.min(...boxes.map(box => box.left));
    const top = Math.min(...boxes.map(box => box.top));
    return {
        left,
        top,
        width: Math.max(...boxes.map(box => box.left + box.width)) - left,
        height: Math.max(...boxes.map(box => box.top + box.height)) - top,
    };
}

/**
 * Everything one mark stands for, in the fitted picture's units, over BOTH versions at once.
 *
 * Both, and that is the whole subtlety: the two columns share one transform, so a node that was
 * dragged is at two different places in that one picture. Framing the newer one alone centres the
 * card in the right-hand column and pushes the left-hand column's copy out of the frame - and
 * `there on one side, absent on the other` is what an ADDED node looks like. The author asked where
 * it moved and would have been shown something that reads as a different answer.
 *
 * An edge is framed on the two cards it joins rather than on the wire, because a wire's midpoint on
 * a long curve can sit over a third node entirely - and which connection changed is only legible
 * with both of its ends on screen.
 *
 * `null` for a mark with nowhere to go: a change to the graph itself wears the frame rather than a
 * card, and one whose node is in neither graph is already counted as unplaced.
 */
function graphMaskBox(
    mask: GraphMask,
    base: GraphFacts | null,
    head: GraphFacts | null,
    shapes: ReturnType<typeof graphNodeShapes>,
    viewport: GraphViewport,
): Box | null {
    const sides = [mask.onHead ? head : null, mask.onBase ? base : null].filter(
        (graph): graph is GraphFacts => graph !== null,
    );
    const target = mask.target;
    if (target.kind === "graph") {
        return null;
    }

    const boxOf = (graph: GraphFacts, nodeId: string): Box | null => {
        const node = graph.nodes.find(candidate => candidate.id === nodeId);
        return node ? graphNodeBox(node, viewport, graphShapeOf(shapes, node)) : null;
    };

    const found: Box[] = [];
    for (const graph of sides) {
        if (target.kind === "node") {
            const box = boxOf(graph, target.nodeId);
            if (box) {
                found.push(box);
            }
            continue;
        }
        const edge = graph.edges.find(candidate => candidate.key === target.edgeKey);
        const from = edge ? boxOf(graph, edge.from) : null;
        const to = edge ? boxOf(graph, edge.to) : null;
        if (from && to) {
            found.push(from, to);
        }
    }
    return boxUnion(found);
}

/* ---------------------------------------------------------------------------------------- */
/* One column                                                                                 */
/* ---------------------------------------------------------------------------------------- */

interface GraphColumnProps {
    readonly caption: TranslationKey;
    readonly graph: GraphFacts;
    /** Every card of both versions, laid out once. See {@link graphNodeShapes}. */
    readonly shapes: ReadonlyMap<string, GraphNodeShape>;
    readonly viewport: GraphViewport;
    /** The pan and zoom the pair shares. Both columns are handed the same one. */
    readonly nav: GraphNav;
    readonly onNav: Dispatch<SetStateAction<GraphNav>>;
    readonly masks: readonly GraphMask[];
    readonly selected: number | null;
    readonly onSelect: (index: number) => void;
}

function GraphColumn({
    caption,
    graph,
    shapes,
    viewport,
    nav,
    onNav,
    masks,
    selected,
    onSelect,
}: GraphColumnProps) {
    const { t } = useTranslation();
    const width = Math.round(viewport.width * viewport.scale);
    const height = Math.round(viewport.height * viewport.scale);
    const frame = useRef<HTMLDivElement | null>(null);
    const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
    const [panning, setPanning] = useState(false);

    /**
     * Ctrl (or Cmd) and the wheel zooms; the bare wheel is left alone.
     *
     * This canvas sits inside a pane the author scrolls to reach the rows under it, and a bare
     * wheel that zoomed would move the picture every time they went looking for the list. The same
     * division the interface editor draws, with the same figures behind it.
     *
     * Registered by hand because React's wheel listener is passive, and a passive listener cannot
     * stop the pane from scrolling the event it just used.
     */
    useEffect(() => {
        const element = frame.current;
        if (!element) {
            return;
        }
        const onWheel = (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) {
                return;
            }
            event.preventDefault();
            const box = element.getBoundingClientRect();
            onNav(current => zoomGraphNavAt(
                current,
                graphNavZoomFactor(event.deltaY, event.deltaMode, box.height),
                event.clientX - box.left,
                event.clientY - box.top,
                viewport.scale,
            ));
        };
        element.addEventListener("wheel", onWheel, { passive: false });
        return () => element.removeEventListener("wheel", onWheel);
    }, [onNav, viewport.scale]);

    // The drag is followed on the window rather than on the frame, so a hand that leaves the
    // picture mid-pull keeps panning instead of stopping at the border.
    useEffect(() => {
        if (!panning) {
            return;
        }
        const onMove = (event: PointerEvent) => {
            const from = drag.current;
            if (!from || from.pointerId !== event.pointerId) {
                return;
            }
            drag.current = { pointerId: from.pointerId, x: event.clientX, y: event.clientY };
            onNav(current => panGraphNav(current, event.clientX - from.x, event.clientY - from.y));
        };
        const stop = () => {
            drag.current = null;
            setPanning(false);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
        };
    }, [panning, onNav]);

    /**
     * The middle button drags from anywhere; the left one only from the background.
     *
     * A left drag begun on a card would have to decide on release whether it was a pull or the
     * click that selects the mark it started on, and a mark that sometimes does nothing is worse
     * than a card that is not a handle. Both canvases in the workspace pan from the middle button
     * for the same reason.
     */
    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        const fromBackground = event.target === event.currentTarget;
        if (event.button !== 1 && !(event.button === 0 && fromBackground)) {
            return;
        }
        event.preventDefault();
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        setPanning(true);
    };

    const nodeTone = new Map<string, GraphMask>();
    const edgeTone = new Map<string, GraphMask>();
    let frameTone: GraphMask | null = null;
    for (const mask of masks) {
        if (mask.target.kind === "node") nodeTone.set(mask.target.nodeId, mask);
        else if (mask.target.kind === "edge") edgeTone.set(mask.target.edgeKey, mask);
        else frameTone = mask;
    }

    // Graph units to drawn pixels. Everything on a card is a multiple of this and nothing is a CSS
    // transform, which is what keeps a border one pixel wide at four times in.
    const draw = viewport.scale * nav.zoom;

    // Fit first, then the view the author moved to - one composition, so a node's card, its mark
    // and the wires into it cannot land in three different places.
    const placed = new Map(graph.nodes.map(node => {
        const shape = graphShapeOf(shapes, node);
        return [node.id, { shape, box: onWholePixels(graphNavBox(graphNodeBox(node, viewport, shape), nav)) }];
    }));

    return (
        <figure className="flex min-w-0 flex-col gap-1">
            <div
                ref={frame}
                onPointerDown={onPointerDown}
                data-graph-canvas
                className={cn(
                    "relative select-none overflow-hidden rounded-md border bg-surface-canvas",
                    panning ? "cursor-grabbing" : "cursor-grab",
                    frameTone ? CHANGE_MASK_CLASS[frameTone.tone] : "border-edge",
                )}
                style={{ width, height }}
            >
                {/*
                  * The wires do not take the pointer, only their own hit strokes do (those set it
                  * back on themselves). Without this the picture would have no background to drag
                  * from: this layer covers every pixel of the frame.
                  */}
                <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden>
                    {graph.edges.map(edge => {
                        const from = placed.get(edge.from);
                        const to = placed.get(edge.to);
                        if (!from || !to) {
                            return null;
                        }
                        const mask = edgeTone.get(edge.key);
                        const path = wirePath(
                            wireEnd(from, "output", edge.fromPort, draw),
                            wireEnd(to, "input", edge.toPort, draw),
                        );
                        // Execution runs heavier than a value, as it does in the editor. Both stay
                        // the same width at every zoom: a stroke is not geometry, and one that
                        // thickened on the way in would end up a band across the card it points at.
                        const exec = from.shape.outputs.some(pin => pin.id === edge.fromPort && pin.exec);
                        return (
                            <g key={edge.key}>
                                <path
                                    d={path}
                                    fill="none"
                                    className={mask ? CHANGE_MASK_STROKE[mask.tone] : "stroke-edge-strong"}
                                    strokeWidth={mask ? 2 : exec ? 1.5 : 1}
                                    // A removed wire is drawn as one that is no longer joined up:
                                    // colour alone would read as "this wire is special", which is
                                    // not what happened to it.
                                    strokeDasharray={mask?.tone === "removed" ? "4 3" : undefined}
                                />
                                {mask && (
                                    <path
                                        d={path}
                                        fill="none"
                                        stroke="transparent"
                                        // The hit area, not the wire: a 2px line is not something
                                        // anyone can click.
                                        strokeWidth={10}
                                        style={{ pointerEvents: "stroke", cursor: "pointer" }}
                                        onClick={() => onSelect(mask.index)}
                                    />
                                )}
                            </g>
                        );
                    })}
                </svg>

                {graph.nodes.map(node => {
                    const held = placed.get(node.id);
                    if (!held) {
                        return null;
                    }
                    return (
                        <GraphNodeCard
                            key={node.id}
                            title={held.shape.title || node.type}
                            shape={held.shape}
                            box={held.box}
                            draw={draw}
                            mask={nodeTone.get(node.id) ?? null}
                            selected={selected}
                            onSelect={onSelect}
                        />
                    );
                })}

                {graph.nodes.length === 0 && (
                    <span className="pointer-events-none absolute inset-0 grid place-items-center px-2 text-center text-2xs text-fg-muted">
                        {t("documentDiff.canvas.emptyGraph")}
                    </span>
                )}
            </div>
            <CanvasColumn caption={caption} detail={null} />
        </figure>
    );
}

/* ---------------------------------------------------------------------------------------- */
/* One node                                                                                   */
/* ---------------------------------------------------------------------------------------- */

interface GraphNodeCardProps {
    readonly title: string;
    readonly shape: GraphNodeShape;
    readonly box: { left: number; top: number; width: number; height: number };
    /** Graph units to drawn pixels: the shared scale times the view's zoom. */
    readonly draw: number;
    /** The mark this node wears, or null for a node nothing happened to. */
    readonly mask: GraphMask | null;
    readonly selected: number | null;
    readonly onSelect: (index: number) => void;
}

/**
 * One node, drawn the way the editor draws one, in a pane where it cannot be touched.
 *
 * **A node with no mark on it is washed out.** Unreal's blueprint diff, and for Unreal's reason: a
 * graph is mostly nodes nobody edited, and if they are all in colour the four that changed have to
 * be hunted for. What Unreal is criticised for is the other half of the same idea - a node that
 * was merely dragged filed as an ordinary change - and that is answered in `changeMask.ts`, where
 * a relocation gets the one mark that carries no hue. Here a dragged node is still a MARKED node
 * and so keeps its colour; the faintest mark on a washed-out card would be no mark at all.
 */
function GraphNodeCard({ title, shape, box, draw, mask, selected, onSelect }: GraphNodeCardProps) {
    const { t } = useTranslation();
    const lit = mask !== null;
    const titleHeight = GRAPH_NODE_TITLE_HEIGHT * draw;
    // Below these the row is thinner than the mark that would sit on it and the label is smaller
    // than a legible glyph, so the pins are left off rather than drawn as grit. The wires still
    // end where the pins are: the geometry does not depend on anything being visible.
    const pins = GRAPH_NODE_PIN_ROW * draw >= 5;
    const labels = pins && GRAPH_NODE_PIN_FONT * draw >= 6;
    const room = shape.inputs.length > 0 && shape.outputs.length > 0
        ? shape.width / 2 - GRAPH_NODE_PIN_GUTTER
        : shape.width - GRAPH_NODE_PIN_GUTTER * 2;

    return (
        <div
            className={cn(
                "absolute overflow-hidden rounded-md border",
                lit ? "border-edge bg-surface-raised" : "border-edge-subtle bg-surface",
            )}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        >
            <span
                className={cn(
                    "block truncate border-b border-edge-subtle text-2xs",
                    lit ? "text-fg" : "text-fg-muted",
                )}
                // The card is drawn at the shared scale, and its text with it, so a dense graph
                // stays a graph rather than becoming a wall of labels - and so zooming in is what
                // makes a title legible again.
                style={{
                    height: titleHeight,
                    lineHeight: `${titleHeight}px`,
                    paddingInline: GRAPH_NODE_SIDE_PADDING * draw,
                    fontSize: `${Math.max(7, GRAPH_NODE_TITLE_FONT * draw)}px`,
                }}
            >
                {title}
            </span>

            {pins && (
                <svg
                    className="pointer-events-none absolute inset-0"
                    width={box.width}
                    height={box.height}
                    aria-hidden
                >
                    {[...shape.inputs, ...shape.outputs].map(pin => (
                        <PinMark key={`${pin.kind}:${pin.id}`} pin={pin} shape={shape} draw={draw} lit={lit} />
                    ))}
                </svg>
            )}

            {labels && [...shape.inputs, ...shape.outputs].map(pin => (
                <span
                    key={`${pin.kind}:${pin.id}`}
                    className={cn(
                        "absolute truncate text-2xs",
                        lit ? "text-fg-muted" : "text-fg-subtle",
                        pin.kind === "output" && "text-right",
                    )}
                    style={{
                        [pin.kind === "input" ? "left" : "right"]: GRAPH_NODE_PIN_GUTTER * draw,
                        top: (pin.y - GRAPH_NODE_PIN_ROW / 2) * draw,
                        height: GRAPH_NODE_PIN_ROW * draw,
                        lineHeight: `${GRAPH_NODE_PIN_ROW * draw}px`,
                        maxWidth: Math.max(0, room) * draw,
                        fontSize: `${GRAPH_NODE_PIN_FONT * draw}px`,
                    }}
                >
                    {pin.label}
                </span>
            ))}

            {mask && (
                <button
                    type="button"
                    onClick={() => onSelect(mask.index)}
                    aria-label={t("documentDiff.canvas.markLabel")}
                    data-change-mask={mask.tone}
                    data-change-index={mask.index}
                    // The mark covers the card it belongs to at any zoom, because the card's own
                    // box was computed with the zoom in it. Its border stays one pixel: zoom is
                    // arithmetic here rather than a CSS scale, and a mark that thickened on the way
                    // in would end up a frame drawn over the title it was meant to point at.
                    className={cn(
                        "nl-focus-ring absolute inset-0 border",
                        CHANGE_MASK_CLASS[mask.tone],
                        selected === mask.index && "outline outline-2 outline-offset-1 outline-primary",
                    )}
                />
            )}
        </div>
    );
}

/**
 * The thing a wire plugs into: an arrow for execution, a disc for a value.
 *
 * Shape rather than colour, which is how a blueprint editor tells the two apart anyway, and which
 * leaves the palette to the four change tones - a canvas where a pin and a mark competed for the
 * same colour would say two things at once about the same card.
 */
function PinMark({ pin, shape, draw, lit }: {
    readonly pin: GraphNodePinRow;
    readonly shape: GraphNodeShape;
    readonly draw: number;
    readonly lit: boolean;
}) {
    const point = graphPinPoint(shape, pin.kind, pin.id);
    const x = point.x * draw;
    const y = point.y * draw;
    // A mark is part of the card and scales with it, but not without limit: fitted out to a
    // forty-node graph it would be a subpixel, and four times in it would be wider than its row.
    const size = Math.min(9, Math.max(2.5, GRAPH_NODE_PIN_SIZE * draw));
    const tone = lit ? (pin.exec ? "fill-primary" : "fill-fg-muted") : "fill-fg-subtle";
    if (!pin.exec) {
        return <circle className={tone} cx={x} cy={y} r={size / 2} />;
    }
    const half = size / 2;
    return <path className={tone} d={`M ${x - half} ${y - half} L ${x + half} ${y} L ${x - half} ${y + half} Z`} />;
}

/* ---------------------------------------------------------------------------------------- */
/* Wires and the catalogue                                                                    */
/* ---------------------------------------------------------------------------------------- */

/**
 * A card's box, snapped to whole pixels.
 *
 * Every border here is one pixel and stays one pixel at any zoom, which is what doing the zoom as
 * arithmetic buys - but a one pixel border at a fractional offset is painted across two rows of
 * pixels and comes out two wide and grey, which undoes it. The rounding reads nothing but the box
 * it is handed, so a node at the same coordinates in both versions still lands in the same place
 * in both columns.
 */
function onWholePixels(
    box: { left: number; top: number; width: number; height: number },
): { left: number; top: number; width: number; height: number } {
    return {
        left: Math.round(box.left),
        top: Math.round(box.top),
        width: Math.round(box.width),
        height: Math.round(box.height),
    };
}

/** Where one end of a wire lands on the canvas, from the pin it is plugged into. */
function wireEnd(
    placed: { shape: GraphNodeShape; box: { left: number; top: number } },
    kind: "input" | "output",
    pinId: string,
    draw: number,
): { x: number; y: number } {
    const point = graphPinPoint(placed.shape, kind, pinId);
    return { x: placed.box.left + point.x * draw, y: placed.box.top + point.y * draw };
}

/** A wire from one pin to another, bowed so parallel runs stay apart. */
function wirePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
    const bow = Math.max(24, Math.abs(to.x - from.x) / 2);
    return `M ${from.x} ${from.y} C ${from.x + bow} ${from.y}, ${to.x - bow} ${to.y}, ${to.x} ${to.y}`;
}

/**
 * What a node is, in the author's language: its title, and the pins the editor would draw on it.
 *
 * The catalogue is a workspace singleton and this pane must not depend on it having been built: a
 * comparison that threw because a node table was not ready would take the whole detail pane with
 * it. A type identifier on a card with no pins is a worse picture and an honest one, and every
 * step below it - the card's size, where its wires end - is written to work from that.
 */
function describeGraphNode(type: string, t: Translator["t"]): GraphNodeDescription {
    try {
        const catalog = getBlueprintNodeEditorCatalogEntry(type);
        if (!catalog) {
            return { title: type, pins: [] };
        }
        return {
            title: resolveBlueprintNodeTitle(catalog.displayName, t),
            pins: (catalog.pins ?? []).map(pin => ({
                id: pin.id,
                kind: pin.kind,
                exec: pin.semantic === "exec",
                label: resolveBlueprintLabel(pin.label ?? pin.id, t),
            })),
        };
    } catch {
        return { title: type, pins: [] };
    }
}

export const uiGraphsChangePresenter: ChangePresenter = {
    id: "ui-graphs",
    matches: (entry: DocumentDiffEntry) => entry.documentKind === "ui-graphs",
    Detail: UIGraphsChangeDetail,
};

// Registered on import, and imported for that effect by `ChangeDetailHost`.
registerChangePresenter(uiGraphsChangePresenter);
