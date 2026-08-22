import { describe, expect, it } from "vitest";
import { layoutBlueprintGraph, type BlueprintLayoutBox, type BlueprintLayoutEdge } from "./blueprintAutoLayout";

/** A card of the size a blueprint node roughly measures, dropped wherever the test needs it. */
function box(id: string, x = 0, y = 0, width = 200, height = 100): BlueprintLayoutBox {
    return { id, x, y, width, height };
}

function edge(from: string, to: string): BlueprintLayoutEdge {
    return { from, to };
}

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }, size = { w: 200, h: 100 }): boolean {
    return Math.abs(a.x - b.x) < size.w && Math.abs(a.y - b.y) < size.h;
}

describe("layoutBlueprintGraph", () => {
    it("has nothing to say about an empty graph", () => {
        expect(layoutBlueprintGraph([], [])).toEqual({});
    });

    it("anchors the result at the corner the graph already occupied", () => {
        const positions = layoutBlueprintGraph([box("a", 400, 300), box("b", 700, 300)], [edge("a", "b")]);

        expect(positions.a).toEqual({ x: 400, y: 300 });
    });

    it("runs a chain left to right on one line", () => {
        const positions = layoutBlueprintGraph(
            [box("a", 0, 0), box("b", 40, 400), box("c", 90, 900)],
            [edge("a", "b"), edge("b", "c")],
        );

        expect(positions.a!.x).toBeLessThan(positions.b!.x);
        expect(positions.b!.x).toBeLessThan(positions.c!.x);
        expect(positions.a!.y).toBe(positions.b!.y);
        expect(positions.b!.y).toBe(positions.c!.y);
    });

    it("leaves a gap between layers rather than butting cards together", () => {
        const positions = layoutBlueprintGraph([box("a"), box("b")], [edge("a", "b")], { layerGap: 90 });

        expect(positions.b!.x - positions.a!.x).toBe(200 + 90);
    });

    it("parks a value node beside the card it feeds, not back at the start", () => {
        // literal -> d, on a chain a -> b -> c -> d. Longest-path layering alone would put the
        // literal in layer 0 with a wire crossing the entire graph.
        const positions = layoutBlueprintGraph(
            [box("a"), box("b"), box("c"), box("d"), box("literal", 0, 500)],
            [edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("literal", "d")],
        );

        expect(positions.literal!.x).toBe(positions.c!.x);
    });

    it("keeps two cards in one layer clear of each other", () => {
        const positions = layoutBlueprintGraph(
            [box("head"), box("left", 0, 0), box("right", 0, 10)],
            [edge("head", "left"), edge("head", "right")],
            { nodeGap: 40 },
        );

        expect(positions.left!.x).toBe(positions.right!.x);
        expect(Math.abs(positions.left!.y - positions.right!.y)).toBe(100 + 40);
    });

    it("centres a card between the two it joins", () => {
        const positions = layoutBlueprintGraph(
            [box("a"), box("top", 0, 0), box("bottom", 0, 10), box("join")],
            [edge("a", "top"), edge("a", "bottom"), edge("top", "join"), edge("bottom", "join")],
        );

        expect(positions.join!.y).toBe((positions.top!.y + positions.bottom!.y) / 2);
    });

    it("stacks disconnected islands down the page without overlapping them", () => {
        const positions = layoutBlueprintGraph(
            [box("a1", 0, 0), box("a2", 300, 0), box("b1", 0, 40), box("b2", 300, 40)],
            [edge("a1", "a2"), edge("b1", "b2")],
        );

        expect(positions.a1!.y).toBeLessThan(positions.b1!.y);
        for (const first of ["a1", "a2"]) {
            for (const second of ["b1", "b2"]) {
                expect(overlaps(positions[first]!, positions[second]!)).toBe(false);
            }
        }
    });

    it("keeps the island that was on top on top", () => {
        const positions = layoutBlueprintGraph([box("lower", 0, 900), box("upper", 0, 100)], []);

        expect(positions.upper!.y).toBeLessThan(positions.lower!.y);
    });

    it("places every node of a loop instead of hanging on it", () => {
        const positions = layoutBlueprintGraph(
            [box("head"), box("body"), box("back")],
            [edge("head", "body"), edge("body", "back"), edge("back", "head")],
        );

        expect(Object.keys(positions).sort()).toEqual(["back", "body", "head"]);
        expect(positions.head!.x).toBeLessThan(positions.body!.x);
    });

    it("ignores self-loops, duplicates and edges to nodes it was not given", () => {
        const positions = layoutBlueprintGraph(
            [box("a"), box("b")],
            [edge("a", "a"), edge("a", "b"), edge("a", "b"), edge("a", "ghost")],
        );

        expect(positions.a!.x).toBeLessThan(positions.b!.x);
        expect(positions.ghost).toBeUndefined();
    });

    it("answers the same way twice, whatever order the nodes arrive in", () => {
        const boxes = [box("a", 0, 0), box("b", 10, 300), box("c", 20, 600), box("d", 30, 900)];
        const links = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")];

        const first = layoutBlueprintGraph(boxes, links);
        const second = layoutBlueprintGraph([...boxes].reverse(), [...links].reverse());

        expect(second).toEqual(first);
    });

    it("settles: formatting an already formatted graph moves nothing", () => {
        const boxes = [box("a", 0, 0), box("b", 10, 300), box("c", 20, 600), box("d", 30, 900)];
        const links = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")];

        const first = layoutBlueprintGraph(boxes, links);
        const again = layoutBlueprintGraph(
            boxes.map(b => ({ ...b, ...first[b.id]! })),
            links,
        );

        expect(again).toEqual(first);
    });

    it("gives a wide card its own column width", () => {
        const positions = layoutBlueprintGraph(
            [box("a", 0, 0, 500, 100), box("b")],
            [edge("a", "b")],
            { layerGap: 90 },
        );

        expect(positions.b!.x - positions.a!.x).toBe(500 + 90);
    });

    describe("vertical", () => {
        const down = { direction: "vertical" } as const;

        it("runs a chain down the page in one column", () => {
            const positions = layoutBlueprintGraph(
                [box("a", 0, 0), box("b", 400, 40), box("c", 900, 90)],
                [edge("a", "b"), edge("b", "c")],
                down,
            );

            expect(positions.a!.y).toBeLessThan(positions.b!.y);
            expect(positions.b!.y).toBeLessThan(positions.c!.y);
            expect(positions.a!.x).toBe(positions.b!.x);
            expect(positions.b!.x).toBe(positions.c!.x);
        });

        it("leaves the layer gap below a card rather than beside it", () => {
            const positions = layoutBlueprintGraph([box("a"), box("b")], [edge("a", "b")], {
                ...down,
                layerGap: 90,
            });

            expect(positions.b!.y - positions.a!.y).toBe(100 + 90);
            expect(positions.b!.x).toBe(positions.a!.x);
        });

        it("puts two branches out of one card side by side", () => {
            const positions = layoutBlueprintGraph(
                [box("head"), box("left", 0, 0), box("right", 10, 0)],
                [edge("head", "left"), edge("head", "right")],
                down,
            );

            expect(positions.left!.y).toBe(positions.right!.y);
            expect(Math.abs(positions.left!.x - positions.right!.x)).toBeGreaterThanOrEqual(200);
        });

        it("anchors at the corner the graph already occupied, as the other direction does", () => {
            const positions = layoutBlueprintGraph([box("a", 400, 300), box("b", 400, 700)], [edge("a", "b")], down);

            expect(positions.a).toEqual({ x: 400, y: 300 });
        });

        it("settles: formatting an already vertical graph moves nothing", () => {
            const boxes = [box("a", 0, 0), box("b", 300, 10), box("c", 600, 20), box("d", 900, 30)];
            const links = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")];

            const first = layoutBlueprintGraph(boxes, links, down);
            const again = layoutBlueprintGraph(
                boxes.map(b => ({ ...b, ...first[b.id]! })),
                links,
                down,
            );

            expect(again).toEqual(first);
        });
    });
});
