import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import { getContainerHeaderInfo, isContainerBlock } from "./storySceneBlockUtils";

function control(payload: Extract<StoryBlock, { kind: "control" }>["payload"]): StoryBlock {
    return { id: "b", kind: "control", parentId: null, childrenIds: [], payload };
}

function nodeAction(payload: Extract<StoryBlock, { kind: "nodeAction" }>["payload"]): StoryBlock {
    return { id: "b", kind: "nodeAction", parentId: null, childrenIds: [], payload };
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
