import { describe, expect, it } from "vitest";
import { countDocumentChanges } from "@shared/documents/diff";
import { uiGraphsSpec } from "@shared/documents/specs";
import type { Blueprint, BlueprintGraphEdge, BlueprintGraphNode } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION, type UIGraphDocument } from "@shared/types/ui-editor/graph";
import {
    accountedGraphChanges,
    buildGraphDiffPlan,
    GRAPH_NODE_HEIGHT,
    GRAPH_NODE_WIDTH,
    graphKeyOf,
    graphMaskTarget,
    graphNodeBox,
    readGraphs,
    sharedGraphViewport,
    type GraphNodeFacts,
} from "./graphDiffPlan";

/**
 * What the blueprint canvas decides before it draws anything.
 *
 * Driven by the real spec's diff, for the reason `surfaceDiffPlan.test.ts` gives: the addressing is
 * a contract across a process boundary, and a hand-written path would keep passing after the
 * producer stopped emitting that shape - putting marks on the wrong nodes with every test green.
 *
 * The geometry IS testable here, unlike the interface canvas next door: a graph is laid out from
 * coordinates in the file rather than measured off the DOM, so "the same node is in the same place
 * in both columns" is arithmetic and is pinned below.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function node(id: string, type: string, x: number, y: number): BlueprintGraphNode {
    return { id, type, params: {}, meta: { editorLayout: { x, y } } };
}

function blueprint(
    id: string,
    name: string,
    nodes: BlueprintGraphNode[],
    edges: BlueprintGraphEdge[] = [],
): Blueprint {
    return {
        id,
        name,
        owner: { kind: "globalMain" },
        frontend: "visual",
        programKind: "graph",
        program: {
            kind: "graph",
            graphs: {
                eventIds: ["ev-1"],
                events: {
                    "ev-1": {
                        id: "ev-1",
                        name: "On click",
                        graph: { nodes: Object.fromEntries(nodes.map(one => [one.id, one])), edges },
                    },
                },
                functionIds: [],
                functions: {},
            },
        },
    };
}

function uigraphs(...blueprints: Blueprint[]): UIGraphDocument {
    return {
        schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
        graphs: {},
        blueprintDocument: {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: Object.fromEntries(blueprints.map(one => [one.id, one])),
            ownerRecords: {},
        },
    };
}

const GRAPH_KEY = graphKeyOf({ blueprintId: "bp-1", slot: "events", graphId: "ev-1" });

const HEAD_NODE = () => node("n-head", "blueprint.event.head.click", 0, 0);
const LOG_NODE = () => node("n-log", "blueprint.debug.log", 400, 0);
const WIRE: BlueprintGraphEdge = { from: { nodeId: "n-head", port: "then" }, to: { nodeId: "n-log", port: "in" } };

function baseDocument(): UIGraphDocument {
    return uigraphs(blueprint("bp-1", "Main menu", [HEAD_NODE(), LOG_NODE()], [WIRE]));
}

/**
 * One of each: a node dragged, a node's parameters edited, a node added, and a wire pulled out.
 *
 * The drag and the parameter edit are the pair the whole tone scheme turns on, so both are here and
 * both are on nodes that also exist on the other side.
 */
function headDocument(): UIGraphDocument {
    const dragged = node("n-head", "blueprint.event.head.click", 40, 60);
    const edited: BlueprintGraphNode = { ...LOG_NODE(), params: { message: "hello" } };
    return uigraphs(blueprint("bp-1", "Main menu", [dragged, edited, node("n-wait", "blueprint.time.wait", 800, 0)], []));
}

function planOf(base: UIGraphDocument, head: UIGraphDocument) {
    const diff = uiGraphsSpec.diff!(base, head, { limit: 200 });
    return { diff, plan: buildGraphDiffPlan(diff.changes, base, head) };
}

// ---------------------------------------------------------------------------
// The invariant the surface is trusted for
// ---------------------------------------------------------------------------

