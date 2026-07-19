import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import { buildSceneFlowGraph } from "./sceneFlowModel";

function jumpBlock(id: string, targetSceneId: string, parentId: string | null = null): StoryBlock {
    return { id, kind: "jump", parentId, childrenIds: [], payload: { targetSceneId } };
}

function controlBlock(id: string, childrenIds: string[]): StoryBlock {
    return { id, kind: "control", parentId: null, childrenIds, payload: { control: "conditionBranch", branch: "if" } };
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

describe("buildSceneFlowGraph", () => {
    it("turns jump blocks into edges between scenes", () => {
        const graph = buildSceneFlowGraph(document([
            scene("a", "Opening", [jumpBlock("j1", "b")]),
            scene("b", "Hallway", []),
        ], "a"));

        expect(graph.edges).toHaveLength(1);
        expect(graph.edges[0]).toMatchObject({ source: "a", target: "b", conditional: false });
        expect(graph.nodes.map(node => node.sceneId)).toEqual(["a", "b"]);
        expect(graph.nodes[0].isEntry).toBe(true);
    });

    it("collapses repeated jumps between the same pair into one edge", () => {
        const graph = buildSceneFlowGraph(document([
            scene("a", "Opening", [jumpBlock("j1", "b"), jumpBlock("j2", "b")]),
            scene("b", "Hallway", []),
        ], "a"));

        expect(graph.edges).toHaveLength(1);
        expect(graph.edges[0].jumps.map(jump => jump.blockId)).toEqual(["j1", "j2"]);
    });

    it("finds jumps nested under control flow and marks the edge conditional", () => {
        const graph = buildSceneFlowGraph(document([
            scene("a", "Opening", [controlBlock("c1", ["j1"]), jumpBlock("j1", "b", "c1")]),
            scene("b", "Hallway", []),
        ], "a"));

        expect(graph.edges).toHaveLength(1);
        expect(graph.edges[0].conditional).toBe(true);
        expect(graph.edges[0].jumps[0].conditional).toBe(true);
    });

    it("counts jumps with a missing or deleted target as dangling instead of dropping them", () => {
        const graph = buildSceneFlowGraph(document([
            scene("a", "Opening", [jumpBlock("j1", ""), jumpBlock("j2", "ghost")]),
        ], "a"));

        expect(graph.edges).toHaveLength(0);
        expect(graph.danglingJumpCount).toBe(2);
        expect(graph.nodes[0].danglingJumpCount).toBe(2);
    });

    it("reports self-jumps as a node badge rather than an edge", () => {
        const graph = buildSceneFlowGraph(document([scene("a", "Loop", [jumpBlock("j1", "a")])], "a"));

        expect(graph.edges).toHaveLength(0);
        expect(graph.nodes[0].selfJumpCount).toBe(1);
    });

    it("flags scenes the entry cannot reach", () => {
        const graph = buildSceneFlowGraph(document([
            scene("a", "Opening", [jumpBlock("j1", "b")]),
            scene("b", "Hallway", []),
            scene("c", "Orphan", []),
        ], "a"));

        expect(graph.unreachableCount).toBe(1);
        expect(graph.nodes.find(node => node.sceneId === "c")?.reachable).toBe(false);
    });

    it("makes no reachability claim when the story declares no entry scene", () => {
        const graph = buildSceneFlowGraph(document([scene("a", "Opening", []), scene("b", "Other", [])]));

        expect(graph.unreachableCount).toBe(0);
        expect(graph.nodes.every(node => node.reachable)).toBe(true);
    });

    it("lays scenes out in jump-distance columns", () => {
        const graph = buildSceneFlowGraph(document([
            scene("a", "One", [jumpBlock("j1", "b")]),
            scene("b", "Two", [jumpBlock("j2", "c")]),
            scene("c", "Three", []),
        ], "a"));

        expect(graph.positions.a.x).toBe(0);
        expect(graph.positions.b.x).toBeGreaterThan(graph.positions.a.x);
        expect(graph.positions.c.x).toBeGreaterThan(graph.positions.b.x);
    });

    it("wraps a tall layer into sub-columns instead of one endless column", () => {
        const scenes = Array.from({ length: 9 }, (_, index) => scene(`s${index}`, `Scene ${index}`, []));
        const graph = buildSceneFlowGraph(document(scenes));

        const xs = new Set(scenes.map(item => graph.positions[item.id].x));
        expect(xs.size).toBe(2);
        // Nothing stacked deeper than the per-column cap.
        const perColumn = new Map<number, number>();
        for (const item of scenes) {
            const column = graph.positions[item.id].x;
            perColumn.set(column, (perColumn.get(column) ?? 0) + 1);
        }
        expect(Math.max(...perColumn.values())).toBeLessThanOrEqual(5);
    });

    it("terminates on a jump cycle", () => {
        const graph = buildSceneFlowGraph(document([
            scene("a", "One", [jumpBlock("j1", "b")]),
            scene("b", "Two", [jumpBlock("j2", "a")]),
        ], "a"));

        expect(graph.edges).toHaveLength(2);
        expect(Object.keys(graph.positions)).toHaveLength(2);
    });
});
