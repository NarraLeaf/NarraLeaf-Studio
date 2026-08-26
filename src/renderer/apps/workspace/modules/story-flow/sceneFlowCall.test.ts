import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import {
    buildSceneFlowLines,
    SCENE_FLOW_CALL_STROKE,
    SCENE_FLOW_CONDITIONAL_DASH,
    SCENE_FLOW_LINE_STROKE,
    sceneFlowLinePaint,
} from "./sceneFlowLines";
import { buildSceneFlowGraph } from "./sceneFlowModel";
import { buildSceneFlowRouteMap, collectSceneFlowContinuations } from "./sceneFlowRoutes";

/**
 * What a returnable jump is to the flow model: an edge that does not leave.
 *
 * The target really is entered, so it stays reachable and the endings in it stay reachable - but the
 * scene the row is written in is not left, so nothing downstream may read it as a way out. Every
 * consumer of `collectSceneFlowContinuations` depends on that distinction, which is why it is drawn
 * here once rather than in each of them.
 */

function jumpBlock(id: string, targetSceneId: string, parentId: string | null = null): StoryBlock {
    return { id, kind: "jump", parentId, childrenIds: [], payload: { targetSceneId } };
}

function callBlock(id: string, targetSceneId: string, parentId: string | null = null): StoryBlock {
    return { id, kind: "jump", parentId, childrenIds: [], payload: { targetSceneId, returnable: true } };
}

/** A call the author has switched off. The map keeps drawing it, faded. */
function disabledCallBlock(id: string, targetSceneId: string): StoryBlock {
    return {
        id,
        kind: "jump",
        parentId: null,
        childrenIds: [],
        disabled: true,
        payload: { targetSceneId, returnable: true },
    };
}

function narrationBlock(id: string, parentId: string | null = null): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId,
        childrenIds: [],
        payload: { action: "narration", text: { textId: `${id}-t`, value: "line", role: "narration" } },
    } as StoryBlock;
}

function endingBlock(id: string, name: string, parentId: string | null = null): StoryBlock {
    return { id, kind: "control", parentId, childrenIds: [], payload: { control: "ending", name } } as StoryBlock;
}

function choiceBlock(id: string, optionIds: string[]): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: optionIds,
        payload: { action: "choice", prompt: { textId: `${id}-p`, value: "", role: "choicePrompt" } },
    } as StoryBlock;
}

function optionBlock(id: string, label: string, parentId: string, childrenIds: string[]): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId,
        childrenIds,
        payload: { action: "choiceOption", text: { textId: `${id}-t`, value: label, role: "choiceText" } },
    } as StoryBlock;
}

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
    return {
        id,
        name,
        runtimeName: id,
        rootBlockIds: blocks.filter(block => !block.parentId).map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

function document(scenes: StoryScene[], entrySceneId?: string): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [],
        scenes: Object.fromEntries(scenes.map(entry => [entry.id, entry])),
        unassignedSceneIds: scenes.map(entry => entry.id),
        ...(entrySceneId ? { entrySceneId } : {}),
    } as unknown as StoryDocument;
}

/** `sc1` calls `sc2` and then jumps to `sc3`. */
function callThenJump(): StoryDocument {
    return document([
        scene("sc1", "Prologue", [callBlock("b1", "sc2"), jumpBlock("b2", "sc3")]),
        scene("sc2", "Title card", [narrationBlock("b3")]),
        scene("sc3", "Chapter 2", [endingBlock("b4", "The end")]),
    ], "sc1");
}

describe("the graph", () => {
    it("marks the edge a returnable jump draws as one that comes back", () => {
        const graph = buildSceneFlowGraph(callThenJump());
        const call = graph.edges.find(edge => edge.target === "sc2");
        const jump = graph.edges.find(edge => edge.target === "sc3");

        expect(call?.returns).toBe(true);
        expect(call?.jumps[0].returnable).toBe(true);
        expect(jump?.returns).toBe(false);
        expect(jump?.jumps[0].returnable).toBe(false);
    });

    it("keeps the called scene reachable, so nothing reports it as orphaned", () => {
        const graph = buildSceneFlowGraph(callThenJump());
        expect(graph.nodes.find(node => node.sceneId === "sc2")?.reachable).toBe(true);
    });

    it("reads an edge carrying one plain jump and one call as a way out", () => {
        // `every`, not `some`: a run really can leave this way, so the line has to read as one that
        // leaves even though a second row on the same pair of scenes comes back.
        const graph = buildSceneFlowGraph(document([
            scene("sc1", "Prologue", [callBlock("b1", "sc2"), jumpBlock("b2", "sc2")]),
            scene("sc2", "Chapter 2", [narrationBlock("b3")]),
        ], "sc1"));

        expect(graph.edges.find(edge => edge.target === "sc2")?.returns).toBe(false);
    });
});

