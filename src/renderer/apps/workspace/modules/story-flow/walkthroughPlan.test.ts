import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import { planWalkthrough } from "./walkthroughPlan";

function jump(id: string, targetSceneId: string, parentId: string | null = null): StoryBlock {
    return { id, kind: "jump", parentId, childrenIds: [], payload: { targetSceneId } };
}

function ending(id: string, name: string, parentId: string | null = null): StoryBlock {
    return {
        id,
        kind: "control",
        parentId,
        childrenIds: [],
        payload: { control: "ending", name },
    } as StoryBlock;
}

function choice(id: string, childrenIds: string[], parentId: string | null = null): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId,
        childrenIds,
        payload: { action: "choice", prompt: { textId: `${id}-prompt`, value: "", role: "choicePrompt" } },
    } as StoryBlock;
}

function option(
    id: string,
    childrenIds: string[],
    text: string,
    parentId: string,
    disabled?: boolean,
): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId,
        childrenIds,
        ...(disabled ? { disabled: true } : {}),
        payload: { action: "choiceOption", text: { textId: `${id}-text`, value: text, role: "choiceText" } },
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

describe("planWalkthrough", () => {
    it("plans a route through a choice, taking the option that owns the jump", () => {
        const doc = document([
            scene("start", "Start", [
                choice("c1", ["o0", "o1"]),
                option("o0", ["j0"], "Left", "c1"),
                jump("j0", "left", "o0"),
                option("o1", ["j1"], "Right", "c1"),
                jump("j1", "right", "o1"),
            ]),
            scene("left", "Left", [ending("e-left", "Left End")]),
            scene("right", "Right", [ending("e-right", "Right End")]),
        ], "start");

        const planned = planWalkthrough(doc, { endingId: "e-right", entrySceneIds: [] });

        expect(planned.ok).toBe(true);
        if (!planned.ok) {
            return;
        }
        expect(planned.plan.entrySceneId).toBe("start");
        expect(planned.plan.sceneIds).toEqual(["start", "right"]);
        expect(planned.plan.decisions).toEqual([{
            choiceBlockId: "c1",
            optionBlockId: "o1",
            optionIndex: 1,
            optionText: "Right",
            sceneId: "start",
            sceneName: "Start",
        }]);
    });

    it("counts the option's index among its live siblings, not its rows", () => {
        // The compiler drops a disabled option before the menu is built, so the option after one is
        // index 0 at play time however it reads in the outline.
        const doc = document([
            scene("start", "Start", [
                choice("c1", ["o0", "o1"]),
                option("o0", [], "Gone", "c1", true),
                option("o1", ["j1"], "Right", "c1"),
                jump("j1", "right", "o1"),
            ]),
            scene("right", "Right", [ending("e-right", "Right End")]),
        ], "start");

        const planned = planWalkthrough(doc, { endingId: "e-right", entrySceneIds: [] });

        expect(planned.ok).toBe(true);
        if (!planned.ok) {
            return;
        }
        expect(planned.plan.decisions.map(decision => decision.optionIndex)).toEqual([0]);
    });

    it("answers a nested choice outermost first, and indexes each in its own menu", () => {
        const doc = document([
            scene("start", "Start", [
                choice("c1", ["o0", "o1"]),
                option("o0", [], "Stay", "c1"),
                option("o1", ["c2"], "Go on", "c1"),
                choice("c2", ["o2", "o3"], "o1"),
                option("o2", [], "Wait", "c2"),
                option("o3", ["j3"], "Leave", "c2"),
                jump("j3", "finish", "o3"),
            ]),
            scene("finish", "Finish", [ending("e-finish", "The End")]),
        ], "start");

        const planned = planWalkthrough(doc, { endingId: "e-finish", entrySceneIds: [] });

        expect(planned.ok).toBe(true);
        if (!planned.ok) {
            return;
        }
        expect(planned.plan.decisions.map(decision => [decision.optionBlockId, decision.optionIndex]))
            .toEqual([["o1", 1], ["o3", 1]]);
    });

    it("plans the decisions the ending row itself sits behind", () => {
        const doc = document([
            scene("start", "Start", [
                choice("c1", ["o0", "o1"]),
                option("o0", [], "Nothing", "c1"),
                option("o1", ["e-secret"], "Look closer", "c1"),
                ending("e-secret", "Secret End", "o1"),
            ]),
        ], "start");

        const planned = planWalkthrough(doc, { endingId: "e-secret", entrySceneIds: [] });

        expect(planned.ok).toBe(true);
        if (!planned.ok) {
            return;
        }
        expect(planned.plan.sceneIds).toEqual(["start"]);
        expect(planned.plan.decisions.map(decision => decision.optionBlockId)).toEqual(["o1"]);
    });

    it("reports an ending nothing leads to", () => {
        const doc = document([
            scene("start", "Start", [ending("e-start", "Early End")]),
            scene("orphan", "Orphan", [ending("e-orphan", "Never")]),
        ], "start");

        expect(planWalkthrough(doc, { endingId: "e-orphan", entrySceneIds: [] }))
            .toEqual({ ok: false, failure: { reason: "unreachable" } });
    });

    it("will not walk a branch the author switched off", () => {
        const blocks = [
            choice("c1", ["o0"]),
            option("o0", ["j0"], "Left", "c1"),
            jump("j0", "left", "o0"),
        ];
        // Disabling the option removes the jump inside it from the build, so the scene beyond it is
        // one no player can reach - the same reading the flow map takes.
        blocks[1] = option("o0", ["j0"], "Left", "c1", true);
        const doc = document([
            scene("start", "Start", blocks),
            scene("left", "Left", [ending("e-left", "Left End")]),
        ], "start");

        expect(planWalkthrough(doc, { endingId: "e-left", entrySceneIds: [] }))
            .toEqual({ ok: false, failure: { reason: "unreachable" } });
    });

    it("takes an entry a blueprint names when the document marks none", () => {
        const doc = document([
            scene("prologue", "Prologue", [jump("j", "finish")]),
            scene("finish", "Finish", [ending("e-finish", "The End")]),
        ]);

        expect(planWalkthrough(doc, { endingId: "e-finish", entrySceneIds: [] }))
            .toEqual({ ok: false, failure: { reason: "noEntryPoint" } });

        const planned = planWalkthrough(doc, { endingId: "e-finish", entrySceneIds: ["prologue"] });
        expect(planned.ok).toBe(true);
        if (planned.ok) {
            expect(planned.plan.entrySceneId).toBe("prologue");
        }
    });

    it("reports an ending the document no longer has", () => {
        const doc = document([scene("start", "Start", [])], "start");

        expect(planWalkthrough(doc, { endingId: "gone", entrySceneIds: [] }))
            .toEqual({ ok: false, failure: { reason: "endingMissing" } });
    });

    it("takes the shortest route, and prefers a jump no condition guards", () => {
        const doc = document([
            scene("start", "Start", [
                choice("c1", ["o0"]),
                option("o0", ["j0"], "Long way", "c1"),
                jump("j0", "middle", "o0"),
                jump("j1", "finish"),
            ]),
            scene("middle", "Middle", [jump("j2", "finish")]),
            scene("finish", "Finish", [ending("e-finish", "The End")]),
        ], "start");

        const planned = planWalkthrough(doc, { endingId: "e-finish", entrySceneIds: [] });

        expect(planned.ok).toBe(true);
        if (!planned.ok) {
            return;
        }
        expect(planned.plan.sceneIds).toEqual(["start", "finish"]);
        expect(planned.plan.decisions).toEqual([]);
    });
});
