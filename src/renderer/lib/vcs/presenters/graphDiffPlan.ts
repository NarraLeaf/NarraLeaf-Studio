import type { DocumentChange } from "@shared/documents/diff";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import { changeLeafCount, changeMaskTone, maskColumns, type ChangeMaskTone } from "./changeMask";

/**
 * Which mark goes on which node of which graph, worked out before anything is drawn.
 *
 * The blueprint half of what `surfaceDiffPlan.ts` does for the interface, and written to the same
 * two rules: every change is either marked or named as unmarkable, and nothing reads a display
 * string to find an id. `uiGraphsDiff.ts` states the addressing - `key, id, key, id`, so a consumer
 * reads a fixed index - and this is the consumer that contract exists for.
 *
 * # A graph is drawn from the file, not compiled
 *
 * There is no build step between the bytes and the picture. A blueprint's event layer holds its IR
 * at `program.graphs.events[<graphId>].graph`, nodes carry their canvas position in
 * `meta.editorLayout`, and both were written by the editor that drew them - so a graph out of a
 * revision can be laid out exactly where its author left it without a compiler, a workspace or an
 * editor context, none of which a comparison pane can reach.
 *
 * # Moving a node is not editing it, and the marks say so
 *
 * The spec splits a drag (`kind: "moved"` on `editorLayout`) from a parameter edit (`kind:
 * "changed"` on `params`) precisely so a consumer can draw them differently, and
 * {@link changeMaskTone} is where that is spent: a node that was only dragged wears the weakest of
 * the four marks, because it changed nothing about what the game does.
 */

/** Where one graph lives. `blueprintId` is null for the older root-level IR under `graphs`. */
export interface GraphAddress {
    readonly blueprintId: string | null;
    /** `events` / `functions` / `macros`, or null for a root-level graph. */
    readonly slot: string | null;
    readonly graphId: string;
}

/**
 * A graph's identity as one string, for a map key and a `<select>` value.
 *
 * Separated by SOH rather than by a printable character, and never by NUL: an authored id may hold
 * anything, a printable separator would eventually collide, and one NUL byte in a source file takes
 * the whole module out of every diff git will ever show (`uiDocumentDiff.ts` has the same note).
 */
const KEY_SEPARATOR = String.fromCharCode(1);

export function graphKeyOf(address: GraphAddress): string {
    return address.blueprintId === null
        ? `graphs${KEY_SEPARATOR}${address.graphId}`
        : `blueprints${KEY_SEPARATOR}${address.blueprintId}${KEY_SEPARATOR}${address.slot ?? ""}${KEY_SEPARATOR}${address.graphId}`;
}

export type GraphMaskTarget =
    | { readonly kind: "node"; readonly nodeId: string }
    | { readonly kind: "edge"; readonly edgeKey: string }
    /** The graph itself: renamed, re-fielded, added or removed whole. */
    | { readonly kind: "graph" };

export interface GraphMask {
    /** The change's index in `DocumentDiff.changes` - the handle a click hands back. */
    readonly index: number;
    readonly change: DocumentChange;
    readonly graphKey: string;
    readonly target: GraphMaskTarget;
    readonly tone: ChangeMaskTone;
    readonly leaves: number;
    readonly onBase: boolean;
    readonly onHead: boolean;
}

export type OffGraphReason =
    /** A blueprint's own fields, or which blueprint is live for an owner slot. */
    | "blueprint"
    /** The order the author arranged the layers in - a fact about a list, not about a canvas. */
    | "order";

export interface OffGraphChange {
    readonly index: number;
    readonly change: DocumentChange;
    readonly reason: OffGraphReason;
    readonly leaves: number;
}

export interface GraphNodeFacts {
    readonly id: string;
    readonly type: string;
    readonly x: number;
    readonly y: number;
}

export interface GraphEdgeFacts {
    /** `<fromNode>:<fromPort>-><toNode>:<toPort>`, exactly as `uiGraphsDiff` builds it. */
    readonly key: string;
    readonly from: string;
    readonly to: string;
}

export interface GraphFacts {
    readonly address: GraphAddress;
    readonly key: string;
    /** The graph's own name, or null when it has none. */
    readonly name: string | null;
    /** The blueprint it belongs to, by the name its author gave it. Null for a root-level graph. */
    readonly blueprintName: string | null;
    readonly nodes: readonly GraphNodeFacts[];
    readonly edges: readonly GraphEdgeFacts[];
}

export interface GraphOption {
    readonly key: string;
    readonly address: GraphAddress;
    readonly name: string | null;
    readonly blueprintName: string | null;
    readonly inBase: boolean;
    readonly inHead: boolean;
    readonly changes: number;
}

export interface GraphDiffPlan {
    readonly graphs: readonly GraphOption[];
    readonly masks: readonly GraphMask[];
    readonly offCanvas: readonly OffGraphChange[];
    readonly defaultGraphKey: string | null;
    /** Both sides indexed by graph key, so the canvas can look one up without walking again. */
    readonly baseGraphs: ReadonlyMap<string, GraphFacts>;
    readonly headGraphs: ReadonlyMap<string, GraphFacts>;
}