describe("every change is either marked or named", () => {
    it("accounts for every row and every leaf the diff produced", () => {
        const { diff, plan } = planOf(baseDocument(), headDocument());

        expect(diff.changes.length).toBeGreaterThan(3);
        expect(accountedGraphChanges(plan)).toEqual({
            rows: diff.changes.length,
            leaves: countDocumentChanges(diff.changes),
        });
        expect(accountedGraphChanges(plan).leaves).toBe(diff.total);
    });

    it("marks nodes, wires and the graph itself, and excuses only what has no canvas", () => {
        const { plan } = planOf(baseDocument(), headDocument());
        const targets = plan.masks.map(mask => mask.target);

        expect(targets).toContainEqual({ kind: "node", nodeId: "n-head" });
        expect(targets).toContainEqual({ kind: "node", nodeId: "n-log" });
        expect(targets).toContainEqual({ kind: "node", nodeId: "n-wait" });
        expect(targets).toContainEqual({ kind: "edge", edgeKey: "n-head:then->n-log:in" });
        expect(plan.offCanvas).toEqual([]);
    });

    it("puts a blueprint's own fields and its layer order on the excused list", () => {
        const base = baseDocument();
        const head = uigraphs({ ...blueprint("bp-1", "Start screen", [HEAD_NODE(), LOG_NODE()], [WIRE]) });
        const { plan } = planOf(base, head);

        expect(plan.masks).toEqual([]);
        expect(plan.offCanvas.map(entry => entry.reason)).toEqual(["blueprint"]);
    });
});

// ---------------------------------------------------------------------------
// Which mark
// ---------------------------------------------------------------------------

describe("what each mark says", () => {
    it("tells a node that was dragged from one whose parameters changed", () => {
        const { plan } = planOf(baseDocument(), headDocument());
        const tone = (nodeId: string) =>
            plan.masks.find(mask => mask.target.kind === "node" && mask.target.nodeId === nodeId)?.tone;

        // The whole reason `editorLayout` is its own leaf with its own kind: a drag changes nothing
        // about what the game does and must not rank with a parameter that decides what runs next.
        expect(tone("n-head")).toBe("moved");
        expect(tone("n-log")).toBe("changed");
        expect(tone("n-wait")).toBe("added");
    });

    it("draws a wire that was pulled out only on the old side", () => {
        const { plan } = planOf(baseDocument(), headDocument());
        const wire = plan.masks.find(mask => mask.target.kind === "edge");

        expect(wire).toMatchObject({ tone: "removed", onBase: true, onHead: false });
    });
});

// ---------------------------------------------------------------------------
// Which graph, and where its nodes are
// ---------------------------------------------------------------------------

describe("which graph the canvas opens on", () => {
    it("opens on the graph with the most changes", () => {
        const quiet = blueprint("bp-2", "Pause", [node("n-quiet", "blueprint.debug.log", 0, 0)]);
        const base = uigraphs(blueprint("bp-1", "Main menu", [HEAD_NODE(), LOG_NODE()], [WIRE]), quiet);
        const head = uigraphs(
            blueprint("bp-1", "Main menu", [node("n-head", "blueprint.event.head.click", 40, 60), LOG_NODE()], [WIRE]),
            quiet,
        );
        const { plan } = planOf(base, head);

        expect(plan.defaultGraphKey).toBe(GRAPH_KEY);
        expect(plan.graphs.map(option => option.changes)).toEqual([1, 0]);
    });

    it("names a graph by its blueprint and its own name", () => {
        const { plan } = planOf(baseDocument(), baseDocument());
        expect(plan.graphs).toEqual([
            expect.objectContaining({ key: GRAPH_KEY, name: "On click", blueprintName: "Main menu", inBase: true, inHead: true }),
        ]);
    });

    it("reads a node's authored position, and both sides' nodes out of one document", () => {
        const graphs = readGraphs(headDocument());
        const graph = graphs.get(GRAPH_KEY);

        expect(graph?.nodes.find(one => one.id === "n-head")).toEqual({
            id: "n-head",
            type: "blueprint.event.head.click",
            x: 40,
            y: 60,
        });
        expect(graph?.edges).toEqual([]);
    });

    it("reads a graph out of a document with nothing in it rather than throwing", () => {
        expect(readGraphs(null).size).toBe(0);
        expect(readGraphs({} as UIGraphDocument).size).toBe(0);
    });
});

