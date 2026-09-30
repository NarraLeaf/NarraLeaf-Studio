import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import { createBlockForCommand, dialogueSpeakerOf } from "./storyActionCommands";

let counter = 0;
const generateId = () => `id-${++counter}`;

function dialogueRow(speaker: { characterId?: string; speakerName?: string }): StoryBlock {
    return {
        id: "row",
        parentId: null,
        childrenIds: [],
        kind: "nodeAction",
        payload: {
            action: "dialogue",
            ...speaker,
            text: { textId: "row-text", role: "dialogue", value: "line" },
        },
    };
}

describe("dialogueSpeakerOf", () => {
    it("reads a bare name as a speaker in its own right", () => {
        expect(dialogueSpeakerOf(dialogueRow({ speakerName: "临时名" }))).toEqual({ speakerName: "临时名" });
    });

    it("prefers a character over a leftover name, the way the payload reads", () => {
        expect(dialogueSpeakerOf(dialogueRow({ characterId: "c1", speakerName: "stale" })))
            .toEqual({ characterId: "c1" });
    });

    it("answers nothing for a row that is not a line of speech", () => {
        const narration: StoryBlock = {
            id: "n", parentId: null, childrenIds: [], kind: "nodeAction",
            payload: { action: "narration", text: { textId: "n-text", role: "narration", value: "prose" } },
        };
        expect(dialogueSpeakerOf(narration)).toBeUndefined();
        expect(dialogueSpeakerOf(dialogueRow({}))).toBeUndefined();
    });
});

describe("createBlockForCommand: dialogue speakers", () => {
    /**
     * The continuation Enter creates. Before this, only the character id travelled, so pressing
     * Enter under a bare-name line produced a row with no speaker at all - it compiled to "Unknown"
     * and the dialogue box showed a different name from the line above it.
     */
    it("carries a bare name onto the row it builds", () => {
        const source = dialogueRow({ speakerName: "临时名" });
        const block = createBlockForCommand("dialogue", generateId, "", dialogueSpeakerOf(source));
        expect(block.kind === "nodeAction" && block.payload.action === "dialogue" && block.payload).toMatchObject({
            speakerName: "临时名",
        });
        expect(block.kind === "nodeAction" && block.payload.action === "dialogue" && block.payload.characterId)
            .toBeUndefined();
    });

    it("carries a character the same way", () => {
        const block = createBlockForCommand("dialogue", generateId, "", dialogueSpeakerOf(dialogueRow({ characterId: "c1" })));
        expect(block.kind === "nodeAction" && block.payload.action === "dialogue" && block.payload.characterId).toBe("c1");
        expect(block.kind === "nodeAction" && block.payload.action === "dialogue" && block.payload.speakerName)
            .toBeUndefined();
    });

    it("leaves both out when there is no speaker, so the row can take one", () => {
        const block = createBlockForCommand("dialogue", generateId, "hello");
        expect(block.kind === "nodeAction" && block.payload.action === "dialogue" && block.payload).toEqual({
            action: "dialogue",
            text: { textId: expect.any(String), role: "dialogue", value: "hello" },
        });
    });
});
