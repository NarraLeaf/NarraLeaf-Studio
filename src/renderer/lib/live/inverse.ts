import type { LiveCastView } from "@shared/live/cast";
import type {
    LiveAssetFolder,
    LiveAssetRecord,
    LiveDialogueRowRef,
    LiveEffect,
    LiveOp,
} from "@shared/live/ops";
import {
    uiGraphPartsBefore,
    uiGraphPartsRestored,
    type LiveUIGraphParts,
} from "@shared/live/uiGraphParts";
import { uiPartsBefore, uiPartsRestored, type LiveUIParts } from "@shared/live/uiParts";
import type { AssetSet } from "@shared/types/assetSet";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import type { CharacterGroup, StoredCharacter } from "@shared/types/character/model";
import type { ProjectDictionaryDocument, ProjectDictionaryEntry, ProjectDictionaryOptions } from "@shared/types/dictionary";
import type { LocalizationUnit } from "@shared/types/localization";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import type { VoiceUnit } from "@shared/types/voice";
import type { StoryBlock, StoryBlockId, StoryDocument, StoryScene, StorySceneId } from "@shared/types/story";
import { DeletedPositions, type LivePosition } from "./deletedPositions";

/**
 * What undoes one operation in a live session.
 *
 * **Inside a session, undo is not "restore a snapshot" - it is "send the inverse of my last
 * operation".** Outside one, undo puts a whole scene back the way it was, and that is the right
 * answer for a document with one author. In a shared scene it is a catastrophe that nothing on
 * either screen would report: the snapshot was taken before a collaborator wrote three paragraphs,
 * so restoring it deletes them, and neither the author who pressed the key nor the author whose
 * work vanished is told anything at all. An operation's inverse is another operation; it goes
 * through the same door as every other edit, the host applies it in the same order, and it changes
 * exactly what the original changed.
 *
 * Four rules follow, and this module exists to make three of them true:
 *
 *  - **Undo undoes MY last operation, not history's last.** In a shared scene those stopped being
 *    the same thing. Somebody else's rows landing on top of mine do not stop me taking mine back,
 *    so long as the inverse still applies - which is why {@link inverseOf} is asked about ONE
 *    effect and never about a stack. Which effect is "mine, last" is the caller's question.
 *  - **Where the inverse no longer applies, refuse and say why.** Never a snapshot as a fallback,
 *    and never a silent nothing. Every impossibility here carries a {@link LiveInverseReason} the
 *    interface can put in front of the person who pressed the key.
 *  - **Undoing somebody else's effect is impossible.** Not merely discouraged: an effect this
 *    machine did not cause has no inverse here at all, so nothing built on this can offer one.
 *  - **Redo is the inverse of the inverse**, under exactly these rules. Nothing below distinguishes
 *    the two directions, because there is nothing to distinguish: undoing an undo is undoing an
 *    operation this machine caused.
 *
 * Pure, and given everything it needs. It reads no service, sends nothing, and decides nothing
 * about when an undo happens - it answers one question about one effect.
 */

/* -------------------------------------------------------------------- what cannot be undone */

/**
 * Why an effect has no inverse.
 *
 * Deliberately overlapping with the host's own refusal reasons where they mean the same thing
 * (`scene-gone`, `row-gone`, `anchor-gone`): an author who is told the row is gone should be told
 * it in the same words whether this machine worked it out before sending or the host said so
 * afterwards. The rest are peculiar to inversion - they are the ways an operation can have been
 * performed and still have no operation that takes it back.
 */
export type LiveInverseReason =
    /**
     * The effect was somebody else's. There is no operation that undoes it: the words are theirs,
     * their machine is holding the undo entry for them, and a stack that offered this would be
     * offering to delete a stranger's paragraph.
     */
    | "not-mine"
    /**
     * Nothing was kept from before the operation, so what it overwrote is not knowable now. Either
     * the caller recorded nothing, or what it recorded belongs to a different operation.
     */
    | "no-record"
    /** The scene the operation was about is gone, and everything in it with it. */
    | "scene-gone"
    /** The row is gone. Somebody deleted it after the operation landed. */
    | "row-gone"
    /** The row this delete removed is in the scene again, so there is nothing left to put back. */
    | "row-restored"
    /** The container the row lived in is gone, so there is nowhere to put it that is where it was. */
    | "container-gone"
    /**
     * The sibling a move came from is gone, so where it moved from cannot be named any more.
     * Deliberately a refusal and not a guess, for the reason the host refuses the same thing: a
     * paragraph that lands somewhere nobody sent it has to be found before it can be undone.
     */
    | "anchor-gone"
    /**
     * The row this insert added has rows inside it now. Deleting it would take them, and they are
     * not this author's to take - a container somebody else has filled is their work, sitting in a
     * box this author happened to make.
     */
    | "container-filled"
    /**
     * The row this delete removed had children, and one `insert-block` carries one block: the
     * vocabulary can put the container back but nothing that was inside it.
     *
     * **A refusal on purpose, rather than half a subtree.** Restoring the container alone would
     * leave a tree that looks whole and is not, and nobody - least of all the author, who is
     * looking at the place the rows used to be - can see what is missing from it. Sending the rows
     * back one at a time is not the answer either: the host applies operations one at a time, so
     * every machine in the room would draw each intermediate state, and any of them could fail
     * halfway and leave the same invisible hole permanently.
     */
    | "subtree-lost"
    /** The chapters are not the ones the recorded order names, so applying it would drop or duplicate one. */
    | "chapters-changed"
    /**
     * The character record is gone. Somebody deleted it after the operation landed.
     *
     * The cast's `row-gone`, and refused for the same reason rather than turned into a creation:
     * putting back a record somebody else deleted is not undoing an edit, it is making a character.
     */
    | "character-gone"
    /** The record this delete removed is in the cast again, so there is nothing left to put back. */
    | "character-restored"
    /**
     * The asset record is gone. Somebody deleted the file after the operation landed.
     *
     * The library's `row-gone`, refused rather than turned into a creation for the cast's reason:
     * putting back a record whose bytes have been deleted is not undoing an edit, it is inventing a
     * row in the browser with nothing under it.
     */
    | "asset-gone"
    /**
     * The bytes this replaced are gone, so there is nothing to point the record back at.
     *
     * **A refusal on purpose, and the same answer replacing has always given.** Replacing an asset's
     * contents overwrites the file in place; the bytes that were there are not kept, in a session or
     * out of one, so an "undo" could only put the record's old name and hash back over a file that is
     * the new one. That is a record describing a file that does not exist - the exact state the
     * metadata merge refuses to produce.
     */
    | "content-replaced"
    /**
     * The bus is gone. Somebody deleted it after the operation landed.
     *
     * The mixer's `row-gone`, refused rather than turned into a creation for the cast's reason:
     * putting back a bus somebody else deleted is not undoing an edit, it is making a track - and
     * every reference that had fallen back to a seeded bus would silently re-point at it.
     */
    | "track-gone"
    /** The bus this delete removed is in the mixer again, so there is nothing left to put back. */
    | "track-restored"
    /** The asset set is gone. The mixer's `track-gone`, one document along. */
    | "set-gone"
    /** A set this delete removed is declared again, so there is nothing left to put back. */
    | "set-restored";

/* ------------------------------------------------------------------------ what to record */

/**
 * What the document held before one operation landed - the part of an inverse that cannot be
 * worked out after the fact.
 *
 * **Captured as the effect is applied, never as the intent is sent.** Every machine applies effects
 * in the host's order, so the document immediately before applying effect N is exactly the document
 * the host had immediately before applying operation N; that moment is the only one at which what
 * an operation is about to overwrite is a knowable thing. Recorded when the intent went out it
 * would be a guess about a document that has moved on - somebody else's rename, somebody else's
 * move of the row - and an inverse built on a guess restores a state that never existed.
 *
 * It is the smallest thing that works, and each member says why it is needed rather than derivable:
 * an effect carries the operation, and an operation states what it did, never what it displaced.
 *
 * There is no member for `insert-block`, and that absence is the statement: an insert's inverse is
 * a delete of a row addressed by the id the effect already carries, so nothing has to be kept.
 */
