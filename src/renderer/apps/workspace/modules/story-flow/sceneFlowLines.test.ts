import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import { buildSceneFlowGraph } from "./sceneFlowModel";
import { buildSceneFlowLines } from "./sceneFlowLines";

function jumpBlock(id: string, targetSceneId: string, parentId: string | null = null): StoryBlock {
    return { id, kind: "jump", parentId, childrenIds: [], payload: { targetSceneId } };
}

function choiceOptionBlock(id: string, childrenIds: string[], text: string, parentId: string | null): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId,
        childrenIds,
        payload: {
            action: "choiceOption",
            text: { textId: `${id}-text`, value: text, role: "choiceText" },
        },
    } as StoryBlock;
}

function choiceBlock(id: string, childrenIds: string[]): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds,
        payload: {
            action: "choice",
            prompt: { textId: `${id}-prompt`, value: "", role: "choicePrompt" },
        },
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
        entrySceneId,
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: scenes.map(item => item.id) }],
        scenes: Object.fromEntries(scenes.map(item => [item.id, item])),
    } as StoryDocument;
}

/**
 * A hub whose one option jumps to `b`, plus a second jump to `b` written outside every fork. Two
 * jumps between the same pair of scenes, only one of which an arm owns — which is the case the
 * expanded reading has to split and the collapsed one has to keep together.
 */
function forkedHub(): StoryDocument {
    return document([
        scene("a", "Hub", [
            choiceBlock("c1", ["o0"]),
            choiceOptionBlock("o0", ["j0"], "Go left", "c1"),
            jumpBlock("j0", "b", "o0"),
            jumpBlock("j1", "b"),
        ]),
        scene("b", "Hallway", []),
    ], "a");
}

const NOTHING_EXPANDED: ReadonlySet<string> = new Set();

describe("buildSceneFlowLines", () => {
    it("draws one line per scene pair while nothing is expanded", () => {
        const graph = buildSceneFlowGraph(forkedHub());
        const lines = buildSceneFlowLines(graph, NOTHING_EXPANDED);

        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ sourceSceneId: "a", targetSceneId: "b" });
        expect(lines[0].sourceBranchId).toBeUndefined();
        // Both jumps, because both are drawn by this one line: deleting it has to take both.
        expect(lines[0].jumps.map(jump => jump.blockId).sort()).toEqual(["j0", "j1"]);
    });

    it("gives the arm's jump to the arm's own line and leaves the scene line the rest", () => {
        const expanded = new Set(["a"]);
        const graph = buildSceneFlowGraph(forkedHub(), { expandedSceneIds: expanded });
        const lines = buildSceneFlowLines(graph, expanded);

        expect(lines).toHaveLength(2);
        const sceneLine = lines.find(line => line.sourceBranchId === undefined);
        const armLine = lines.find(line => line.sourceBranchId !== undefined);
        // The residual: the jump written outside every fork, and only that one. Deleting the scene
        // line while the arm's line is still on screen must not take the arm's jump with it.
        expect(sceneLine?.jumps.map(jump => jump.blockId)).toEqual(["j1"]);
        expect(armLine?.jumps.map(jump => jump.blockId)).toEqual(["j0"]);
        expect(armLine?.conditional).toBe(true);
    });

    it("drops the scene line entirely when every jump on it belongs to an arm", () => {
        const expanded = new Set(["a"]);
        const source = document([
            scene("a", "Hub", [
                choiceBlock("c1", ["o0"]),
                choiceOptionBlock("o0", ["j0"], "Go left", "c1"),
                jumpBlock("j0", "b", "o0"),
            ]),
            scene("b", "Hallway", []),
        ], "a");
        const graph = buildSceneFlowGraph(source, { expandedSceneIds: expanded });
        const lines = buildSceneFlowLines(graph, expanded);

        expect(lines).toHaveLength(1);
        expect(lines[0].sourceBranchId).toBeDefined();
    });

    it("ignores an expansion flag on a scene the map draws no arms for", () => {
        // The canvas gates expansion on the scene actually HAVING arms; a set that disagrees would
        // credit jumps to rows that are not drawn, and they would vanish from the map.
        const graph = buildSceneFlowGraph(document([
            scene("a", "Opening", [jumpBlock("j1", "b")]),
            scene("b", "Hallway", []),
        ], "a"));
        const lines = buildSceneFlowLines(graph, new Set(["a"]));

        expect(lines).toHaveLength(1);
        expect(lines[0].jumps.map(jump => jump.blockId)).toEqual(["j1"]);
    });

    it("keeps every line's id matching the graph edge it was drawn from", () => {
        const expanded = new Set(["a"]);
        const graph = buildSceneFlowGraph(forkedHub(), { expandedSceneIds: expanded });
        const lines = buildSceneFlowLines(graph, expanded);
        const known = new Set([...graph.edges, ...graph.branchEdges].map(edge => edge.id));

        // React Flow addresses a line by this id and hands it back on delete; an id the map cannot
        // look up again is a line that silently refuses to be deleted.
        expect(lines.every(line => known.has(line.id))).toBe(true);
        expect(new Set(lines.map(line => line.id)).size).toBe(lines.length);
    });
});
