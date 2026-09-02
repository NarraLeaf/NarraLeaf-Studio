import type { StoryBlock, StoryBlockId, StoryDocument, StoryId, StorySceneId } from "@shared/types/story";
import {
    bindRowsToCharacter,
    collectRowsSpokenBy,
    collectRowsSpokenByName,
    setRowsSpeakerName,
    type StoryDialogueRowRef,
} from "./storyModel";

/**
 * Deleting a character, as the story documents experience it.
 *
 * A dialogue row points at its speaker either by `characterId` or by a bare `speakerName`, and the
 * engine's dialogue box only ever displays the name its `Character` carries - so the two states read
 * identically to a player. That is what makes a delete recoverable rather than destructive: every
 * line the deleted character spoke keeps speaking, under the name it had, and can be bound to another
 * character later. Left alone, those lines would hold an id that resolves to nothing and the compiler
 * would render them as "Unknown".
 *
 * # Why this is a module rather than a method
 *
 * The sweep spans every story document in the project, and the undo entry it belongs to is the
 * character service's - that entry also carries the deleted character's record, its place in the cast
 * order and its baked avatar's bytes, none of which anything else can reconstruct. Splitting the two
 * halves into two history entries would make one gesture take two presses to undo. So the character
 * service drives this, and the knowledge of how a story document is shaped stays here and in
 * `storyModel`.
 *
 * # Why the rows are captured once
 *
 * `apply` and `revert` both work from the row list settled at delete time rather than re-deriving it.
 * Re-deriving `revert` from the name would sweep up every unrelated line that happens to use it, and
 * a bare name is not an identifier - two characters may share one.
 */

/**
 * The slice of `StoryService` this sweep needs.
 *
 * Narrow on purpose: the sweep is a document rewrite plus a library walk, and stating exactly that
 * keeps it testable without a workspace behind it.
 */
export interface StoryDocumentWriter {
    listStories(): readonly { id: StoryId }[];
    loadStory(storyId: StoryId): Promise<StoryDocument>;
    getStoryDocument(storyId: StoryId): StoryDocument;
    updateBlocks(
        storyId: StoryId,
        edits: readonly { sceneId: StorySceneId; blockId: StoryBlockId; payload: StoryBlock["payload"] }[],
    ): void;
}

/** The rows one deletion degrades, grouped by the document that holds them. */
export type CharacterSpeakerFallbackPlan = readonly {
    storyId: StoryId;
    rows: readonly StoryDialogueRowRef[];
}[];

/**
 * Find every dialogue row in the project that this character speaks.
 *
 * Asynchronous, and that is the reason it is a separate phase: story documents are loaded lazily, so
 * covering the whole project means reading the ones the author has not opened. A document that will
 * not load is reported and skipped - a delete that refused because one unrelated story is corrupt
 * would be worse than one that leaves that story's lines dangling for the lint to find.
 */
export async function planCharacterSpeakerFallback(
    stories: StoryDocumentWriter,
    characterId: string,
): Promise<CharacterSpeakerFallbackPlan> {
    const plan: { storyId: StoryId; rows: readonly StoryDialogueRowRef[] }[] = [];
    for (const entry of stories.listStories()) {
        let document: StoryDocument;
        try {
            document = await stories.loadStory(entry.id);
        } catch (error) {
            console.warn(`[characterSpeakerFallback] could not read story ${entry.id}:`, error);
            continue;
        }
        const rows = collectRowsSpokenBy(document, characterId);
        if (rows.length > 0) {
            plan.push({ storyId: entry.id, rows });
        }
    }
    return plan;
}

/**
 * Find every dialogue row in the project spoken by a bare name, matched exactly.
 *
 * The sibling of {@link planCharacterSpeakerFallback}, for the case a rename raises: rows that say
 * a name with no character behind them. They are not this character's rows - nothing binds them -
 * which is why renaming never touches them on its own. They are offered, and only when the author
 * says so does {@link applySpeakerNameRename} write the new name onto them.
 *
 * Exact match, and only rows with no `characterId`: a row bound to a character already follows that
 * character's name, and matching loosely would rename lines that merely look similar.
 */
export async function planSpeakerNameRows(
    stories: StoryDocumentWriter,
    speakerName: string,
): Promise<CharacterSpeakerFallbackPlan> {
    const wanted = speakerName.trim();
    if (!wanted) {
        return [];
    }
    const plan: { storyId: StoryId; rows: readonly StoryDialogueRowRef[] }[] = [];
    for (const entry of stories.listStories()) {
        let document: StoryDocument;
        try {
            document = await stories.loadStory(entry.id);
        } catch (error) {
            console.warn(`[characterSpeakerFallback] could not read story ${entry.id}:`, error);
            continue;
        }
        const rows = collectRowsSpokenByName(document, wanted);
        if (rows.length > 0) {
            plan.push({ storyId: entry.id, rows });
        }
    }
    return plan;
}

/** Write a new bare name onto every planned row. The inverse is the same call with the old name. */
export function applySpeakerNameRename(
    stories: StoryDocumentWriter,
    plan: CharacterSpeakerFallbackPlan,
    speakerName: string,
): void {
    applyCharacterSpeakerFallback(stories, plan, speakerName);
}

/** Write the bare name onto every planned row - one mutation per document, so one save each. */
export function applyCharacterSpeakerFallback(
    stories: StoryDocumentWriter,
    plan: CharacterSpeakerFallbackPlan,
    speakerName: string,
): void {
    for (const { storyId, rows } of plan) {
        const document = resolveDocument(stories, storyId);
        if (!document) {
            continue;
        }
        const edits = setRowsSpeakerName(document, rows, speakerName);
        if (edits.length > 0) {
            stories.updateBlocks(storyId, edits);
        }
    }
}

/**
 * Put the character back on every planned row that is still waiting for it.
 *
 * A row the author has since given a speaker of its own is left as it is. Undoing a deletion is meant
 * to restore what the deletion changed, and a line the author has since re-pointed is no longer that.
 */
export function revertCharacterSpeakerFallback(
    stories: StoryDocumentWriter,
    plan: CharacterSpeakerFallbackPlan,
    characterId: string,
    speakerName: string,
): void {
    const name = speakerName.trim();
    for (const { storyId, rows } of plan) {
        const document = resolveDocument(stories, storyId);
        if (!document) {
            continue;
        }
        const untouched = rows.filter(row => {
            const block = document.scenes[row.sceneId]?.blocks[row.blockId];
            if (!block || block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
                return false;
            }
            return !block.payload.characterId?.trim() && block.payload.speakerName?.trim() === name;
        });
        const edits = bindRowsToCharacter(document, untouched, characterId);
        if (edits.length > 0) {
            stories.updateBlocks(storyId, edits);
        }
    }
}

/** The live document, or null when the story has gone since the plan was made. */
function resolveDocument(stories: StoryDocumentWriter, storyId: StoryId): StoryDocument | null {
    try {
        return stories.getStoryDocument(storyId);
    } catch {
        return null;
    }
}