export type LiveBefore =
    /** The payload the row held. An update states the new payload and nothing about the old one. */
    | { op: "update-block"; payload: StoryBlock["payload"] }
    /**
     * The payload every row of a batch held, one entry per edit and each carrying its own scene:
     * the rows of one batch can live anywhere in the story.
     */
    | {
          op: "update-blocks";
          edits: readonly { sceneId: StorySceneId; blockId: StoryBlockId; payload: StoryBlock["payload"] }[];
      }
    /**
     * The row itself, whole, and where it sat. A delete names an id: the block is gone from the
     * document by the time anybody asks, and no message in the session carries it.
     */
    | { op: "delete-block"; block: StoryBlock; at: LivePosition }
    /**
     * Every row a batch removed, whole, **in the document order they sat in**.
     *
     * The order is load-bearing and it is the opposite of `move-blocks`'s reason. Rows are put back
     * front to back so that a container is there before the rows that live inside it; the anchors
     * that then point at siblings not yet restored are exactly what the host's memory of deleted
     * positions is for, and a walk from the back would place a child into a parent that does not
     * exist yet.
     */
    | { op: "delete-blocks"; rows: readonly { block: StoryBlock; at: LivePosition }[] }
    /** Where the row was before it moved. A move states its destination only. */
    | { op: "move-block"; at: LivePosition }
    /**
     * Where every row of a batch sat, **in the document order they sat in**.
     *
     * The order is load-bearing rather than incidental: putting the rows back one at a time works
     * only if each is placed in front of a successor that is already home, and the recorded
     * successor of a row is either a row that never moved or one that came after it - so a walk from
     * the back restores every row into a settled neighbourhood, and a walk from the front does not.
     * See {@link inverseOf}.
     */
    | { op: "move-blocks"; at: readonly { blockId: StoryBlockId; at: LivePosition }[] }
    /**
     * Whether the row was disabled. Not `!disabled`: disabling a row that was already disabled
     * changes nothing, and its inverse is therefore not enabling it.
     */
    | { op: "set-block-disabled"; disabled: boolean }
    /** The scene's name. */
    | { op: "rename-scene"; name: string }
    /** The entry scene, or null when the story had none. */
    | { op: "set-entry-scene"; sceneId: StorySceneId | null }
    /** The story's name. */
    | { op: "rename-story"; name: string }
    /** The chapter order. */
    | { op: "reorder-chapters"; chapterIds: readonly string[] }
    /**
     * The record the character held. An update states the new record and nothing about the old one -
     * the same shape as `update-block`, one document along.
     */
    | { op: "update-character"; character: StoredCharacter }
    /**
     * The group as it stood, or null when there was none - a `set` that created one is undone by a
     * delete, and the record says which of the two it was.
     */
    | { op: "set-character-group"; group: CharacterGroup | null }
    /**
     * The record itself, whole, where it sat, and the lines it was speaking.
     *
     * A delete names an id: the record is gone from the store by the time anybody asks, and no message
     * in the session carries it. The rows are here for a sharper reason than the record is. Going
     * down, the sweep is derived - every machine can ask "which rows does this character speak". Coming
     * back up it cannot be: those rows now hold a bare NAME, and a name is not an identifier. Two
     * characters may share one, and the author may have written more lines under it since the
     * deletion. So the only correct answer to "which lines were this character's" is the one recorded
     * at the moment they stopped being.
     */
    | { op: "delete-character"; character: StoredCharacter; at: number; spoke: readonly LiveDialogueRowRef[] }
    /**
     * The group itself and who was in it.
     *
     * The membership is the half of a deletion that is not recoverable from the group afterwards:
     * every member was moved out of it, and the group record says nothing about which ones. Undoing
     * has to put the cast back where it was, not re-create an empty group with the right name.
     */
    | { op: "delete-character-group"; group: CharacterGroup; members: readonly string[] }
    /**
     * The entry the translation held, or null when there was none.
     *
     * `update-block`'s shape two documents along, with one difference: null is a value here rather
     * than the absence of a record. In a locale library "no entry" is what an untranslated line
     * looks like, so a set that wrote the first translation of a line is undone by putting the
     * nothing back - and a record that could not tell "there was no entry" from "nothing was kept"
     * would leave the first translation of every line impossible to take back.
     */
    | { op: "set-translation"; unit: LocalizationUnit | null }
    /** What every entry of a batch held, one per entry the batch named, in the order it named them. */
    | { op: "set-translations"; units: readonly { unitId: string; unit: LocalizationUnit | null }[] }
    /** The take the line held, or null when there was none. The translation's mirror. */
    | { op: "set-take"; unit: VoiceUnit | null }
    /** What every take of a batch held, one per entry the batch named. */
    | { op: "set-takes"; units: readonly { unitId: string; unit: VoiceUnit | null }[] }
    /**
     * The record the asset held. `update-block`'s shape three documents along: an update states the
     * new record and nothing about the old one.
     */
    | { op: "update-asset"; record: LiveAssetRecord }
    /**
     * Which folder every asset of a batch was in, one entry per asset the batch named.
     *
     * The whole of why the operation carries a destination per row rather than one for all of them:
     * a drag collects assets that were in different folders, and an inverse that filed them all in
     * one place would be a rearrangement nobody asked for wearing the word "undo".
     */
    | { op: "move-assets"; moves: readonly { assetId: string; groupId: string | null }[] }
    /**
     * The records a deletion removed, whole.
     *
     * A deletion names ids: the records are gone from the shard by the time anybody asks, and no
     * message in the session carries them. ⚠ The bytes are NOT here and must not be - each machine
     * put its own copy in its own trash, and the creation that undoes this says so rather than
     * carrying two hundred megabytes back across the room.
     */
    | { op: "delete-assets"; records: readonly LiveAssetRecord[] }
    /**
     * The folder as it stood, or null when there was none - a `set` that created one is undone by a
     * delete, and the record says which of the two it was. `set-character-group`'s shape.
     */
    | { op: "set-asset-folder"; folder: LiveAssetFolder | null }
    /**
     * Everything a folder deletion destroyed: the folders it took, and the records that were in them.
     *
     * The half that is not recoverable afterwards. Going down, the cascade is derived - every machine
     * can ask which folders are below this one. Coming back up it cannot be: they are gone, and so
     * are the records that named them.
     */
    | {
          op: "delete-asset-folder";
          folders: readonly LiveAssetFolder[];
          assets: readonly { assetType: string; record: LiveAssetRecord }[];
      }
    /**
     * The interface records the delta named, as they stood.
     *
     * `update-block`'s shape over a whole set: a delta states what the document is about to hold and
     * nothing about what it held, so undo is a delta of the other side. `null` inside it is "there
     * was no such record", which is what makes undoing a creation a removal rather than a puzzle.
     */
    | { op: "write-ui"; parts: LiveUIParts }
    /** The blueprint records the delta named, as they stood. The interface's mirror. */
    | { op: "write-ui-graphs"; parts: LiveUIGraphParts }
    /**
     * The entry that was at the address, or null when there was none.
     *
     * The translation's shape, and null is a value here for its reason: in this document "no entry"
     * is what a word the project does not write looks like, so a set that taught the project its
     * first spelling of something is undone by putting the nothing back.
     *
     * ⚠ The address is the operation's own `term`, which for a rename is where the entry WAS.
     * Nothing is kept for a rename onto a spelling the project already writes - see
     * {@link captureBefore} - because one operation names one address and putting two entries back
     * is not something the vocabulary can state.
     */
    | { op: "set-dictionary-entry"; entry: ProjectDictionaryEntry | null }
    /** Both checks as they stood. The operation states the new pair and nothing about the old one. */
    | { op: "set-dictionary-options"; options: ProjectDictionaryOptions }
    /** The record the bus held. `update-block`'s shape, one document along. */
    | { op: "update-audio-track"; track: ProjectAudioTrack }
    /**
     * The bus itself, where it sat, and what fed into it.
     *
     * The children are the half that cannot be recovered afterwards, and it is
     * `delete-character`'s asymmetry exactly. Going down the promotion is derived - every machine
     * works out which buses fed this one. Coming back up it is not: they now name the deleted bus's
     * own parent, and so do the buses that always did, so the two are indistinguishable.
     */
    | {
          op: "delete-audio-track";
          track: ProjectAudioTrack;
          /** The bus it sat in front of, or null when it was last. */
          beforeId: string | null;
          children: readonly string[];
      }
    /** Where the bus sat before it moved. A move states its destination only. */
    | { op: "move-audio-track"; beforeId: string | null }
    /** The record the set held. `update-audio-track`'s shape, one document along. */
    | { op: "update-asset-set"; set: AssetSet }
    /**
     * Every set a deletion removed, whole, **in the document order they sat in**, each with the
     * surviving set it sat in front of.
     *
     * The anchor skips the sets that went with it, which is what lets them be put back in one pass
     * from the front: two sets that shared a surviving successor land in front of it in the order
     * they are restored, which is the order they were in.
     */
    | { op: "delete-asset-sets"; sets: readonly { set: AssetSet; beforeId: string | null }[] }
    /**
     * Which folder every set of a batch was filed in, one entry per set the batch named.
     *
     * The whole of why the operation carries a destination per set rather than one for all of them:
     * a set and the sets drawn inside it need not have been in the same folder, and an inverse that
     * filed them all in one place would be a rearrangement nobody asked for wearing the word "undo".
     */
    | { op: "move-asset-sets"; moves: readonly { setId: string; groupId: string | null }[] };