export function buildGraphDiffPlan(
    changes: readonly DocumentChange[],
    base: UIGraphDocument | null,
    head: UIGraphDocument | null,
): GraphDiffPlan {
    const baseGraphs = readGraphs(base);
    const headGraphs = readGraphs(head);

    const masks: GraphMask[] = [];
    const offCanvas: OffGraphChange[] = [];
    const changesByGraph = new Map<string, number>();

    changes.forEach((change, index) => {
        const leaves = changeLeafCount(change);
        const located = graphMaskTarget(change.path);
        if (!located) {
            offCanvas.push({
                index,
                change,
                reason: change.path[0] === "blueprints" && change.path.length >= 3 ? "order" : "blueprint",
                leaves,
            });
            return;
        }
        const graphKey = graphKeyOf(located.address);
        masks.push({
            index,
            change,
            graphKey,
            target: located.target,
            tone: changeMaskTone(change),
            leaves,
            ...maskColumns(change.kind),
        });
        changesByGraph.set(graphKey, (changesByGraph.get(graphKey) ?? 0) + leaves);
    });

    const keys: string[] = [];
    const take = (key: string): void => {
        if (!keys.includes(key)) {
            keys.push(key);
        }
    };
    for (const key of headGraphs.keys()) take(key);
    for (const key of baseGraphs.keys()) take(key);
    for (const key of changesByGraph.keys()) take(key);

    const graphs = keys.map<GraphOption>(key => {
        const inHead = headGraphs.get(key);
        const inBase = baseGraphs.get(key);
        const facts = inHead ?? inBase;
        return {
            key,
            address: facts?.address ?? { blueprintId: null, slot: null, graphId: key },
            name: facts?.name ?? null,
            blueprintName: facts?.blueprintName ?? null,
            inBase: inBase !== undefined,
            inHead: inHead !== undefined,
            changes: changesByGraph.get(key) ?? 0,
        };
    });

    let busiest: GraphOption | null = null;
    for (const graph of graphs) {
        if (!busiest || graph.changes > busiest.changes) {
            busiest = graph;
        }
    }

    return {
        graphs,
        masks,
        offCanvas,
        defaultGraphKey: busiest?.key ?? null,
        baseGraphs,
        headGraphs,
    };
}

/**
 * The graph, node or wire one row is about, or null for a row that is about none of them.
 *
 * Read positionally, per the addressing contract: under `blueprints` the segments alternate
 * `blueprints, <id>, <slot>, <graphId>` and then either `nodes, <nodeId>` or `edges, <edgeKey>`;
 * the older root-level form is the same shape with the first two segments removed.
 */
export function graphMaskTarget(
    path: readonly string[],
): { address: GraphAddress; target: GraphMaskTarget } | null {
    if (path[0] === "blueprints" && typeof path[1] === "string"
        && typeof path[2] === "string" && GRAPH_SLOTS.has(path[2]) && typeof path[3] === "string") {
        const address: GraphAddress = { blueprintId: path[1], slot: path[2], graphId: path[3] };
        return { address, target: innerTarget(path, 4) };
    }
    if (path[0] === "graphs" && typeof path[1] === "string") {
        const address: GraphAddress = { blueprintId: null, slot: null, graphId: path[1] };
        return { address, target: innerTarget(path, 2) };
    }
    return null;
}

/** What comes after a graph's address: one of its nodes, one of its wires, or the graph itself. */
function innerTarget(path: readonly string[], at: number): GraphMaskTarget {
    if (path[at] === "nodes" && typeof path[at + 1] === "string") {
        return { kind: "node", nodeId: path[at + 1] };
    }
    if (path[at] === "edges" && typeof path[at + 1] === "string") {
        return { kind: "edge", edgeKey: path[at + 1] };
    }
    return { kind: "graph" };
}

const GRAPH_SLOTS = new Set(["events", "functions", "macros"]);

// ---------------------------------------------------------------------------
// Reading a document
// ---------------------------------------------------------------------------

/**
 * Every graph one side holds, in the order the member tree lists them.
 *
 * Defensive throughout, on the same terms the diff is: this document came out of a repository, the
 * spec that parsed it is a shape gate that runs no migration, and nothing here may assume a field
 * exists or holds the type it is declared with.
 */
export function readGraphs(document: UIGraphDocument | null): Map<string, GraphFacts> {
    const out = new Map<string, GraphFacts>();

    const blueprints = recordOf(recordOf((document as Record<string, unknown> | null)?.blueprintDocument)?.blueprints);
    for (const [blueprintId, blueprint] of Object.entries(blueprints ?? {})) {
        const record = recordOf(blueprint);
        if (!record) continue;
        const blueprintName = textOrNull(record.name);
        const slots = recordOf(recordOf(record.program)?.graphs);
        for (const slot of ["events", "functions", "macros"] as const) {
            for (const [graphId, graph] of Object.entries(recordOf(slots?.[slot]) ?? {})) {
                const wrapper = recordOf(graph);
                if (!wrapper) continue;
                const address: GraphAddress = { blueprintId, slot, graphId };
                out.set(graphKeyOf(address), graphFacts(address, wrapper, blueprintName));
            }
        }
    }

    for (const [graphId, graph] of Object.entries(recordOf((document as Record<string, unknown> | null)?.graphs) ?? {})) {
        const wrapper = recordOf(graph);
        if (!wrapper) continue;
        const address: GraphAddress = { blueprintId: null, slot: null, graphId };
        out.set(graphKeyOf(address), graphFacts(address, wrapper, null));
    }

    return out;
}

