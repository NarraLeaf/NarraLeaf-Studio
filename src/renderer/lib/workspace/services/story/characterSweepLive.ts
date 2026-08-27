import type { LiveDialogueRowRef, LiveDigestScope, LiveStoryOp } from "@shared/live/ops";
import type { StoryDocument, StoryId } from "@shared/types/story";
import {
    bindRowsToCharacter,
    collectRowsSpokenBy,
    setRowsSpeakerName,
    type StoryDialogueRowRef,
} from "./storyModel";

/**
 * Deleting a character, as a live session performs it: synchronously, on every machine, from one
 * effect.
 *
 * `characterSpeakerFallback` is the same sweep for a workspace that is not in a session, and the two
 * differ in exactly one way that matters. There, the plan is settled asynchronously because story
 * documents are loaded lazily and covering the project means reading the ones the author never
 * opened. Here every story is already in memory - a session loads them all on the way in, because
 * this gesture is why it carries them - so the walk is a walk, and it has to be, since an applier
 * that yielded would let a second operation start while the first was half done.
 *
 * **This is derived work, not carried work.** The effect says "delete this character" and nothing
 * about rows; each machine finds the same rows, because each holds the same cast and the same
 * stories, and the room's digests are what make "the same" a fact rather than a hope. Sending the
 * rows instead would be a second statement of something every receiver can compute - and it is a
 * statement that gets long, since a well-used character speaks everywhere.
 *
 * ⚠ **What it touched is reported back so the effect can fingerprint it.** Derived work is exactly
 * the work that has to be checked: a machine whose sweep found something else would otherwise write a
 * different story document and nothing would say so until somebody edited that scene. The scopes
 * returned here become `LiveEffect.digests`.
 */

/** Every story document a session holds, by id. What both sweeps below walk. */
export type LiveStoryDocuments = {
    listStories(): readonly { id: StoryId }[];
    getStoryDocument(storyId: StoryId): StoryDocument;
    /** Apply one operation without consulting the sink - the sweep is part of an effect, not a new one. */
    applyLiveOp(storyId: StoryId, op: LiveStoryOp): void;
};

/** One row, addressed across the project, and the story it lives in. */
type Located = { storyId: StoryId; rows: StoryDialogueRowRef[] };

/**
 * Which rows a character speaks, everywhere, right now.
 *
 * Read **before** the deletion, which is the only moment they still say whose they are. A story that
 * cannot be read is skipped rather than fatal, exactly as the asynchronous plan skips one: a deletion
 * refused because an unrelated story is corrupt would be worse than one that leaves that story's lines
 * for the lint to find.
 */
export function rowsSpokenBy(stories: LiveStoryDocuments, characterId: string): LiveDialogueRowRef[] {
    const found: LiveDialogueRowRef[] = [];
    for (const entry of located(stories, characterId)) {
        for (const row of entry.rows) {
            found.push({ storyId: entry.storyId, sceneId: row.sceneId, blockId: row.blockId });
        }
    }
    return found;
}

/**
 * Write the bare name onto every row this character speaks, and say which scenes changed.
 *
 * One mutation per document, so one save each, and the name is the one the record carried - a player
 * reads the line exactly as before, and the author can bind it to another character afterwards.
 */
export function sweepSpeakerName(
    stories: LiveStoryDocuments,
    characterId: string,
    speakerName: string,
): LiveDigestScope[] {
    const touched: LiveDigestScope[] = [];
    for (const { storyId, rows } of located(stories, characterId)) {
        const document = read(stories, storyId);
        if (!document) {
            continue;
        }
        const edits = setRowsSpeakerName(document, rows, speakerName);
        if (edits.length === 0) {
            continue;
        }
        stories.applyLiveOp(storyId, { op: "update-blocks", edits });
        touched.push(...scenesOf(storyId, edits));
    }
    return touched;
}

/**
 * Point named rows back at a character, and say which scenes changed.
 *
 * The other direction, and it takes the rows rather than finding them: they hold a bare name now, and
 * a name is not an identifier - two characters may share one, and the author may have written more
 * lines under it since. The list is the one recorded when the deletion happened.
 *
 * A row that has since been given a speaker of its own is left alone by `bindRowsToCharacter`, which
 * is the same rule undoing a deletion follows outside a session: undo restores what the deletion
 * changed, and a line the author has re-pointed is no longer that.
 */
export function rebindRows(
    stories: LiveStoryDocuments,
    rows: readonly LiveDialogueRowRef[],
    characterId: string,
): LiveDigestScope[] {
    const touched: LiveDigestScope[] = [];
    for (const [storyId, group] of byStory(rows)) {
        const document = read(stories, storyId);
        if (!document) {
            continue;
        }
        const edits = bindRowsToCharacter(document, group, characterId);
        if (edits.length === 0) {
            continue;
        }
        stories.applyLiveOp(storyId, { op: "update-blocks", edits });
        touched.push(...scenesOf(storyId, edits));
    }
    return touched;
}

/** Every story that holds a row this character speaks, with those rows. */
function located(stories: LiveStoryDocuments, characterId: string): Located[] {
    const found: Located[] = [];
    for (const entry of stories.listStories()) {
        const document = read(stories, entry.id);
        if (!document) {
            continue;
        }
        const rows = collectRowsSpokenBy(document, characterId);
        if (rows.length > 0) {
            found.push({ storyId: entry.id, rows });
        }
    }
    return found;
}

/** Rows grouped by the document that holds them, so each document is written once. */
function byStory(rows: readonly LiveDialogueRowRef[]): Map<StoryId, StoryDialogueRowRef[]> {
    const grouped = new Map<StoryId, StoryDialogueRowRef[]>();
    for (const row of rows) {
        const group = grouped.get(row.storyId) ?? [];
        group.push({ sceneId: row.sceneId, blockId: row.blockId });
        grouped.set(row.storyId, group);
    }
    return grouped;
}

/** The scenes a set of edits changed, once each, as digest scopes. */
function scenesOf(storyId: StoryId, edits: readonly { sceneId: string }[]): LiveDigestScope[] {
    const seen = new Set<string>();
    const scopes: LiveDigestScope[] = [];
    for (const edit of edits) {
        if (seen.has(edit.sceneId)) {
            continue;
        }
        seen.add(edit.sceneId);
        scopes.push({ of: "scene", storyId, sceneId: edit.sceneId });
    }
    return scopes;
}

/** A story this machine holds, or null. Not loaded is not an error here; see the file header. */
function read(stories: LiveStoryDocuments, storyId: StoryId): StoryDocument | null {
    try {
        return stories.getStoryDocument(storyId);
    } catch {
        return null;
    }
}
