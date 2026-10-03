import { describe, expect, it } from "vitest";
import {
    layoutBlueprintGraph,
    measureBlueprintLayout,
    type BlueprintLayoutCard,
    type BlueprintLayoutComment,
    type BlueprintLayoutGraph,
    type BlueprintLayoutPin,
    type BlueprintLayoutWire,
} from "./blueprintAutoLayout";

/**
 * A card shaped like the editor's: a header, then one row per pin pair - execution pins first, then
 * data pins, inputs down the left and outputs down the right, 22 apart.
 */
function card(
    id: string,
    shape: { in?: boolean; out?: string[]; data?: string[]; values?: string[]; x?: number; y?: number; width?: number } = {},
): BlueprintLayoutCard {
    const left: { id: string; kind: "exec" | "data" }[] = [
        ...(shape.in ? [{ id: "in", kind: "exec" as const }] : []),
        ...(shape.data ?? []).map(pin => ({ id: pin, kind: "data" as const })),
    ];
    const right: { id: string; kind: "exec" | "data" }[] = [
        ...(shape.out ?? []).map(pin => ({ id: pin, kind: "exec" as const })),
        ...(shape.values ?? []).map(pin => ({ id: pin, kind: "data" as const })),
    ];
    const rows = Math.max(1, left.length, right.length);
    const pins: BlueprintLayoutPin[] = [
        ...left.map((pin, row) => ({ id: pin.id, side: "in" as const, kind: pin.kind, offset: 60 + 22 * row })),
        ...right.map((pin, row) => ({ id: pin.id, side: "out" as const, kind: pin.kind, offset: 60 + 22 * row })),
    ];
    return { id, x: shape.x ?? 0, y: shape.y ?? 0, width: shape.width ?? 200, height: 77 + 22 * (rows - 1), pins };
}

/** An event head: one execution output and any data outputs. */
const head = (id: string, values: string[] = [], at: { x?: number; y?: number } = {}) =>
    card(id, { out: ["then"], values, ...at });
/** An ordinary execution card: in, next, and data pins. */
const step = (id: string, data: string[] = [], values: string[] = [], at: { x?: number; y?: number } = {}) =>
    card(id, { in: true, out: ["next"], data, values, ...at });
/** A card that only computes a value. */
const value = (id: string, data: string[] = [], at: { x?: number; y?: number } = {}) =>
    card(id, { data, values: ["result"], ...at });

function wire(from: string, to: string): BlueprintLayoutWire {
    const [a, fromPin] = from.split(".") as [string, string];
    const [b, toPin] = to.split(".") as [string, string];
    return { from: a, fromPin, to: b, toPin };
}

function pinY(graph: BlueprintLayoutGraph, positions: Record<string, { x: number; y: number }>, ref: string): number {
    const [id, pin] = ref.split(".") as [string, string];
    const c = graph.cards.find(item => item.id === id)!;
    return positions[id]!.y + c.pins.find(item => item.id === pin)!.offset;
}

function rightOf(graph: BlueprintLayoutGraph, positions: Record<string, { x: number; y: number }>, id: string): number {
    return positions[id]!.x + graph.cards.find(item => item.id === id)!.width;
}

function bottomOf(graph: BlueprintLayoutGraph, positions: Record<string, { x: number; y: number }>, id: string): number {
    return positions[id]!.y + graph.cards.find(item => item.id === id)!.height;
}

function untangled(graph: BlueprintLayoutGraph) {
    const result = layoutBlueprintGraph(graph);
    return { result, measure: measureBlueprintLayout(graph, result.positions) };
}

