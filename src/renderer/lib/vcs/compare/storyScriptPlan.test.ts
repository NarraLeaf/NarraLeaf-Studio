import { describe, expect, it } from "vitest";
import { diffStoryDocument } from "@shared/documents/specs/storyDiff";
import type { StoryBlock, StoryChapter, StoryDocument, StoryScene } from "@shared/types/story/document";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story/document";
import { buildDocumentChangeRows } from "../documentChangeView";
import { buildStoryScriptPlan, mergeOrder, type StoryScriptSlot } from "./storyScriptPlan";

/**
 * The script both halves draw, pinned against the REAL story diff.
 *
 * Every test here builds two documents, runs `diffStoryDocument` over them and plans from what it
 * answered - never from a hand-written change list. The plan reads the change PATHS (`["scenes",
 * <id>, "blocks", <id>, ...]`) to decide which line a mark goes on, and a hand-written list would
 * pin this file against itself rather than against the contract `storyDiff.ts` states.
 *
 * jsdom is not needed and not used: none of this is about pixels. What a slot LOOKS like is in
 * `SplitComparisonView.test.tsx`; what a slot IS is here.
 */

function block(id: string, text: string, overrides: Partial<StoryBlock> = {}): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "narration", text: { textId: `t-${id}`, value: text } },
        ...overrides,
    } as StoryBlock;
}

function scene(id: string, name: string, blocks: StoryBlock[], rootIds?: string[]): StoryScene {
    return {
        id,
        name,
        runtimeName: name,
        rootBlockIds: rootIds ?? blocks.map(one => one.id),
        blocks: Object.fromEntries(blocks.map(one => [one.id, one])),
    } as StoryScene;
}

function story(scenes: StoryScene[], overrides: Partial<StoryDocument> = {}): StoryDocument {
    const chapters: StoryChapter[] = [{ id: "ch1", name: "Chapter One", sceneIds: scenes.map(one => one.id) }];
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "A Story",
        chapters,
        scenes: Object.fromEntries(scenes.map(one => [one.id, one])),
        ...overrides,
    } as StoryDocument;
}

/** The plan for two versions, taken the way the tab takes it. */
function planOf(base: StoryDocument | null, head: StoryDocument | null) {
    const diff = base && head
        ? diffStoryDocument(base, head, { limit: 200 })
        : { changes: [], complete: true, total: 0, tier: "semantic" as const };
    return buildStoryScriptPlan(buildDocumentChangeRows(diff, 200).rows, base, head);
}

function slotFor(slots: readonly StoryScriptSlot[], key: string): StoryScriptSlot {
    const found = slots.find(slot => slot.key === key);
    expect(found, `no slot ${key}`).toBeDefined();
    return found!;
}

const THREE = [block("b1", "One"), block("b2", "Two"), block("b3", "Three")];

describe("buildStoryScriptPlan marks", () => {
    it("marks the line that changed and nothing around it", () => {
        const base = story([scene("s1", "Opening", THREE)]);
        const head = story([scene("s1", "Opening", [THREE[0], block("b2", "Two, rewritten"), THREE[2]])]);

        const { slots } = planOf(base, head);
        expect(slotFor(slots, "block:s1/b2").tone).toBe("changed");
        expect(slotFor(slots, "block:s1/b1").tone).toBeNull();
        expect(slotFor(slots, "block:s1/b3").tone).toBeNull();
    });

    it("gives each half the text of ITS OWN version", () => {
        const base = story([scene("s1", "Opening", THREE)]);
        const head = story([scene("s1", "Opening", [THREE[0], block("b2", "Two, rewritten"), THREE[2]])]);

        const slot = slotFor(planOf(base, head).slots, "block:s1/b2");
        expect(slot.kind).toBe("block");
        if (slot.kind !== "block") return;
        expect(slot.base?.block.payload).toMatchObject({ text: { value: "Two" } });
        expect(slot.head?.block.payload).toMatchObject({ text: { value: "Two, rewritten" } });
    });

    it("wears the weakest mark for a line that only moved, and reads its depth per version", () => {
        const base = story([scene("s1", "Opening", [block("b1", "One"), block("b2", "Two")])]);
        const head = story([scene("s1", "Opening", [
            block("b1", "One", { childrenIds: ["b2"] }),
            block("b2", "Two", { parentId: "b1" }),
        ], ["b1"])]);

        const slot = slotFor(planOf(base, head).slots, "block:s1/b2");
        expect(slot.tone).toBe("moved");
        if (slot.kind !== "block") return;
        // The same block, indented in one version and not in the other. Each half draws its own.
        expect(slot.base?.depth).toBe(0);
        expect(slot.head?.depth).toBe(1);
    });
});

