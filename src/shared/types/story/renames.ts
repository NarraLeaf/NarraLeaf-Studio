import type {
    StoryActionBlock,
    StoryActionPayload,
    StoryBlock,
    StoryBlockId,
    StoryDocument,
    StoryScene,
    StorySceneId,
} from "./document";
import { listSceneBlocksInDocumentOrder, listScenesInDocumentOrder } from "./order";

/**
 * The story's `/rename` rows - one scan, read by everything that offers their words for translation
 * or ships them in a build.
 *
 * A `/rename` row gives a character the words it speaks under from that row on ("？？？", "神秘少女").
 * Those words reach the player as a speaker's name - the name plate, a backlog row, a save slot -
 * and are a translation unit of their own, filed under the row the way an ending's name is filed
 * under its `/ending` row: an author who rewrites the words keeps every translation of them.
 *
 * `disabled` rows are skipped, together with everything under a disabled container, exactly as the
 * compiler skips them: a row the build does not produce gives no one a name.
 */

export type StoryRename = {
    /** The row's block id. The rename's identity, and the key its translation is filed under. */
    renameId: StoryBlockId;
    /** The words the row gives its character, exactly as the compiler hands them to the engine. */
    name: string;
    /** The character the row renames, when it names one. */
    characterId?: string;
    sceneId: StorySceneId;
    /** The scene's display name, so a list can place the row without a second lookup. */
    sceneName: string;
};

type StoryRenameBlock = StoryActionBlock & {
    payload: Extract<StoryActionPayload, { action: "character" }> & { operation: "setName" };
};

/** What the block IS. Whether it still counts (disabled) is the scan's business. */
export function isStoryRenameBlock(block: StoryBlock): block is StoryRenameBlock {
    return block.kind === "action" && block.payload.action === "character" && block.payload.operation === "setName";
}

/** Every `/rename` row in one scene, in the scene's document order. */
export function listSceneRenames(scene: StoryScene | null | undefined): StoryRename[] {
    if (!scene) {
        return [];
    }
    return listSceneBlocksInDocumentOrder(scene, { skipSubtree: block => Boolean(block.disabled) })
        .filter(isStoryRenameBlock)
        .map(block => ({
            renameId: block.id,
            name: block.payload.displayName ?? "",
            ...(block.payload.characterId ? { characterId: block.payload.characterId } : {}),
            sceneId: scene.id,
            sceneName: scene.name,
        }));
}

/** Every `/rename` row in a story, in the order the author reads it: chapters, scenes, rows. */
export function listStoryRenames(document: StoryDocument | null | undefined): StoryRename[] {
    if (!document) {
        return [];
    }
    return listScenesInDocumentOrder(document).flatMap(scene => listSceneRenames(scene));
}