/**
 * Read out of the document everything the inverse of `op` will need.
 *
 * **Call it immediately before applying the effect that carries `op`**, with the document as it
 * stands. Null means there is nothing to keep (an insert) or nothing to read (the row or scene the
 * operation names is not there, which is an operation that is about to fail anyway).
 *
 * A copy rather than a reference for anything that will be edited: the document is mutated in
 * place, and a record that pointed into it would describe the state after the operation instead of
 * the state before, which is the one mistake this whole module exists to avoid.
 */
export function captureBefore(op: LiveOp, sources: LiveBeforeSources): LiveBefore | null {
    const document = sources.story ?? EMPTY_STORY;
    const cast = sources.cast ?? EMPTY_CAST;
    switch (op.op) {
        case "insert-block":
        case "insert-blocks":
        case "create-character":
            // Nothing. The inverse is a delete of what the effect already names.
            return null;

        case "update-block": {
            const block = blockIn(document, op.sceneId, op.blockId);
            return block ? { op: "update-block", payload: structuredClone(block.payload) } : null;
        }

        case "update-blocks": {
            // One unreadable row and nothing is kept at all. A record covering some of a batch would
            // invert into an operation that puts some of it back, which is the arrangement nobody
            // wrote - and the operation this is about to be applied alongside is going to be refused
            // whole for the same missing row anyway.
            const edits: { sceneId: StorySceneId; blockId: StoryBlockId; payload: StoryBlock["payload"] }[] = [];
            for (const edit of op.edits) {
                const block = blockIn(document, edit.sceneId, edit.blockId);
                if (!block) {
                    return null;
                }
                edits.push({
                    sceneId: edit.sceneId,
                    blockId: edit.blockId,
                    payload: structuredClone(block.payload),
                });
            }
            return { op: "update-blocks", edits };
        }

        case "move-blocks": {
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return null;
            }
            const moving = new Set(op.moves.flatMap(move => [...move.blockIds]));
            const at: { blockId: StoryBlockId; at: LivePosition }[] = [];
            for (const blockId of documentOrder(scene)) {
                if (!moving.has(blockId)) {
                    continue;
                }
                const position = positionOf(scene, blockId);
                if (!position) {
                    return null;
                }
                at.push({ blockId, at: position });
            }
            // A row the batch names and the scene does not have is a batch that cannot be inverted,
            // for the reason above.
            return at.length === moving.size ? { op: "move-blocks", at } : null;
        }

        case "delete-block": {
            const scene = document.scenes[op.sceneId];
            const block = scene ? scene.blocks[op.blockId] : undefined;
            if (!scene || !block) {
                return null;
            }
            const at = positionOf(scene, op.blockId);
            return at ? { op: "delete-block", block: structuredClone(block), at } : null;
        }

        case "delete-blocks": {
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return null;
            }
            const rows: { block: StoryBlock; at: LivePosition }[] = [];
            for (const blockId of op.blockIds) {
                const block = scene.blocks[blockId];
                if (!block) {
                    // A row inside a container an earlier id of this same batch already took with
                    // it. Nothing to record: the container's record is what puts it back, and the
                    // guard on inverting insists every child of a recorded row is recorded too.
                    continue;
                }
                const at = positionOf(scene, blockId);
                if (!at) {
                    return null;
                }
                rows.push({ block: structuredClone(block), at });
            }
            return rows.length > 0 ? { op: "delete-blocks", rows } : null;
        }

        case "move-block": {
            const scene = document.scenes[op.sceneId];
            if (!scene || !scene.blocks[op.blockId]) {
                return null;
            }
            const at = positionOf(scene, op.blockId);
            return at ? { op: "move-block", at } : null;
        }

        case "set-block-disabled": {
            const block = blockIn(document, op.sceneId, op.blockId);
            // Absent and false are the same state and the document writes both, so the record says
            // which of the two states the row was in rather than which spelling it used.
            return block ? { op: "set-block-disabled", disabled: block.disabled === true } : null;
        }

        case "rename-scene": {
            const scene = document.scenes[op.sceneId];
            return scene ? { op: "rename-scene", name: scene.name } : null;
        }

        case "set-entry-scene":
            return { op: "set-entry-scene", sceneId: document.entrySceneId ?? null };

        case "rename-story":
            return { op: "rename-story", name: document.name };

        case "reorder-chapters":
            return { op: "reorder-chapters", chapterIds: document.chapters.map(chapter => chapter.id) };

        case "set-translation": {
            const units = sources.translations?.(op.locale) ?? null;
            // Null is the library not being held, which is a different fact from the entry being
            // absent: nothing can be read, so nothing is kept and the undo answers `no-record`.
            const held = units === null ? undefined : units[op.unitId];
            return units === null
                ? null
                : { op: "set-translation", unit: held ? { ...held } : null };
        }

        case "set-translations": {
            const units = sources.translations?.(op.locale) ?? null;
            if (units === null) {
                return null;
            }
            return {
                op: "set-translations",
                units: op.units.map(entry => {
                    const held = units[entry.unitId];
                    return { unitId: entry.unitId, unit: held ? { ...held } : null };
                }),
            };
        }

        case "set-take": {
            const units = sources.takes?.(op.locale) ?? null;
            const held = units === null ? undefined : units[op.unitId];
            return units === null ? null : { op: "set-take", unit: held ? { ...held } : null };
        }

        case "set-takes": {
            const units = sources.takes?.(op.locale) ?? null;
            if (units === null) {
                return null;
            }
            return {
                op: "set-takes",
                units: op.units.map(entry => {
                    const held = units[entry.unitId];
                    return { unitId: entry.unitId, unit: held ? { ...held } : null };
                }),
            };
        }

        case "delete-character": {
            const record = cast.characters[op.characterId];
            if (!record) {
                return null;
            }
            const at = cast.order.indexOf(op.characterId);
            return at < 0 ? null : {
                op: "delete-character",
                character: structuredClone(record),
                at,
                // Read before the sweep runs, which is the only moment these rows still say whose they
                // are. Supplied by the caller, because finding them means walking every story and this
                // module is handed documents rather than reaching for them.
                spoke: [...(sources.spoke ?? [])],
            };
        }

        case "update-character": {
            const record = cast.characters[op.characterId];
            return record ? { op: "update-character", character: structuredClone(record) } : null;
        }

        case "set-character-group": {
            const group = cast.groups[op.groupId];
            return { op: "set-character-group", group: group ? { ...group } : null };
        }

        case "delete-character-group": {
            const group = cast.groups[op.groupId];
            if (!group) {
                // Already gone, so the deletion changes nothing and there is nothing to put back.
                return null;
            }
            return {
                op: "delete-character-group",
                group: { ...group },
                members: cast.order.filter(id => cast.characters[id]?.profile.groupId === op.groupId),
            };
        }

        case "update-asset": {
            const record = sources.assets?.(op.assetType)?.[op.assetId];
            // Null covers both "this machine does not hold that shard" and "no such record": neither
            // gives an inverse anything to put back, and the undo answers `no-record` either way.
            return record ? { op: "update-asset", record: structuredClone(record) } : null;
        }

        case "move-assets": {
            const records = sources.assets?.(op.assetType) ?? null;
            if (records === null) {
                return null;
            }
            return {
                op: "move-assets",
                moves: op.moves.map(move => ({
                    assetId: move.assetId,
                    // A record already gone is recorded as being at the section root rather than
                    // dropped: the batch is answered whole, and an entry missing from the record
                    // would make the two lists disagree about which row is which.
                    groupId: readGroupId(records[move.assetId]),
                })),
            };
        }

        case "create-assets":
            // Nothing to keep: what undoes a creation is a deletion of ids the operation itself
            // names, exactly as an insert's inverse needs nothing kept.
            return null;

        case "replace-asset-content":
            // Nothing to keep either, and for the opposite reason: the bytes it overwrote are gone,
            // so there is nothing an inverse could point the record back at. See `content-replaced`.
            return null;

        case "delete-assets": {
            const records = sources.assets?.(op.assetType) ?? null;
            if (records === null) {
                return null;
            }
            const kept: LiveAssetRecord[] = [];
            for (const assetId of op.assetIds) {
                const record = records[assetId];
                if (record) {
                    kept.push(structuredClone(record));
                }
            }
            return kept.length === op.assetIds.length ? { op: "delete-assets", records: kept } : null;
        }

        case "set-asset-folder": {
            const folders = sources.assetFolders?.(op.category) ?? null;
            if (folders === null) {
                return null;
            }
            const folder = folders[op.folderId];
            return { op: "set-asset-folder", folder: folder ? structuredClone(folder) : null };
        }

        case "delete-asset-folder": {
            const folders = sources.assetFolders?.(op.category) ?? null;
            if (folders === null) {
                return null;
            }
            const doomed = folderIdsUnder(folders, op.folderId, op.recursive);
            if (!folders[op.folderId]) {
                // Already gone, so the deletion changes nothing and there is nothing to put back.
                return null;
            }
            const assets: { assetType: string; record: LiveAssetRecord }[] = [];
            for (const [assetType, records] of Object.entries(sources.assetsByType?.(op.category) ?? {})) {
                for (const record of Object.values(records)) {
                    const groupId = readGroupId(record);
                    if (groupId !== null && doomed.has(groupId)) {
                        assets.push({ assetType, record: structuredClone(record) });
                    }
                }
            }
            return {
                op: "delete-asset-folder",
                folders: [...doomed].map(id => folders[id]).filter(Boolean).map(folder => structuredClone(folder)),
                assets,
            };
        }

        case "restore-asset-folder":
            // Its own inverse is a deletion of the folder it put back, which needs nothing kept.
            return null;

        case "write-ui": {
            const document = sources.ui ?? null;
            if (document === null) {
                return null;
            }
            return { op: "write-ui", parts: uiPartsBefore(document, op.parts) };
        }

        case "write-ui-graphs": {
            const document = sources.uiGraphs ?? null;
            if (document === null) {
                return null;
            }
            return { op: "write-ui-graphs", parts: uiGraphPartsBefore(document, op.parts) };
        }

        case "set-dictionary-entry": {
            const dictionary = sources.dictionary?.() ?? null;
            if (dictionary === null) {
                return null;
            }
            const target = op.entry;
            if (target && target.term !== op.term
                && dictionary.entries.some(entry => entry.term === target.term)) {
                // A rename onto a spelling the project already writes. It overwrote a second entry,
                // and one operation names one address, so nothing here could put both back. Studio
                // refuses to produce one (`updateEntry` answers false), so this is reachable only
                // from a machine a version apart - and the honest answer is that nothing was kept.
                return null;
            }
            const existing = dictionary.entries.find(entry => entry.term === op.term);
            return { op: "set-dictionary-entry", entry: existing ? { ...existing } : null };
        }

        case "set-dictionary-options": {
            const dictionary = sources.dictionary?.() ?? null;
            return dictionary === null
                ? null
                : { op: "set-dictionary-options", options: { ...dictionary.options } };
        }

        case "create-audio-track":
        case "create-asset-sets":
            // Nothing. The inverse is a deletion of what the effect already names, exactly as an
            // insert's is.
            return null;

        case "update-audio-track": {
            const track = sources.audioTracks?.()?.find(entry => entry.id === op.trackId);
            return track ? { op: "update-audio-track", track: structuredClone(track) } : null;
        }

        case "move-audio-track": {
            const tracks = sources.audioTracks?.() ?? null;
            const index = tracks === null ? -1 : tracks.findIndex(entry => entry.id === op.trackId);
            return index < 0 || tracks === null
                ? null
                : { op: "move-audio-track", beforeId: tracks[index + 1]?.id ?? null };
        }

        case "delete-audio-track": {
            const tracks = sources.audioTracks?.() ?? null;
            const index = tracks === null ? -1 : tracks.findIndex(entry => entry.id === op.trackId);
            if (tracks === null || index < 0) {
                return null;
            }
            return {
                op: "delete-audio-track",
                track: structuredClone(tracks[index]!),
                beforeId: tracks[index + 1]?.id ?? null,
                // Read before the promotion runs, which is the only moment these buses still say
                // which one they fed.
                children: tracks.filter(entry => entry.parentId === op.trackId).map(entry => entry.id),
            };
        }

        case "update-asset-set": {
            const set = sources.assetSets?.()?.find(entry => entry.id === op.setId);
            return set ? { op: "update-asset-set", set: structuredClone(set) } : null;
        }

        case "delete-asset-sets": {
            const sets = sources.assetSets?.() ?? null;
            if (sets === null) {
                return null;
            }
            const doomed = new Set(op.setIds);
            const kept: { set: AssetSet; beforeId: string | null }[] = [];
            for (let index = 0; index < sets.length; index += 1) {
                const set = sets[index]!;
                if (!doomed.has(set.id)) {
                    continue;
                }
                kept.push({
                    set: structuredClone(set),
                    beforeId: sets.slice(index + 1).find(later => !doomed.has(later.id))?.id ?? null,
                });
            }
            return kept.length > 0 ? { op: "delete-asset-sets", sets: kept } : null;
        }

        case "move-asset-sets": {
            const sets = sources.assetSets?.() ?? null;
            if (sets === null) {
                return null;
            }
            return {
                op: "move-asset-sets",
                moves: op.moves.map(move => ({
                    setId: move.setId,
                    // A set already gone is recorded as being at the top of its section rather than
                    // dropped: the batch is answered whole, and an entry missing from the record
                    // would make the two lists disagree about which row is which.
                    groupId: sets.find(entry => entry.id === move.setId)?.groupId ?? null,
                })),
            };
        }
    }
}