describe("layoutBlueprintGraph", () => {
    it("has nothing to say about an empty graph", () => {
        expect(layoutBlueprintGraph({ cards: [], wires: [] })).toEqual({ positions: {}, frames: {} });
    });

    it("anchors the result at the corner the graph already occupied", () => {
        const graph = { cards: [head("a", [], { x: 400, y: 300 }), step("b", [], [], { x: 700, y: 300 })], wires: [wire("a.then", "b.in")] };
        const { positions } = layoutBlueprintGraph(graph);

        expect(Math.min(positions.a!.x, positions.b!.x)).toBe(400);
        expect(Math.min(positions.a!.y, positions.b!.y)).toBe(300);
    });

    it("runs a chain along one straight execution line", () => {
        const graph = {
            cards: [head("a", [], { y: 0 }), step("b", [], [], { x: 40, y: 400 }), step("c", [], [], { x: 90, y: 900 })],
            wires: [wire("a.then", "b.in"), wire("b.next", "c.in")],
        };
        const { positions } = layoutBlueprintGraph(graph);

        expect(positions.a!.x).toBeLessThan(positions.b!.x);
        expect(positions.b!.x).toBeLessThan(positions.c!.x);
        expect(pinY(graph, positions, "a.then")).toBe(pinY(graph, positions, "b.in"));
        expect(pinY(graph, positions, "b.next")).toBe(pinY(graph, positions, "c.in"));
        expect(positions.b!.x - rightOf(graph, positions, "a")).toBe(90);
    });

    it("lines execution pins up even when the cards are of different heights", () => {
        const tall = { ...step("b"), height: 230, pins: step("b").pins.map(pin => ({ ...pin, offset: pin.offset + 130 })) };
        const graph = { cards: [head("a"), tall, step("c")], wires: [wire("a.then", "b.in"), wire("b.next", "c.in")] };
        const { positions } = layoutBlueprintGraph(graph);

        expect(pinY(graph, positions, "a.then")).toBe(pinY(graph, positions, "b.in"));
        expect(pinY(graph, positions, "b.next")).toBe(pinY(graph, positions, "c.in"));
    });

    describe("a branch", () => {
        const branch = card("if", { in: true, out: ["true", "false"], data: ["condition"] });
        const graph = {
            cards: [head("start"), branch, step("yes1"), step("yes2"), step("no1"), step("no2")],
            wires: [
                wire("start.then", "if.in"),
                wire("if.true", "yes1.in"),
                wire("yes1.next", "yes2.in"),
                wire("if.false", "no1.in"),
                wire("no1.next", "no2.in"),
            ],
        };

        it("continues the row with its first output and starts a row below for the next", () => {
            const { positions } = layoutBlueprintGraph(graph);

            expect(pinY(graph, positions, "if.true")).toBe(pinY(graph, positions, "yes1.in"));
            expect(pinY(graph, positions, "no1.in")).toBeGreaterThan(pinY(graph, positions, "if.false"));
            expect(pinY(graph, positions, "no1.next")).toBe(pinY(graph, positions, "no2.in"));
        });

        it("starts the second row just right of the card it leaves", () => {
            const { positions } = layoutBlueprintGraph(graph);

            expect(positions.no1!.x).toBeGreaterThan(rightOf(graph, positions, "if"));
            expect(positions.no1!.x - rightOf(graph, positions, "if")).toBeLessThanOrEqual(90);
        });

        it("crosses nothing and runs nothing backwards", () => {
            expect(untangled(graph).measure).toEqual({ crossings: 0, backwards: 0, throughCards: 0, overlaps: 0 });
        });

        describe("whose first output has feeders of its own", () => {
            // The true side's cards each read a value drawn just below them, the way Set Element
            // Variant reads its Element: the false row has to clear those too.
            const fed = {
                cards: [
                    head("start"),
                    card("if", { in: true, out: ["true", "false"], data: ["condition"] }),
                    step("yes1", ["v"]),
                    step("yes2", ["v"]),
                    { ...value("feedYes1"), height: 211, pins: [{ id: "result", side: "out" as const, kind: "data" as const, offset: 194 }] },
                    { ...value("feedYes2"), height: 211, pins: [{ id: "result", side: "out" as const, kind: "data" as const, offset: 194 }] },
                    step("no1", ["v"]),
                    step("no2"),
                    value("feedNo1"),
                ],
                wires: [
                    wire("start.then", "if.in"),
                    wire("if.true", "yes1.in"),
                    wire("feedYes1.result", "yes1.v"),
                    wire("yes1.next", "yes2.in"),
                    wire("feedYes2.result", "yes2.v"),
                    wire("if.false", "no1.in"),
                    wire("feedNo1.result", "no1.v"),
                    wire("no1.next", "no2.in"),
                ],
            };

            it("reads true then false: the false row goes below the whole true side", () => {
                const { positions } = layoutBlueprintGraph(fed);
                const trueBottom = Math.max(...["yes1", "yes2", "feedYes1", "feedYes2"].map(id => bottomOf(fed, positions, id)));

                for (const id of ["no1", "no2", "feedNo1"]) {
                    expect(positions[id]!.y).toBeGreaterThan(trueBottom);
                }
                expect(pinY(fed, positions, "if.true")).toBe(pinY(fed, positions, "yes1.in"));
            });

            it("keeps the graph compact: the true side starts where its feeders need it to", () => {
                const { positions } = layoutBlueprintGraph(fed);

                // One feeder column and the false row's corridor - not the whole false row's width.
                expect(positions.yes1!.x - rightOf(fed, positions, "if")).toBeLessThanOrEqual(90 + 200 + 2 * 60);
            });

            it("drops the false wire down a corridor beside the true side, crossing nothing", () => {
                const { result, measure } = untangled(fed);

                expect(measure).toEqual({ crossings: 0, backwards: 0, throughCards: 0, overlaps: 0 });
                for (const id of ["yes1", "yes2", "feedYes1", "feedYes2"]) {
                    expect(result.positions[id]!.x).toBeGreaterThanOrEqual(result.positions.no1!.x);
                }
            });
        });
    });

    describe("feeders", () => {
        it("puts a data card just before and below the input it feeds", () => {
            const graph = {
                cards: [head("start"), step("use", ["v"]), value("source")],
                wires: [wire("start.then", "use.in"), wire("source.result", "use.v")],
            };
            const { positions } = layoutBlueprintGraph(graph);

            expect(positions.use!.x - rightOf(graph, positions, "source")).toBe(60);
            expect(positions.source!.y).toBeGreaterThan(pinY(graph, positions, "use.in"));
            expect(positions.source!.x).toBeGreaterThan(rightOf(graph, positions, "start"));
        });

        it("runs a chain of data cards leftwards from its consumer, level, out of the execution row", () => {
            const graph = {
                cards: [head("start"), step("use", ["v"]), value("last", ["a"]), value("middle", ["a"]), value("first")],
                wires: [
                    wire("start.then", "use.in"),
                    wire("last.result", "use.v"),
                    wire("middle.result", "last.a"),
                    wire("first.result", "middle.a"),
                ],
            };
            const { positions } = layoutBlueprintGraph(graph);

            expect(positions.first!.x).toBeLessThan(positions.middle!.x);
            expect(positions.middle!.x).toBeLessThan(positions.last!.x);
            expect(pinY(graph, positions, "first.result")).toBe(pinY(graph, positions, "middle.a"));
            expect(pinY(graph, positions, "middle.result")).toBe(pinY(graph, positions, "last.a"));
            for (const id of ["first", "middle", "last"]) {
                expect(positions[id]!.y).toBeGreaterThan(pinY(graph, positions, "use.in"));
            }
            expect(untangled(graph).measure).toEqual({ crossings: 0, backwards: 0, throughCards: 0, overlaps: 0 });
        });

        it("stacks a card's feeders in the order of its inputs, whatever order they were in", () => {
            // Written upside down: the feeder of the lower input sits above the other one.
            const graph = {
                cards: [head("start"), step("use", ["a", "b"]), value("forB", [], { y: -400 }), value("forA", [], { y: 400 })],
                wires: [wire("start.then", "use.in"), wire("forA.result", "use.a"), wire("forB.result", "use.b")],
            };
            const { result, measure } = untangled(graph);

            expect(result.positions.forA!.y).toBeLessThan(result.positions.forB!.y);
            expect(measure.crossings).toBe(0);
        });

        it("spaces execution cards so their feeders fit between them", () => {
            const graph = {
                cards: [head("start"), step("use", ["v"]), value("wide", [], { x: 0, y: 0 })],
                wires: [wire("start.then", "use.in"), wire("wide.result", "use.v")],
            };
            graph.cards[2] = { ...graph.cards[2]!, width: 280 };
            const { positions } = layoutBlueprintGraph(graph);

            expect(positions.wide!.x).toBeGreaterThanOrEqual(rightOf(graph, positions, "start") + 60);
            expect(positions.use!.x).toBe(rightOf(graph, positions, "wide") + 60);
        });
    });

    it("draws a Memo's value forwards to every input it feeds without crossing them", () => {
        // head.value -> scale -> memo.value; memo.result feeds the next card directly and a chain
        // into the card after that.
        const graph = {
            cards: [
                head("changed", ["value"]),
                value("scale", ["a"]),
                step("memo", ["value"], ["result"]),
                step("apply", ["amount"]),
                step("show", ["text"]),
                value("round", ["v"]),
                value("label", ["v"]),
            ],
            wires: [
                wire("changed.then", "memo.in"),
                wire("changed.value", "scale.a"),
                wire("scale.result", "memo.value"),
                wire("memo.next", "apply.in"),
                wire("memo.result", "apply.amount"),
                wire("apply.next", "show.in"),
                wire("memo.result", "round.v"),
                wire("round.result", "label.v"),
                wire("label.result", "show.text"),
            ],
        };
        const { result, measure } = untangled(graph);

        expect(measure).toEqual({ crossings: 0, backwards: 0, throughCards: 0, overlaps: 0 });
        expect(result.positions.round!.x).toBeGreaterThan(rightOf(graph, result.positions, "memo"));
    });

    it("draws a value shared by two inputs beside one of them and wires it forwards to the other", () => {
        const graph = {
            cards: [head("start"), step("one", ["v"]), step("two", ["v"]), value("shared")],
            wires: [
                wire("start.then", "one.in"),
                wire("one.next", "two.in"),
                wire("shared.result", "one.v"),
                wire("shared.result", "two.v"),
            ],
        };
        const { result, measure } = untangled(graph);

        expect(measure.backwards).toBe(0);
        expect(measure.overlaps).toBe(0);
        expect(result.positions.shared!.x).toBeLessThan(result.positions.one!.x);
    });

    describe("frames and notes", () => {
        const graph: BlueprintLayoutGraph = {
            cards: [
                head("start", [], { x: 0, y: 200 }),
                step("a", ["v"], [], { x: 300, y: 200 }),
                value("feed", [], { x: 300, y: 400 }),
                step("b", [], [], { x: 700, y: 200 }),
                step("c", [], [], { x: 1000, y: 200 }),
            ],
            wires: [
                wire("start.then", "a.in"),
                wire("feed.result", "a.v"),
                wire("a.next", "b.in"),
                wire("b.next", "c.in"),
            ],
            comments: [
                { id: "note", x: 0, y: 0, width: 600, height: 120, frame: false },
                // Holds a and its feeder; c has a frame of its own.
                { id: "frameA", x: 280, y: 150, width: 260, height: 400, frame: true },
                { id: "frameC", x: 980, y: 150, width: 240, height: 160, frame: true },
            ],
        };

        it("keeps a frame around the cards it held, and only those", () => {
            const { frames, positions } = layoutBlueprintGraph(graph);
            const inside = (frame: { x: number; y: number; width: number; height: number }, id: string) => {
                const c = graph.cards.find(item => item.id === id)!;
                const p = positions[id]!;
                return p.x >= frame.x && p.y >= frame.y && p.x + c.width <= frame.x + frame.width && p.y + c.height <= frame.y + frame.height;
            };
            const overlapsFrame = (frame: { x: number; y: number; width: number; height: number }, id: string) => {
                const c = graph.cards.find(item => item.id === id)!;
                const p = positions[id]!;
                return p.x < frame.x + frame.width && frame.x < p.x + c.width && p.y < frame.y + frame.height && frame.y < p.y + c.height;
            };

            expect(inside(frames.frameA!, "a")).toBe(true);
            expect(inside(frames.frameA!, "feed")).toBe(true);
            expect(inside(frames.frameC!, "c")).toBe(true);
            for (const id of ["start", "b", "c"]) {
                expect(overlapsFrame(frames.frameA!, id)).toBe(false);
            }
            for (const id of ["start", "a", "feed", "b"]) {
                expect(overlapsFrame(frames.frameC!, id)).toBe(false);
            }
            // Constant padding: the frame is fitted to its members, not left at the author's size.
            expect(frames.frameC!.width).toBe(200 + 28 + 28);
        });

        it("takes a frame's members as given when the caller has decided them", () => {
            const given: BlueprintLayoutGraph = {
                ...graph,
                // Drawn around nothing in particular, but said to hold b.
                comments: [{ id: "frameB", x: -500, y: -500, width: 100, height: 100, frame: true, members: ["b"] }],
            };
            const { frames, positions } = layoutBlueprintGraph(given);

            expect(frames.frameB).toEqual({
                x: positions.b!.x - 28,
                y: positions.b!.y - 48,
                width: 200 + 28 + 28,
                height: 77 + 48 + 28,
            });
        });

        it("puts a note above the chain it was written over", () => {
            const { positions } = layoutBlueprintGraph(graph);
            const top = Math.min(...graph.cards.map(c => positions[c.id]!.y));

            expect(positions.note!.y + 120).toBeLessThanOrEqual(top);
        });
    });

    it("places every card of a loop and runs only the wire that closes it backwards", () => {
        const graph = {
            cards: [head("start"), step("body"), step("again")],
            wires: [wire("start.then", "body.in"), wire("body.next", "again.in"), wire("again.next", "body.in")],
        };
        const { result, measure } = untangled(graph);

        expect(Object.keys(result.positions).sort()).toEqual(["again", "body", "start"]);
        expect(result.positions.start!.x).toBeLessThan(result.positions.body!.x);
        expect(measure.backwards).toBe(1);
        expect(measure.overlaps).toBe(0);
    });

    it("stacks disconnected pieces down the page in the order they were in", () => {
        const graph = {
            cards: [head("lowerHead", [], { y: 900 }), step("lower", [], [], { x: 300, y: 900 }), head("upperHead", [], { y: 100 }), step("upper", [], [], { x: 300, y: 100 })],
            wires: [wire("lowerHead.then", "lower.in"), wire("upperHead.then", "upper.in")],
        };
        const { positions } = layoutBlueprintGraph(graph);

        expect(bottomOf(graph, positions, "upper")).toBeLessThan(positions.lowerHead!.y);
        expect(measureBlueprintLayout(graph, positions).overlaps).toBe(0);
    });

    it("ignores self-loops, duplicates and wires to cards it was not given", () => {
        const graph = {
            cards: [head("a"), step("b")],
            wires: [wire("a.then", "a.then"), wire("a.then", "b.in"), wire("a.then", "b.in"), wire("a.then", "ghost.in")],
        };
        const { positions } = layoutBlueprintGraph(graph);

        expect(positions.a!.x).toBeLessThan(positions.b!.x);
        expect(positions.ghost).toBeUndefined();
    });

    const sample = (): BlueprintLayoutGraph => ({
        cards: [
            head("start", [], { x: 0, y: 0 }),
            card("if", { in: true, out: ["true", "false"], data: ["condition"], x: 300, y: 0 }),
            value("test", [], { x: 100, y: 300 }),
            step("yes", ["v"], [], { x: 600, y: 0 }),
            value("feedYes", [], { x: 500, y: 300 }),
            step("no", [], [], { x: 600, y: 600 }),
            step("after", [], [], { x: 900, y: 0 }),
        ],
        wires: [
            wire("start.then", "if.in"),
            wire("test.result", "if.condition"),
            wire("if.true", "yes.in"),
            wire("feedYes.result", "yes.v"),
            wire("if.false", "no.in"),
            wire("yes.next", "after.in"),
            wire("no.next", "after.in"),
        ],
        comments: [{ id: "frame", x: 480, y: -40, width: 360, height: 520, frame: true }],
    });

    it("answers the same way whatever order the cards and wires arrive in", () => {
        const graph = sample();
        const first = layoutBlueprintGraph(graph);
        const second = layoutBlueprintGraph({
            cards: [...graph.cards].reverse(),
            wires: [...graph.wires].reverse(),
            comments: graph.comments,
        });

        expect(second).toEqual(first);
    });

    it("settles: formatting an already formatted graph moves nothing", () => {
        const graph = sample();
        const first = layoutBlueprintGraph(graph);
        const again = layoutBlueprintGraph({
            cards: graph.cards.map(c => ({ ...c, ...first.positions[c.id]! })),
            wires: graph.wires,
            comments: graph.comments!.map((c: BlueprintLayoutComment) => ({ ...c, ...first.frames[c.id]! })),
        });

        expect(again).toEqual(first);
    });

    describe("vertical", () => {
        const down = { direction: "vertical" } as const;

        it("runs a chain down the page in one column", () => {
            const graph = {
                cards: [head("a"), step("b", [], [], { x: 400, y: 40 }), step("c", [], [], { x: 900, y: 90 })],
                wires: [wire("a.then", "b.in"), wire("b.next", "c.in")],
            };
            const { positions } = layoutBlueprintGraph(graph, down);

            expect(positions.a!.y).toBeLessThan(positions.b!.y);
            expect(positions.b!.y).toBeLessThan(positions.c!.y);
            expect(positions.a!.x).toBe(positions.b!.x);
            expect(positions.b!.x).toBe(positions.c!.x);
        });

        it("anchors at the corner the graph already occupied, as the other direction does", () => {
            const graph = { cards: [head("a", [], { x: 400, y: 300 }), step("b", [], [], { x: 400, y: 700 })], wires: [wire("a.then", "b.in")] };
            const { positions } = layoutBlueprintGraph(graph, down);

            expect(Math.min(positions.a!.x, positions.b!.x)).toBe(400);
            expect(Math.min(positions.a!.y, positions.b!.y)).toBe(300);
        });

        it("keeps cards from overlapping", () => {
            const graph = sample();
            const { positions } = layoutBlueprintGraph(graph, down);

            expect(measureBlueprintLayout(graph, positions).overlaps).toBe(0);
        });
    });
});
