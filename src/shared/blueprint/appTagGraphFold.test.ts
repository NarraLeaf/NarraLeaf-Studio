import { describe, expect, it } from "vitest";
import {
    applyAppTagToBlueprintDocument,
    collectUnfoldableAppTagGraphs,
    foldAppTagInBlueprintGraph,
} from "./appTagGraphFold";
import { BLUEPRINT_IF_ELSE_BRANCH_PINS, BLUEPRINT_SWITCH_STRING_CASE_PINS } from "./blueprintPinSemantics";
import type { Blueprint, BlueprintDocument, BlueprintGraphEdge, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_BOOLEAN_NOT,
    BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
    BLUEPRINT_NODE_TYPE_FLOW_NOOP,
    BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG,
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_STRING_EQUALS,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
} from "@shared/types/blueprint/graph";

const DEMO = { tagName: "Demo" };
const MAIN = { tagName: "main" };

type NodeSpec = { id: string; type: string; params?: Record<string, unknown> };

function graph(nodes: NodeSpec[], edges: Array<[string, string, string, string]>): BlueprintGraphIr {
    return {
        nodes: Object.fromEntries(nodes.map(node => [node.id, node])),
        edges: edges.map(([fromNode, fromPort, toNode, toPort]): BlueprintGraphEdge => ({
            from: { nodeId: fromNode, port: fromPort },
            to: { nodeId: toNode, port: toPort },
        })),
    };
}

function nodeIds(ir: BlueprintGraphIr): string[] {
    return Object.keys(ir.nodes ?? {}).sort();
}

function edgeList(ir: BlueprintGraphIr): string[] {
    return (ir.edges ?? []).map(e => `${e.from.nodeId}.${e.from.port}->${e.to.nodeId}.${e.to.port}`).sort();
}

