import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { buildVisibleRows, getContainerHeaderInfo, isContainerBlock, nextSelectionAfterDelete } from "./storySceneBlockUtils";

function control(payload: Extract<StoryBlock, { kind: "control" }>["payload"]): StoryBlock {
    return { id: "b", kind: "control", parentId: null, childrenIds: [], payload };
}

function nodeAction(payload: Extract<StoryBlock, { kind: "nodeAction" }>["payload"]): StoryBlock {
    return { id: "b", kind: "nodeAction", parentId: null, childrenIds: [], payload };
}

function narration(id: string, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind: "nodeAction", parentId, childrenIds, payload: { action: "narration", text: { textId: `${id}-t`, role: "narration", value: id } } };
}

function group(id: string, childrenIds: string[]): StoryBlock {
    return { id, kind: "control", parentId: null, childrenIds, payload: { control: "sequence", mode: "do" } };
}

/** A scene with just the fields the row helpers read. */
function scene(blocks: StoryBlock[], rootBlockIds: string[]): StoryScene {
    return { blocks: Object.fromEntries(blocks.map(block => [block.id, block])), rootBlockIds } as unknown as StoryScene;
}

describe("isContainerBlock", () => {
    it("is true for control, choice, choiceOption, and nvl", () => {
        expect(isContainerBlock(control({ control: "condition" }))).toBe(true);
        expect(isContainerBlock(nodeAction({ action: "choice" }))).toBe(true);
        expect(isContainerBlock(nodeAction({ action: "choiceOption", text: { textId: "t", role: "choiceText", value: "" } }))).toBe(true);
        expect(isContainerBlock({ id: "b", kind: "action", parentId: null, childrenIds: [], payload: { action: "nvl" } })).toBe(true);
    });

    it("is false for plain actions and narration", () => {
        expect(isContainerBlock(nodeAction({ action: "narration", text: { textId: "t", role: "narration", value: "hi" } }))).toBe(false);
        expect(isContainerBlock(undefined)).toBe(false);
    });
});

describe("getContainerHeaderInfo", () => {
    it("labels condition branches in plain language and flags which carry a condition", () => {
        expect(getContainerHeaderInfo(control({ control: "conditionBranch", branch: "if" }))).toMatchObject({ pill: "If", role: "branch", hasCondition: true });
        expect(getContainerHeaderInfo(control({ control: "conditionBranch", branch: "elseIf" }))).toMatchObject({ pill: "Else if", hasCondition: true });
        expect(getContainerHeaderInfo(control({ control: "conditionBranch", branch: "else" }))).toMatchObject({ pill: "Otherwise", hasCondition: false });
    });

    it("exposes the repeat count on repeat groups", () => {
        expect(getContainerHeaderInfo(control({ control: "repeat", times: 3 }))).toMatchObject({ pill: "Repeat", role: "group", repeatTimes: 3 });
    });

    it("labels the remaining group kinds and menu containers", () => {
        expect(getContainerHeaderInfo(control({ control: "parallel", mode: "all" }))?.role).toBe("group");
        expect(getContainerHeaderInfo(control({ control: "race", mode: "any" }))?.role).toBe("group");
        expect(getContainerHeaderInfo(control({ control: "sequence", mode: "do" }))?.role).toBe("group");
        expect(getContainerHeaderInfo(nodeAction({ action: "choice" }))).toMatchObject({ pill: "Menu", role: "menu" });
    });

    it("returns null for non-container blocks", () => {
        expect(getContainerHeaderInfo(nodeAction({ action: "narration", text: { textId: "t", role: "narration", value: "hi" } }))).toBeNull();
    });
});

describe("nextSelectionAfterDelete", () => {
    const flat = scene(
        ["r1", "r2", "r3", "r4"].map(id => narration(id)),
        ["r1", "r2", "r3", "r4"],
    );
    const flatRows = buildVisibleRows(flat, new Set());

    it("lands on the previous row when a middle or last row is deleted", () => {
        expect(nextSelectionAfterDelete(flat, flatRows, ["r2"])).toBe("r1");
        expect(nextSelectionAfterDelete(flat, flatRows, ["r4"])).toBe("r3");
    });

    it("lands on the first survivor below when the top row(s) go", () => {
        expect(nextSelectionAfterDelete(flat, flatRows, ["r1"])).toBe("r2");
        expect(nextSelectionAfterDelete(flat, flatRows, ["r1", "r2"])).toBe("r3");
    });

    it("returns null when every row is deleted", () => {
        expect(nextSelectionAfterDelete(flat, flatRows, ["r1", "r2", "r3", "r4"])).toBeNull();
    });

    it("treats a deleted container's descendants as gone, landing above the container", () => {
        const nested = scene(
            [narration("top"), group("grp", ["g1", "g2"]), narration("g1", "grp"), narration("g2", "grp"), narration("after")],
            ["top", "grp", "after"],
        );
        const rows = buildVisibleRows(nested, new Set());
        // Deleting the container removes g1/g2 too, so the landing is the row above it, not a child.
        expect(nextSelectionAfterDelete(nested, rows, ["grp"])).toBe("top");
        // Deleting a child lands on its previous visible row.
        expect(nextSelectionAfterDelete(nested, rows, ["g2"])).toBe("g1");
    });

    it("skips a deleted top container's descendants to the first true survivor below", () => {
        const nested = scene(
            [group("grp", ["g1"]), narration("g1", "grp"), narration("after")],
            ["grp", "after"],
        );
        const rows = buildVisibleRows(nested, new Set());
        // grp is first and g1 is its (also-deleted) descendant, so the survivor is `after`.
        expect(nextSelectionAfterDelete(nested, rows, ["grp"])).toBe("after");
    });
});