/** One folder and, when asked for, every folder below it. The same walk the applier does. */
function folderIdsUnder(
    folders: Readonly<Record<string, LiveAssetFolder>>,
    folderId: string,
    recursive: boolean,
): ReadonlySet<string> {
    const ids = new Set<string>([folderId]);
    if (!recursive) {
        return ids;
    }
    let grew = true;
    while (grew) {
        grew = false;
        for (const [id, folder] of Object.entries(folders)) {
            const parent = folder.parentGroupId;
            if (typeof parent === "string" && ids.has(parent) && !ids.has(id)) {
                ids.add(id);
                grew = true;
            }
        }
    }
    return ids;
}

/**
 * Whether the mixer holds this bus right now.
 *
 * Permissive when the reader is absent, so a caller that has not wired the mixer gets an inverse
 * that works rather than one that refuses everything - the same bargain `LiveHostDeps` makes.
 */
function trackPresent(context: LiveInverseContext, trackId: string): boolean {
    const tracks = context.audioTracks?.();
    return tracks === undefined || tracks === null
        ? true
        : tracks.some(track => track.id === trackId);
}

/** Whether the project declares this set right now. {@link trackPresent}'s counterpart. */
function setPresent(context: LiveInverseContext, setId: string): boolean {
    const sets = context.assetSets?.();
    return sets === undefined || sets === null ? true : sets.some(set => set.id === setId);
}