function graphFacts(
    address: GraphAddress,
    wrapper: Record<string, unknown>,
    blueprintName: string | null,
): GraphFacts {
    // A blueprint's event layer wraps its IR in `graph`; a root-level record already IS one. Same
    // unwrapping `uiGraphsDiff.irOf` does, and it has to be the same or the two would disagree
    // about which nodes a graph has.
    const ir = recordOf(wrapper.graph) ?? wrapper;

    const nodes: GraphNodeFacts[] = [];
    for (const [nodeId, node] of Object.entries(recordOf(ir.nodes) ?? {})) {
        const record = recordOf(node);
        if (!record) continue;
        const layout = recordOf(recordOf(record.meta)?.editorLayout);
        nodes.push({
            id: nodeId,
            type: typeof record.type === "string" ? record.type : "",
            x: finiteOr(layout?.x, 0),
            y: finiteOr(layout?.y, 0),
        });
    }

    const edges: GraphEdgeFacts[] = [];
    for (const edge of Array.isArray(ir.edges) ? ir.edges : []) {
        const record = recordOf(edge);
        const from = recordOf(record?.from);
        const to = recordOf(record?.to);
        const fromNode = typeof from?.nodeId === "string" ? from.nodeId : null;
        const toNode = typeof to?.nodeId === "string" ? to.nodeId : null;
        if (fromNode === null || toNode === null) {
            continue;
        }
        edges.push({
            // Built exactly as the spec builds it, because it is the key a change is addressed by
            // and a wire the two spell differently is a wire that can never be marked.
            key: `${fromNode}:${text(from?.port)}->${toNode}:${text(to?.port)}`,
            from: fromNode,
            to: toNode,
        });
    }

    return { address, key: graphKeyOf(address), name: textOrNull(wrapper.name), blueprintName, nodes, edges };
}

function recordOf(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function textOrNull(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function text(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function finiteOr(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** A node card, in graph coordinates. Fixed, because this is a picture of a graph, not the editor. */
export const GRAPH_NODE_WIDTH = 168;
export const GRAPH_NODE_HEIGHT = 40;

/** Space around the outermost cards, so a node at the edge is not cut in half by the frame. */
const GRAPH_VIEWPORT_PADDING = 24;

export interface GraphViewport {
    /** Where the drawn area starts, in graph coordinates. */
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly scale: number;
}

/**
 * The one box and the one scale both columns are drawn in.
 *
 * **Computed over both sides at once, which is the whole reason it is a function.** Two graphs each
 * fitted to their own column would put a node that never moved in two different places on screen,
 * and an author comparing them would read that as a change. One box taken from both sides means a
 * node at the same coordinates is at the same place in both columns - and a node that really did
 * move is the only thing that appears to.
 */
export function sharedGraphViewport(
    sides: readonly (readonly GraphNodeFacts[])[],
    frame: { readonly width: number; readonly height: number },
): GraphViewport {
    const nodes = sides.flat();
    if (nodes.length === 0) {
        return { x: 0, y: 0, width: frame.width || 1, height: frame.height || 1, scale: 1 };
    }

    const left = Math.min(...nodes.map(node => node.x)) - GRAPH_VIEWPORT_PADDING;
    const top = Math.min(...nodes.map(node => node.y)) - GRAPH_VIEWPORT_PADDING;
    const right = Math.max(...nodes.map(node => node.x + GRAPH_NODE_WIDTH)) + GRAPH_VIEWPORT_PADDING;
    const bottom = Math.max(...nodes.map(node => node.y + GRAPH_NODE_HEIGHT)) + GRAPH_VIEWPORT_PADDING;

    const width = right - left;
    const height = bottom - top;
    const scale = frame.width > 0 && frame.height > 0
        ? Math.min(1, frame.width / width, frame.height / height)
        : 1;

    return { x: left, y: top, width, height, scale };
}

/** One node's box on screen, given the viewport both columns share. */
export function graphNodeBox(
    node: GraphNodeFacts,
    viewport: GraphViewport,
): { left: number; top: number; width: number; height: number } {
    return {
        left: (node.x - viewport.x) * viewport.scale,
        top: (node.y - viewport.y) * viewport.scale,
        width: GRAPH_NODE_WIDTH * viewport.scale,
        height: GRAPH_NODE_HEIGHT * viewport.scale,
    };
}

/** What the canvas and the off-canvas line add up to. See `surfaceDiffPlan.accountedChanges`. */
export function accountedGraphChanges(plan: GraphDiffPlan): { rows: number; leaves: number } {
    const rows = plan.masks.length + plan.offCanvas.length;
    const leaves = [...plan.masks, ...plan.offCanvas].reduce((total, entry) => total + entry.leaves, 0);
    return { rows, leaves };
}
