import type {
    StoryBlock,
    StoryBlockId,
    StoryControlBlock,
    StoryControlPayload,
    StoryDocument,
    StoryEndingPage,
    StoryScene,
    StorySceneId,
} from "./document";
import { listSceneBlocksInDocumentOrder, listScenesInDocumentOrder } from "./order";

/**
 * The story's endings - one scan, read by everything that needs to know which endings exist.
 *
 * Shaped like the label and declaration scans next door, and for the same reason: the row IS the
 * ending. There is no registry to keep in step, nothing to garbage-collect when a scene is deleted,
 * and no way for the list an author sees to disagree with the list the compiler emits. An author
 * adds an ending by writing the row and removes it by deleting the row.
 *
 * **Everything keys on {@link StoryEnding.endingId}, which is the row's block id.** The name is
 * display text and may be rewritten at any time; the unlock record, a blueprint node's reference and
 * a test's target all name the id, so a rename is invisible to every one of them. This is the same
 * convention `Is Option Picked` already follows for a choice option.
 *
 * Document-wide rather than per-scene, unlike labels: a `goto` may only address a label in its own
 * scene, while an ending is a fact about the whole story and is consumed from outside it - a gallery
 * screen, a walkthrough test, an author's list of what a player can still find.
 *
 * `disabled` rows are skipped, exactly as labels are. Disabling the row removes the ending from the
 * build, so an ending that still appeared in the list would be one a player could never reach and a
 * gallery could never unlock.
 */

export type StoryEnding = {
    /** The row's block id. The ending's identity, everywhere. */
    endingId: StoryBlockId;
    /** Display text. Empty when the author has not named it yet. */
    name: string;
    /** Where the player lands afterwards, or absent for the build's own ending page. */
    page?: StoryEndingPage;
    sceneId: StorySceneId;
    /** The scene's display name, so a picker can group without a second lookup. */
    sceneName: string;
};

type StoryEndingBlock = StoryControlBlock & { payload: Extract<StoryControlPayload, { control: "ending" }> };

/** What the block IS. Whether it still counts (disabled) is the scan's business. */
export function isStoryEndingBlock(block: StoryBlock): block is StoryEndingBlock {
    return block.kind === "control" && block.payload.control === "ending";
}

/** Every ending declared in one scene, in the scene's document order. */
export function listSceneEndings(scene: StoryScene | null | undefined): StoryEnding[] {
    if (!scene) {
        return [];
    }
    // A container's own disabled state already removed its subtree from the runtime, so the endings
    // inside it are gone with it - the same rule the compiler applies when it skips the subtree.
    return listSceneBlocksInDocumentOrder(scene, { skipSubtree: block => Boolean(block.disabled) })
        .filter(isStoryEndingBlock)
        .map(block => ({
            endingId: block.id,
            name: block.payload.name.trim(),
            ...(block.payload.page ? { page: block.payload.page } : {}),
            sceneId: scene.id,
            sceneName: scene.name,
        }));
}

/**
 * Every ending in a story, in document order - chapters, then the scenes inside them, then rows.
 *
 * The order is the one the author sees in the outline, so a picker built from this reads in the same
 * sequence as the story it describes.
 */
export function listStoryEndings(document: StoryDocument | null | undefined): StoryEnding[] {
    if (!document) {
        return [];
    }
    return listScenesInDocumentOrder(document).flatMap(scene => listSceneEndings(scene));
}

/** One ending by id, or null. Callers that only need the name should still go through this. */
export function findStoryEnding(
    document: StoryDocument | null | undefined,
    endingId: string,
): StoryEnding | null {
    if (!endingId) {
        return null;
    }
    return listStoryEndings(document).find(ending => ending.endingId === endingId) ?? null;
}

/**
 * The endings sharing a display name, keyed by the SECOND and later rows.
 *
 * Not an error - two rows may legitimately be called "Bad End" - but a screen that lists endings by
 * name would show the same word twice with no way to tell which is which, so the author is worth
 * telling. The first row keeps the name; later ones are what a diagnostic anchors to, which is the
 * rule `duplicateSceneLabels` already follows.
 */
export function duplicateStoryEndingNames(document: StoryDocument | null | undefined): StoryEnding[] {
    const seen = new Set<string>();
    const duplicates: StoryEnding[] = [];
    for (const ending of listStoryEndings(document)) {
        if (!ending.name) {
            continue;
        }
        if (seen.has(ending.name)) {
            duplicates.push(ending);
            continue;
        }
        seen.add(ending.name);
    }
    return duplicates;
}
