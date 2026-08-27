import {
    GRAPH_NODE_HEIGHT,
    GRAPH_NODE_WIDTH,
    type GraphEdgeFacts,
    type GraphNodeFacts,
    type GraphNodeSize,
} from "./graphDiffPlan";

/**
 * What one blueprint node looks like, worked out as arithmetic rather than measured off a card.
 *
 * The comparison canvas draws a graph out of a revision's bytes: there is no editor, no workspace
 * and no laid-out DOM to ask how tall a node came out. So the card's size, the rows its pins sit on
 * and the point a wire meets each pin are all computed here, from the same two things the editor's
 * card is built from - the title and the pin list - and every one of them is a pure function of
 * those. That is what lets a wire end on the pin it actually connects instead of on the middle of
 * a card's edge, and what lets the whole picture be pinned by a test with no DOM in it.
 *
 * **Sizes are in graph coordinates.** One unit is one pixel of the canvas the author laid the graph
 * out on, the same units `meta.editorLayout` is written in, so a card and the position it was
 * dragged to are in one system. The viewport's scale and the view's zoom are applied on top of
 * that, by multiplication - see `graphCanvasNav.ts` for why that stays arithmetic.
 *
 * **A node whose type the catalogue does not know still draws.** `describe` is handed in rather
 * than imported, so the catalogue lookup - which needs a workspace this pane must not require -
 * stays at the edge; a description with no pins in it lays out as a plain titled box, which is the
 * fallback the pane has always had.
 */

/** One pin of a node, as much of it as a picture of a graph needs. */
export interface GraphNodePin {
    readonly id: string;
    readonly kind: "input" | "output";
    /** Execution flow rather than a value. Drawn as an arrow, the way the editor draws it. */
    readonly exec: boolean;
    readonly label: string;
}

/** What the catalogue says about one node type, or as much of it as could be found out. */
export interface GraphNodeDescription {
    readonly title: string;
    readonly pins: readonly GraphNodePin[];
}

/** A pin placed on the card: `y` is the centre of its row, in graph units from the card's top. */
export interface GraphNodePinRow extends GraphNodePin {
    readonly y: number;
}

export interface GraphNodeShape extends GraphNodeSize {
    readonly title: string;
    /** Down the left edge, execution first, in the order the editor's node card lists them. */
    readonly inputs: readonly GraphNodePinRow[];
    /** Down the right edge, on the same terms. */
    readonly outputs: readonly GraphNodePinRow[];
}

// ---------------------------------------------------------------------------
// The card's proportions
// ---------------------------------------------------------------------------

/** The title bar, which every node has whether or not it has a pin. */
export const GRAPH_NODE_TITLE_HEIGHT = 20;
/** One pin's row. An input and an output opposite each other share a row. */
export const GRAPH_NODE_PIN_ROW = 14;
/** Above the first pin row and below the last. */
export const GRAPH_NODE_BODY_PADDING = 5;
/** The disc or arrow that marks a pin. */
export const GRAPH_NODE_PIN_SIZE = 7;

/**
 * How far inside its edge a pin's mark sits, and therefore where a wire ends.
 *
 * Half the mark, so the mark is wholly inside the card: the card clips what overflows it, and a
 * mark centred on the border would be drawn as a half moon. The wire's last few units run under
 * the card, which is behind it, so what an author sees is a wire meeting the edge at the pin's row.
 */
export const GRAPH_NODE_PIN_INSET = GRAPH_NODE_PIN_SIZE / 2;

/** Narrower than this and a title is nothing but an ellipsis; wider and one node owns the column. */
export const GRAPH_NODE_MIN_WIDTH = 120;
export const GRAPH_NODE_MAX_WIDTH = 260;

/** The title, and a pin's label, in graph units. Multiplied by the drawn scale like everything. */
export const GRAPH_NODE_TITLE_FONT = 11;
export const GRAPH_NODE_PIN_FONT = 10;

/** Left and right of the title. */
export const GRAPH_NODE_SIDE_PADDING = 7;
/** From the card's edge to the label a pin's mark stands in front of. */
export const GRAPH_NODE_PIN_GUTTER = 9;
/** Between the input labels and the output labels, so the two columns cannot run together. */
const COLUMN_GAP = 10;

