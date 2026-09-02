import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument, StoryExpr, StoryLibraryIndex, StoryVariableRef } from "@shared/types/story";
import { isStoryExpressionEvaluable, storyVariableRefKey, STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import {
    findStoryDocumentTooNewError,
    findStoryDocumentTooOldError,
    StoryDocumentTooNewError,
    StoryDocumentTooOldError,
} from "@shared/story/migrateStoryDocument";
import {
    bindRowsToCharacter,
    collectInvalidBlocks,
    collectRowsSpokenBy,
    collectTempSpeakers,
    collectUnresolvedSpeakerRows,
    narrowToOneUnresolvedSpeaker,
    createEmptyStoryAnimationIndex,
    createEmptyStoryDocument,
    createEmptyStoryLibraryIndex,
    deleteBlockFromScene,
    insertBlockInScene,
    isBlockDisabled,
    migrateStoryDocumentToLatest,
    moveBlockInScene,
    normalizeStoryAnimationAsset,
    normalizeStoryAnimationIndex,
    normalizeStoryDocument,
    normalizeStoryLibraryIndex,
    promoteTempSpeaker,
    rebindSpeakersInBlocks,
    setRowsSpeakerName,
    STORY_DOCUMENT_MIN_SUPPORTED_VERSION,
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

        expect(index.schemaVersion).toBe(2);
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
        // Version 1, which is also what makes this the migration test: an index written before the
        // entries could name a DLC is read, and comes back stamped at the version that was read.
        const index = {
            schemaVersion: 1 as unknown as StoryLibraryIndex["schemaVersion"],
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

        expect(normalized.schemaVersion).toBe(2);
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

    it("keeps a camera motion filed under the camera", () => {
        // The fallback for an unknown kind is `image`, so a motion target kind that is not on the
        // normalizer's list is not rejected - it is silently reassigned, and the author's camera shot
        // shows up in every sprite's motion picker instead. Hence a test naming the kind directly.
        const normalized = normalizeStoryAnimationAsset({
            schemaVersion: 1,
            id: STORY_ID_2,
            name: "Camera shake",
            targetKind: "camera",
            sequences: [],
        } as any, "2026-07-29T00:00:00.000Z");

        expect(normalized.targetKind).toBe("camera");
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

    it("drops the axes a position keyframe never wrote instead of writing them as undefined", () => {
        // An unwritten axis has to be ABSENT, not present-and-undefined. Every preset moves offsets
        // and leaves alignment alone, and a `{xalign: undefined}` key wins the `{...neutral,
        // ...keyframe}` merge the stage preview does - which produced `calc(NaN% + 0px)`, a
        // declaration the browser discards, dropping the preview frame into the stage's corner.
        // `toEqual` cannot see the difference (it ignores undefined-valued keys), hence `Object.keys`.
        const normalized = normalizeStoryAnimationAsset({
            schemaVersion: 1,
            id: STORY_ID_2,
            name: "Camera shake",
            targetKind: "camera",
            sequences: [],
            timeline: {
                tracks: [
                    {
                        id: "track-position",
                        property: "position",
                        keyframes: [{ id: "kf-0", timeMs: 70, value: { xoffset: -12, yoffset: 7 }, easing: "easeOut" }],
                    },
                ],
            },
        } as any, "2026-08-18T00:00:00.000Z");

        const value = normalized.timeline?.tracks[0].keyframes[0].value as Record<string, number>;
        expect(Object.keys(value).sort()).toEqual(["xoffset", "yoffset"]);
        expect(value).toStrictEqual({ xoffset: -12, yoffset: 7 });
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

    it("preserves a legacy dialogue key and displayable effect fields through normalization", () => {
        const now = "2026-06-08T00:00:00.000Z";
        const document = createEmptyStoryDocument({
            id: STORY_ID_1,
            name: "Story",
            now,
            generateId: idFactory(),
        });
        const scene = document.scenes[document.entrySceneId!];
        // `pauseAfter` left the dialogue payload when the engine dropped the sentence config
        // field it fed, and the schema version was deliberately not bumped along with it - so a
        // document written before that still carries the key. Cast, because the type no longer
        // admits it; the assertion below is what the decision not to migrate actually means.
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
        } as unknown as StoryBlock, { parentId: null });
        insertBlockInScene(scene, {
            id: "fx",
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: {
                action: "displayable",
                operation: "transform",
                target: { name: "hero", kind: "image" },
                transform: { mode: "props", clipReveal: { kind: "wipe", direction: "right", reverse: true }, durationMs: 500, easing: "easeOut" },
            },
        }, { parentId: null });

        const normalized = normalizeStoryDocument(document, now);
        const normalizedScene = normalized.scenes[document.entrySceneId!];

        // Carried, not read: nothing in Studio or the engine consults it any more.
        expect((normalizedScene.blocks.say.payload as any).pauseAfter).toBe(400);
        expect((normalizedScene.blocks.fx.payload as any).transform.clipReveal).toEqual({ kind: "wipe", direction: "right", reverse: true });
        expect((normalizedScene.blocks.fx.payload as any).transform.durationMs).toBe(500);
    });

    it("keeps a scene's audio track through normalization, even one no track list has", () => {
        const now = "2026-06-08T00:00:00.000Z";
        const document = createEmptyStoryDocument({ id: STORY_ID_1, name: "Story", now, generateId: idFactory() });
        const scene = document.scenes[document.entrySceneId!];
        // A deleted track's id, which is the case that matters: references are NOT rewritten when a
        // track goes away, they resolve to the bus's built-in - so dropping the id here would erase
        // the author's choice the moment they deleted a track they meant to re-create.
        scene.bgm = { assetId: "asset-theme", audioTrackId: "  t_gone  ", volume: 0.5 };

        const normalized = normalizeStoryDocument(document, now);

        expect(normalized.scenes[document.entrySceneId!].bgm).toMatchObject({
            assetId: "asset-theme",
            audioTrackId: "t_gone",
            volume: 0.5,
        });
    });

    it("writes no audio track key when the scene names none", () => {
        const now = "2026-06-08T00:00:00.000Z";
        const document = createEmptyStoryDocument({ id: STORY_ID_1, name: "Story", now, generateId: idFactory() });
        document.scenes[document.entrySceneId!].bgm = { assetId: "asset-theme" };

        const normalized = normalizeStoryDocument(document, now);

        expect(normalized.scenes[document.entrySceneId!].bgm).not.toHaveProperty("audioTrackId");
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

describe("collectInvalidBlocks", () => {
    function documentWith(blocks: StoryBlock[]) {
        const document = createEmptyStoryDocument({
            id: STORY_ID_1,
            name: "My Story",
            now: "2026-07-16T00:00:00.000Z",
            generateId: idFactory(),
        });
        const scene = Object.values(document.scenes)[0];
        for (const block of blocks) {
            scene.blocks[block.id] = block;
            scene.rootBlockIds.push(block.id);
        }
        return document;
    }

    function invalidBlock(id: string, source: string): StoryBlock {
        return { id, kind: "invalid", parentId: null, childrenIds: [], payload: { source } };
    }

    it("finds nothing in a story that has none", () => {
        const document = documentWith([narrationBlock("n1", "t1", "Hello")]);
        expect(collectInvalidBlocks(document)).toEqual([]);
    });

    it("reports each invalid block with the text the author typed and where it lives", () => {
        const document = documentWith([
            narrationBlock("n1", "t1", "Hello"),
            invalidBlock("bad", "/bgg forest"),
        ]);
        const scene = Object.values(document.scenes)[0];

        expect(collectInvalidBlocks(document)).toEqual([
            {
                storyId: STORY_ID_1,
                storyName: "My Story",
                sceneId: scene.id,
                sceneName: scene.name,
                blockId: "bad",
                source: "/bgg forest",
            },
        ]);
    });

    it("finds every one of them, not just the first", () => {
        const document = documentWith([invalidBlock("bad1", "/bgg"), invalidBlock("bad2", "#")]);
        expect(collectInvalidBlocks(document).map(ref => ref.blockId)).toEqual(["bad1", "bad2"]);
    });

    it("does not gate the build on a disabled invalid row (schema v7)", () => {
        const document = documentWith([{ ...invalidBlock("bad", "/bgg"), disabled: true }]);
        expect(collectInvalidBlocks(document)).toEqual([]);
    });

    it("does not gate the build on an invalid row nested under a disabled container", () => {
        const document = documentWith([
            { id: "grp", kind: "control", parentId: null, childrenIds: ["bad"], disabled: true, payload: { control: "sequence", mode: "do" } },
            { ...invalidBlock("bad", "/bgg"), parentId: "grp" },
        ]);
        const scene = Object.values(document.scenes)[0];
        expect(isBlockDisabled(scene, scene.blocks.bad)).toBe(true);
        expect(collectInvalidBlocks(document)).toEqual([]);
    });
});

describe("temp speakers", () => {
    function dialogue(id: string, payload: { characterId?: string; speakerName?: string }): StoryBlock {
        return {
            id,
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: {
                action: "dialogue",
                ...payload,
                text: { textId: `t-${id}`, role: "dialogue", value: "Hi" },
            },
        };
    }

    function documentWith(blocks: StoryBlock[]) {
        const document = createEmptyStoryDocument({
            id: STORY_ID_1,
            name: "My Story",
            now: "2026-07-16T00:00:00.000Z",
            generateId: idFactory(),
        });
        const scene = Object.values(document.scenes)[0];
        for (const block of blocks) {
            scene.blocks[block.id] = block;
            scene.rootBlockIds.push(block.id);
        }
        return document;
    }

    it("groups every line under the name that speaks it", () => {
        const document = documentWith([
            dialogue("a", { speakerName: "Alice" }),
            dialogue("b", { speakerName: "Bob" }),
            dialogue("c", { speakerName: "Alice" }),
        ]);

        expect(collectTempSpeakers(document)).toEqual([
            { name: "Alice", blockIds: ["a", "c"] },
            { name: "Bob", blockIds: ["b"] },
        ]);
    });

    it("ignores lines that already have a real character", () => {
        const document = documentWith([dialogue("a", { characterId: "char-alice", speakerName: "Stale" })]);
        expect(collectTempSpeakers(document)).toEqual([]);
    });

    it("ignores blank names, which cannot be spoken by anyone", () => {
        const document = documentWith([dialogue("a", { speakerName: "   " }), dialogue("b", {})]);
        expect(collectTempSpeakers(document)).toEqual([]);
    });

    it("retires a temp speaker once nothing references it", () => {
        const document = documentWith([dialogue("a", { speakerName: "Alice" })]);
        const scene = Object.values(document.scenes)[0];

        deleteBlockFromScene(scene, "a");

        expect(collectTempSpeakers(document)).toEqual([]);
    });

    it("rebinds every line of a promoted speaker and drops the bare name", () => {
        const document = documentWith([
            dialogue("a", { speakerName: "Alice" }),
            dialogue("b", { speakerName: "Bob" }),
            dialogue("c", { speakerName: "Alice" }),
        ]);
        const scene = Object.values(document.scenes)[0];

        expect(promoteTempSpeaker(document, "Alice", "char-new")).toBe(2);

        for (const id of ["a", "c"]) {
            const payload = scene.blocks[id].payload as Record<string, unknown>;
            expect(payload.characterId).toBe("char-new");
            expect(payload.speakerName).toBeUndefined();
        }
        // Bob is a different speaker and must not be swept up.
        expect(collectTempSpeakers(document)).toEqual([{ name: "Bob", blockIds: ["b"] }]);
    });

    it("does not touch lines already bound to a character", () => {
        const document = documentWith([dialogue("a", { characterId: "char-existing", speakerName: "Alice" })]);
        const scene = Object.values(document.scenes)[0];

        expect(promoteTempSpeaker(document, "Alice", "char-new")).toBe(0);
        expect((scene.blocks["a"].payload as Record<string, unknown>).characterId).toBe("char-existing");
    });
});

describe("repairing a row's speaker", () => {
    const KNOWN = new Set(["char-alice", "char-bob"]);

    function dialogue(id: string, payload: { characterId?: string; speakerName?: string }): StoryBlock {
        return {
            id,
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: {
                action: "dialogue",
                ...payload,
                text: { textId: `t-${id}`, role: "dialogue", value: "Hi" },
            },
        };
    }

    /** A character's stage row, which carries an id and has no bare-name arm to degrade to. */
    function characterEnter(id: string, characterId: string): StoryBlock {
        return {
            id,
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: { action: "character", operation: "enter", characterId },
        };
    }

    /** One document, one scene per array of blocks, in the order given. */
    function documentWithScenes(...sceneBlocks: StoryBlock[][]): StoryDocument {
        const document = createEmptyStoryDocument({
            id: STORY_ID_1,
            name: "My Story",
            now: "2026-08-20T00:00:00.000Z",
            generateId: idFactory(),
        });
        const [first] = Object.values(document.scenes);
        sceneBlocks.forEach((blocks, index) => {
            const scene = index === 0 ? first : { ...first, id: `scene-${index + 1}`, blocks: {}, rootBlockIds: [] };
            document.scenes[scene.id] = scene;
            for (const block of blocks) {
                scene.blocks[block.id] = block;
                scene.rootBlockIds.push(block.id);
            }
        });
        return document;
    }

    function payloadOf(document: StoryDocument, blockId: string): Record<string, unknown> {
        for (const scene of Object.values(document.scenes)) {
            if (scene.blocks[blockId]) {
                return scene.blocks[blockId].payload as Record<string, unknown>;
            }
        }
        throw new Error(`No block ${blockId}`);
    }

    /** What `StoryService.updateBlocks` does, so a test can assert on the document rather than the plan. */
    function applyEdits(document: StoryDocument, edits: readonly { sceneId: string; blockId: string; payload: StoryBlock["payload"] }[]): void {
        for (const edit of edits) {
            document.scenes[edit.sceneId].blocks[edit.blockId].payload = edit.payload;
        }
    }

    // Two unresolved speakers in one selection is the ordinary shape of a chapter pasted in from
    // another project. Binding them together would make two people one, so the anchor decides.
    it("repairs only the anchored speaker when a selection holds more than one", () => {
        const document = documentWithScenes([
            dialogue("a", { speakerName: "Kaede" }),
            dialogue("b", { characterId: "char-gone" }),
            dialogue("c", { speakerName: "Kaede" }),
        ]);
        const rows = collectUnresolvedSpeakerRows(document, ["a", "b", "c"], KNOWN);

        expect(narrowToOneUnresolvedSpeaker(rows, "a").map(row => row.blockId)).toEqual(["a", "c"]);
        expect(narrowToOneUnresolvedSpeaker(rows, "b").map(row => row.blockId)).toEqual(["b"]);
    });

    it("offers nothing when the anchor is not itself broken and the rows disagree", () => {
        const document = documentWithScenes([
            dialogue("a", { speakerName: "Kaede" }),
            dialogue("b", { characterId: "char-gone" }),
            dialogue("resolved", { characterId: "char-alice" }),
        ]);
        const rows = collectUnresolvedSpeakerRows(document, ["a", "b", "resolved"], KNOWN);

        expect(narrowToOneUnresolvedSpeaker(rows, "resolved")).toEqual([]);
    });

    // The common case: one broken speaker, and the author right-clicked a row that is not a
    // dialogue row at all. The rows agree, so the repair is still offered.
    it("falls back to the rows' own agreement when the anchor says nothing", () => {
        const document = documentWithScenes([
            dialogue("a", { speakerName: "Kaede" }),
            dialogue("b", { speakerName: "Kaede" }),
        ]);
        const rows = collectUnresolvedSpeakerRows(document, ["a", "b"], KNOWN);

        expect(narrowToOneUnresolvedSpeaker(rows, undefined).map(row => row.blockId)).toEqual(["a", "b"]);
    });

    // A bare name and an unresolvable id are different speakers even when the name on screen is
    // the same one - nothing says the id belonged to a character called "Kaede".
    it("does not treat a bare name and an unresolvable id as one speaker", () => {
        const document = documentWithScenes([
            dialogue("a", { speakerName: "Kaede" }),
            dialogue("b", { characterId: "char-gone" }),
        ]);
        const rows = collectUnresolvedSpeakerRows(document, ["a", "b"], KNOWN);

        expect(narrowToOneUnresolvedSpeaker(rows, undefined)).toEqual([]);
    });

    it("binds a bare name on the rows it was given, and on no others", () => {
        const document = documentWithScenes([
            dialogue("a", { speakerName: "Alice" }),
            dialogue("b", { speakerName: "Alice" }),
        ]);

        applyEdits(document, rebindSpeakersInBlocks(document, ["a"], "char-alice", KNOWN));

        expect(payloadOf(document, "a")).toMatchObject({ characterId: "char-alice" });
        expect(payloadOf(document, "a")).not.toHaveProperty("speakerName");
        // The row outside the set speaks the same name and must be untouched: the gesture is scoped to
        // the rows the author selected, which is the whole reason it is not `promoteTempSpeaker`.
        expect(payloadOf(document, "b").speakerName).toBe("Alice");
        expect(payloadOf(document, "b")).not.toHaveProperty("characterId");
    });

    it("binds a character id that names nothing in this project", () => {
        const document = documentWithScenes([dialogue("a", { characterId: "char-from-another-project" })]);

        const edits = rebindSpeakersInBlocks(document, ["a"], "char-alice", KNOWN);

        expect(edits).toHaveLength(1);
        expect(edits[0].payload).toMatchObject({ characterId: "char-alice" });
    });

    it("leaves a row whose character resolves, and one with no speaker at all", () => {
        const document = documentWithScenes([
            dialogue("bound", { characterId: "char-bob" }),
            dialogue("silent", {}),
        ]);

        expect(collectUnresolvedSpeakerRows(document, ["bound", "silent"], KNOWN)).toEqual([]);
        expect(rebindSpeakersInBlocks(document, ["bound", "silent"], "char-alice", KNOWN)).toEqual([]);
    });

    it("finds every line a character speaks, in every scene, and no stage row", () => {
        const document = documentWithScenes(
            [dialogue("a", { characterId: "char-alice" }), characterEnter("enter", "char-alice")],
            [dialogue("b", { characterId: "char-alice" }), dialogue("c", { characterId: "char-bob" })],
        );

        expect(collectRowsSpokenBy(document, "char-alice").map(row => row.blockId)).toEqual(["a", "b"]);
    });

    it("degrades a character's lines to its name and takes the id off", () => {
        const document = documentWithScenes(
            [dialogue("a", { characterId: "char-alice" })],
            [dialogue("b", { characterId: "char-alice" })],
        );

        const edits = setRowsSpeakerName(document, collectRowsSpokenBy(document, "char-alice"), "Alice");

        expect(edits.map(edit => edit.blockId)).toEqual(["a", "b"]);
        for (const edit of edits) {
            expect(edit.payload).toMatchObject({ speakerName: "Alice" });
            expect(edit.payload).not.toHaveProperty("characterId");
        }
    });

    it("takes a degraded line back to its character, which is what undoing the deletion does", () => {
        const document = documentWithScenes([dialogue("a", { speakerName: "Alice" })]);
        const rows = collectUnresolvedSpeakerRows(document, ["a"], KNOWN);

        const edits = bindRowsToCharacter(document, rows, "char-alice");

        expect(edits[0].payload).toMatchObject({ characterId: "char-alice" });
        expect(edits[0].payload).not.toHaveProperty("speakerName");
    });
});

describe("story document migration ladder", () => {
    function docAtVersion(version: number) {
        const document = createEmptyStoryDocument({
            id: STORY_ID_1,
            name: "My Story",
            now: "2026-07-16T00:00:00.000Z",
            generateId: idFactory(),
        });
        return { ...document, schemaVersion: version as never };
    }

    // The regression that shipped: bumping the constant without adding a step left v3 documents
    // falling through migrateStoryDocumentToLatest untouched, so every existing project threw
    // "migration is not implemented" and its story panel would not open.
    // 22 is the rung an additive bump is easiest to leave behind: v23 added
    // `StoryJumpPayload.returnable` with no step of its own, so only the unconditional stamp at the
    // end of the ladder brings a v22 document up at all.
    it.each([[STORY_DOCUMENT_MIN_SUPPORTED_VERSION], [22]])("brings a v%i document to the current schema", version => {
        expect(normalizeStoryDocument(docAtVersion(version), "2026-07-16T00:00:00.000Z").schemaVersion)
            .toBe(STORY_DOCUMENT_SCHEMA_VERSION);
    });

    // The floor, from the other side. A document below it is REFUSED, and refused by name - the
    // failure a reader has to be able to act on is "this project predates what this Studio reads",
    // not the "migration is not implemented" that a silent fall-through would produce one assertion
    // later. The version stated here is deliberately not derived from the constant: the point of the
    // case is that some real older version, one this repository did produce, does not open.
    it.each([[1], [13], [17], [STORY_DOCUMENT_MIN_SUPPORTED_VERSION - 1]])(
        "refuses a v%i document rather than half-migrating it",
        version => {
            expect(() => normalizeStoryDocument(docAtVersion(version), "2026-07-16T00:00:00.000Z"))
                .toThrow(/older than this Studio version can read/);
        },
    );

    // The same refusal as data, and the two are not interchangeable. Every reader between the ladder
    // and a surface rewraps the sentence, so a caller that wants to *say* what happened - the lint
    // sweep, which is where an author meets this - has only the fields to go on.
    it("refuses with the two versions as fields, not only inside the sentence", () => {
        let thrown: unknown;
        try {
            normalizeStoryDocument(docAtVersion(17), "2026-07-16T00:00:00.000Z");
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(StoryDocumentTooOldError);
        expect(findStoryDocumentTooOldError(new Error("wrapped", { cause: thrown }))).toBe(thrown);
        expect((thrown as StoryDocumentTooOldError).version).toBe(17);
        expect((thrown as StoryDocumentTooOldError).minimumVersion).toBe(STORY_DOCUMENT_MIN_SUPPORTED_VERSION);
    });

    /**
     * The other end of the ladder, and the end where being wrong costs the author their work.
     *
     * A document above the current version used to be handed straight through: read as if it were
     * current, the normalize pass drops every field this build has not heard of and the next save
     * writes that back. One visit from an older Studio was enough to strip a newer one's work, with
     * nothing on screen having said a field was lost.
     */
    it("refuses a document from a newer Studio rather than reading it as current", () => {
        let thrown: unknown;
        try {
            normalizeStoryDocument(docAtVersion(STORY_DOCUMENT_SCHEMA_VERSION + 1), "2026-07-16T00:00:00.000Z");
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(StoryDocumentTooNewError);
        expect(findStoryDocumentTooNewError(new Error("wrapped", { cause: thrown }))).toBe(thrown);
        expect((thrown as StoryDocumentTooNewError).version).toBe(STORY_DOCUMENT_SCHEMA_VERSION + 1);
        expect((thrown as StoryDocumentTooNewError).supportedVersion).toBe(STORY_DOCUMENT_SCHEMA_VERSION);
    });

    it("reads a document at the current version untouched", () => {
        expect(() => normalizeStoryDocument(docAtVersion(STORY_DOCUMENT_SCHEMA_VERSION), "2026-07-16T00:00:00.000Z"))
            .not.toThrow();
    });

    /**
     * v21→v22: the hold becomes a length of time, and `maskWipe` retires.
     *
     * The percentage is converted against the row's own duration, and the row keeps the share it
     * STATED rather than the shorter one it was getting - the engine spent the hold as a band of
     * eased progress, which is the defect, and baking that into the document would preserve it.
     */
    describe("v21→v22 the transition hold", () => {
        const payloadOf = (document: StoryDocument, blockId: string): Record<string, unknown> =>
            Object.values(document.scenes).flatMap(scene => scene.blocks[blockId] ? [scene.blocks[blockId]] : [])[0]!.payload as Record<string, unknown>;

        function v21With(blocks: Record<string, unknown>): StoryDocument {
            const document = docAtVersion(21);
            const sceneId = document.entrySceneId!;
            const scene = document.scenes[sceneId];
            return {
                ...document,
                scenes: {
                    [sceneId]: {
                        ...scene,
                        blocks: Object.fromEntries(Object.entries(blocks).map(([id, payload]) => [
                            id,
                            id === "jump"
                                ? { id, kind: "jump", parentId: null, childrenIds: [], payload }
                                : { id, kind: "action", parentId: null, childrenIds: [], payload },
                        ])) as never,
                        rootBlockIds: Object.keys(blocks),
                    },
                },
            } as StoryDocument;
        }

        it("converts the percentage against the row's own duration", () => {
            const migrated = migrateStoryDocumentToLatest(v21With({
                bg: { action: "setBackground", assetId: "a", transition: { kind: "throughColor", durationMs: 4000, props: { color: "#fff", hold: 50 } } },
            }));
            expect(payloadOf(migrated, "bg").transition).toEqual({
                kind: "throughColor", durationMs: 4000, holdMs: 2000, props: { color: "#fff" },
            });
        });

        it("uses the compiler's own 300ms default when the row never stated a duration", () => {
            const migrated = migrateStoryDocumentToLatest(v21With({
                bg: { action: "setBackground", assetId: "a", transition: { kind: "exposure", props: { hold: 40 } } },
            }));
            expect(payloadOf(migrated, "bg").transition).toEqual({ kind: "exposure", holdMs: 120 });
        });

        it("leaves a row that never stated a hold with none, so it keeps the transition's default", () => {
            const migrated = migrateStoryDocumentToLatest(v21With({
                bg: { action: "setBackground", assetId: "a", transition: { kind: "throughColor", durationMs: 900 } },
            }));
            expect(payloadOf(migrated, "bg").transition).toEqual({ kind: "throughColor", durationMs: 900 });
        });

        it("ignores a hold prop on a kind that never read one", () => {
            // `props` is a per-kind bag: a stray key on a kind with no hold means nothing, and
            // promoting it to a first-class field would invent a setting the row never had.
            const migrated = migrateStoryDocumentToLatest(v21With({
                bg: { action: "setBackground", assetId: "a", transition: { kind: "blinds", durationMs: 400, props: { hold: 50 } } },
            }));
            expect(payloadOf(migrated, "bg").transition).toEqual({ kind: "blinds", durationMs: 400, props: { hold: 50 } });
        });

        it("retires maskWipe into the softWipe it always compiled to", () => {
            const migrated = migrateStoryDocumentToLatest(v21With({
                bg: { action: "setBackground", assetId: "a", transition: { kind: "maskWipe", durationMs: 500, props: { direction: "right" } } },
            }));
            expect(payloadOf(migrated, "bg").transition).toEqual({
                kind: "softWipe", durationMs: 500, props: { direction: "right", feather: 0 },
            });
        });

        it("reaches a jump block, which is not an action and has always been the walk that gets missed", () => {
            const migrated = migrateStoryDocumentToLatest(v21With({
                jump: { targetSceneId: "scene-2", transition: { kind: "throughColor", durationMs: 2000, props: { hold: 25 } } },
            }));
            expect(payloadOf(migrated, "jump").transition).toEqual({ kind: "throughColor", durationMs: 2000, holdMs: 500 });
        });

        it("leaves the NVL panel's transition field alone - that one is a transform", () => {
            const migrated = migrateStoryDocumentToLatest(v21With({
                nvl: { action: "nvl", transition: { to: { opacity: 1 }, durationMs: 400 } },
            }));
            expect(payloadOf(migrated, "nvl").transition).toEqual({ to: { opacity: 1 }, durationMs: 400 });
        });
    });

    it("leaves a current-version document alone", () => {
        const document = docAtVersion(STORY_DOCUMENT_SCHEMA_VERSION);
        expect(normalizeStoryDocument(document, "2026-07-16T00:00:00.000Z").schemaVersion)
            .toBe(STORY_DOCUMENT_SCHEMA_VERSION);
    });

    it("still refuses a document from a newer Studio", () => {
        expect(() => normalizeStoryDocument(docAtVersion(STORY_DOCUMENT_SCHEMA_VERSION + 1), "2026-07-16T00:00:00.000Z"))
            .toThrow(/newer than this Studio/);
    });
});
