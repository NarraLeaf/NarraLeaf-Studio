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

function lookupsFor(names: Record<string, string>, colors: Record<string, string> = {}): StoryRowLookups {
    return {
        character: id => (names[id] ? { name: names[id], ...(colors[id] ? { color: colors[id] } : {}) } : null),
    };
}

function dialogueBlock(characterId: string): StoryBlock {
    return {
        id: "d",
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "dialogue", characterId, text: { textId: "t", value: "hi", role: "dialogue" } },
    };
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
        const rows = projectSceneTimeline(scene([dialogueBlock("c1")], ["d"]), lookupsFor({ c1: "Alice" }));
        expect(rows[0]!.summary).toBe("hi");
        expect(rows[0]!.speaker).toBe("Alice");
        expect(rows[0]!.speakerColor).toBeNull();
    });

    it("carries the speaker's accent colour beside the name", () => {
        const rows = projectSceneTimeline(
            scene([dialogueBlock("c1")], ["d"]),
            lookupsFor({ c1: "Alice" }, { c1: "#40A8C4" }),
        );
        expect(rows[0]!.speakerColor).toBe("#40A8C4");
    });

    // A temp speaker (a bare name with no character record) resolves through no lookup at all, so
    // there is nothing to tint - and the row must still name them.
    it("leaves a temp speaker uncoloured", () => {
        const temp: StoryBlock = {
            id: "d",
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: { action: "dialogue", speakerName: "Stranger", text: { textId: "t", value: "hi", role: "dialogue" } },
        };
        const rows = projectSceneTimeline(scene([temp], ["d"]), noLookups);
        expect(rows[0]!.speaker).toBe("Stranger");
        expect(rows[0]!.speakerColor).toBeNull();
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

    it("carries the repeat's authored round count from the document", () => {
        // The engine drops a nested loop's counter (see findReportedLoop), so this is what a repeat
        // rung can always say: how many rounds the author asked for.
        expect(contextFor("left", null).chain[0]).toMatchObject({ pill: "Repeat", times: 3 });
    });

    it("shows the round a repeat is on when the engine does report a loop", () => {
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

    it("lists a parallel's branches by what they say, and marks the one holding the play head", () => {
        // No engine frames at all: this is the state the panel is actually looked at in, because a
        // branch waiting on the player has drained its stack. The document still knows the answer.
        const view = contextFor("left", { root: { frames: [] }, async: [] });
        expect(view.branches).toEqual([
            { index: 1, sentence: "left line", current: true },
            { index: 2, sentence: "right line", current: false },
        ]);
    });

    it("prefers the engine's own current row for a branch when it reports one", () => {
        const stack: StackViewLike = {
            root: {
                frames: [{
                    actionId: null,
                    branches: [
                        { frames: [{ actionId: "s-right" }] },
                        { frames: [{ actionId: "s-left" }] },
                    ],
                }],
            },
            async: [],
        };
        expect(contextFor("left", stack).branches.map(b => b.sentence)).toEqual(["right line", "left line"]);
    });

    /**
     * The round a `/repeat` is ON only ever arrives nested: the loop is its own StackModel, handed
     * up as a branch of the frame that waits on it. Before engine 0.19.1 `branches` carried bare
     * frame lists and the nested `loop` never made it out, so this could not have passed.
     */
    it("finds a loop the engine reports inside a branch, not only on the root stack", () => {
        const stack: StackViewLike = {
            root: {
                frames: [{
                    actionId: null,
                    branches: [
                        { frames: [{ actionId: "s-left" }], loop: { counter: 1, limit: 3 } },
                    ],
                }],
            },
            async: [],
        };
        // It lands ON the Repeat rung, not in orphanRound: the chain has a repeat to claim it, which
        // is the whole user-visible point — the rung stops saying only how many rounds were authored.
        const repeat = contextFor("left", stack).chain.find(rung => rung.pill === "Repeat");
        // counter counts COMPLETED iterations, so the round being watched is counter + 1.
        expect(repeat?.round).toEqual({ current: 2, limit: 3 });
    });

    it("has no branch list when the play head is not inside a concurrent container", () => {
        expect(contextFor(null, null).branches).toEqual([]);
    });
});