/**
 * Roughly how wide a run of text is, with no DOM to measure it in.
 *
 * An estimate is enough and a measurement is not available: this runs while a picture is planned,
 * not while a card is laid out, and the only thing riding on it is whether a card is wide enough
 * for its own title. Two buckets, because the gap that matters is the one between a Latin letter
 * and a CJK one - a Japanese node title is about twice the width of a Latin one of the same length,
 * and a single average would leave one of the two languages wrong by a factor of two.
 */
export function graphTextWidth(text: string, fontSize: number): number {
    let units = 0;
    for (const character of text) {
        units += WIDE_CHARACTER.test(character) ? 1 : 0.52;
    }
    return units * fontSize;
}

/** The blocks whose glyphs occupy a full em: CJK, kana, Hangul, and the fullwidth forms. */
const WIDE_CHARACTER =
    /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/**
 * One node's card, from its title and its pins.
 *
 * The height follows the pin rows, because that is what lets a wire end on a pin: a card of one
 * fixed height would have to fit five pins into forty pixels and no author could read which was
 * which. The width follows the widest thing that has to sit on one line - the title, or the two
 * pin columns side by side - and is then held inside a band, because this is a picture of a shape
 * and one node with a long title is not entitled to set the scale for every other node.
 */
export function layoutGraphNode(description: GraphNodeDescription): GraphNodeShape {
    const inputs = execFirst(description.pins.filter(pin => pin.kind === "input"));
    const outputs = execFirst(description.pins.filter(pin => pin.kind === "output"));

    const rows = Math.max(inputs.length, outputs.length);
    const height = GRAPH_NODE_TITLE_HEIGHT + GRAPH_NODE_BODY_PADDING * 2 + rows * GRAPH_NODE_PIN_ROW;

    const titleWidth = GRAPH_NODE_SIDE_PADDING * 2
        + graphTextWidth(description.title, GRAPH_NODE_TITLE_FONT);
    const bodyWidth = columnWidth(inputs) + columnWidth(outputs)
        + (inputs.length > 0 && outputs.length > 0 ? COLUMN_GAP : 0);
    const width = Math.round(Math.min(
        GRAPH_NODE_MAX_WIDTH,
        Math.max(GRAPH_NODE_MIN_WIDTH, titleWidth, bodyWidth),
    ));

    return { title: description.title, width, height, inputs: place(inputs), outputs: place(outputs) };
}

/** Execution pins above value pins, which is the order the editor's node card puts them in. */
function execFirst(pins: readonly GraphNodePin[]): readonly GraphNodePin[] {
    return [...pins.filter(pin => pin.exec), ...pins.filter(pin => !pin.exec)];
}

/** What one column of pins needs: its widest label, plus the room the marks take beside them. */
function columnWidth(pins: readonly GraphNodePin[]): number {
    if (pins.length === 0) {
        return 0;
    }
    const label = Math.max(...pins.map(pin => graphTextWidth(pin.label, GRAPH_NODE_PIN_FONT)));
    return GRAPH_NODE_PIN_GUTTER + label;
}

/** Pins onto their rows, top to bottom, each one centred in the row it owns. */
function place(pins: readonly GraphNodePin[]): readonly GraphNodePinRow[] {
    return pins.map((pin, index) => ({
        ...pin,
        y: GRAPH_NODE_TITLE_HEIGHT + GRAPH_NODE_BODY_PADDING
            + index * GRAPH_NODE_PIN_ROW + GRAPH_NODE_PIN_ROW / 2,
    }));
}

// ---------------------------------------------------------------------------
// A whole graph
// ---------------------------------------------------------------------------

/**
 * Every node of a pair of graphs, keyed so a card can be looked up as it is drawn.
 *
 * **Both versions are laid out from one list.** A node nobody touched has to be the same shape in
 * both columns or the pane would report a change nobody made - the same reason
 * `sharedGraphViewport` takes both sides at once. Keyed by id AND type, so the one case where the
 * two sides genuinely disagree - a node id reused for another kind of node - draws two cards
 * rather than one wrong one.
 */
