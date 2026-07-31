import type {
    StoryBlock,
    StoryDocument,
    StoryRichRun,
    StoryScene,
    StoryTextSegment,
} from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { LintStoryEntry } from "../../context";

/**
 * Story fixtures for the W4 rule tests (`text`, `localization`, `voice`).
 *
 * Imported only by those three `*.test.ts` files - it lives beside the rules rather than in each of
 * them because all three need the same four-row script, and three copies of a block builder is three
 * places to edit the day a payload grows a field.
 */

export function textSegment(
    textId: string,
    value: string,
    role: StoryTextSegment["role"],
    rich?: StoryRichRun[],
): StoryTextSegment {
    return { textId, value, role, ...(rich ? { rich } : {}) };
}

function nodeAction(id: string, payload: unknown, options?: { disabled?: boolean; parentId?: string }): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: options?.parentId ?? null,
        childrenIds: [],
        payload,
        ...(options?.disabled ? { disabled: true } : {}),
    } as StoryBlock;
}

export function narrationBlock(
    id: string,
    segment: StoryTextSegment,
    options?: { disabled?: boolean },
): StoryBlock {
    return nodeAction(id, { action: "narration", text: segment }, options);
}

export function dialogueBlock(
    id: string,
    segment: StoryTextSegment,
    options?: { disabled?: boolean; characterId?: string; voiceAssetId?: string },
): StoryBlock {
    return nodeAction(
        id,
        {
            action: "dialogue",
            text: segment,
            ...(options?.characterId ? { characterId: options.characterId } : {}),
            ...(options?.voiceAssetId ? { voiceAssetId: options.voiceAssetId } : {}),
        },
        options,
    );
}

export function choiceBlock(
    id: string,
    prompt: StoryTextSegment | null,
    childrenIds: string[],
    options?: { disabled?: boolean },
): StoryBlock {
    const block = nodeAction(id, { action: "choice", ...(prompt ? { prompt } : {}) }, options);
    block.childrenIds = childrenIds;
    return block;
}

export function choiceOptionBlock(
    id: string,
    segment: StoryTextSegment,
    parentId: string,
    options?: { disabled?: boolean },
): StoryBlock {
    return nodeAction(id, { action: "choiceOption", text: segment }, { ...options, parentId });
}

export function noteBlock(id: string, segment: StoryTextSegment): StoryBlock {
    return {
        id,
        kind: "note",
        parentId: null,
        childrenIds: [],
        payload: { text: segment },
    } as StoryBlock;
}

/** A scene holding the given blocks; every parentless block is a root, in the order supplied. */
export function sceneOf(id: string, name: string, blocks: StoryBlock[]): StoryScene {
    return {
        id,
        name,
        runtimeName: id,
        rootBlockIds: blocks.filter(block => block.parentId === null).map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

export function storyDocumentOf(id: string, name: string, scenes: StoryScene[]): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id,
        name,
        chapters: [{ id: `${id}-ch`, name: "Chapter 1", sceneIds: scenes.map(scene => scene.id) }],
        scenes: Object.fromEntries(scenes.map(scene => [scene.id, scene])),
    };
}

export function storyEntryOf(id: string, name: string, scenes: StoryScene[]): LintStoryEntry {
    return { id, name, document: storyDocumentOf(id, name, scenes) };
}

/** One story, one scene, the blocks given - the shape almost every rule test wants. */
export function singleSceneStories(blocks: StoryBlock[]): LintStoryEntry[] {
    return [storyEntryOf("story-1", "Story", [sceneOf("scene-1", "Scene One", blocks)])];
}