/** Which folder a record says it is in, or null for the section root and for no record at all. */
function readGroupId(record: LiveAssetRecord | undefined): string | null {
    const groupId = record?.groupId;
    return typeof groupId === "string" ? groupId : null;
}

/**
 * Where {@link captureBefore} reads from.
 *
 * Both documents rather than one, and both optional: a session carries several documents and one
 * capture call serves all of them, so the caller hands over whatever it holds and the operation
 * decides which half it needs. Absent is treated as empty rather than as an error, because a caller
 * with no cast loaded asking about a story operation is an ordinary state and not a mistake.
 */
export type LiveBeforeSources = {
    story?: StoryDocument | null;
    cast?: LiveCastView | null;
    /**
     * The dialogue rows the character about to be deleted is speaking, across every story.
     *
     * Passed in rather than derived here for the reason the rest of this module takes its documents
     * as arguments: finding them is a walk over the whole project, and a rule that reached for a
     * project could not be exercised without one.
     */
    spoke?: readonly LiveDialogueRowRef[];
    /**
     * One language's translations as they stand, or null when this machine does not hold them.
     *
     * A reader rather than a document, because which language an operation is about is stated inside
     * the operation and this is called before the switch that reads it. Still nothing but a lookup -
     * the module reaches for no service.
     */
    translations?(locale: string): Readonly<Record<string, LocalizationUnit>> | null;
    /** One language's voice takes as they stand, or null when this machine does not hold them. */
    takes?(locale: string): Readonly<Record<string, VoiceUnit>> | null;
    /**
     * One asset type's records as they stand, or null when this machine does not hold that shard.
     *
     * A reader rather than a map, for the libraries' reason: which shard an operation is about is
     * stated inside the operation, and this is called before the switch that reads it.
     */
    assets?(assetType: string): Readonly<Record<string, LiveAssetRecord>> | null;
    /** One section's folders as they stand, or null when this machine does not hold that shard. */
    assetFolders?(category: string): Readonly<Record<string, LiveAssetFolder>> | null;
    /**
     * Every shard of one section, by asset type.
     *
     * What a folder deletion has to read, and it is a section rather than a type because that is what
     * a folder belongs to: Media holds audio and video, and both of them can be inside the folder
     * being deleted.
     */
    assetsByType?(category: string): Readonly<Record<string, Readonly<Record<string, LiveAssetRecord>>>>;
    /**
     * The interface document as it stands, or null when this machine does not hold it.
     *
     * A document rather than a reader, unlike the libraries': there is one of these per project, so
     * there is no parameter inside the operation to resolve first.
     */
    ui?: UIDocument | null;
    /** The blueprint document as it stands, or null when this machine does not hold it. */
    uiGraphs?: UIGraphDocument | null;
    /**
     * The project dictionary as it stands, or null when this window does not hold it.
     *
     * A reader rather than the document, with the libraries': this is called before the switch that
     * decides which of the sources an operation needs, and a document read for every story edit
     * would be work nothing looks at.
     */
    dictionary?(): ProjectDictionaryDocument | null;
    /** The mixer as it stands, or null when this window does not hold it. */
    audioTracks?(): readonly ProjectAudioTrack[] | null;
    /** The asset sets as they stand, or null when this window does not hold them. */
    assetSets?(): readonly AssetSet[] | null;
};

/** Stand-ins for an absent source, so the cases below need no null check of their own. */
const EMPTY_STORY = { name: "", scenes: {}, chapters: [] } as unknown as StoryDocument;
const EMPTY_CAST: LiveCastView = { characters: {}, order: [], groups: {} };

/* --------------------------------------------------------------------------- the inverse */

/**
 * Everything {@link inverseOf} needs, and nothing it needs to know how to reach.
 *
 * Injected for the reason the host's and the guest's dependencies are: a rule that can only be
 * exercised against a running session is a rule nobody can check.
 */
export type LiveInverseContext = {
    /** This machine's instance id. An effect by anybody else has no inverse here. */
    self: string;
    /** The story as it stands NOW - after the effect, and after everything that followed it. */
    document?: StoryDocument | null;
    /** The cast as it stands NOW, for the operations that are about it. */
    cast?: LiveCastView | null;
    /** One asset type's records as they stand NOW, for the operations that are about the library. */
    assets?(assetType: string): Readonly<Record<string, LiveAssetRecord>> | null;
    /** One section's folders as they stand NOW, for the operations that are about them. */
    assetFolders?(category: string): Readonly<Record<string, LiveAssetFolder>> | null;
    /** The mixer as it stands NOW, for the operations that are about it. */
    audioTracks?(): readonly ProjectAudioTrack[] | null;
    /** The asset sets as they stand NOW, for the operations that are about them. */
    assetSets?(): readonly AssetSet[] | null;
    /** What {@link captureBefore} read before this effect was applied, or null if nothing was kept. */
    before: LiveBefore | null;
};

/**
 * The operation that undoes an effect, or the reason there is not one.
 *
 * Two shapes rather than an operation and a null, so that a caller cannot forget the second
 * outcome: nothing can be sent without narrowing, and narrowing means the refusal has been read.
 */
export type LiveInverse =
    | { op: LiveOp }
    | { impossible: LiveInverseReason };

/**
 * What undoes `effect`, or why nothing does.
 *
 * The switch is exhaustive over the vocabulary and has no default, so a verb added to it fails to
 * compile here until somebody has said what takes it back.
 *
 * The checks run in the order a reason stops being worth reporting: what the record itself settles
 * comes first (there is none; the operation was never invertible), then the scene, then the row,
 * then where the row has to go. `subtree-lost` in particular is a fact about the operation and not
 * about the document, so it is answered without reading the scene at all - an interface can grey
 * the entry out the moment the delete lands and never re-ask.
 */