describe("the viewport both columns share", () => {
    /** A node as the plan reads it out of a document: position lifted out of `meta.editorLayout`. */
    const at = (id: string, x: number, y: number): GraphNodeFacts => ({ id, type: "t", x, y });
    const base = [at("a", 0, 0), at("b", 400, 0)];
    const head = [at("a", 0, 0), at("b", 400, 300)];

    it("puts a node that did not move in the same place in both columns", () => {
        const viewport = sharedGraphViewport([base, head], { width: 800, height: 400 });
        const inBase = graphNodeBox(base[0], viewport);
        const inHead = graphNodeBox(head[0], viewport);

        expect(inBase).toEqual(inHead);
        // And the one that DID move is the only thing that looks different.
        expect(graphNodeBox(base[1], viewport)).not.toEqual(graphNodeBox(head[1], viewport));
    });

    it("is one box over both sides, so neither column crops what the other holds", () => {
        const viewport = sharedGraphViewport([base, head], { width: 10_000, height: 10_000 });

        expect(viewport.scale).toBe(1);
        expect(viewport.x).toBeLessThanOrEqual(0);
        expect(viewport.y).toBeLessThanOrEqual(0);
        expect(viewport.x + viewport.width).toBeGreaterThanOrEqual(400 + GRAPH_NODE_WIDTH);
        expect(viewport.y + viewport.height).toBeGreaterThanOrEqual(300 + GRAPH_NODE_HEIGHT);
    });

    it("shrinks to fit the narrower of the two limits, and never magnifies", () => {
        const wide = sharedGraphViewport([base, head], { width: 100, height: 10_000 });
        expect(wide.scale).toBeLessThan(1);
        expect(wide.width * wide.scale).toBeCloseTo(100);

        expect(sharedGraphViewport([[at("a", 0, 0)]], { width: 10_000, height: 10_000 }).scale).toBe(1);
    });

    it("answers a drawable box for a graph with no nodes at all", () => {
        expect(sharedGraphViewport([[], []], { width: 300, height: 200 }))
            .toEqual({ x: 0, y: 0, width: 300, height: 200, scale: 1 });
    });
});

// ---------------------------------------------------------------------------
// Addressing
// ---------------------------------------------------------------------------

describe("reading a path", () => {
    it("reads a blueprint graph's nodes and wires positionally", () => {
        expect(graphMaskTarget(["blueprints", "bp", "events", "ev", "nodes", "n1"])).toEqual({
            address: { blueprintId: "bp", slot: "events", graphId: "ev" },
            target: { kind: "node", nodeId: "n1" },
        });
        expect(graphMaskTarget(["blueprints", "bp", "functions", "fn", "edges", "a:x->b:y"])?.target)
            .toEqual({ kind: "edge", edgeKey: "a:x->b:y" });
        expect(graphMaskTarget(["blueprints", "bp", "events", "ev"])?.target).toEqual({ kind: "graph" });
        // A leaf handed over on its own is still about its node.
        expect(graphMaskTarget(["blueprints", "bp", "events", "ev", "nodes", "n1", "params"])?.target)
            .toEqual({ kind: "node", nodeId: "n1" });
    });

    it("reads the older root-level form on the same terms", () => {
        expect(graphMaskTarget(["graphs", "g1", "nodes", "n1"])).toEqual({
            address: { blueprintId: null, slot: null, graphId: "g1" },
            target: { kind: "node", nodeId: "n1" },
        });
    });

    it("refuses a blueprint's own fields and the owner records", () => {
        expect(graphMaskTarget(["blueprints", "bp"])).toBeNull();
        expect(graphMaskTarget(["blueprints", "bp", "eventIds"])).toBeNull();
        expect(graphMaskTarget(["ownerRecords", "surface:1"])).toBeNull();
        expect(graphMaskTarget([])).toBeNull();
    });

    /** Two graphs in two blueprints may share an id; the key has to keep them apart. */
    it("keys a graph by its blueprint as well as by its own id", () => {
        expect(graphKeyOf({ blueprintId: "a", slot: "events", graphId: "g" }))
            .not.toBe(graphKeyOf({ blueprintId: "b", slot: "events", graphId: "g" }));
        expect(graphKeyOf({ blueprintId: null, slot: null, graphId: "g" }))
            .not.toBe(graphKeyOf({ blueprintId: "a", slot: "events", graphId: "g" }));
        // Never a NUL byte: one of those in a source file takes the whole module out of every diff.
        expect(graphKeyOf({ blueprintId: "a", slot: "events", graphId: "g" })).not.toContain("\0");
    });
});