describe("the lines the map draws", () => {
    it("marks the line a call draws, so the map does not read it as a way out", () => {
        const lines = buildSceneFlowLines(buildSceneFlowGraph(callThenJump()), new Set());

        expect(lines.find(line => line.targetSceneId === "sc2")?.returns).toBe(true);
        expect(lines.find(line => line.targetSceneId === "sc3")?.returns).toBe(false);
    });
});

/**
 * How a call is told apart from a way out on screen.
 *
 * Every line a collapsed scene sends out leaves the same point on its rim, so the arrowheads at the
 * source of a scene that both jumps and calls are painted on a stub the two lines share. What
 * attributes an arrowhead to its line is the colour of the whole line, and these cases are the ones
 * where that colour has to hold: alongside a plain jump, under a condition, switched off, several at
 * once, and folded together with a plain jump to the same scene.
 */
describe("telling a call apart from a way out", () => {
    /** Whatever else changes, these two have to stay different or nothing above works. */
    it("draws a call in an ink of its own", () => {
        expect(SCENE_FLOW_CALL_STROKE).not.toBe(SCENE_FLOW_LINE_STROKE);
    });

    it("gives the two lines out of one scene different strokes, not just different arrowheads", () => {
        const lines = buildSceneFlowLines(buildSceneFlowGraph(callThenJump()), new Set());
        const call = sceneFlowLinePaint(lines.find(line => line.targetSceneId === "sc2")!);
        const wayOut = sceneFlowLinePaint(lines.find(line => line.targetSceneId === "sc3")!);

        expect(call).toEqual({
            stroke: SCENE_FLOW_CALL_STROKE,
            strokeDasharray: undefined,
            doubleHeaded: true,
        });
        expect(wayOut).toEqual({
            stroke: SCENE_FLOW_LINE_STROKE,
            strokeDasharray: undefined,
            doubleHeaded: false,
        });
    });

    it("keeps the call colour on a call written under an option, dash and all", () => {
        // Conditional and returning at once: the dash says "only on some runs", the colour says
        // "and the run comes back". Neither may swallow the other.
        const doc = document([
            scene("sc1", "Prologue", [
                choiceBlock("ch1", ["o1"]),
                optionBlock("o1", "Look", "ch1", ["b1"]),
                callBlock("b1", "sc2", "o1"),
            ]),
            scene("sc2", "Title card", [narrationBlock("n2")]),
        ], "sc1");
        const lines = buildSceneFlowLines(buildSceneFlowGraph(doc), new Set());

        expect(sceneFlowLinePaint(lines[0])).toEqual({
            stroke: SCENE_FLOW_CALL_STROKE,
            strokeDasharray: SCENE_FLOW_CONDITIONAL_DASH,
            doubleHeaded: true,
        });
    });

    it("keeps the call colour on a switched-off call", () => {
        // Fading is what says the row is off, and it is applied on top of the stroke rather than
        // instead of it: a disabled call that dropped back to the ordinary ink would read as a way
        // out that happens to be quiet.
        const doc = document([
            scene("sc1", "Prologue", [disabledCallBlock("b1", "sc2"), jumpBlock("b2", "sc3")]),
            scene("sc2", "Title card", [narrationBlock("n2")]),
            scene("sc3", "Chapter 2", [endingBlock("e3", "The end")]),
        ], "sc1");
        const lines = buildSceneFlowLines(buildSceneFlowGraph(doc), new Set());
        const call = lines.find(line => line.targetSceneId === "sc2")!;

        expect(call.disabled).toBe(true);
        expect(sceneFlowLinePaint(call)).toMatchObject({
            stroke: SCENE_FLOW_CALL_STROKE,
            doubleHeaded: true,
        });
    });

    it("colours every call when a scene makes several, and leaves the way out alone", () => {
        const doc = document([
            scene("sc1", "Prologue", [
                callBlock("b1", "sc2"),
                callBlock("b2", "sc3"),
                jumpBlock("b3", "sc4"),
            ]),
            scene("sc2", "First aside", [narrationBlock("n2")]),
            scene("sc3", "Second aside", [narrationBlock("n3")]),
            scene("sc4", "Chapter 2", [endingBlock("e4", "The end")]),
        ], "sc1");
        const lines = buildSceneFlowLines(buildSceneFlowGraph(doc), new Set());
        const strokes = new Map(lines.map(line => [line.targetSceneId, sceneFlowLinePaint(line).stroke]));

        expect(strokes.get("sc2")).toBe(SCENE_FLOW_CALL_STROKE);
        expect(strokes.get("sc3")).toBe(SCENE_FLOW_CALL_STROKE);
        expect(strokes.get("sc4")).toBe(SCENE_FLOW_LINE_STROKE);
    });

    it("draws a call folded together with a plain jump to the same scene as a way out", () => {
        // One line stands for both rows, and a run really can leave this way, so it takes the
        // ordinary ink and one arrowhead. Colouring it as a call would promise a return that only
        // one of the two rows makes.
        const doc = document([
            scene("sc1", "Prologue", [callBlock("b1", "sc2"), jumpBlock("b2", "sc2")]),
            scene("sc2", "Chapter 2", [narrationBlock("n2")]),
        ], "sc1");
        const lines = buildSceneFlowLines(buildSceneFlowGraph(doc), new Set());

        expect(lines).toHaveLength(1);
        expect(lines[0].jumps).toHaveLength(2);
        expect(sceneFlowLinePaint(lines[0])).toMatchObject({
            stroke: SCENE_FLOW_LINE_STROKE,
            doubleHeaded: false,
        });
    });

    it("carries the colour onto the line that leaves an expanded scene's own option row", () => {
        // Expanded, the call moves off the scene's rim and onto the arm's row, where it no longer
        // shares a stub with anything. It stays coloured regardless: the two readings of one story
        // must not disagree about what kind of line this is.
        const doc = document([
            scene("sc1", "Prologue", [
                choiceBlock("ch1", ["o1", "o2"]),
                optionBlock("o1", "Look", "ch1", ["b1"]),
                callBlock("b1", "sc2", "o1"),
                optionBlock("o2", "Leave", "ch1", ["b2"]),
                jumpBlock("b2", "sc3", "o2"),
            ]),
            scene("sc2", "Title card", [narrationBlock("n2")]),
            scene("sc3", "Chapter 2", [endingBlock("e3", "The end")]),
        ], "sc1");
        const expanded = new Set(["sc1"]);
        const lines = buildSceneFlowLines(buildSceneFlowGraph(doc, { expandedSceneIds: expanded }), expanded);
        const armLines = lines.filter(line => line.sourceBranchId !== undefined);

        expect(armLines).toHaveLength(2);
        expect(sceneFlowLinePaint(armLines.find(line => line.targetSceneId === "sc2")!)).toEqual({
            stroke: SCENE_FLOW_CALL_STROKE,
            strokeDasharray: SCENE_FLOW_CONDITIONAL_DASH,
            doubleHeaded: true,
        });
        expect(sceneFlowLinePaint(armLines.find(line => line.targetSceneId === "sc3")!)).toEqual({
            stroke: SCENE_FLOW_LINE_STROKE,
            strokeDasharray: SCENE_FLOW_CONDITIONAL_DASH,
            doubleHeaded: false,
        });
    });
});

