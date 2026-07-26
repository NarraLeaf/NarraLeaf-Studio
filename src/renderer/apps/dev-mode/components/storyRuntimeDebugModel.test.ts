import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";
import type { NlrActionIdBinding } from "@/lib/ui-editor/runtime/game/storyCompiler";
import type { StoryRowLookups } from "@/lib/story/storyRowProjection";
import { storyRowSentence } from "@/lib/story/storyRowProjection";
import {
    blockIdForActionId,
    projectExecutionContext,
    projectSceneTimeline,
    type StackViewLike,
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

const noLookups: StoryRowLookups = { character: () => null };

function lookupsFor(names: Record<string, string>): StoryRowLookups {
    return { character: id => (names[id] ? { name: names[id] } : null) };
}

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
        const rows = projectSceneTimeline(target, noLookups);
        expect(rows.map(r => [r.blockId, r.lineNumber, r.depth])).toEqual([
            ["a", 1, 0],
            ["a1", 2, 1],
            ["b", 3, 0],
        ]);
    });

    it("does not hang on a corrupted childrenIds cycle", () => {
        const a = narration("a", "a", ["b"]);
        const b = narration("b", "b", ["a"]);
        const rows = projectSceneTimeline(scene([a, b], ["a"]), noLookups);
        expect(rows.map(r => r.blockId)).toEqual(["a", "b"]);
    });

    it("carries the speaker beside the line rather than baked into it (the panel prefixes it)", () => {
        const dialogue: StoryBlock = {
            id: "d",
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: { action: "dialogue", characterId: "c1", text: { textId: "t", value: "hi", role: "dialogue" } },
        };
        const rows = projectSceneTimeline(scene([dialogue], ["d"]), lookupsFor({ c1: "Alice" }));
        expect(rows[0]!.summary).toBe("hi");
        expect(rows[0]!.speaker).toBe("Alice");
    });

    it("gives prose rows no colour bar and staging rows the editor's hue", () => {
        const background: StoryBlock = {
            id: "bg",
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: { action: "setBackground", assetId: "img-1" },
        };
        const rows = projectSceneTimeline(scene([narration("n", "hi"), background], ["n", "bg"]), noLookups);
        expect(rows[0]!.barColor).toBeNull();
        // The `scene` command group's hue - the same value `getBlockBadgeInfo` hands the editor's bar.
        expect(rows[1]!.barColor).toBe("#8fa9c7");
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
});

describe("projectExecutionContext", () => {
    /** repeat(3) > parallel > narration, plus a second parallel branch. */
    function nestedScene(): StoryScene {
        const repeat: StoryBlock = {
            id: "rep", kind: "control", parentId: null, childrenIds: ["par"],
            payload: { control: "repeat", times: 3 },
        };
        const parallel: StoryBlock = {
            id: "par", kind: "control", parentId: "rep", childrenIds: ["left", "right"],
            payload: { control: "parallel", mode: "all" },
        };
        const left = { ...narration("left", "left line"), parentId: "par" };
        const right = { ...narration("right", "right line"), parentId: "par" };
        return {
            id: "scene-1", name: "Nesting Lab", runtimeName: "nesting",
            rootBlockIds: ["rep"],
            blocks: Object.fromEntries([repeat, parallel, left, right].map(block => [block.id, block])),
        };
    }

    const bindings = [
        { staticId: "s-left", blockId: "left" },
        { staticId: "s-right", blockId: "right" },
    ];

    function contextFor(currentBlockId: StoryBlockId | null, stack: StackViewLike | null) {
        const target = nestedScene();
        return projectExecutionContext({
            scene: target,
            sceneName: target.name,
            currentBlockId,
            stack,
            bindings,
            rowSentence: blockId => {
                const block = target.blocks[blockId];
                return block ? storyRowSentence(block, noLookups) : null;
            },
        });
    }

    it("names the scene even at the root, where there is no chain to show", () => {
        const view = contextFor(null, null);
        expect(view.sceneName).toBe("Nesting Lab");
        expect(view.chain).toEqual([]);
        expect(view.branches).toEqual([]);
    });

    it("reads the container chain out of the document, outermost first, in plain words", () => {
        const view = contextFor("left", null);
        // The editor's own pills - never `control:all` / `menu:action`, which is what the panel used
        // to print in their place.
        expect(view.chain.map(rung => rung.pill)).toEqual(["Repeat", "Run at the same time"]);
    });

    it("shows the round a repeat is on, counting the one in progress", () => {
        // counter = completed iterations, so the first pass through the body is round 1 of 3.
        const first = contextFor("left", { root: { frames: [], loop: { counter: 0, limit: 3 } }, async: [] });
        expect(first.chain[0]!.round).toEqual({ current: 1, limit: 3 });
        const second = contextFor("left", { root: { frames: [], loop: { counter: 1, limit: 3 } }, async: [] });
        expect(second.chain[0]!.round).toEqual({ current: 2, limit: 3 });
        // The counter reaches the limit in the instant before the loop drains; never print `4/3`.
        const last = contextFor("left", { root: { frames: [], loop: { counter: 3, limit: 3 } }, async: [] });
        expect(last.chain[0]!.round).toEqual({ current: 3, limit: 3 });
        expect(last.orphanRound).toBeNull();
    });

    it("keeps a loop the chain does not claim rather than dropping it", () => {
        const view = contextFor(null, { root: { frames: [], loop: { counter: 0, limit: 2 } }, async: [] });
        expect(view.chain).toEqual([]);
        expect(view.orphanRound).toEqual({ current: 1, limit: 2 });
    });

    it("names who is running in a parallel instead of numbering anonymous branches", () => {
        const stack: StackViewLike = {
            root: {
                frames: [{
                    actionId: null,
                    branches: [
                        [{ actionId: "s-left" }],
                        [{ actionId: "s-right" }],
                    ],
                }],
            },
            async: [],
        };
        const view = contextFor("left", stack);
        expect(view.branches).toEqual([
            { index: 1, sentence: "left line" },
            { index: 2, sentence: "right line" },
        ]);
    });

    it("finds a concurrent group nested inside another branch", () => {
        const stack: StackViewLike = {
            root: { frames: [{ actionId: null }] },
            async: [{
                frames: [{ actionId: null, branches: [[{ actionId: "s-right" }]] }],
            }],
        };
        expect(contextFor("right", stack).branches).toEqual([{ index: 1, sentence: "right line" }]);
    });
});