describe("buildStoryScriptPlan presence", () => {
    it("keeps a deleted line where it was, in the older half only", () => {
        const base = story([scene("s1", "Opening", THREE)]);
        const head = story([scene("s1", "Opening", [THREE[0], THREE[2]])]);

        const { slots } = planOf(base, head);
        const slot = slotFor(slots, "block:s1/b2");
        expect([slot.onBase, slot.onHead]).toEqual([true, false]);
        expect(slot.tone).toBe("removed");

        // Between its neighbours, not in a heap at the end: the two halves have to face each
        // other's counterparts everywhere, deletions included.
        const order = slots.filter(one => one.kind === "block").map(one => one.key);
        expect(order).toEqual(["block:s1/b1", "block:s1/b2", "block:s1/b3"]);
    });

    it("puts a new line in the newer half only", () => {
        const base = story([scene("s1", "Opening", [THREE[0], THREE[2]])]);
        const head = story([scene("s1", "Opening", THREE)]);

        const slot = slotFor(planOf(base, head).slots, "block:s1/b2");
        expect([slot.onBase, slot.onHead]).toEqual([false, true]);
        expect(slot.tone).toBe("added");
    });

    it("reserves a scene one version does not hold", () => {
        const base = story([scene("s1", "Opening", THREE)]);
        const head = story([scene("s1", "Opening", THREE), scene("s2", "Later", [block("b9", "Nine")])]);

        const { slots } = planOf(base, head);
        const added = slotFor(slots, "scene:s2");
        expect([added.onBase, added.onHead]).toEqual([false, true]);
        expect(added.tone).toBe("added");
        // The scene that did not change is not drawn at all, so its lines are not either.
        expect(slots.some(slot => slot.key === "block:s1/b1")).toBe(false);
        expect(slotFor(slots, "block:s2/b9").onBase).toBe(false);
    });
});

describe("buildStoryScriptPlan coverage", () => {
    it("draws only the scenes a change lands in", () => {
        const untouched = scene("s2", "Untouched", [block("b9", "Nine")]);
        const base = story([scene("s1", "Opening", THREE), untouched]);
        const head = story([
            scene("s1", "Opening", [THREE[0], block("b2", "Two, rewritten"), THREE[2]]),
            untouched,
        ]);

        const { slots } = planOf(base, head);
        expect(slots.filter(slot => slot.kind === "scene").map(slot => slot.key)).toEqual(["scene:s1"]);
    });

    it("keeps a change the script cannot show as a row, ahead of the script", () => {
        const base = story([scene("s1", "Opening", THREE)]);
        const head = story([scene("s1", "Opening", [THREE[0], block("b2", "Two, rewritten"), THREE[2]])], {
            name: "A Story, renamed",
        });

        const { slots } = planOf(base, head);
        expect(slots[0].kind).toBe("change");
        expect(slots[0].stop).toBe(true);
        expect(slots.filter(slot => slot.kind === "change")).toHaveLength(1);
    });

    it("stops on every change row and on nothing else", () => {
        const base = story([scene("s1", "Opening", THREE)]);
        const head = story([scene("s1", "Opening", [THREE[0], block("b2", "Two, rewritten"), THREE[2]])], {
            name: "A Story, renamed",
        });

        const rows = buildDocumentChangeRows(diffStoryDocument(base, head, { limit: 200 }), 200).rows;
        const { slots } = planOf(base, head);
        // One stop per row the change list would have drawn: the document's name, the scene's own
        // group row, and the line inside it. Nothing an author could previously reach is gone.
        expect(slots.filter(slot => slot.stop)).toHaveLength(rows.length);
        expect(slotFor(slots, "block:s1/b1").stop).toBe(false);
    });

    it("counts the lines it drew, so a caller can refuse to draw too many", () => {
        const base = story([scene("s1", "Opening", THREE)]);
        const head = story([scene("s1", "Opening", [THREE[0], block("b2", "Two, rewritten"), THREE[2]])]);
        expect(planOf(base, head).blocks).toBe(3);
    });
});

describe("mergeOrder", () => {
    it("puts an id only the older version holds back where it was", () => {
        expect(mergeOrder(["a", "b", "c"], ["a", "c"])).toEqual(["a", "b", "c"]);
    });

    it("keeps an id that led the older version at the front", () => {
        expect(mergeOrder(["x", "a"], ["a", "b"])).toEqual(["x", "a", "b"]);
    });

    it("follows the newer version wherever both hold an id", () => {
        expect(mergeOrder(["a", "b"], ["b", "a"])).toEqual(["b", "a"]);
    });

    it("answers each side alone when the other is empty", () => {
        expect(mergeOrder([], ["a", "b"])).toEqual(["a", "b"]);
        expect(mergeOrder(["a", "b"], [])).toEqual(["a", "b"]);
    });
});