describe("continuations", () => {
    it("gives a call its own kind, apart from the ways out", () => {
        const doc = callThenJump();
        const continuations = collectSceneFlowContinuations(buildSceneFlowGraph(doc), doc);
        const fromPrologue = continuations.get("sc1") ?? [];

        expect(fromPrologue.filter(exit => exit.kind === "call").map(exit => exit.kind === "call" && exit.target))
            .toEqual(["sc2"]);
        expect(fromPrologue.filter(exit => exit.kind === "edge").map(exit => exit.kind === "edge" && exit.target))
            .toEqual(["sc3"]);
    });

    it("gives a scene whose only jump comes back nothing that leaves", () => {
        const doc = document([
            scene("sc1", "Prologue", [callBlock("b1", "sc2")]),
            scene("sc2", "Title card", [narrationBlock("b2")]),
        ], "sc1");
        const continuations = collectSceneFlowContinuations(buildSceneFlowGraph(doc), doc);

        expect((continuations.get("sc1") ?? []).every(exit => exit.kind === "call")).toBe(true);
    });

    it("reads an arm whose only jump comes back as falling through", () => {
        // The arm hands the run nowhere: it goes to the called scene and comes straight back to
        // carry on past the fork, which is what falling through means.
        const doc = document([
            scene("sc1", "Prologue", [
                { id: "c1", kind: "nodeAction", parentId: null, childrenIds: ["o1"], payload: { action: "choice", prompt: { textId: "p", value: "", role: "choicePrompt" } } } as StoryBlock,
                { id: "o1", kind: "nodeAction", parentId: "c1", childrenIds: ["b1"], payload: { action: "choiceOption", text: { textId: "o1-t", value: "Look", role: "choiceText" } } } as StoryBlock,
                callBlock("b1", "sc2", "o1"),
                jumpBlock("b2", "sc3"),
            ]),
            scene("sc2", "Title card", [narrationBlock("b3")]),
            scene("sc3", "Chapter 2", [endingBlock("b4", "The end")]),
        ], "sc1");
        const graph = buildSceneFlowGraph(doc);

        const arm = graph.branches.find(branch => branch.blockId === "o1");
        expect(arm?.fallsThrough).toBe(true);
    });
});

