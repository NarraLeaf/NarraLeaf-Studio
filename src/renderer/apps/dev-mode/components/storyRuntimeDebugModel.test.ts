import { describe, expect, it } from "vitest";
import type { DevModeCharacterSummary } from "@shared/types/devMode";
import type { StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";
import type { NlrActionIdBinding } from "@/lib/ui-editor/runtime/game/storyCompiler";
import {
    blockIdForActionId,
    firstActionIdForBlock,
    projectSceneTimeline,
} from "./storyRuntimeDebugModel";

function narration(id: StoryBlockId, text: string, childrenIds: StoryBlockId[] = []): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds,
        payload: { action: "narration", text: { textId: `t-${id}`, value: text, role: "narration" } },
    };
}

function scene(blocks: StoryBlock[], rootBlockIds: StoryBlockId[]): StoryScene {
    return {
        id: "scene-1",
        name: "Scene 1",
        runtimeName: "scene1",
        rootBlockIds,
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

const noCharacters = new Map<string, DevModeCharacterSummary>();

describe("projectSceneTimeline", () => {
    it("flattens the block tree depth-first with 1-based line numbers and depth", () => {
        const target = scene(
            [
                narration("a", "first", ["a1"]),
                narration("a1", "nested"),
                narration("b", "second"),
            ],
            ["a", "b"],
        );
        const rows = projectSceneTimeline(target, noCharacters);
        expect(rows.map(r => [r.blockId, r.lineNumber, r.depth])).toEqual([
            ["a", 1, 0],
            ["a1", 2, 1],
            ["b", 3, 0],
        ]);
    });

    it("does not hang on a corrupted childrenIds cycle", () => {
        const a = narration("a", "a", ["b"]);
        const b = narration("b", "b", ["a"]);
        const rows = projectSceneTimeline(scene([a, b], ["a"]), noCharacters);
        expect(rows.map(r => r.blockId)).toEqual(["a", "b"]);
    });

    it("summarizes a dialogue line with the resolved character name", () => {
        const dialogue: StoryBlock = {
            id: "d",
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: { action: "dialogue", characterId: "c1", text: { textId: "t", value: "hi", role: "dialogue" } },
        };
        const rows = projectSceneTimeline(
            scene([dialogue], ["d"]),
            new Map([["c1", { id: "c1", name: "Alice" }]]),
        );
        expect(rows[0]!.summary).toBe("Alice: hi");
    });
});

describe("action id ↔ block bindings", () => {
    const bindings: NlrActionIdBinding[] = [
        { action: {} as never, staticId: "s-a-0", blockId: "a" },
        { action: {} as never, staticId: "s-a-1", blockId: "a" },
        { action: {} as never, staticId: "s-b-0", blockId: "b" },
    ];

    it("maps an action id back to its block", () => {
        expect(blockIdForActionId(bindings, "s-b-0")).toBe("b");
        expect(blockIdForActionId(bindings, "missing")).toBeNull();
        expect(blockIdForActionId(bindings, null)).toBeNull();
    });

    it("resolves the first action id a block compiled to", () => {
        expect(firstActionIdForBlock(bindings, "a")).toBe("s-a-0");
        expect(firstActionIdForBlock(bindings, "missing")).toBeNull();
    });
});
