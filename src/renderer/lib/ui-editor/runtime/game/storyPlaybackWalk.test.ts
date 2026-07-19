import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { collectStoryPlaybackPlan, groupPlaybackStepsByNvl } from "./storyPlaybackWalk";

function makeScene(blocks: Record<string, StoryBlock>, rootBlockIds: string[]): StoryScene {
    return { id: "scene-1", name: "Scene 1", runtimeName: "Scene 1", rootBlockIds, blocks };
}

function block(id: string, kind: StoryBlock["kind"], payload: unknown, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind, parentId, childrenIds, payload } as StoryBlock;
}

const say = (id: string, parentId: string | null = null, childrenIds: string[] = []) =>
    block(id, "nodeAction", { action: "narration", text: { textId: `${id}-text`, value: "Text", role: "narration" } }, parentId, childrenIds);

const ids = (scene: StoryScene, start: string | null) =>
    collectStoryPlaybackPlan(scene, start).steps.map(step => step.blockId);

describe("collectStoryPlaybackPlan", () => {
    it("plays the rest of a flat scene from the start row", () => {
        const scene = makeScene({ a: say("a"), b: say("b"), c: say("c") }, ["a", "b", "c"]);
        expect(ids(scene, "b")).toEqual(["b", "c"]);
        expect(collectStoryPlaybackPlan(scene, "b").stop).toEqual({ reason: "sceneEnd" });
    });

    it("plays the whole scene when there is no start row", () => {
        const scene = makeScene({ a: say("a"), b: say("b") }, ["a", "b"]);
        expect(ids(scene, null)).toEqual(["a", "b"]);
        expect(ids(scene, "missing")).toEqual(["a", "b"]);
    });

    it("ascends out of a container and resumes after it", () => {
        const scene = makeScene({
            group: block("group", "control", { control: "sequence" }, null, ["inner1", "inner2"]),
            inner1: say("inner1", "group"),
            inner2: say("inner2", "group"),
            after: say("after"),
        }, ["group", "after"]);
        expect(ids(scene, "inner1")).toEqual(["inner1", "inner2", "after"]);
    });

    it("entering a menu option plays that branch, skips the other options, then resumes after the menu", () => {
        const scene = makeScene({
            choice: block("choice", "nodeAction", { action: "choice" }, null, ["optA", "optB"]),
            optA: block("optA", "nodeAction", { action: "choiceOption", text: { textId: "ta", value: "A", role: "choiceText" } }, "choice", ["a1", "a2"]),
            a1: say("a1", "optA"),
            a2: say("a2", "optA"),
            optB: block("optB", "nodeAction", { action: "choiceOption", text: { textId: "tb", value: "B", role: "choiceText" } }, "choice", ["b1"]),
            b1: say("b1", "optB"),
            after: say("after"),
        }, ["choice", "after"]);

        const plan = collectStoryPlaybackPlan(scene, "optA");
        // The option row itself is a branch label: compile its body, not the row.
        expect(plan.steps[0]).toMatchObject({ blockId: "optA", bodyOnly: true });
        expect(plan.steps.map(step => step.blockId)).toEqual(["optA", "after"]);
        // Starting *inside* the branch walks the rest of the branch, then past the whole menu.
        expect(ids(scene, "a1")).toEqual(["a1", "a2", "after"]);
    });

    it("skips sibling condition branches when climbing out of one", () => {
        const scene = makeScene({
            cond: block("cond", "control", { control: "condition" }, null, ["ifB", "elseB"]),
            ifB: block("ifB", "control", { control: "conditionBranch", branch: "if" }, "cond", ["i1"]),
            i1: say("i1", "ifB"),
            elseB: block("elseB", "control", { control: "conditionBranch", branch: "else" }, "cond", ["e1"]),
            e1: say("e1", "elseB"),
            after: say("after"),
        }, ["cond", "after"]);

        expect(ids(scene, "i1")).toEqual(["i1", "after"]);
        expect(collectStoryPlaybackPlan(scene, "elseB").steps[0]).toMatchObject({ blockId: "elseB", bodyOnly: true });
        expect(ids(scene, "elseB")).toEqual(["elseB", "after"]);
    });

    it("stops at a scene jump and reports the destination", () => {
        const scene = makeScene({
            a: say("a"),
            jump: block("jump", "jump", { targetSceneId: "scene-2" }),
            never: say("never"),
        }, ["a", "jump", "never"]);

        const plan = collectStoryPlaybackPlan(scene, "a");
        expect(plan.steps.map(step => step.blockId)).toEqual(["a"]);
        expect(plan.stop).toEqual({ reason: "jump", blockId: "jump", targetSceneId: "scene-2" });
    });

    it("stops immediately when playback starts on a jump row", () => {
        const scene = makeScene({ jump: block("jump", "jump", { targetSceneId: "scene-2" }) }, ["jump"]);
        const plan = collectStoryPlaybackPlan(scene, "jump");
        expect(plan.steps).toEqual([]);
        expect(plan.stop).toMatchObject({ reason: "jump", targetSceneId: "scene-2" });
    });

    it("drops note and code rows, which have no runtime behaviour", () => {
        const scene = makeScene({
            a: say("a"),
            note: block("note", "note", { text: { textId: "n", value: "Remember", role: "note" } }),
            code: block("code", "code", { language: "narraleaf", source: "x" }),
            b: say("b"),
        }, ["a", "note", "code", "b"]);
        expect(ids(scene, "a")).toEqual(["a", "b"]);
    });

    it("marks steps inside an NVL container", () => {
        const scene = makeScene({
            nvl: block("nvl", "action", { action: "nvl" }, null, ["n1", "n2"]),
            n1: say("n1", "nvl"),
            n2: say("n2", "nvl"),
            after: say("after"),
        }, ["nvl", "after"]);

        const plan = collectStoryPlaybackPlan(scene, "n1");
        expect(plan.steps).toEqual([
            { blockId: "n1", bodyOnly: false, insideNvl: true },
            { blockId: "n2", bodyOnly: false, insideNvl: true },
            { blockId: "after", bodyOnly: false, insideNvl: false },
        ]);
        expect(groupPlaybackStepsByNvl(plan.steps)).toEqual([
            { insideNvl: true, steps: [plan.steps[0], plan.steps[1]] },
            { insideNvl: false, steps: [plan.steps[2]] },
        ]);
    });

    it("survives a parent cycle instead of spinning", () => {
        const scene = makeScene({
            a: block("a", "control", { control: "sequence" }, "b", ["b"]),
            b: block("b", "control", { control: "sequence" }, "a", ["a"]),
        }, ["a"]);
        const plan = collectStoryPlaybackPlan(scene, "a");
        expect(plan.stop.reason).toBe("limit");
    });
});