/** Head → If, whose condition is `Get App Tag == "Demo"`, with one node on each arm. */
function ifGraph(): BlueprintGraphIr {
    return graph(
        [
            { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
            { id: "if", type: BLUEPRINT_NODE_TYPE_FLOW_IF },
            { id: "tag", type: BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG },
            { id: "wanted", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "Demo" } },
            { id: "eq", type: BLUEPRINT_NODE_TYPE_STRING_EQUALS },
            { id: "demoOnly", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
            { id: "otherwise", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
        ],
        [
            ["head", "then", "if", "in"],
            ["tag", "appTag", "eq", "a"],
            ["wanted", "value", "eq", "b"],
            ["eq", "result", "if", "condition"],
            ["if", "true", "demoOnly", "in"],
            ["if", "false", "otherwise", "in"],
        ],
    );
}

describe("foldAppTagInBlueprintGraph", () => {
    it("keeps the taken arm of a decided If and deletes the other one", () => {
        const folded = foldAppTagInBlueprintGraph(ifGraph(), DEMO);

        expect(folded.refusals).toEqual([]);
        expect(nodeIds(folded.ir)).toEqual(["demoOnly", "head"]);
        // Rewired past the branch: the head now runs the demo-only node directly.
        expect(edgeList(folded.ir)).toEqual(["head.then->demoOnly.in"]);
    });

    it("takes the other arm when the variant is a different one", () => {
        const folded = foldAppTagInBlueprintGraph(ifGraph(), MAIN);

        expect(folded.refusals).toEqual([]);
        expect(nodeIds(folded.ir)).toEqual(["head", "otherwise"]);
        expect(edgeList(folded.ir)).toEqual(["head.then->otherwise.in"]);
    });

    it("ends the flow when the taken arm is wired to nothing", () => {
        const source = ifGraph();
        source.edges = (source.edges ?? []).filter(edge => !(edge.from.nodeId === "if" && edge.from.port === "true"));
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        expect(folded.refusals).toEqual([]);
        // `demoOnly` is unreferenced authored work rather than something the fold made unreachable,
        // so it stays; the arm the head used to take simply stops.
        expect(nodeIds(folded.ir)).toEqual(["demoOnly", "head"]);
        expect(edgeList(folded.ir)).toEqual([]);
    });

    it("prunes a decided If that nothing routes into", () => {
        const source = ifGraph();
        // No event head above it: the branch node is itself where flow would start, which is the one
        // root the fold has to move rather than keep.
        source.edges = (source.edges ?? []).filter(edge => edge.from.nodeId !== "head");
        delete source.nodes!.head;
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        expect(folded.refusals).toEqual([]);
        expect(nodeIds(folded.ir)).toEqual(["demoOnly"]);
    });

    it("keeps a node both arms reach", () => {
        const source = ifGraph();
        source.nodes!.shared = { id: "shared", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP };
        source.edges = [
            ...(source.edges ?? []),
            { from: { nodeId: "demoOnly", port: "next" }, to: { nodeId: "shared", port: "in" } },
            { from: { nodeId: "otherwise", port: "next" }, to: { nodeId: "shared", port: "in" } },
        ];
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        expect(nodeIds(folded.ir)).toEqual(["demoOnly", "head", "shared"]);
        expect(edgeList(folded.ir)).toEqual(["demoOnly.next->shared.in", "head.then->demoOnly.in"]);
    });

    it("folds a Get App Tag through a string comparison and a Not", () => {
        const source = graph(
            [
                { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                { id: "if", type: BLUEPRINT_NODE_TYPE_FLOW_IF },
                { id: "tag", type: BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG },
                { id: "wanted", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "Demo" } },
                { id: "eq", type: BLUEPRINT_NODE_TYPE_STRING_EQUALS },
                { id: "not", type: BLUEPRINT_NODE_TYPE_BOOLEAN_NOT },
                { id: "notDemo", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
                { id: "demo", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
            ],
            [
                ["head", "then", "if", "in"],
                ["tag", "appTag", "eq", "a"],
                ["wanted", "value", "eq", "b"],
                ["eq", "result", "not", "a"],
                ["not", "result", "if", "condition"],
                ["if", "true", "notDemo", "in"],
                ["if", "false", "demo", "in"],
            ],
        );
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        expect(folded.refusals).toEqual([]);
        expect(nodeIds(folded.ir)).toEqual(["demo", "head"]);
    });

    it("reads an on-card literal when the comparison pin is not wired", () => {
        const source = graph(
            [
                { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                { id: "if", type: BLUEPRINT_NODE_TYPE_FLOW_IF },
                { id: "tag", type: BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG },
                { id: "eq", type: BLUEPRINT_NODE_TYPE_STRING_EQUALS, params: { b: "Demo" } },
                { id: "demo", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
            ],
            [
                ["head", "then", "if", "in"],
                ["tag", "appTag", "eq", "a"],
                ["eq", "result", "if", "condition"],
                ["if", "true", "demo", "in"],
            ],
        );
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        expect(folded.refusals).toEqual([]);
        expect(nodeIds(folded.ir)).toEqual(["demo", "head"]);
    });

    it("decides an If Else with three conditions", () => {
        const source = graph(
            [
                { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                {
                    id: "branch",
                    type: BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
                    params: {
                        [BLUEPRINT_IF_ELSE_BRANCH_PINS.storageKey]: [
                            "if_1_condition", "if_1_then", "if_2_condition", "if_2_then",
                        ],
                    },
                },
                { id: "tag", type: BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG },
                { id: "isAlpha", type: BLUEPRINT_NODE_TYPE_STRING_EQUALS, params: { b: "Alpha" } },
                { id: "isBeta", type: BLUEPRINT_NODE_TYPE_STRING_EQUALS, params: { b: "Beta" } },
                { id: "isDemo", type: BLUEPRINT_NODE_TYPE_STRING_EQUALS, params: { b: "Demo" } },
                { id: "alpha", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
                { id: "beta", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
                { id: "demo", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
                { id: "none", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
            ],
            [
                ["head", "then", "branch", "in"],
                ["tag", "appTag", "isAlpha", "a"],
                ["tag", "appTag", "isBeta", "a"],
                ["tag", "appTag", "isDemo", "a"],
                ["isAlpha", "result", "branch", "condition"],
                ["isBeta", "result", "branch", "if_1_condition"],
                ["isDemo", "result", "branch", "if_2_condition"],
                ["branch", "then", "alpha", "in"],
                ["branch", "if_1_then", "beta", "in"],
                ["branch", "if_2_then", "demo", "in"],
                ["branch", "else", "none", "in"],
            ],
        );

        const demo = foldAppTagInBlueprintGraph(source, DEMO);
        expect(demo.refusals).toEqual([]);
        expect(nodeIds(demo.ir)).toEqual(["demo", "head"]);

        const other = foldAppTagInBlueprintGraph(source, { tagName: "Gold" });
        expect(other.refusals).toEqual([]);
        expect(nodeIds(other.ir)).toEqual(["head", "none"]);
    });

    it("decides a Switch String on both a fixed and an added case", () => {
        const source = graph(
            [
                { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                {
                    id: "switch",
                    type: BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
                    params: {
                        case0Value: "main",
                        case_1_value: "Demo",
                        [BLUEPRINT_SWITCH_STRING_CASE_PINS.storageKey]: ["case_1_value", "case_1_output"],
                    },
                },
                { id: "tag", type: BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG },
                { id: "release", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
                { id: "demo", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
                { id: "other", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
            ],
            [
                ["head", "then", "switch", "in"],
                ["tag", "appTag", "switch", "value"],
                ["switch", "case0", "release", "in"],
                ["switch", "case_1_output", "demo", "in"],
                ["switch", "default", "other", "in"],
            ],
        );

        expect(nodeIds(foldAppTagInBlueprintGraph(source, MAIN).ir)).toEqual(["head", "release"]);
        expect(nodeIds(foldAppTagInBlueprintGraph(source, DEMO).ir)).toEqual(["demo", "head"]);
        expect(nodeIds(foldAppTagInBlueprintGraph(source, { tagName: "Gold" }).ir)).toEqual(["head", "other"]);
    });

    it("substitutes the variant name for a consumer that is not a branch", () => {
        const source = graph(
            [
                { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                { id: "label", type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT },
                { id: "tag", type: BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG },
            ],
            [
                ["head", "then", "label", "in"],
                ["tag", "appTag", "label", "text"],
            ],
        );
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        // Showing which edition this is performs no variant test at play time: the package carries
        // the string and nothing else, which is the whole property the fold protects.
        expect(folded.refusals).toEqual([]);
        expect(nodeIds(folded.ir)).toEqual(["head", "label", "tag__appTag"]);
        expect(folded.ir.nodes?.tag__appTag).toEqual({
            id: "tag__appTag",
            type: BLUEPRINT_NODE_TYPE_LITERAL,
            params: { value: "Demo" },
        });
        expect(edgeList(folded.ir)).toEqual(["head.then->label.in", "tag__appTag.value->label.text"]);
    });

    it("substitutes one value that both decides a branch and reaches a display", () => {
        const source = graph(
            [
                { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                { id: "if", type: BLUEPRINT_NODE_TYPE_FLOW_IF },
                { id: "tag", type: BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG },
                { id: "eq", type: BLUEPRINT_NODE_TYPE_STRING_EQUALS, params: { b: "Demo" } },
                { id: "label", type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT },
                { id: "otherwise", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
            ],
            [
                ["head", "then", "if", "in"],
                ["tag", "appTag", "eq", "a"],
                ["tag", "appTag", "label", "text"],
                ["eq", "result", "if", "condition"],
                ["if", "true", "label", "in"],
                ["if", "false", "otherwise", "in"],
            ],
        );
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        expect(folded.refusals).toEqual([]);
        // The branch is decided and the untaken arm is gone; the same value still reaches the label,
        // now as a literal rather than as a read the shipped game performs.
        expect(nodeIds(folded.ir)).toEqual(["head", "label", "tag__appTag"]);
        expect(edgeList(folded.ir)).toEqual(["head.then->label.in", "tag__appTag.value->label.text"]);
    });

    it("refuses a tainted value it could not resolve, branch or not", () => {
        const source = graph(
            [
                { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                { id: "tag", type: BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG },
                { id: "eq", type: BLUEPRINT_NODE_TYPE_COMPARE_EQUAL },
                { id: "label", type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT },
            ],
            [
                ["head", "then", "label", "in"],
                ["tag", "appTag", "eq", "a"],
                // `b` comes from something only the running game answers, so the comparison would be
                // performed on the player's machine in every edition.
                ["head", "then", "eq", "b"],
                ["eq", "result", "label", "text"],
            ],
        );
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        expect(folded.ir).toBe(source);
        expect(folded.refusals).toEqual([{
            reason: "unresolved",
            nodeId: "eq",
            nodeType: BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
        }]);
    });

    it("refuses a variant test the build cannot settle", () => {
        const source = graph(
            [
                { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                { id: "tag", type: BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG },
                { id: "eq", type: BLUEPRINT_NODE_TYPE_COMPARE_EQUAL },
                { id: "if", type: BLUEPRINT_NODE_TYPE_FLOW_IF },
                { id: "yes", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
            ],
            [
                ["head", "then", "if", "in"],
                ["tag", "appTag", "eq", "a"],
                // `b` is wired to nothing this module can evaluate: an event head's own output.
                ["head", "then", "eq", "b"],
                ["eq", "result", "if", "condition"],
                ["if", "true", "yes", "in"],
            ],
        );
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        expect(folded.ir).toBe(source);
        // The comparison is named, not the tag: the tag is fine, the value it is held against is not.
        expect(folded.refusals).toEqual([{
            reason: "unresolved",
            nodeId: "eq",
            nodeType: BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
        }]);
    });

    it("refuses a folding graph that holds a node type the table does not know", () => {
        const source = ifGraph();
        source.nodes!.plugin = { id: "plugin", type: "acme.plugin.doThing" };
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        expect(folded.ir).toBe(source);
        expect(folded.refusals).toEqual([{ reason: "unknownNode", nodeId: "plugin", nodeType: "acme.plugin.doThing" }]);
    });

    it("leaves an unknown node type alone in a graph that does not fold", () => {
        const source = graph(
            [
                { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                { id: "plugin", type: "acme.plugin.doThing" },
            ],
            [["head", "then", "plugin", "in"]],
        );
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        expect(folded).toEqual({ ir: source, mentioned: false, refusals: [] });
        expect(folded.ir).toBe(source);
    });

    it("refuses a fold that would delete a Fn head", () => {
        const source = ifGraph();
        source.nodes!.fn = { id: "fn", type: BLUEPRINT_NODE_TYPE_FN_HEAD };
        source.edges = [
            // The head sits on the arm this variant does not take, so folding would remove it while a
            // Call Fn elsewhere still names it.
            ...(source.edges ?? []).filter(edge => !(edge.from.nodeId === "if" && edge.from.port === "false")),
            { from: { nodeId: "if", port: "false" }, to: { nodeId: "fn", port: "in" } },
        ];
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        expect(folded.ir).toBe(source);
        expect(folded.refusals).toEqual([{ reason: "fnHeadRemoved", nodeId: "fn", nodeType: BLUEPRINT_NODE_TYPE_FN_HEAD }]);
    });

    it("returns the same graph when there is no Get App Tag in it", () => {
        const source = graph(
            [
                { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                { id: "if", type: BLUEPRINT_NODE_TYPE_FLOW_IF },
                { id: "one", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "x" } },
                { id: "two", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "x" } },
                { id: "eq", type: BLUEPRINT_NODE_TYPE_STRING_EQUALS },
                { id: "yes", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
                { id: "no", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP },
            ],
            [
                ["head", "then", "if", "in"],
                ["one", "value", "eq", "a"],
                ["two", "value", "eq", "b"],
                ["eq", "result", "if", "condition"],
                ["if", "true", "yes", "in"],
                ["if", "false", "no", "in"],
            ],
        );
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        // Two literals compared with each other is decidable, and deliberately not decided: the
        // author's other arm is theirs to keep.
        expect(folded.ir).toBe(source);
        expect(folded.mentioned).toBe(false);
    });

    it("deletes a Get App Tag nothing consumes", () => {
        const source = graph(
            [
                { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                { id: "tag", type: BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG },
            ],
            [],
        );
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        expect(folded.refusals).toEqual([]);
        expect(nodeIds(folded.ir)).toEqual(["head"]);
    });

    it("keeps the graph's own variables and meta", () => {
        const source: BlueprintGraphIr = { ...ifGraph(), variables: { a: 1 }, meta: { note: "kept" } };
        const folded = foldAppTagInBlueprintGraph(source, DEMO);

        expect(folded.ir.variables).toEqual({ a: 1 });
        expect(folded.ir.meta).toEqual({ note: "kept" });
    });
});

// ── Documents ────────────────────────────────────────────────────────────────────────────────────

function documentWith(ir: BlueprintGraphIr): BlueprintDocument {
    const blueprint: Blueprint = {
        id: "bp1",
        name: "Main Menu",
        owner: { kind: "globalMain" },
        frontend: "visual",
        programKind: "graph",
        program: {
            kind: "graph",
            graphs: {
                events: { g1: { id: "g1", name: "On Init", graph: ir } },
                functions: {},
            },
        },
    };
    return {
        schemaVersion: 1 as BlueprintDocument["schemaVersion"],
        blueprints: { bp1: blueprint },
        ownerRecords: { globalMain: { activeBlueprintId: "bp1", privateBlueprintIds: ["bp1"] } },
    };
}

describe("applyAppTagToBlueprintDocument", () => {
    it("folds every graph the document holds", () => {
        const document = documentWith(ifGraph());
        const folded = applyAppTagToBlueprintDocument(document, DEMO);
        const program = folded.blueprints.bp1.program;

        expect(program.kind).toBe("graph");
        if (program.kind === "graph") {
            expect(nodeIds(program.graphs.events.g1.graph!)).toEqual(["demoOnly", "head"]);
        }
    });

    it("returns the same document when nothing in it names the variant", () => {
        const document = documentWith(graph([{ id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT }], []));

        expect(applyAppTagToBlueprintDocument(document, DEMO)).toBe(document);
    });

    it("carries a refused graph through unchanged", () => {
        const refused = graph(
            [
                { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                { id: "tag", type: BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG },
                { id: "eq", type: BLUEPRINT_NODE_TYPE_COMPARE_EQUAL },
                { id: "label", type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT },
            ],
            [
                ["head", "then", "label", "in"],
                ["tag", "appTag", "eq", "a"],
                ["head", "then", "eq", "b"],
                ["eq", "result", "label", "text"],
            ],
        );
        const document = documentWith(refused);

        // The removal and the refusal read the same module, so the graph the gate names is exactly
        // the graph the bundler leaves alone.
        expect(applyAppTagToBlueprintDocument(document, DEMO)).toBe(document);
        expect(collectUnfoldableAppTagGraphs(document, DEMO)).toEqual([{
            reason: "unresolved",
            nodeId: "eq",
            nodeType: BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
            blueprintId: "bp1",
            blueprintName: "Main Menu",
            graphId: "g1",
            graphName: "On Init",
        }]);
    });

    it("reports nothing for a document that folds", () => {
        expect(collectUnfoldableAppTagGraphs(documentWith(ifGraph()), DEMO)).toEqual([]);
        expect(collectUnfoldableAppTagGraphs(null, DEMO)).toEqual([]);
    });
});
