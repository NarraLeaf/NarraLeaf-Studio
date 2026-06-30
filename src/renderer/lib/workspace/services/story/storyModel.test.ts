import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import {
    createEmptyStoryDocument,
    createEmptyStoryLibraryIndex,
    deleteBlockFromScene,
    insertBlockInScene,
    moveBlockInScene,
    normalizeStoryDocument,
    normalizeStoryLibraryIndex,
    storyDocumentRelativePath,
    updateBlockPayload,
} from "./storyModel";

const STORY_ID_1 = "00000000-0000-4000-8000-000000000001";
const STORY_ID_2 = "00000000-0000-4000-8000-000000000002";
const STORY_ID_3 = "00000000-0000-4000-8000-000000000003";

let nextFactoryBase = 1000;

function idFactory(_prefix = "id") {
    let next = nextFactoryBase;
    nextFactoryBase += 1000;
    return () => `00000000-0000-4000-8000-${(++next).toString(16).padStart(12, "0")}`;
}

function narrationBlock(id: string, textId: string, value: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {
            action: "narration",
            text: {
                textId,
                role: "narration",
                value,
            },
        },
    };
}

describe("storyModel", () => {
    it("creates an empty library without forcing a story document", () => {
        const index = createEmptyStoryLibraryIndex("2026-06-08T00:00:00.000Z");

        expect(index.schemaVersion).toBe(1);
        expect(index.stories).toEqual([]);
        expect(index.defaultStoryId).toBeUndefined();
    });

    it("creates independent story documents and paths", () => {
        const ids = idFactory("story-a");
        const first = createEmptyStoryDocument({
            id: STORY_ID_1,
            name: "First",
            now: "2026-06-08T00:00:00.000Z",
            generateId: ids,
        });
        const second = createEmptyStoryDocument({
            id: STORY_ID_2,
            name: "Second",
            now: "2026-06-08T00:00:00.000Z",
            generateId: idFactory("story-b"),
        });

        expect(first.id).toBe(STORY_ID_1);
        expect(second.id).toBe(STORY_ID_2);
        expect(storyDocumentRelativePath(first.id)).toBe(`editor/story/stories/${STORY_ID_1}/storydoc.json`);
        expect(storyDocumentRelativePath(second.id)).toBe(`editor/story/stories/${STORY_ID_2}/storydoc.json`);
        expect(first.entrySceneId).not.toBe(second.entrySceneId);
    });

    it("keeps only UUID story ids and canonical document paths in the library index", () => {
        const now = "2026-06-08T00:00:00.000Z";
        const index = {
            schemaVersion: 1 as const,
            defaultStoryId: "story-1",
            stories: [
                {
                    id: "story-1",
                    name: "Legacy",
                    documentPath: "../../outside.json",
                    createdAt: now,
                    updatedAt: now,
                },
                {
                    id: STORY_ID_1,
                    name: "Safe",
                    documentPath: "/tmp/outside.json",
                    createdAt: now,
                    updatedAt: now,
                },
                {
                    id: STORY_ID_1,
                    name: "Duplicate",
                    documentPath: `editor/story/stories/${STORY_ID_1}/duplicate.json`,
                    createdAt: now,
                    updatedAt: now,
                },
            ],
        };

        const normalized = normalizeStoryLibraryIndex(index, now);

        expect(normalized.defaultStoryId).toBeUndefined();
        expect(normalized.stories.map(story => story.id)).toEqual([STORY_ID_1]);
        expect(normalized.stories[0]?.documentPath).toBe(`editor/story/stories/${STORY_ID_1}/storydoc.json`);
    });

    it("rejects unsafe story ids before building document paths", () => {
        expect(() => storyDocumentRelativePath("story-1")).toThrow(/UUID v4/);
        expect(() => storyDocumentRelativePath("../story")).toThrow(/UUID v4/);
    });

    it("rejects future story schemas", () => {
        const index = createEmptyStoryLibraryIndex("2026-06-08T00:00:00.000Z") as any;
        index.schemaVersion = 99;
        expect(() => normalizeStoryLibraryIndex(index, "2026-06-08T00:00:00.000Z")).toThrow(/newer/);

        const document = createEmptyStoryDocument({
            id: STORY_ID_1,
            name: "Story",
            now: "2026-06-08T00:00:00.000Z",
            generateId: idFactory(),
        }) as any;
        document.schemaVersion = 99;
        expect(() => normalizeStoryDocument(document, "2026-06-08T00:00:00.000Z")).toThrow(/newer/);
    });

    it("keeps block trees legal when inserting, moving, and deleting blocks", () => {
        const document = createEmptyStoryDocument({
            id: STORY_ID_1,
            name: "Story",
            now: "2026-06-08T00:00:00.000Z",
            generateId: idFactory(),
        });
        const scene = document.scenes[document.entrySceneId!];
        const choice: StoryBlock = {
            id: "choice",
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: {
                action: "choice",
                prompt: {
                    textId: "prompt-text",
                    role: "choicePrompt",
                    value: "Pick one",
                },
            },
        };
        const option = {
            id: "option",
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: {
                action: "choiceOption",
                text: {
                    textId: "option-text",
                    role: "choiceText",
                    value: "Stay",
                },
            },
        } satisfies StoryBlock;
        const line = narrationBlock("line", "line-text", "Stayed.");

        insertBlockInScene(scene, choice, { parentId: null });
        insertBlockInScene(scene, option, { parentId: "choice" });
        insertBlockInScene(scene, line, { parentId: "option" });

        expect(scene.rootBlockIds).toEqual(["choice"]);
        expect(scene.blocks.choice.childrenIds).toEqual(["option"]);
        expect(scene.blocks.option.childrenIds).toEqual(["line"]);

        moveBlockInScene(scene, "line", { parentId: null });
        expect(scene.rootBlockIds).toEqual(["choice", "line"]);
        expect(scene.blocks.line.parentId).toBeNull();
        expect(scene.blocks.option.childrenIds).toEqual([]);

        deleteBlockFromScene(scene, "choice");
        expect(scene.rootBlockIds).toEqual(["line"]);
        expect(scene.blocks.choice).toBeUndefined();
        expect(scene.blocks.option).toBeUndefined();
        expect(scene.blocks.line).toBeDefined();
    });

    it("preserves text ids when text payload changes", () => {
        const document = createEmptyStoryDocument({
            id: STORY_ID_2,
            name: "Story",
            now: "2026-06-08T00:00:00.000Z",
            generateId: idFactory(),
        });
        const scene = document.scenes[document.entrySceneId!];
        insertBlockInScene(scene, narrationBlock("line", "stable-text", "Before"), { parentId: null });

        updateBlockPayload(scene, "line", {
            action: "narration",
            text: {
                textId: "new-text-id",
                role: "narration",
                value: "After",
            },
        });

        const block = scene.blocks.line;
        expect(block.kind).toBe("nodeAction");
        if (block.kind === "nodeAction" && block.payload.action === "narration") {
            expect(block.payload.text.value).toBe("After");
            expect(block.payload.text.textId).toBe("stable-text");
        }
    });

    it("does not allow jump blocks to own children", () => {
        const document = createEmptyStoryDocument({
            id: STORY_ID_3,
            name: "Story",
            now: "2026-06-08T00:00:00.000Z",
            generateId: idFactory(),
        });
        const scene = document.scenes[document.entrySceneId!];
        const jump: StoryBlock = {
            id: "jump",
            kind: "jump",
            parentId: null,
            childrenIds: ["illegal"],
            payload: {
                targetSceneId: "target-scene",
            },
        };

        expect(() => insertBlockInScene(scene, jump, { parentId: null })).toThrow(/Jump/);
    });
});
