import { useMemo, useState } from "react";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import type { TranslationKey, Translator } from "@shared/i18n";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import { uiGraphsSpec } from "@shared/documents/specs/uiGraphs";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { Select } from "@/lib/components/elements";
import { getBlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { resolveBlueprintNodeTitle } from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";
import { sidesOfEntry } from "./bitmapPreview";
import {
    canvasReadFailure,
    CanvasColumn,
    CanvasNote,
    CanvasShell,
    MaskLegend,
    UnmarkedNote,
    useCanvasWidth,
} from "./canvasShell";
import { CHANGE_MASK_CLASS, CHANGE_MASK_STROKE } from "./changeMask";
import { registerChangePresenter, type ChangePresenter, type ChangePresenterProps } from "./registry";
import { useSideDocument } from "./sideDocument";
import {
    buildGraphDiffPlan,
    graphNodeBox,
    sharedGraphViewport,
    type GraphFacts,
    type GraphMask,
    type GraphViewport,
} from "./graphDiffPlan";

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
 * **It is a picture of a graph, not the editor's canvas.** Cards are one size and carry a title;
 * wires run card to card rather than pin to pin, because a pin's position comes from the editor's
 * node catalogue and is not a thing that changed. Anything finer would be the editor rebuilt in a
 * pane where it cannot be edited.
 *
 * **Both columns share one viewport.** Two graphs each fitted to their own column would put a node
 * that never moved in two different places, which an author reads as a change - so the box and the
 * scale are computed across both sides at once and a node only appears to move if it moved.
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

    const [selected, setSelected] = useState<number | null>(null);
    const [frame, onFrame] = useCanvasWidth();

    const masks = useMemo(
        () => plan.masks.filter(mask => mask.graphKey === graphKey),
        [plan.masks, graphKey],
    );

    const baseGraph = graphKey ? plan.baseGraphs.get(graphKey) ?? null : null;
    const headGraph = graphKey ? plan.headGraphs.get(graphKey) ?? null : null;
    const columns = (baseGraph ? 1 : 0) + (headGraph ? 1 : 0);
    const viewport = sharedGraphViewport(
        [baseGraph?.nodes ?? [], headGraph?.nodes ?? []],
        {
            width: columns > 1 ? Math.max(0, (frame - COLUMN_GAP) / 2) : frame,
            height: CANVAS_MAX_HEIGHT,
        },
    );

    // A mark whose node is not in the graph it belongs to, on the side that has that graph. It
    // should not happen - the plan and the facts come out of one document - and is counted rather
    // than dropped, because "should not happen" is not a thing to leave a canvas silent about.
    const unplaced = masks.filter(mask => !placeable(mask, baseGraph, headGraph)).length;
    const failure = canvasReadFailure(base, head);

    return (
        <CanvasShell
            entry={entry}
            change={change}
            selected={selected === null ? null : changes[selected] ?? null}
            onClearSelection={() => setSelected(null)}
            controls={plan.graphs.length > 1 && (
                <Select
                    size="sm"
                    ariaLabel={t("documentDiff.canvas.graphLabel")}
                    value={graphKey ?? ""}
                    onChange={value => {
                        setChosenGraph(String(value));
                        setSelected(null);
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
                </>
            }
        >
            <div ref={onFrame} className="flex w-full items-start gap-2">
                {frame > 0 && option && (
                    <>
                        {baseGraph && (
                            <GraphColumn
                                caption="documentDiff.canvas.before"
                                graph={baseGraph}
                                viewport={viewport}
                                masks={masks.filter(mask => mask.onBase)}
                                selected={selected}
                                onSelect={setSelected}
                            />
                        )}
                        {headGraph && (
                            <GraphColumn
                                caption="documentDiff.canvas.after"
                                graph={headGraph}
                                viewport={viewport}
                                masks={masks.filter(mask => mask.onHead)}
                                selected={selected}
                                onSelect={setSelected}
                            />
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

/* ---------------------------------------------------------------------------------------- */
/* One column                                                                                 */
/* ---------------------------------------------------------------------------------------- */

interface GraphColumnProps {
    readonly caption: TranslationKey;
    readonly graph: GraphFacts;
    readonly viewport: GraphViewport;
    readonly masks: readonly GraphMask[];
    readonly selected: number | null;
    readonly onSelect: (index: number) => void;
}

function GraphColumn({ caption, graph, viewport, masks, selected, onSelect }: GraphColumnProps) {
    const { t } = useTranslation();
    const width = Math.round(viewport.width * viewport.scale);
    const height = Math.round(viewport.height * viewport.scale);

    const nodeTone = new Map<string, GraphMask>();
    const edgeTone = new Map<string, GraphMask>();
    let frameTone: GraphMask | null = null;
    for (const mask of masks) {
        if (mask.target.kind === "node") nodeTone.set(mask.target.nodeId, mask);
        else if (mask.target.kind === "edge") edgeTone.set(mask.target.edgeKey, mask);
        else frameTone = mask;
    }

    const positions = new Map(graph.nodes.map(node => [node.id, graphNodeBox(node, viewport)]));

    return (
        <figure className="flex min-w-0 flex-col gap-1">
            <div
                className={cn(
                    "relative overflow-hidden rounded-md border bg-surface-canvas",
                    frameTone ? CHANGE_MASK_CLASS[frameTone.tone] : "border-edge",
                )}
                style={{ width, height }}
            >
                <svg className="absolute inset-0" width={width} height={height} aria-hidden>
                    {graph.edges.map(edge => {
                        const from = positions.get(edge.from);
                        const to = positions.get(edge.to);
                        if (!from || !to) {
                            return null;
                        }
                        const mask = edgeTone.get(edge.key);
                        const path = wirePath(from, to);
                        return (
                            <g key={edge.key}>
                                <path
                                    d={path}
                                    fill="none"
                                    className={mask ? CHANGE_MASK_STROKE[mask.tone] : "stroke-edge-strong"}
                                    strokeWidth={mask ? 2 : 1}
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
                    const box = positions.get(node.id);
                    const mask = nodeTone.get(node.id);
                    if (!box) {
                        return null;
                    }
                    return (
                        <div
                            key={node.id}
                            className="absolute overflow-hidden rounded-md border border-edge bg-surface-raised"
                            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                        >
                            <span
                                className="block truncate px-1.5 py-1 text-2xs text-fg"
                                // The card is drawn at the shared scale, and its text with it, so a
                                // dense graph stays a graph rather than becoming a wall of labels.
                                style={{ fontSize: `${Math.max(7, Math.round(11 * viewport.scale))}px` }}
                            >
                                {nodeTitle(node.type, t)}
                            </span>
                            {mask && (
                                <button
                                    type="button"
                                    onClick={() => onSelect(mask.index)}
                                    aria-label={t("documentDiff.canvas.markLabel")}
                                    data-change-mask={mask.tone}
                                    data-change-index={mask.index}
                                    className={cn(
                                        "nl-focus-ring absolute inset-0 border",
                                        CHANGE_MASK_CLASS[mask.tone],
                                        selected === mask.index && "outline outline-2 outline-offset-1 outline-primary",
                                    )}
                                />
                            )}
                        </div>
                    );
                })}

                {graph.nodes.length === 0 && (
                    <span className="absolute inset-0 grid place-items-center px-2 text-center text-2xs text-fg-muted">
                        {t("documentDiff.canvas.emptyGraph")}
                    </span>
                )}
            </div>
            <CanvasColumn caption={caption} detail={null} />
        </figure>
    );
}

/** A wire from one card's right edge to another's left, bowed so parallel runs stay apart. */
function wirePath(
    from: { left: number; top: number; width: number; height: number },
    to: { left: number; top: number; width: number; height: number },
): string {
    const x1 = from.left + from.width;
    const y1 = from.top + from.height / 2;
    const x2 = to.left;
    const y2 = to.top + to.height / 2;
    const bow = Math.max(24, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + bow} ${y1}, ${x2 - bow} ${y2}, ${x2} ${y2}`;
}

/**
 * What a node is called, in the author's language, falling back to its type.
 *
 * The catalogue is a workspace singleton and this pane must not depend on it having been built: a
 * comparison that threw because a node table was not ready would take the whole detail pane with
 * it. The type identifier is a worse label and an honest one.
 */
function nodeTitle(type: string, t: Translator["t"]): string {
    try {
        const catalog = getBlueprintNodeEditorCatalogEntry(type);
        return catalog ? resolveBlueprintNodeTitle(catalog.displayName, t) : type;
    } catch {
        return type;
    }
}

export const uiGraphsChangePresenter: ChangePresenter = {
    id: "ui-graphs",
    matches: (entry: DocumentDiffEntry) => entry.documentKind === "ui-graphs",
    Detail: UIGraphsChangeDetail,
};

// Registered on import, and imported for that effect by `ChangeDetailHost`.
registerChangePresenter(uiGraphsChangePresenter);