describe("routes", () => {
    it("does not step into a call, and does not claim the endings inside one are unreachable", () => {
        const doc = document([
            scene("sc1", "Prologue", [callBlock("b1", "sc2"), jumpBlock("b2", "sc3")]),
            scene("sc2", "Title card", [endingBlock("b3", "Bad end")]),
            scene("sc3", "Chapter 2", [endingBlock("b4", "The end")]),
        ], "sc1");
        const map = buildSceneFlowRouteMap(buildSceneFlowGraph(doc), doc);

        // One route: entry -> Chapter 2. Going into the title card is an excursion, not a decision.
        expect(map.routes).toHaveLength(1);
        expect(map.routes[0].sceneIds).toEqual(["sc1", "sc3"]);
        // The ending inside the called scene is not on a route, and is not reported as unreachable
        // either: the enumeration cannot see it, which is a limit of the walk rather than a fact.
        expect(map.unreachableEndings).toEqual([]);
    });

    it("ends the route where a scene has nothing but a call left", () => {
        const doc = document([
            scene("sc1", "Prologue", [callBlock("b1", "sc2")]),
            scene("sc2", "Title card", [narrationBlock("b2")]),
        ], "sc1");
        const map = buildSceneFlowRouteMap(buildSceneFlowGraph(doc), doc);

        expect(map.routes).toHaveLength(1);
        expect(map.routes[0].sceneIds).toEqual(["sc1"]);
    });
});

describe("a scene that both calls and leaves", () => {
    it("keeps the two apart: one way out, one excursion, in document order", () => {
        const doc = callThenJump();
        const continuations = collectSceneFlowContinuations(buildSceneFlowGraph(doc), doc);

        expect((continuations.get("sc1") ?? []).map(exit => [exit.kind, exit.kind === "stop" ? null : "target" in exit ? exit.target : null]))
            .toEqual([["edge", "sc3"], ["call", "sc2"]]);
    });

    it("routes through the way out only, and the called scene is not on the route", () => {
        const doc = callThenJump();
        const map = buildSceneFlowRouteMap(buildSceneFlowGraph(doc), doc);

        expect(map.routes.map(route => route.sceneIds)).toEqual([["sc1", "sc3"]]);
    });
});

