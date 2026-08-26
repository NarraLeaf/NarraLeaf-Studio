import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import { buildSceneFlowLines } from "./sceneFlowLines";
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