export function inverseOf(effect: LiveEffect, context: LiveInverseContext): LiveInverse {
    if (effect.by !== context.self) {
        // Not a case that is merely refused: an effect somebody else caused is not this machine's
        // to take back at all, and the interface must not be able to draw an entry for one.
        return { impossible: "not-mine" };
    }

    const { before } = context;
    const document = context.document ?? EMPTY_STORY;
    const cast = context.cast ?? EMPTY_CAST;
    // The operation as APPLIED, which is not always the one that was asked for - see LiveEffect.op.
    // An insert whose anchor had been deleted landed where that row stood, and the row is now where
    // the effect says it is rather than where its author aimed.
    const op = effect.op;

    switch (op.op) {
        case "insert-block": {
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return { impossible: "scene-gone" };
            }
            const row = scene.blocks[op.block.id];
            if (!row) {
                return { impossible: "row-gone" };
            }
            if (row.childrenIds.length > 0) {
                return { impossible: "container-filled" };
            }
            return { op: { op: "delete-block", sceneId: op.sceneId, blockId: op.block.id } };
        }

        case "update-block": {
            if (!before || before.op !== "update-block") {
                return { impossible: "no-record" };
            }
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return { impossible: "scene-gone" };
            }
            if (!scene.blocks[op.blockId]) {
                return { impossible: "row-gone" };
            }
            return { op: { op: "update-block", sceneId: op.sceneId, blockId: op.blockId, payload: before.payload } };
        }

        case "update-blocks": {
            if (!before || before.op !== "update-blocks" || before.edits.length !== op.edits.length) {
                return { impossible: "no-record" };
            }
            // Whole or not at all, checked before any of it is offered. Half a replace put back is
            // an arrangement neither author asked for, and the entry that produced it would already
            // be off the stack by the time anybody noticed.
            for (const edit of before.edits) {
                const scene = document.scenes[edit.sceneId];
                if (!scene) {
                    return { impossible: "scene-gone" };
                }
                if (!scene.blocks[edit.blockId]) {
                    return { impossible: "row-gone" };
                }
            }
            return {
                op: {
                    op: "update-blocks",
                    // Copies, because applying an update writes the payload into the document. The
                    // record has to survive to answer a redo.
                    edits: before.edits.map(edit => ({
                        sceneId: edit.sceneId,
                        blockId: edit.blockId,
                        payload: structuredClone(edit.payload),
                    })),
                },
            };
        }

        case "move-blocks": {
            const moved = new Set(op.moves.flatMap(move => [...move.blockIds]));
            if (!before || before.op !== "move-blocks" || before.at.length !== moved.size) {
                return { impossible: "no-record" };
            }
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return { impossible: "scene-gone" };
            }
            for (const row of before.at) {
                if (!moved.has(row.blockId)) {
                    return { impossible: "no-record" };
                }
                if (!scene.blocks[row.blockId]) {
                    return { impossible: "row-gone" };
                }
                if (row.at.parentId !== null && !scene.blocks[row.at.parentId]) {
                    return { impossible: "container-gone" };
                }
                if (row.at.beforeBlockId !== null && !scene.blocks[row.at.beforeBlockId]) {
                    return { impossible: "anchor-gone" };
                }
            }
            return {
                op: {
                    op: "move-blocks",
                    sceneId: op.sceneId,
                    // One row per group, from the back of the document forwards. Each row goes in
                    // front of the successor it had, and taking the last one first is what makes
                    // that successor already be where it belongs: rows that moved and sat after this
                    // one have been put back, and rows that did not move never left. Front to back
                    // would aim every row at a neighbour still standing in the wrong place.
                    moves: [...before.at]
                        .reverse()
                        .map(row => ({ blockIds: [row.blockId], target: { ...row.at } })),
                },
            };
        }

        case "delete-block": {
            if (!before || before.op !== "delete-block" || before.block.id !== op.blockId) {
                return { impossible: "no-record" };
            }
            if (before.block.childrenIds.length > 0) {
                return { impossible: "subtree-lost" };
            }
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return { impossible: "scene-gone" };
            }
            if (scene.blocks[op.blockId]) {
                return { impossible: "row-restored" };
            }
            if (before.at.parentId !== null && !scene.blocks[before.at.parentId]) {
                return { impossible: "container-gone" };
            }
            // The successor is NOT checked, and that is the difference between putting a row back
            // and moving one: the host resolves an insert's anchor against the rows it watched
            // being deleted, so a row whose neighbour has since gone still lands where it was.
            //
            // A copy, because applying an insert writes the block into the document and edits it on
            // the way in. Handing over the record itself would leave a redo holding a block that
            // belongs to the scene.
            return {
                op: {
                    op: "insert-block",
                    sceneId: op.sceneId,
                    block: structuredClone(before.block),
                    target: { parentId: before.at.parentId, beforeBlockId: before.at.beforeBlockId },
                },
            };
        }

        case "insert-blocks": {
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return { impossible: "scene-gone" };
            }
            const own = new Set(op.inserts.map(insert => insert.block.id));
            for (const insert of op.inserts) {
                const row = scene.blocks[insert.block.id];
                if (!row) {
                    return { impossible: "row-gone" };
                }
                // A row this batch put down may hold the rows this batch put inside it - a pasted
                // container is exactly that. What it may NOT hold is anything somebody has written
                // into it since, because taking the paste back would take that with it.
                if (row.childrenIds.some(childId => !own.has(childId))) {
                    return { impossible: "container-filled" };
                }
            }
            // In the order they were placed, so a container is named before the rows inside it. The
            // applier removes a container's children with it and treats an id already gone as
            // nothing to do, which is what makes that order safe rather than merely tidy.
            return {
                op: {
                    op: "delete-blocks",
                    sceneId: op.sceneId,
                    blockIds: op.inserts.map(insert => insert.block.id),
                },
            };
        }

        case "delete-blocks": {
            if (!before || before.op !== "delete-blocks") {
                return { impossible: "no-record" };
            }
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return { impossible: "scene-gone" };
            }
            const recorded = new Set(before.rows.map(row => row.block.id));
            for (const row of before.rows) {
                if (scene.blocks[row.block.id]) {
                    return { impossible: "row-restored" };
                }
                // A container is restorable exactly when the rows that were inside it are coming
                // back too. One that is not - a selection delete names roots only - would come back
                // empty, which is not the document the author asked to have back.
                if (row.block.childrenIds.some(childId => !recorded.has(childId))) {
                    return { impossible: "subtree-lost" };
                }
                if (row.at.parentId !== null && !recorded.has(row.at.parentId) && !scene.blocks[row.at.parentId]) {
                    return { impossible: "container-gone" };
                }
            }
            // Front to back, which is the order they sat in: a container is put back before the rows
            // that go inside it. Successors are NOT checked, for the reason a single delete's
            // inverse does not check its own - the host resolves an insert's anchor against the rows
            // it watched being deleted, so a row still lands where it was even though its neighbour
            // in this same batch has not been restored yet.
            //
            // Copies, because applying an insert writes the block into the document and edits it on
            // the way in; handing over the records themselves would leave a redo holding blocks that
            // belong to the scene.
            return {
                op: {
                    op: "insert-blocks",
                    sceneId: op.sceneId,
                    inserts: before.rows.map(row => ({
                        block: structuredClone(row.block),
                        target: { parentId: row.at.parentId, beforeBlockId: row.at.beforeBlockId },
                    })),
                },
            };
        }

        case "move-block": {
            if (!before || before.op !== "move-block") {
                return { impossible: "no-record" };
            }
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return { impossible: "scene-gone" };
            }
            if (!scene.blocks[op.blockId]) {
                return { impossible: "row-gone" };
            }
            if (before.at.parentId !== null && !scene.blocks[before.at.parentId]) {
                return { impossible: "container-gone" };
            }
            if (before.at.beforeBlockId !== null && !scene.blocks[before.at.beforeBlockId]) {
                // Refused here rather than sent and refused there, so the author is told before the
                // round trip. The host would say the same thing: it does not resolve a move's anchor
                // against deleted rows, because moving again costs one gesture and landing a
                // paragraph where nobody sent it costs finding it first.
                return { impossible: "anchor-gone" };
            }
            return {
                op: {
                    op: "move-block",
                    sceneId: op.sceneId,
                    blockId: op.blockId,
                    target: { parentId: before.at.parentId, beforeBlockId: before.at.beforeBlockId },
                },
            };
        }

        case "set-block-disabled": {
            if (!before || before.op !== "set-block-disabled") {
                return { impossible: "no-record" };
            }
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return { impossible: "scene-gone" };
            }
            if (!scene.blocks[op.blockId]) {
                return { impossible: "row-gone" };
            }
            return {
                op: { op: "set-block-disabled", sceneId: op.sceneId, blockId: op.blockId, disabled: before.disabled },
            };
        }

        case "rename-scene": {
            if (!before || before.op !== "rename-scene") {
                return { impossible: "no-record" };
            }
            if (!document.scenes[op.sceneId]) {
                return { impossible: "scene-gone" };
            }
            return { op: { op: "rename-scene", sceneId: op.sceneId, name: before.name } };
        }

        case "set-entry-scene": {
            if (!before || before.op !== "set-entry-scene") {
                return { impossible: "no-record" };
            }
            if (before.sceneId !== null && !document.scenes[before.sceneId]) {
                // The scene that used to be the entry is gone. Naming it again would be refused by
                // the host, and there is no other scene that means "the one it was before".
                return { impossible: "scene-gone" };
            }
            return { op: { op: "set-entry-scene", sceneId: before.sceneId } };
        }

        case "rename-story": {
            if (!before || before.op !== "rename-story") {
                return { impossible: "no-record" };
            }
            // The only operation with no way to fail. A story has a name, the name it had is known,
            // and nothing that happens in a session can take away the thing being renamed.
            return { op: { op: "rename-story", name: before.name } };
        }

        case "reorder-chapters": {
            if (!before || before.op !== "reorder-chapters") {
                return { impossible: "no-record" };
            }
            if (!sameChapters(before.chapterIds, document.chapters)) {
                // An order is a statement about a set. Applying one written for a different set
                // would silently drop the chapters it does not name, which is a far larger edit
                // than the one being undone.
                return { impossible: "chapters-changed" };
            }
            return { op: { op: "reorder-chapters", chapterIds: [...before.chapterIds] } };
        }

        case "create-character": {
            const id = op.character.profile.id;
            if (!cast.characters[id]) {
                return { impossible: "character-gone" };
            }
            return { op: { op: "delete-character", characterId: id } };
        }

        case "delete-character": {
            if (!before || before.op !== "delete-character") {
                return { impossible: "no-record" };
            }
            if (cast.characters[op.characterId]) {
                // Somebody put it back - a redo of this delete, or an undo somewhere else - and
                // creating it again would be a second copy of one character under one id.
                return { impossible: "character-restored" };
            }
            return {
                op: {
                    op: "create-character",
                    character: structuredClone(before.character),
                    // The lines this character was speaking when it went. Nothing else can answer
                    // that now: they hold a bare name, and a name is not an identifier.
                    rebind: [...before.spoke],
                },
            };
        }

        case "update-character": {
            if (!before || before.op !== "update-character") {
                return { impossible: "no-record" };
            }
            if (!cast.characters[op.characterId]) {
                // Refused rather than turned back into a creation. Putting a record back that
                // somebody else deleted is not undoing an edit, it is making a character - and the
                // author asked for neither.
                return { impossible: "character-gone" };
            }
            return {
                op: {
                    op: "update-character",
                    characterId: op.characterId,
                    character: structuredClone(before.character),
                },
            };
        }

        case "set-character-group": {
            if (!before || before.op !== "set-character-group") {
                return { impossible: "no-record" };
            }
            if (before.group === null) {
                // There was no group, so the operation created one and taking it back is removing it.
                return { op: { op: "delete-character-group", groupId: op.groupId } };
            }
            return { op: { op: "set-character-group", groupId: op.groupId, group: { ...before.group } } };
        }

        case "set-translation": {
            if (!before || before.op !== "set-translation") {
                return { impossible: "no-record" };
            }
            // No way to fail, and the reason belongs to the document rather than to this operation:
            // an entry is whatever it was last set to, and nothing in a session can take away the
            // thing it is about - the story row it belongs to lives in another document, and a
            // translation of a line that has since been deleted is a harmless orphan the library
            // already tolerates.
            return {
                op: {
                    op: "set-translation",
                    locale: op.locale,
                    unitId: op.unitId,
                    unit: before.unit === null ? null : { ...before.unit },
                },
            };
        }

        case "set-translations": {
            if (!before || before.op !== "set-translations" || before.units.length !== op.units.length) {
                return { impossible: "no-record" };
            }
            return {
                op: {
                    op: "set-translations",
                    locale: op.locale,
                    // Copies, because applying one writes the unit into the library; handing over
                    // the record itself would leave a redo holding entries that belong to it.
                    units: before.units.map(entry => ({
                        unitId: entry.unitId,
                        unit: entry.unit === null ? null : { ...entry.unit },
                    })),
                },
            };
        }

        case "set-take": {
            if (!before || before.op !== "set-take") {
                return { impossible: "no-record" };
            }
            return {
                op: {
                    op: "set-take",
                    locale: op.locale,
                    unitId: op.unitId,
                    unit: before.unit === null ? null : { ...before.unit },
                },
            };
        }

        case "set-takes": {
            if (!before || before.op !== "set-takes" || before.units.length !== op.units.length) {
                return { impossible: "no-record" };
            }
            return {
                op: {
                    op: "set-takes",
                    locale: op.locale,
                    units: before.units.map(entry => ({
                        unitId: entry.unitId,
                        unit: entry.unit === null ? null : { ...entry.unit },
                    })),
                },
            };
        }

        case "update-asset": {
            if (!before || before.op !== "update-asset") {
                return { impossible: "no-record" };
            }
            if (!context.assets?.(op.assetType)?.[op.assetId]) {
                // Somebody deleted the file after the edit landed. Putting the record back would be
                // a row in the browser with no bytes under it.
                return { impossible: "asset-gone" };
            }
            return {
                op: {
                    op: "update-asset",
                    assetType: op.assetType,
                    assetId: op.assetId,
                    record: structuredClone(before.record),
                },
            };
        }

        case "move-assets": {
            if (!before || before.op !== "move-assets" || before.moves.length !== op.moves.length) {
                return { impossible: "no-record" };
            }
            const records = context.assets?.(op.assetType) ?? null;
            if (records === null) {
                return { impossible: "no-record" };
            }
            // Whole or not at all, the rule every batch follows: a drag put back for the rows that
            // survive and not for the rest is an arrangement neither the author nor anybody else
            // produced, and nothing on screen would say half of it was skipped.
            for (const move of before.moves) {
                if (!records[move.assetId]) {
                    return { impossible: "asset-gone" };
                }
            }
            return {
                op: {
                    op: "move-assets",
                    assetType: op.assetType,
                    moves: before.moves.map(move => ({ assetId: move.assetId, groupId: move.groupId })),
                },
            };
        }

        case "create-assets": {
            // What undoes a creation is a deletion of exactly the ids it made. Nothing had to be
            // kept, and the bytes it wrote go to each machine's own trash on the way out - which is
            // what makes redoing it free.
            const ids: string[] = [];
            for (const create of op.creates) {
                const id = create.record.id;
                if (typeof id !== "string") {
                    return { impossible: "no-record" };
                }
                ids.push(id);
            }
            return { op: { op: "delete-assets", assetType: op.assetType, assetIds: ids } };
        }

        case "replace-asset-content":
            // The bytes it overwrote are gone. See `content-replaced` - this is the answer replacing
            // has always given, in a session or out of one.
            return { impossible: "content-replaced" };

        case "delete-assets": {
            if (!before || before.op !== "delete-assets" || before.records.length !== op.assetIds.length) {
                return { impossible: "no-record" };
            }
            return {
                op: {
                    op: "create-assets",
                    assetType: op.assetType,
                    // ⚠ `from: "trash"` and not a transfer. Every machine put its own copy of each
                    // file in its own trash when it applied the deletion, so putting them back costs
                    // one message however large they are.
                    creates: before.records.map(record => ({
                        record: structuredClone(record),
                        bytes: { from: "trash" as const },
                    })),
                },
            };
        }

        case "set-asset-folder": {
            if (!before || before.op !== "set-asset-folder") {
                return { impossible: "no-record" };
            }
            if (before.folder === null) {
                // There was no folder, so the operation created one and taking it back is removing
                // it. Not recursive: it was empty when it was made, and anything put into it since
                // belongs to whoever put it there.
                return {
                    op: {
                        op: "delete-asset-folder",
                        category: op.category,
                        folderId: op.folderId,
                        recursive: false,
                    },
                };
            }
            return {
                op: {
                    op: "set-asset-folder",
                    category: op.category,
                    folderId: op.folderId,
                    folder: structuredClone(before.folder),
                },
            };
        }

        case "delete-asset-folder": {
            if (!before || before.op !== "delete-asset-folder") {
                return { impossible: "no-record" };
            }
            return {
                op: {
                    op: "restore-asset-folder",
                    category: op.category,
                    folders: before.folders.map(folder => structuredClone(folder)),
                    assets: before.assets.map(entry => ({
                        assetType: entry.assetType,
                        record: structuredClone(entry.record),
                    })),
                },
            };
        }

        case "set-dictionary-entry": {
            if (!before || before.op !== "set-dictionary-entry") {
                return { impossible: "no-record" };
            }
            // ⚠ The address of the inverse is where the entry ENDED UP, not where it started -
            // which for a rename is the new spelling, and for everything else is the same word. One
            // statement therefore covers all four shapes this verb has: an addition is undone by
            // removing what it wrote, a removal by putting the record back, an edit by restoring the
            // record at the same address, and a rename by clearing the new spelling and writing the
            // old entry, which carries its own old term.
            return {
                op: {
                    op: "set-dictionary-entry",
                    term: op.entry?.term ?? op.term,
                    entry: before.entry === null ? null : { ...before.entry },
                },
            };
        }

        case "set-dictionary-options": {
            if (!before || before.op !== "set-dictionary-options") {
                return { impossible: "no-record" };
            }
            return { op: { op: "set-dictionary-options", options: { ...before.options } } };
        }

        case "create-audio-track": {
            if (!trackPresent(context, op.track.id)) {
                return { impossible: "track-gone" };
            }
            return { op: { op: "delete-audio-track", trackId: op.track.id } };
        }

        case "update-audio-track": {
            if (!before || before.op !== "update-audio-track") {
                return { impossible: "no-record" };
            }
            if (!trackPresent(context, op.trackId)) {
                return { impossible: "track-gone" };
            }
            return {
                op: {
                    op: "update-audio-track",
                    trackId: op.trackId,
                    track: structuredClone(before.track),
                },
            };
        }

        case "move-audio-track": {
            if (!before || before.op !== "move-audio-track") {
                return { impossible: "no-record" };
            }
            if (!trackPresent(context, op.trackId)) {
                return { impossible: "track-gone" };
            }
            return { op: { op: "move-audio-track", trackId: op.trackId, beforeId: before.beforeId } };
        }

        case "delete-audio-track": {
            if (!before || before.op !== "delete-audio-track") {
                return { impossible: "no-record" };
            }
            if (trackPresent(context, op.trackId)) {
                // Somebody put it back, so there is nothing left to restore and doing it anyway
                // would overwrite whatever they made of it.
                return { impossible: "track-restored" };
            }
            return {
                op: {
                    op: "create-audio-track",
                    track: structuredClone(before.track),
                    beforeId: before.beforeId,
                    // The promotion coming home. Carried rather than derived - see `LiveBefore`.
                    reparent: [...before.children],
                },
            };
        }

        case "create-asset-sets":
            // What undoes a declaration is a deletion of exactly the sets it made. Nothing had to be
            // kept, and a set that has since gone is not an error: the deletion is tolerant of it.
            return {
                op: {
                    op: "delete-asset-sets",
                    setIds: op.creates.map(create => create.set.id),
                },
            };

        case "update-asset-set": {
            if (!before || before.op !== "update-asset-set") {
                return { impossible: "no-record" };
            }
            if (!setPresent(context, op.setId)) {
                return { impossible: "set-gone" };
            }
            return {
                op: { op: "update-asset-set", setId: op.setId, set: structuredClone(before.set) },
            };
        }

        case "delete-asset-sets": {
            if (!before || before.op !== "delete-asset-sets" || before.sets.length !== op.setIds.length) {
                return { impossible: "no-record" };
            }
            for (const entry of before.sets) {
                if (setPresent(context, entry.set.id)) {
                    return { impossible: "set-restored" };
                }
            }
            return {
                op: {
                    op: "create-asset-sets",
                    creates: before.sets.map(entry => ({
                        set: structuredClone(entry.set),
                        beforeId: entry.beforeId,
                    })),
                },
            };
        }

        case "move-asset-sets": {
            if (!before || before.op !== "move-asset-sets" || before.moves.length !== op.moves.length) {
                return { impossible: "no-record" };
            }
            // Whole or not at all, the rule every batch follows: a drag put back for the rows that
            // survive and not for the rest is an arrangement neither author produced.
            for (const move of before.moves) {
                if (!setPresent(context, move.setId)) {
                    return { impossible: "set-gone" };
                }
            }
            return {
                op: {
                    op: "move-asset-sets",
                    moves: before.moves.map(move => ({ setId: move.setId, groupId: move.groupId })),
                },
            };
        }

        case "restore-asset-folder":
            // Taking a restoration back removes what it put back, and recursively: it may have
            // brought a whole tree with it.
            return {
                op: {
                    op: "delete-asset-folder",
                    category: op.category,
                    folderId: firstFolderId(op.folders) ?? "",
                    recursive: true,
                },
            };

        case "delete-character-group": {
            if (!before || before.op !== "delete-character-group") {
                return { impossible: "no-record" };
            }
            // The membership travels with the restoration, as one operation: a group put back empty
            // is a group with the right name and the cast still scattered, and the author would have
            // to re-assign every member by hand. Members that have since been deleted are dropped by
            // the applier rather than refused here - the group is still the group it was, minus
            // somebody nobody has.
            return {
                op: {
                    op: "set-character-group",
                    groupId: op.groupId,
                    group: { ...before.group },
                    members: [...before.members],
                },
            };
        }

        case "write-ui": {
            if (!before || before.op !== "write-ui") {
                return { impossible: "no-record" };
            }
            // A delta of the other side, and its own precondition: every element it puts back was
            // there before the operation and is therefore there now, so naming them makes an undo
            // whose target somebody has since deleted refuse rather than resurrect.
            return {
                op: {
                    op: "write-ui",
                    parts: before.parts,
                    updates: uiPartsRestored(before.parts),
                },
            };
        }

        case "write-ui-graphs": {
            if (!before || before.op !== "write-ui-graphs") {
                return { impossible: "no-record" };
            }
            return {
                op: {
                    op: "write-ui-graphs",
                    parts: before.parts,
                    updates: uiGraphPartsRestored(before.parts),
                },
            };
        }
    }
}

