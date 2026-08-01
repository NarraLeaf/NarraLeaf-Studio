import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryBlockId, StoryDocument, StoryScene, StorySceneId } from "@shared/types/story";
import type { NlrActionIdBinding } from "@/lib/ui-editor/runtime/game/storyCompiler";
import type { StoryRowLookups } from "@/lib/story/storyRowProjection";
import { storyRowSentence } from "@/lib/story/storyRowProjection";
import {
    advanceStoryRunTrail,
    blockIdForActionId,
    buildStorySceneBlockIndex,
    formatStoryVariableDeltaChip,
    formatStoryVariableRangeChip,
    projectExecutionContext,
    projectSceneTimeline,
    projectStoryTrailHighlight,
    seedStoryRunTrail,
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

function jump(id: StoryBlockId, targetSceneId: StorySceneId): StoryBlock {
    return {
        id,
        kind: "jump",
        parentId: null,
        childrenIds: [],
        payload: { targetSceneId },
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

describe("buildStorySceneBlockIndex", () => {
    const document = {
        scenes: {
            "scene-a": scene([narration("a1", "hi"), jump("a-jump", "scene-b")], ["a1", "a-jump"]),
            "scene-b": { ...scene([narration("b1", "there")], ["b1"]), id: "scene-b" },
        },
    } as unknown as StoryDocument;

    it("places every block in its scene and names the jumps", () => {
        const index = buildStorySceneBlockIndex(document);
        expect(index.sceneIdByBlockId.get("a1")).toBe("scene-a");
        expect(index.sceneIdByBlockId.get("b1")).toBe("scene-b");
        expect(Array.from(index.jumpBlockIds)).toEqual(["a-jump"]);
    });
});

describe("advanceStoryRunTrail", () => {
    const observe = (sceneId: string | null, blockId: string | null, isJump = false) => ({ sceneId, blockId, isJump });

    it("returns the very same object when nothing moved (so no render is scheduled)", () => {
        const trail = seedStoryRunTrail("scene-a");
        expect(advanceStoryRunTrail(trail, observe("scene-a", "a1"))).toBe(trail);
        // An action bound to no Studio block says nothing about where the story is.
        expect(advanceStoryRunTrail(trail, observe(null, null))).toBe(trail);
    });

    it("credits the jump the head passed through to the scene it lands in", () => {
        let trail = seedStoryRunTrail("scene-a");
        trail = advanceStoryRunTrail(trail, observe("scene-a", "a-jump", true));
        // The jump is not a step of its own — nothing has been entered yet.
        expect(trail.steps).toEqual([{ sceneId: "scene-a", viaJumpBlockId: null }]);
        trail = advanceStoryRunTrail(trail, observe("scene-b", "b1"));
        expect(trail.steps).toEqual([
            { sceneId: "scene-a", viaJumpBlockId: null },
            { sceneId: "scene-b", viaJumpBlockId: "a-jump" },
        ]);
        expect(trail.pendingJumpBlockId).toBeNull();
    });

    it("records a scene entered with no witnessed jump rather than dropping it", () => {
        let trail = seedStoryRunTrail("scene-a");
        trail = advanceStoryRunTrail(trail, observe("scene-b", "b1"));
        expect(trail.steps[1]).toEqual({ sceneId: "scene-b", viaJumpBlockId: null });
    });

    it("records a scene re-entered later as a step of its own", () => {
        let trail = seedStoryRunTrail("scene-a");
        for (const step of [["scene-b", "b1"], ["scene-a", "a1"]] as const) {
            trail = advanceStoryRunTrail(trail, observe(step[0], step[1]));
        }
        expect(trail.steps.map(step => step.sceneId)).toEqual(["scene-a", "scene-b", "scene-a"]);
    });
});

describe("projectStoryTrailHighlight", () => {
    /** Two options of one fork, both leaving scene-a; only one of them reaches scene-b. */
    const graph = {
        edges: [
            { id: "e:a->b", source: "scene-a", target: "scene-b", jumps: [{ blockId: "j1" }, { blockId: "j2" }] },
            { id: "e:a->c", source: "scene-a", target: "scene-c", jumps: [{ blockId: "j3" }] },
        ],
        branchEdges: [
            { id: "br:opt1->b", sourceBranchId: "br:opt1", sourceSceneId: "scene-a", target: "scene-b", jumps: [{ blockId: "j1" }] },
            { id: "br:opt2->b", sourceBranchId: "br:opt2", sourceSceneId: "scene-a", target: "scene-b", jumps: [{ blockId: "j2" }] },
            { id: "br:opt3->c", sourceBranchId: "br:opt3", sourceSceneId: "scene-a", target: "scene-c", jumps: [{ blockId: "j3" }] },
        ],
    };

    it("lights the arm the witnessed jump belongs to, and leaves its siblings dark", () => {
        const highlight = projectStoryTrailHighlight({
            steps: [
                { sceneId: "scene-a", viaJumpBlockId: null },
                { sceneId: "scene-b", viaJumpBlockId: "j2" },
            ],
            pendingJumpBlockId: null,
        }, graph);
        expect(Array.from(highlight.sceneIds).sort()).toEqual(["scene-a", "scene-b"]);
        expect(highlight.edgeIds.has("br:opt2->b")).toBe(true);
        expect(highlight.edgeIds.has("br:opt2")).toBe(true);
        expect(highlight.edgeIds.has("br:opt1->b")).toBe(false);
        // The collapsed line is keyed by scene pair, so lighting it involves no guess.
        expect(highlight.edgeIds.has("e:a->b")).toBe(true);
    });

    it("lights the line but no arm when two arms could have taken it", () => {
        const highlight = projectStoryTrailHighlight({
            steps: [
                { sceneId: "scene-a", viaJumpBlockId: null },
                { sceneId: "scene-b", viaJumpBlockId: null },
            ],
            pendingJumpBlockId: null,
        }, graph);
        expect(highlight.edgeIds.has("e:a->b")).toBe(true);
        expect(highlight.edgeIds.has("br:opt1->b")).toBe(false);
        expect(highlight.edgeIds.has("br:opt2->b")).toBe(false);
    });

    it("falls back to the one arm that could have taken it", () => {
        const highlight = projectStoryTrailHighlight({
            steps: [
                { sceneId: "scene-a", viaJumpBlockId: null },
                { sceneId: "scene-c", viaJumpBlockId: null },
            ],
            pendingJumpBlockId: null,
        }, graph);
        expect(highlight.edgeIds.has("br:opt3->c")).toBe(true);
    });

    it("discards a witness the map says cannot lead there", () => {
        const highlight = projectStoryTrailHighlight({
            steps: [
                { sceneId: "scene-a", viaJumpBlockId: null },
                // `j3` leaves scene-a for scene-c, so it is not how this run reached scene-b.
                { sceneId: "scene-b", viaJumpBlockId: "j3" },
            ],
            pendingJumpBlockId: null,
        }, graph);
        expect(highlight.edgeIds.has("br:opt3->c")).toBe(false);
        expect(highlight.edgeIds.has("br:opt1->b")).toBe(false);
        expect(highlight.edgeIds.has("e:a->b")).toBe(true);
    });
});

describe("variable focus chips", () => {
    it("words a delta the way the map does, with a real minus sign", () => {
        expect(formatStoryVariableDeltaChip({ op: "add", amount: 2 })).toBe("+2");
        expect(formatStoryVariableDeltaChip({ op: "add", amount: -1 })).toBe("\u22121");
        expect(formatStoryVariableDeltaChip({ op: "set", value: 5 })).toBe("=5");
        expect(formatStoryVariableDeltaChip({ op: "unknown" })).toBe("?");
    });

    it("prints a settled range as one number and an underivable one as ?", () => {
        expect(formatStoryVariableRangeChip({ kind: "known", min: 4, max: 4 })).toBe("4");
        expect(formatStoryVariableRangeChip({ kind: "known", min: 0, max: 7 })).toBe("0\u20137");
        expect(formatStoryVariableRangeChip({ kind: "unknown" })).toBe("?");
    });
});
