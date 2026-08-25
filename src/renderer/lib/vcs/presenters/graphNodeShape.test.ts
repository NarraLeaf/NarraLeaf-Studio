import { describe, expect, it } from "vitest";
import type { GraphEdgeFacts, GraphNodeFacts } from "./graphDiffPlan";
import {
    GRAPH_NODE_MAX_WIDTH,
    GRAPH_NODE_MIN_WIDTH,
    GRAPH_NODE_PIN_INSET,
    GRAPH_NODE_PIN_ROW,
    GRAPH_NODE_TITLE_HEIGHT,
    graphNodeShapeKey,
    graphNodeShapes,
    graphPinPoint,
    graphShapeOf,
    graphTextWidth,
    layoutGraphNode,
    type GraphNodeDescription,
    type GraphNodePin,
} from "./graphNodeShape";

/**
 * The card a blueprint node is drawn as, and where its wires end.
 *
 * All of it is arithmetic over the title and the pin list, which is why it is tested here rather
 * than through a rendered canvas: jsdom lays nothing out, so a test that went through the DOM
 * could only assert that some numbers were written into a style attribute. These are the numbers.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function pin(id: string, kind: "input" | "output", exec = false, label = id): GraphNodePin {
    return { id, kind, exec, label };
}

function describing(title: string, pins: GraphNodePin[] = []): GraphNodeDescription {
    return { title, pins };
}

function node(id: string, type: string): GraphNodeFacts {
    return { id, type, x: 0, y: 0 };
}

function wire(from: string, fromPort: string, to: string, toPort: string): GraphEdgeFacts {
    return { key: `${from}:${fromPort}->${to}:${toPort}`, from, to, fromPort, toPort };
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

describe("how big a node's card is", () => {
    it("grows a row per pin, and pairs an input with the output opposite it", () => {
        const bare = layoutGraphNode(describing("Wait"));
        const three = layoutGraphNode(describing("Wait", [
            pin("in", "input", true),
            pin("seconds", "input"),
            pin("next", "output", true),
        ]));

        expect(bare.height).toBe(GRAPH_NODE_TITLE_HEIGHT + 10);
        // Two inputs against one output is two rows, not three: they sit side by side.
        expect(three.height).toBe(bare.height + 2 * GRAPH_NODE_PIN_ROW);
    });

    it("is wide enough for its own title, and never wider than the band allows", () => {
        const short = layoutGraphNode(describing("If"));
        const long = layoutGraphNode(describing("Set Persistent Variable From Expression"));
        const absurd = layoutGraphNode(describing("x".repeat(400)));

        expect(short.width).toBe(GRAPH_NODE_MIN_WIDTH);
        expect(long.width).toBeGreaterThan(short.width);
        expect(absurd.width).toBe(GRAPH_NODE_MAX_WIDTH);
    });

    it("is wide enough for two columns of pin labels standing back to back", () => {
        const narrow = layoutGraphNode(describing("Compare", [pin("a", "input"), pin("out", "output")]));
        const wide = layoutGraphNode(describing("Compare", [
            pin("a", "input", false, "The left hand side of it"),
            pin("out", "output", false, "The right hand side of it"),
        ]));

        expect(wide.width).toBeGreaterThan(narrow.width);
    });

    /** A CJK title is about twice as wide as a Latin one of the same length. */
    it("charges a full-width glyph what it costs", () => {
        expect(graphTextWidth("待機", 11)).toBeGreaterThan(graphTextWidth("wa", 11) * 1.8);
        expect(graphTextWidth("", 11)).toBe(0);
    });
});