/** The outermost folder of a restored tree - the one whose deletion takes the rest with it. */
function firstFolderId(folders: readonly LiveAssetFolder[]): string | null {
    const ids = new Set(folders.map(folder => folder.id).filter((id): id is string => typeof id === "string"));
    for (const folder of folders) {
        const parent = folder.parentGroupId;
        if ((typeof parent !== "string" || !ids.has(parent)) && typeof folder.id === "string") {
            return folder.id;
        }
    }
    return null;
}

/* ------------------------------------------------------------------------------- reading */

function blockIn(document: StoryDocument, sceneId: StorySceneId, blockId: StoryBlockId): StoryBlock | null {
    const scene = document.scenes[sceneId];
    return scene ? scene.blocks[blockId] ?? null : null;
}

/**
 * Where a row sits: whose child it is, and which sibling follows it.
 *
 * Asked of the host's own position memory rather than worked out again here, so that "where a row
 * was" has one definition in the session and not a second one that can drift from it. Building a
 * store to ask it one question is cheap, and the alternative is a copy of a rule that already
 * exists.
 */
function positionOf(scene: StoryScene, blockId: StoryBlockId): LivePosition | null {
    const positions = new DeletedPositions();
    positions.remember(scene, blockId);
    return positions.get(scene.id, blockId);
}

/** Every row of a scene, parents before their children, in the order they are drawn. */
function documentOrder(scene: StoryScene): StoryBlockId[] {
    const walk = (ids: readonly StoryBlockId[]): StoryBlockId[] =>
        ids.flatMap(id => [id, ...walk(scene.blocks[id]?.childrenIds ?? [])]);
    return walk(scene.rootBlockIds);
}

/** Whether a recorded order names exactly the chapters the document has now. */
function sameChapters(recorded: readonly string[], chapters: readonly { id: string }[]): boolean {
    if (recorded.length !== chapters.length) {
        return false;
    }
    const present = new Set(chapters.map(chapter => chapter.id));
    return recorded.every(id => present.has(id));
}