export function graphNodeShapes(
    nodes: readonly GraphNodeFacts[],
    edges: readonly GraphEdgeFacts[],
    describe: (type: string) => GraphNodeDescription,
): Map<string, GraphNodeShape> {
    const wired = wiredPorts(edges);
    const shapes = new Map<string, GraphNodeShape>();
    for (const node of nodes) {
        const key = graphNodeShapeKey(node);
        if (shapes.has(key)) {
            continue;
        }
        shapes.set(key, layoutGraphNode(withWiredPins(describe(node.type), wired.get(node.id))));
    }
    return shapes;
}

/** How {@link graphNodeShapes} names one card. A caller looks a node's shape up with this. */
export function graphNodeShapeKey(node: GraphNodeFacts): string {
    // SOH, never NUL: one NUL byte in a source file takes the whole module out of every diff git
    // will ever show, and `graphDiffPlan.graphKeyOf` separates its own key for the same reason.
    return `${node.id}${String.fromCharCode(1)}${node.type}`;
}

/** A node's shape, or the plain fallback card for one the layout does not hold. */
export function graphShapeOf(
    shapes: ReadonlyMap<string, GraphNodeShape>,
    node: GraphNodeFacts,
): GraphNodeShape {
    return shapes.get(graphNodeShapeKey(node)) ?? FALLBACK_SHAPE;
}

const FALLBACK_SHAPE: GraphNodeShape = {
    title: "",
    width: GRAPH_NODE_WIDTH,
    height: GRAPH_NODE_HEIGHT,
    inputs: [],
    outputs: [],
};

/** Which pins each node is wired through, by node id, split by the end the wire arrives at. */
function wiredPorts(
    edges: readonly GraphEdgeFacts[],
): Map<string, { outputs: Set<string>; inputs: Set<string> }> {
    const wired = new Map<string, { outputs: Set<string>; inputs: Set<string> }>();
    const at = (nodeId: string) => {
        const held = wired.get(nodeId);
        if (held) {
            return held;
        }
        const made = { outputs: new Set<string>(), inputs: new Set<string>() };
        wired.set(nodeId, made);
        return made;
    };
    for (const edge of edges) {
        at(edge.from).outputs.add(edge.fromPort);
        at(edge.to).inputs.add(edge.toPort);
    }
    return wired;
}

/**
 * The catalogue's pins, plus any pin the graph is wired through that the catalogue does not list.
 *
 * Several node types grow pins as an author adds to them - a Switch's cases, a function head's
 * parameters - and those live on the node rather than on its type. Taking the rest from the wires
 * is what keeps a wire ending on a pin: the graph itself says the pin exists, because something is
 * plugged into it. Named by its id, which is the only name available and is what the author chose
 * in most of these cases anyway.
 */
function withWiredPins(
    description: GraphNodeDescription,
    wired: { outputs: Set<string>; inputs: Set<string> } | undefined,
): GraphNodeDescription {
    if (!wired) {
        return description;
    }
    const extra: GraphNodePin[] = [];
    for (const [kind, ids] of [["output", wired.outputs], ["input", wired.inputs]] as const) {
        for (const id of ids) {
            if (!description.pins.some(pin => pin.kind === kind && pin.id === id)) {
                extra.push({ id, kind, exec: false, label: id });
            }
        }
    }
    return extra.length === 0 ? description : { ...description, pins: [...description.pins, ...extra] };
}

// ---------------------------------------------------------------------------
// Where a wire ends
// ---------------------------------------------------------------------------

/** A point on a card, in graph units from the card's own top left corner. */
export interface GraphNodePoint {
    readonly x: number;
    readonly y: number;
}

/**
 * Where a wire meets one end of itself.
 *
 * A pin the shape does not hold falls back to the middle of the card's edge, which is where every
 * wire used to end: a graph drawn with no catalogue behind it is still a graph, and a wire that
 * refused to be drawn because a pin could not be found would take the shape of the change with it.
 */
export function graphPinPoint(
    shape: GraphNodeShape,
    kind: "input" | "output",
    pinId: string,
): GraphNodePoint {
    const rows = kind === "input" ? shape.inputs : shape.outputs;
    const pin = rows.find(row => row.id === pinId);
    return {
        x: kind === "input" ? GRAPH_NODE_PIN_INSET : shape.width - GRAPH_NODE_PIN_INSET,
        y: pin ? pin.y : shape.height / 2,
    };
}
