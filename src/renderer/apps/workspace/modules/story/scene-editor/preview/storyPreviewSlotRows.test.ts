import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { findStoryPreviewRowForSlot, storyPreviewCanShowSlot, storyPreviewRowShowsSlot } from "./storyPreviewSlotRows";

function makeScene(blocks: StoryBlock[], rootBlockIds: string[]): StoryScene {
    return {
        id: "scene-1",
        name: "Scene 1",
        runtimeName: "Scene 1",
        rootBlockIds,
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

function row(id: string, kind: StoryBlock["kind"], payload: unknown, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind, parentId, childrenIds, payload } as StoryBlock;
}

const line = (id: string, parentId: string | null = null, value = "Text") =>
    row(id, "nodeAction", { action: "narration", text: { textId: `${id}-t`, value, role: "narration" } }, parentId);
const say = (id: string, parentId: string | null = null) =>
    row(id, "nodeAction", { action: "dialogue", characterId: "c", text: { textId: `${id}-t`, value: "Hello.", role: "dialogue" } }, parentId);
const command = (id: string, parentId: string | null = null) =>
    row(id, "action", { action: "setVariable", target: { scope: "scene", variableId: "v" }, value: 1 }, parentId);
const menu = (id: string, optionIds: string[], parentId: string | null = null) =>
    row(id, "nodeAction", { action: "choice" }, parentId, optionIds);
const option = (id: string, parentId: string, childrenIds: string[]) =>
    row(id, "nodeAction", { action: "choiceOption", text: { textId: `${id}-t`, value: id, role: "choiceText" } }, parentId, childrenIds);
const nvl = (id: string, childrenIds: string[]) => row(id, "action", { action: "nvl" }, null, childrenIds);
const note = (id: string) => row(id, "note", { text: "later" });
const disabled = (block: StoryBlock): StoryBlock => ({ ...block, disabled: true });

/** A command, two lines, a menu of two options, an NVL page of two lines, and a last line. */
function scene(): StoryScene {
    return makeScene([
        command("set"), line("n1"), say("s2"),
        menu("menu", ["optA", "optB"]),
        option("optA", "menu", ["a1"]), say("a1", "optA"),
        option("optB", "menu", ["b1"]), line("b1", "optB"),
        nvl("page", ["p1", "p2"]), line("p1", "page"), say("p2", "page"),
        note("note"), say("last"),
    ], ["set", "n1", "s2", "menu", "page", "note", "last"]);
}

describe("storyPreviewRowShowsSlot", () => {
    it("shows the dialogue box at a line, and not at a command or a menu", () => {
        const s = scene();
        expect(storyPreviewRowShowsSlot(s, "n1", "dialog")).toBe(true);
        expect(storyPreviewRowShowsSlot(s, "s2", "dialog")).toBe(true);
        expect(storyPreviewRowShowsSlot(s, "set", "dialog")).toBe(false);
        expect(storyPreviewRowShowsSlot(s, "menu", "dialog")).toBe(false);
    });

    it("shows the NVL page, not the dialogue box, at a line inside /nvl", () => {
        const s = scene();
        expect(storyPreviewRowShowsSlot(s, "p1", "nvl")).toBe(true);
        expect(storyPreviewRowShowsSlot(s, "p1", "dialog")).toBe(false);
        expect(storyPreviewRowShowsSlot(s, "n1", "nvl")).toBe(false);
    });

    it("reads an option row as its menu, and a note as the row before it", () => {
        const s = scene();
        expect(storyPreviewRowShowsSlot(s, "optA", "choice")).toBe(true);
        expect(storyPreviewRowShowsSlot(s, "note", "nvl")).toBe(true);
    });

    it("shows the On-Stage Game UI at every row, and notifications at none", () => {
        const s = scene();
        expect(storyPreviewRowShowsSlot(s, "set", "onStage")).toBe(true);
        expect(storyPreviewRowShowsSlot(s, null, "onStage")).toBe(true);
        expect(storyPreviewCanShowSlot("notification")).toBe(false);
        expect(findStoryPreviewRowForSlot(s, "n1", "notification")).toBeNull();
    });
});

describe("findStoryPreviewRowForSlot", () => {
    it("keeps the cursor where it already shows the Game UI", () => {
        expect(findStoryPreviewRowForSlot(scene(), "s2", "dialog")).toBe("s2");
        expect(findStoryPreviewRowForSlot(scene(), "optB", "choice")).toBe("optB");
    });

    it("moves to the next row that shows it, in reading order", () => {
        const s = scene();
        expect(findStoryPreviewRowForSlot(s, "set", "dialog")).toBe("n1");
        expect(findStoryPreviewRowForSlot(s, "n1", "choice")).toBe("menu");
        expect(findStoryPreviewRowForSlot(s, "menu", "dialog")).toBe("a1");
        expect(findStoryPreviewRowForSlot(s, "s2", "nvl")).toBe("p1");
    });

    it("wraps to the top of the scene when nothing after the cursor shows it", () => {
        expect(findStoryPreviewRowForSlot(scene(), "last", "choice")).toBe("menu");
    });

    it("starts at the top of the scene without a cursor", () => {
        expect(findStoryPreviewRowForSlot(scene(), null, "dialog")).toBe("n1");
        expect(findStoryPreviewRowForSlot(scene(), null, "onStage")).toBe("n1");
    });

    it("passes over rows the game never plays and rows the author is not showing", () => {
        const s = makeScene([
            disabled(say("off")), say("hidden"), say("shown"), disabled(menu("offMenu", ["o"])), option("o", "offMenu", ["inside"]), say("inside", "o"),
        ], ["off", "hidden", "shown", "offMenu"]);
        expect(findStoryPreviewRowForSlot(s, null, "dialog", id => id !== "hidden")).toBe("shown");
        expect(findStoryPreviewRowForSlot(s, "offMenu", "dialog")).toBe("hidden");
        expect(findStoryPreviewRowForSlot(s, null, "choice")).toBeNull();
    });

    it("passes over a line with nothing to say", () => {
        const s = makeScene([line("silent", null, "  "), line("spoken")], ["silent", "spoken"]);
        expect(findStoryPreviewRowForSlot(s, null, "dialog")).toBe("spoken");
    });
});