describe("where the pins sit", () => {
    const shape = layoutGraphNode(describing("Play Sound", [
        pin("assetId", "input"),
        pin("in", "input", true),
        pin("handle", "output"),
        pin("next", "output", true),
    ]));

    it("puts execution above value, the order the editor's card uses", () => {
        expect(shape.inputs.map(row => row.id)).toEqual(["in", "assetId"]);
        expect(shape.outputs.map(row => row.id)).toEqual(["next", "handle"]);
    });

    it("centres each pin in the row it owns, under the title bar", () => {
        expect(shape.inputs[0]!.y).toBeGreaterThan(GRAPH_NODE_TITLE_HEIGHT);
        expect(shape.inputs[1]!.y - shape.inputs[0]!.y).toBe(GRAPH_NODE_PIN_ROW);
        // The first input and the first output share a row: nothing has moved sideways.
        expect(shape.outputs[0]!.y).toBe(shape.inputs[0]!.y);
    });

    it("ends a wire on the pin it is plugged into, on the side that pin is on", () => {
        expect(graphPinPoint(shape, "input", "assetId"))
            .toEqual({ x: GRAPH_NODE_PIN_INSET, y: shape.inputs[1]!.y });
        expect(graphPinPoint(shape, "output", "next"))
            .toEqual({ x: shape.width - GRAPH_NODE_PIN_INSET, y: shape.outputs[0]!.y });
    });

    /**
     * A graph whose catalogue could not be read is still a graph. The wire falls back to the
     * middle of the card's edge - which is where every wire on this canvas used to end - rather
     * than refusing to be drawn and taking the shape of the change with it.
     */
    it("falls back to the middle of the edge for a pin nothing knows about", () => {
        const plain = layoutGraphNode(describing("blueprint.sound.play"));

        expect(graphPinPoint(plain, "input", "in")).toEqual({ x: GRAPH_NODE_PIN_INSET, y: plain.height / 2 });
        expect(graphPinPoint(shape, "output", "no-such-pin").y).toBe(shape.height / 2);
    });
});

// ---------------------------------------------------------------------------
// A whole graph
// ---------------------------------------------------------------------------

describe("laying out both versions at once", () => {
    const catalogue: Record<string, GraphNodeDescription> = {
        "blueprint.event.head.click": describing("On Click", [pin("then", "output", true)]),
        "blueprint.debug.log": describing("Log", [pin("in", "input", true), pin("message", "input")]),
    };
    const describe_ = (type: string): GraphNodeDescription => catalogue[type] ?? describing(type);

    it("gives a node that nobody touched one shape, whichever column draws it", () => {
        const shapes = graphNodeShapes(
            // The same node as both sides hold it, which is how the canvas hands them over.
            [node("n-log", "blueprint.debug.log"), node("n-log", "blueprint.debug.log")],
            [],
            describe_,
        );

        expect(shapes.size).toBe(1);
        expect(graphShapeOf(shapes, node("n-log", "blueprint.debug.log")).title).toBe("Log");
    });

    it("keeps two cards apart when one id names two kinds of node", () => {
        const shapes = graphNodeShapes(
            [node("n-1", "blueprint.debug.log"), node("n-1", "blueprint.event.head.click")],
            [],
            describe_,
        );

        expect(shapes.size).toBe(2);
        expect(graphShapeOf(shapes, node("n-1", "blueprint.event.head.click")).title).toBe("On Click");
    });

    it("draws a node whose type the catalogue does not hold as a plain titled box", () => {
        const shapes = graphNodeShapes([node("n-x", "plugin.unknown.thing")], [], describe_);
        const shape = graphShapeOf(shapes, node("n-x", "plugin.unknown.thing"));

        expect(shape.title).toBe("plugin.unknown.thing");
        expect([...shape.inputs, ...shape.outputs]).toEqual([]);
    });

    /**
     * A Switch's cases and a function head's parameters live on the node rather than on its type,
     * and this pane reads no node parameters. The wires say the pins are there, which is enough to
     * end a wire on one.
     */
    it("takes a pin the catalogue never listed from the wire plugged into it", () => {
        const shapes = graphNodeShapes(
            [node("n-head", "blueprint.event.head.click"), node("n-log", "blueprint.debug.log")],
            [wire("n-head", "case_3", "n-log", "message")],
            describe_,
        );
        const head = graphShapeOf(shapes, node("n-head", "blueprint.event.head.click"));

        expect(head.outputs.map(row => row.id)).toEqual(["then", "case_3"]);
        expect(graphPinPoint(head, "output", "case_3").y).toBe(head.outputs[1]!.y);
    });

    it("names a card by what it is, and never with a NUL byte", () => {
        expect(graphNodeShapeKey(node("n-1", "a"))).not.toBe(graphNodeShapeKey(node("n-1", "b")));
        // One NUL byte in a source file takes the whole module out of every diff git will show.
        expect(graphNodeShapeKey(node("n-1", "a"))).not.toContain("\0");
    });
});
