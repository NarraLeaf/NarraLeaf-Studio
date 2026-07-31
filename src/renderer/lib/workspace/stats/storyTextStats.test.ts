import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { countBlockWords, countSceneTextStats } from "./storyTextStats";

function nodeAction(id: string, payload: StoryBlock["payload"]): StoryBlock {
    return { id, kind: "nodeAction", parentId: null, childrenIds: [], payload } as StoryBlock;
}

const narration = (id: string, value: string) =>
    nodeAction(id, { action: "narration", text: { textId: `${id}-t`, role: "narration", value } });

const dialogue = (id: string, value: string) =>
    nodeAction(id, { action: "dialogue", text: { textId: `${id}-t`, role: "dialogue", value } });

const choice = (id: string, prompt?: string) =>
    nodeAction(id, {
        action: "choice",
        ...(prompt === undefined
            ? {}
            : { prompt: { textId: `${id}-t`, role: "choicePrompt", value: prompt } }),
    });

const choiceOption = (id: string, value: string) =>
    nodeAction(id, { action: "choiceOption", text: { textId: `${id}-t`, role: "choiceText", value } });

function sceneOf(blocks: StoryBlock[]): StoryScene {
    return {
        id: "s",
        name: "S",
        runtimeName: "s",
        rootBlockIds: blocks.map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

describe("countBlockWords", () => {
    it("counts every kind of text the player reads", () => {
        expect(countBlockWords(narration("n", "the rain kept on"))).toBe(4);
        expect(countBlockWords(dialogue("d", "we should go"))).toBe(3);
        // The regression this exists for: choice text is authored prose the player reads, and it
        // used to count as nothing at all - so a day spent writing branches read as a day off.
        expect(countBlockWords(choice("c", "what now?"))).toBe(2);
        expect(countBlockWords(choiceOption("o", "stay a while longer"))).toBe(4);
    });

    it("counts a promptless choice as no words rather than crashing on the missing segment", () => {
        expect(countBlockWords(choice("c"))).toBe(0);
    });

    it("ignores blocks that carry machinery instead of prose", () => {
        const declaration: StoryBlock = {
            id: "decl",
            kind: "declaration",
            parentId: null,
            childrenIds: [],
            payload: { scope: "scene", name: "trust", valueType: "number", defaultValue: 0, storageKey: "trust" },
        };
        expect(countBlockWords(declaration)).toBe(0);
    });
});

describe("countSceneTextStats", () => {
    it("sums a branch's prose and counts one line per block", () => {
        const stats = countSceneTextStats(
            sceneOf([
                narration("n", "the door opened"),
                choice("c", "what now?"),
                choiceOption("o1", "step inside"),
                choiceOption("o2", "turn back"),
            ]),
        );
        expect(stats.words).toBe(3 + 2 + 2 + 2);
        expect(stats.lines).toBe(4);
    });

    it("counts CJK by character, matching what an author counting 字 expects", () => {
        expect(countSceneTextStats(sceneOf([choiceOption("o", "留下来")])).words).toBe(3);
    });
});
