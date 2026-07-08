import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import {
    createEmptyStoryAnimationIndex,
    createEmptyStoryDocument,
    createEmptyStoryLibraryIndex,
    deleteBlockFromScene,
    insertBlockInScene,
    moveBlockInScene,
    normalizeStoryAnimationAsset,
    normalizeStoryAnimationIndex,
    normalizeStoryDocument,
    normalizeStoryLibraryIndex,
    storyAnimationDocumentRelativePath,
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

    it("normalizes the hidden story animation index to canonical asset paths", () => {
        const now = "2026-06-08T00:00:00.000Z";
        const empty = createEmptyStoryAnimationIndex(now);
        const index = {
            schemaVersion: 1 as const,
            animations: [
                {
                    id: "motion-1",
                    name: "Legacy",
                    targetKind: "character",
                    documentPath: "../../outside.json",
                    createdAt: now,
                    updatedAt: now,
                },
                {
                    id: STORY_ID_1,
                    name: "",
                    targetKind: "bad",
                    documentPath: "/tmp/outside.json",
                    createdAt: now,
                    updatedAt: now,
                },
                {
                    id: STORY_ID_1,
                    name: "Duplicate",
                    targetKind: "image",
                    documentPath: `editor/story/animations/${STORY_ID_1}.json`,
                    createdAt: now,
                    updatedAt: now,
                },
            ],
        };

        const normalized = normalizeStoryAnimationIndex(index as any, now);

        expect(empty.animations).toEqual([]);
        expect(storyAnimationDocumentRelativePath(STORY_ID_1)).toBe(`editor/story/animations/${STORY_ID_1}.json`);
        expect(normalized.animations).toEqual([
            expect.objectContaining({
                id: STORY_ID_1,
                name: "Untitled Motion",
                targetKind: "image",
                documentPath: `editor/story/animations/${STORY_ID_1}.json`,
            }),
        ]);
    });

    it("normalizes story animation assets without leaking unsupported sequence fields", () => {
        const now = "2026-06-08T00:00:00.000Z";
        const normalized = normalizeStoryAnimationAsset({
            schemaVersion: 1,
            id: STORY_ID_2,
            name: "",
            targetKind: "bad",
            sequences: [
                {
                    id: "",
                    props: {
                        position: {
                            xalign: 0.25,
                            yalign: "bad",
                            xoffset: 12,
                        },
                        opacity: "bad",
                        zoom: 0.9,
                        filter: "blur(2px)",
                    },
                    options: {
                        durationMs: -1,
                        delayMs: 50,
                        easing: "easeOut",
                        at: "+120",
                    },
                    unknown: true,
                },
            ],
            config: {
                repeat: 0,
                repeatDelayMs: -20,
            },
        } as any, now);

        expect(normalized.name).toBe("Untitled Motion");
        expect(normalized.targetKind).toBe("image");
        expect(normalized.config).toEqual({});
        expect(normalized.sequences).toEqual([
            {
                id: "step-1",
                props: {
                    position: {
                        xalign: 0.25,
                        xoffset: 12,
                    },
                    zoom: 0.9,
                    filter: "blur(2px)",
                },
                options: {
                    durationMs: undefined,
                    delayMs: 50,
                    easing: "easeOut",
                    at: "+120",
                },
            },
        ]);
        const positionTrack = normalized.timeline?.tracks.find(track => track.property === "position");
        const zoomTrack = normalized.timeline?.tracks.find(track => track.property === "zoom");
        expect(normalized.timeline?.fps).toBeUndefined();
        expect(positionTrack?.keyframes).toEqual([
            expect.objectContaining({
                timeMs: 470,
                value: {
                    xalign: 0.25,
                    xoffset: 12,
                },
                easing: "easeOut",
            }),
        ]);
        expect(zoomTrack?.keyframes).toEqual([
            expect.objectContaining({
                timeMs: 470,
                value: 0.9,
            }),
        ]);
    });

    it("keeps keyframe timelines as the canonical story animation editor model", () => {
        const now = "2026-06-08T00:00:00.000Z";
        const normalized = normalizeStoryAnimationAsset({
            schemaVersion: 1,
            id: STORY_ID_2,
            name: "Slide",
            targetKind: "character",
            sequences: [],
            timeline: {
                durationMs: 500,
                tracks: [
                    {
                        id: "",
                        property: "position",
                        keyframes: [
                            {
                                id: "",
                                timeMs: 500,
                                value: {
                                    xalign: 0.5,
                                    yalign: 0.55,
                                    xoffset: -80,
                                    bad: true,
                                },
                                easing: "easeOut",
                            },
                        ],
                    },
                    {
                        id: "bad",
                        property: "unknown",
                        keyframes: [{ id: "bad", timeMs: 200, value: 1 }],
                    },
                ],
            },
        } as any, now);

        expect(normalized.timeline).toEqual({
            durationMs: 500,
            tracks: [
                {
                    id: "track-position-1",
                    property: "position",
                    keyframes: [
                        {
                            id: "kf-position-500-1",
                            timeMs: 500,
                            value: {
                                xalign: 0.5,
                                yalign: 0.55,
                                xoffset: -80,
                            },
                            easing: "easeOut",
                        },
                    ],
                },
            ],
        });
    });

    it("rejects unsafe story ids before building document paths", () => {
        expect(() => storyDocumentRelativePath("story-1")).toThrow(/UUID v4/);
        expect(() => storyDocumentRelativePath("../story")).toThrow(/UUID v4/);
        expect(() => storyAnimationDocumentRelativePath("motion-1")).toThrow(/UUID v4/);
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

    it("preserves dialogue pause and displayable effect fields through normalization", () => {
        const now = "2026-06-08T00:00:00.000Z";
        const document = createEmptyStoryDocument({
            id: STORY_ID_1,
            name: "Story",
            now,
            generateId: idFactory(),
        });
        const scene = document.scenes[document.entrySceneId!];
        insertBlockInScene(scene, {
            id: "say",
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: {
                action: "dialogue",
                characterId: "char-1",
                pauseAfter: 400,
                text: { textId: "t1", role: "dialogue", value: "Hi" },
            },
        }, { parentId: null });
        insertBlockInScene(scene, {
            id: "fx",
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: {
                action: "displayable",
                operation: "wipe",
                target: { name: "hero", kind: "image" },
                durationMs: 500,
                easing: "easeOut",
                effectProps: { direction: "right", reverse: true },
            },
        }, { parentId: null });

        const normalized = normalizeStoryDocument(document, now);
        const normalizedScene = normalized.scenes[document.entrySceneId!];

        expect((normalizedScene.blocks.say.payload as any).pauseAfter).toBe(400);
        expect((normalizedScene.blocks.fx.payload as any).operation).toBe("wipe");
        expect((normalizedScene.blocks.fx.payload as any).effectProps).toEqual({ direction: "right", reverse: true });
        expect((normalizedScene.blocks.fx.payload as any).durationMs).toBe(500);
    });

    it("migrates legacy image/text layerName strings to stable layer refs (v2 → v3)", () => {
        const now = "2026-06-08T00:00:00.000Z";
        const document = createEmptyStoryDocument({
            id: STORY_ID_1,
            name: "Story",
            now,
            generateId: idFactory(),
        });
        const scene = document.scenes[document.entrySceneId!];
        insertBlockInScene(scene, {
            id: "layer-block",
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: { action: "layer", operation: "create", objectName: "Foreground", zIndex: 2 },
        }, { parentId: null });
        insertBlockInScene(scene, {
            id: "img-bound",
            kind: "action",
            parentId: null,
            childrenIds: [],
            // Legacy free-text layer name matching the layer block (case-insensitively).
            payload: { action: "image", operation: "create", objectName: "hero", layerName: "foreground" },
        } as unknown as StoryBlock, { parentId: null });
        insertBlockInScene(scene, {
            id: "text-orphan",
            kind: "action",
            parentId: null,
            childrenIds: [],
            // Legacy layer name with no matching layer block — keeps the last-known name only.
            payload: { action: "text", operation: "create", objectName: "caption", layerName: "ghost" },
        } as unknown as StoryBlock, { parentId: null });
        (document as { schemaVersion: number }).schemaVersion = 2;

        const normalized = normalizeStoryDocument(document, now);
        const migratedScene = normalized.scenes[document.entrySceneId!];

        expect(normalized.schemaVersion).toBe(3);
        expect((migratedScene.blocks["img-bound"].payload as Record<string, unknown>).layerName).toBeUndefined();
        expect((migratedScene.blocks["img-bound"].payload as Record<string, unknown>).layer).toEqual({
            kind: "custom",
            sourceBlockId: "layer-block",
            name: "foreground",
        });
        expect((migratedScene.blocks["text-orphan"].payload as Record<string, unknown>).layer).toEqual({
            kind: "custom",
            name: "ghost",
        });
    });

    it("preserves rich text runs through normalization", () => {
        const now = "2026-06-08T00:00:00.000Z";
        const document = createEmptyStoryDocument({
            id: STORY_ID_2,
            name: "Story",
            now,
            generateId: idFactory(),
        });
        const scene = document.scenes[document.entrySceneId!];
        insertBlockInScene(scene, {
            id: "say",
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: {
                action: "dialogue",
                text: {
                    textId: "t",
                    role: "dialogue",
                    value: "Hi there",
                    rich: [{ text: "Hi " }, { text: "there", marks: { bold: true } }],
                },
            },
        }, { parentId: null });

        const normalized = normalizeStoryDocument(document, now);

        expect((normalized.scenes[document.entrySceneId!].blocks.say.payload as any).text.rich)
            .toEqual([{ text: "Hi " }, { text: "there", marks: { bold: true } }]);
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