describe("several calls in one scene", () => {
    /** `sc1` calls three scenes in a row, then leaves for the one holding the ending. */
    function threeCalls(): StoryDocument {
        return document([
            scene("sc1", "Prologue", [
                callBlock("b1", "sc2"),
                callBlock("b2", "sc3"),
                callBlock("b3", "sc4"),
                jumpBlock("b4", "sc5"),
            ]),
            scene("sc2", "First aside", [narrationBlock("n2")]),
            scene("sc3", "Second aside", [narrationBlock("n3")]),
            scene("sc4", "Third aside", [narrationBlock("n4")]),
            scene("sc5", "Chapter 2", [endingBlock("e5", "The end")]),
        ], "sc1");
    }

    it("lists each called scene once, in the order the rows were written", () => {
        const doc = threeCalls();
        const continuations = collectSceneFlowContinuations(buildSceneFlowGraph(doc), doc);
        const calls = (continuations.get("sc1") ?? []).filter(exit => exit.kind === "call");

        expect(calls.map(exit => exit.kind === "call" && exit.target)).toEqual(["sc2", "sc3", "sc4"]);
    });

    it("does not multiply the routes: three excursions are not three decisions", () => {
        // A route is the sequence of decisions that gets a player somewhere. None of these is one, so
        // there is exactly one route however many calls the scene makes - which is also what keeps a
        // scene full of calls from exploding the enumeration against its own cap.
        const doc = threeCalls();
        const map = buildSceneFlowRouteMap(buildSceneFlowGraph(doc), doc);

        expect(map.routes.map(route => route.sceneIds)).toEqual([["sc1", "sc5"]]);
        expect(map.truncated).toBe(false);
    });

    it("folds two calls to the same scene into one, the way two jumps to it fold", () => {
        const doc = document([
            scene("sc1", "Prologue", [callBlock("b1", "sc2"), callBlock("b2", "sc2"), jumpBlock("b3", "sc3")]),
            scene("sc2", "Aside", [narrationBlock("n2")]),
            scene("sc3", "Chapter 2", [endingBlock("e3", "The end")]),
        ], "sc1");
        const continuations = collectSceneFlowContinuations(buildSceneFlowGraph(doc), doc);

        expect((continuations.get("sc1") ?? []).filter(exit => exit.kind === "call")).toHaveLength(1);
    });
});

describe("endings around a call", () => {
    it("reaches an ending written in the row after a call", () => {
        // The run comes back to it, so it is on the route and the route ends there.
        const doc = document([
            scene("sc1", "Prologue", [callBlock("b1", "sc2"), endingBlock("e1", "The end")]),
            scene("sc2", "Title card", [narrationBlock("n2")]),
        ], "sc1");
        const map = buildSceneFlowRouteMap(buildSceneFlowGraph(doc), doc);

        expect(map.routes.map(route => route.endingId)).toEqual(["e1"]);
        expect(map.unreachableEndings).toEqual([]);
    });

    it("does not claim an ending beyond a called scene is unreachable", () => {
        // `sc2` is called and then leaves on a plain jump, which gives the call up and carries on -
        // so `sc3` is entered for real and its ending can be reached. The route walk does not step
        // into the call, so it cannot see either scene: that is a limit of the enumeration, and
        // reporting it as a fact about the story is the mistake the direct case already avoids.
        const doc = document([
            scene("sc1", "Prologue", [callBlock("b1", "sc2"), jumpBlock("b2", "sc4")]),
            scene("sc2", "Aside", [jumpBlock("b3", "sc3")]),
            scene("sc3", "Beyond", [endingBlock("e3", "Secret end")]),
            scene("sc4", "Chapter 2", [endingBlock("e4", "The end")]),
        ], "sc1");
        const map = buildSceneFlowRouteMap(buildSceneFlowGraph(doc), doc);

        expect(map.unreachableEndings).toEqual([]);
    });
});

describe("a call written inside a fork", () => {
    /** The menu's second option calls a scene; its first leaves the scene for good. */
    function callUnderOption(): StoryDocument {
        return document([
            scene("sc1", "Prologue", [
                choiceBlock("ch1", ["o1", "o2"]),
                optionBlock("o1", "Leave", "ch1", ["b1"]),
                jumpBlock("b1", "sc3", "o1"),
                optionBlock("o2", "Look", "ch1", ["b2"]),
                callBlock("b2", "sc2", "o2"),
            ]),
            scene("sc2", "Title card", [endingBlock("e2", "Secret end")]),
            scene("sc3", "Chapter 2", [endingBlock("e3", "The end")]),
        ], "sc1");
    }

    it("still says the called scene is entered", () => {
        // An arm owns the row, but a call is not the arm's way out - it is an excursion the run takes
        // and returns from. Whoever owns the row, the scene it names is entered, and a consumer that
        // never hears about it reports the endings inside it as unreachable.
        const doc = callUnderOption();
        const continuations = collectSceneFlowContinuations(buildSceneFlowGraph(doc), doc);
        const calls = (continuations.get("sc1") ?? []).filter(exit => exit.kind === "call");

        expect(calls.map(exit => exit.kind === "call" && exit.target)).toEqual(["sc2"]);
    });

    it("does not claim the ending inside it is unreachable", () => {
        const map = buildSceneFlowRouteMap(buildSceneFlowGraph(callUnderOption()), callUnderOption());
        expect(map.unreachableEndings).toEqual([]);
    });
});
