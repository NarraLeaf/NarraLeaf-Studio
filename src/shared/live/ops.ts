import type { CharacterGroup, StoredCharacter } from "@shared/types/character/model";
import type { LocalizationUnit } from "@shared/types/localization";
import type { VoiceUnit } from "@shared/types/voice";
import type {
    StoryBlock,
    StoryBlockId,
    StoryId,
    StorySceneId,
} from "@shared/types/story";

/**
 * What the machines in a live session say to each other.
 *
 * **One rule explains every shape here: only the host changes the document.** Everybody else sends
 * an *intent* - a thing they would like done - and the host, which holds the only copy that counts,
 * applies intents one at a time and broadcasts the *effect* it produced. An effect is also the
 * receipt for the intent that asked for it, and a *refusal* is the other answer. Nothing arrives at
 * a guest that the host has not already done.
 *
 * Four consequences, and all of them are things this file does NOT have to contain:
 *
 *  - **No transformation.** There is one applier, so operations never have to be rewritten against
 *    concurrent ones.
 *  - **No rollback.** A guest never applies its own intent first and takes it back later.
 *  - **No consensus.** A claim on a line is a note in the host's memory, not an agreement.
 *  - **No ordering protocol.** The order is the order the host applied things in, and
 *    {@link LiveEffect.seq} states it.
 *
 * **The server never reads any of this.** Every message below travels as the opaque payload of one
 * `live.say`, so the Team protocol needs no addition to carry a feature it knows nothing about. Keep
 * it that way: anything that would need the server to understand a message belongs somewhere else.
 *
 * **More than one document travels here, and each one brings its own verbs.** A session used to be
 * about a single story; it is now about a set of documents, and the set is
 * `@shared/live/sharedDocuments`. The rule for adding the next one is the rule the story and the
 * cast were both built to: **one operation is the finest thing the owning service can state at the
 * one point every edit to that document passes through.** For a story that is a block, because
 * `StoryService`'s mutators take one; for the cast it is a whole character record, because
 * `CharacterService` learns of an edit from a change notification that names the record and nothing
 * else. What is forbidden is the verb that would fit any document - "here is the new file" - which is
 * whole-document last-writer-wins, and the reason a line of prose has a claim on it instead.
 *
 * ⚠ **Size.** One `live.say` payload is capped, and a whole document is far larger than the cap.
 * That is not a limitation to work around here - the bulk of a project travels through version
 * control, a session opens on an already-committed revision, and this channel carries only the
 * difference since then. An operation is a few hundred bytes; if a log grows uncomfortable the host
 * records a checkpoint and re-bases the session on it.
 */

/* ------------------------------------------------------------------ operations */

/**
 * Where a block goes, relative to what is already there.
 *
 * The same shape the story service takes, and relative on purpose: an absolute index would be a
 * statement about a document that has moved on by the time it arrives. `beforeBlockId` names the
 * block to sit in front of; absent or null means the end of `parentId`'s children.
 */
export type LiveBlockTarget = {
    parentId: StoryBlockId | null;
    beforeBlockId?: StoryBlockId | null;
};

/**
 * Everything that can be done to a story document. **Deliberately the story service's own methods**
 * rather than a second set of verbs invented for the wire: those methods already address by id,
 * already take a relative target, and are already what every editing gesture ends up calling. A
 * parallel vocabulary would be a second model of the document to keep in step with the first.
 */
export type LiveStoryOp =
    /** Add a block. The block arrives whole, with the id its author minted. */
    | { op: "insert-block"; sceneId: StorySceneId; block: StoryBlock; target: LiveBlockTarget }
    /**
     * Replace a block's payload.
     *
     * The whole payload rather than a patch of it, because the editing atom is already a committed
     * line: prose accumulates in a draft and reaches the document on Enter or blur. A field-level
     * patch would buy precision the interface never produces.
     */
    | { op: "update-block"; sceneId: StorySceneId; blockId: StoryBlockId; payload: StoryBlock["payload"] }
    /**
     * Replace many payloads, across any number of scenes, as ONE operation.
     *
     * **Not a convenience, and not decomposable into a run of {@link LiveOp} `update-block`s.** The
     * host applies one operation at a time and broadcasts each: a project-wide replace sent as two
     * hundred operations would make every other machine draw a hundred and ninety-nine half-finished
     * documents, and somebody else's operation landing between two of them would produce a document
     * nobody wrote. One gesture is one operation.
     */
    | {
          op: "update-blocks";
          edits: readonly { sceneId: StorySceneId; blockId: StoryBlockId; payload: StoryBlock["payload"] }[];
      }
    /**
     * Add many blocks, in the order given, as ONE operation.
     *
     * What a paste is. The same reasoning as `update-blocks` and `move-blocks`, and one consequence
     * of its own: **a paste sent as a run of `insert-block`s is a run of undo steps**, so taking one
     * back inside a session costs a press per row while taking the same paste back outside one costs
     * a single press. One gesture is one operation, on both sides of the seam.
     *
     * The list is a flattened tree in insertion order - a parent before its children - so an entry
     * may aim inside or beside another entry of the same batch. Those targets are correct by
     * construction and the host does not resolve them against the document; see `LiveHost`.
     */
    | {
          op: "insert-blocks";
          sceneId: StorySceneId;
          inserts: readonly { block: StoryBlock; target: LiveBlockTarget }[];
      }
    | { op: "delete-block"; sceneId: StorySceneId; blockId: StoryBlockId }
    /**
     * Remove many rows, as ONE operation.
     *
     * Deleting a selection is one gesture, and a run of `delete-block`s makes it several: every other
     * machine draws each intermediate document, one refused row leaves the rest deleted with nothing
     * saying so, and the author's undo walks back through rows one at a time. It is also the inverse
     * of `insert-blocks`, which is what lets a paste be taken back in one press.
     *
     * The ids are given in document order and removed in that order. Naming a row and its own
     * container is allowed - the container takes its children with it, and an id already gone by the
     * time its turn comes is not an error.
     */
    | { op: "delete-blocks"; sceneId: StorySceneId; blockIds: readonly StoryBlockId[] }
    | { op: "move-block"; sceneId: StorySceneId; blockId: StoryBlockId; target: LiveBlockTarget }
    /**
     * Move groups of rows, each group to its own target, as ONE operation.
     *
     * Dragging a five-row selection is one gesture and one arrangement; the same reasoning as
     * `update-blocks`, and here the intermediate states are visibly wrong rather than merely
     * incomplete - a selection halfway to its destination is an order the author never asked for.
     * The groups are applied in the order given and every row in a group lands in front of the same
     * anchor, which is what the story service's own `moveBlocks` does.
     */
    | {
          op: "move-blocks";
          sceneId: StorySceneId;
          moves: readonly { blockIds: readonly StoryBlockId[]; target: LiveBlockTarget }[];
      }
    | { op: "set-block-disabled"; sceneId: StorySceneId; blockId: StoryBlockId; disabled: boolean }
    | { op: "rename-scene"; sceneId: StorySceneId; name: string }
    /** The scene the story starts at, or null to leave it unset. */
    | { op: "set-entry-scene"; sceneId: StorySceneId | null }
    | { op: "rename-story"; name: string }
    /** Chapters in their new order, named by id. */
    | { op: "reorder-chapters"; chapterIds: readonly string[] };

/** One dialogue row, addressed across the whole project. What a rebind names. */
export type LiveDialogueRowRef = {
    storyId: StoryId;
    sceneId: StorySceneId;
    blockId: StoryBlockId;
};

/**
 * Everything that can be done to the cast.
 *
 * **Six verbs where the story has thirteen, and the difference is not that a character is simpler.**
 * `StoryService` exposes a mutator per gesture, so the wire could borrow them. `CharacterService`
 * does not: a character's fields are changed by around eighty setters on `CharacterProfile` and
 * `CharacterAppearance`, objects the panels hold directly, and the service hears about all of them
 * through one change notification - `character.setOnChange` - which fires *after* the fact and says
 * only which record moved. So the finest thing that can be stated truthfully at the one point every
 * cast edit passes through is **one record, whole**, and that is what `update-character` carries.
 *
 * That is not the whole-document last-writer-wins this file refuses, and the difference is worth
 * stating because the two look alike from a distance. A whole *file* operation makes the loser lose a
 * paragraph somebody else was writing, silently. A whole *record* operation is claimed - see
 * {@link CLAIMED_OPS} - so two people cannot be inside one character at once, and the second is told
 * why before they have typed anything. Last-writer-wins happens only where the claim was refused,
 * and there it is not silent.
 *
 * ⚠ **A record can outgrow the payload cap.** A layered character with a PSD fingerprint, dozens of
 * layers and a snapshot table is bounded by nothing, and one `live.say` is 16 KB. An operation that
 * will not fit is refused by name (`too-large`) and said out loud; it is never truncated, and it never
 * degrades into "look this record up in your own store", which would derive nothing anywhere else.
 * Splitting the appearance into verbs of its own is the fix, and it is a later round's.
 */
export type LiveCharacterOp =
    /**
     * Add a character. The record arrives whole, with the id its author minted.
     *
     * Separate from `update-character` for the reason `insert-block` is separate from `update-block`:
     * an update naming a record that is gone has to be refused, so that the author keeps what they
     * just typed, and a single verb that created whatever it could not find would instead silently
     * resurrect a character somebody else deleted.
     */
    | {
          op: "create-character";
          character: StoredCharacter;
          /**
           * Dialogue rows to point back at this character, for the creation that undoes a deletion.
           *
           * **Carried, where the deletion's own sweep is derived, and the asymmetry is the point.**
           * Going down, "which rows does this character speak" is a question about the document.
           * Coming back up, the rows now hold a bare name, and a name is not an identifier - two
           * characters may share one, and the author may have written more lines under it since. So
           * the only correct answer is the one recorded when the deletion happened, which is this.
           * Absent for an ordinary creation, which has no lines to reclaim.
           */
          rebind?: readonly LiveDialogueRowRef[];
      }
    /** Replace a character's record. The whole record - see {@link LiveCharacterOp}. */
    | { op: "update-character"; characterId: string; character: StoredCharacter }
    /**
     * Remove a character, and let every machine rewrite the lines it spoke.
     *
     * **One operation for something that changes several documents, because the other documents'
     * share of it is DERIVED rather than carried.** A deleted character's dialogue rows keep their
     * words and lose their speaker id, falling back to the bare name so the line still reads as it
     * always did - and every machine can work out exactly which rows those are, from a cast and a set
     * of story documents the room already agrees on. Sending them would be a second statement of
     * something every receiver can compute, and the criterion for that is the one a paste's
     * translations fail and this passes: **can everybody else reach the same answer from the same
     * effect?**
     *
     * ⚠ **What the sweep touches is fingerprinted, not taken on trust.** The applier reports which
     * scenes it rewrote and the effect carries a digest for each - see {@link LiveEffect.digests} -
     * so a machine that swept differently is caught by the same guard that catches everything else,
     * on the same message rather than some later one.
     */
    | { op: "delete-character"; characterId: string }
    /**
     * Add or replace a group, and say who is in it.
     *
     * One verb for creating and for replacing, unlike the character pair above, because a group is
     * four fields and none of them is drafted anywhere: there is no half-typed paragraph for a
     * resurrection to overwrite, so the case that split exists to catch cannot arise here.
     *
     * `members` is present only when the membership is part of the same gesture, which is what
     * putting a deleted group back is: restoring the record alone would leave an empty group with the
     * right name and the cast still scattered, and sending each member as its own `update-character`
     * would make one gesture into several - the thing the story's batch verbs exist to prevent.
     * Absent means "leave membership alone", which is what creating or renaming a group does.
     */
    | { op: "set-character-group"; groupId: string; group: CharacterGroup; members?: readonly string[] }
    /**
     * Remove a group, and move its members out of it.
     *
     * The membership is **not** carried and the members are **not** separate operations. Every
     * machine can work out which characters were in the group from the document it already holds, so
     * naming them would be a second statement of the same fact - and sending them as their own
     * `update-character`s would make one gesture into several, which is what the story's batch verbs
     * exist to prevent.
     */
    | { op: "delete-character-group"; groupId: string };

/**
 * Everything a session can be asked to do, whichever document it is about.
 *
 * Flat rather than nested by document, because every consumer of this type switches over `op` and a
 * nesting would make each of them switch twice. Which document a verb belongs to is
 * {@link opDocumentKind}'s answer, and it is a property of the verb rather than of the message.
 */
export type LiveOp = LiveStoryOp | LiveCharacterOp;

/** Every operation kind, for a caller that has to enumerate them. */
export type LiveOpKind = LiveOp["op"];

/**
 * Which document an operation is about.
 *
 * A session carries a set of documents rather than one, so a message has to say which of them it
 * changes: the verb alone is not enough, because a project has many story documents and an operation
 * applied to the wrong one corrupts two files at once with nothing saying so.
 *
 * **Only the kind that needs a parameter carries one.** There is one cast per project, so
 * `{ doc: "characters" }` is the whole address; there are many stories, so a story address names
 * which. That asymmetry is the document registry's own - the cast's spec has a fixed path and the
 * story's takes a `storyId` - and following it here keeps one spelling of "which document" rather
 * than two.
 */
export type LiveDocument =
    | { doc: "story"; storyId: StoryId }
    | { doc: "characters" };

/**
 * The kind of document a verb can only ever be about.
 *
 * The invariant this exists to enforce lives in the host: a message carries both an operation and the
 * document it claims to change, and a pair that disagrees is refused rather than guessed at. Deriving
 * the whole address from the operation is not possible - a story operation carries its scene, never
 * its story - so the address travels on the message and this is what checks it.
 */
export function opDocumentKind(op: LiveOp): LiveDocument["doc"] {
    switch (op.op) {
        case "insert-block":
        case "insert-blocks":
        case "update-block":
        case "update-blocks":
        case "delete-block":
        case "delete-blocks":
        case "move-block":
        case "move-blocks":
        case "set-block-disabled":
        case "rename-scene":
        case "set-entry-scene":
        case "rename-story":
        case "reorder-chapters":
            return "story";
        case "create-character":
        case "update-character":
        case "delete-character":
        case "set-character-group":
        case "delete-character-group":
            return "characters";
    }
}

/** Whether a message's operation and the document it states agree. See {@link opDocumentKind}. */
export function opBelongsTo(op: LiveOp, document: LiveDocument): boolean {
    return opDocumentKind(op) === document.doc;
}

/** Two addresses naming one document. */
export function sameLiveDocument(left: LiveDocument, right: LiveDocument): boolean {
    if (left.doc === "story") {
        return right.doc === "story" && left.storyId === right.storyId;
    }
    return right.doc === "characters";
}

/** A document address in one line, for a log line or a refusal that has to name it. */
export function describeLiveDocument(document: LiveDocument): string {
    return document.doc === "story" ? `story ${document.storyId}` : "characters";
}

/**
 * The operations a line's claim governs.
 *
 * **A claim is over the whole row, not a field of it.** The fields of a row hold each other up - a
 * different speaker changes how the prose parses and which translation entry it belongs to - so
 * splitting the claim per field would buy nothing and leave a second kind of state to keep correct.
 *
 * Everything outside this set is last-writer-wins: a scene's name, the story's name, the entry
 * scene, the chapter order. Losing one of those costs a word, and a word is worth less than the
 * ceremony of claiming it. Losing a claimed row would cost the paragraph somebody just typed.
 *
 * A batch is claimed exactly when the single operation it batches is: `update-blocks` writes rows'
 * prose and is here, `move-blocks` rearranges rows without touching a word of them and is not. The
 * line is about what a loser loses, and batching changes how many rows are at stake, never what.
 * ⚠ A claimed batch is answered whole - see {@link opClaimKeys}.
 *
 * **The test that decides a new entry: does the interface hold a draft of it?** A claim is worth its
 * ceremony exactly where the losing author has typing that nobody else can see and nothing else would
 * report - prose accumulating in the story editor's draft, a description accumulating in the
 * properties panel's own state until the field is blurred. A field with no draft layer behind it
 * loses a word or a drag, which is cheaper than asking to hold it.
 *
 * That is why the whole of a character record is here and the cast's order is not. The record has
 * drafted fields on it (`TextField` commits on blur, and its sync-from-props would otherwise wipe a
 * half-typed paragraph the moment somebody else's edit to the same character arrived); the order is a
 * drag, so the later drag wins and costs nobody anything. Claiming a record rather than a field of
 * one follows the row's reasoning: a character's fields hold each other up - the appearance kind
 * decides whether poses or layers mean anything, `defaultPoseId` names one of the poses - and the
 * panel edits one character at a time anyway.
 */
export const CLAIMED_OPS: ReadonlySet<LiveOpKind> = new Set<LiveOpKind>([
    "update-block",
    "update-blocks",
    "delete-block",
    "delete-blocks",
    "set-block-disabled",
    "update-character",
    "delete-character",
]);

/**
 * The block an operation is about, or null for the ones that are about the story as a whole.
 *
 * **Null for a batch, which is about many.** This answers a lookup of ONE claim, so a batch that
 * named one of its rows here would have its claim checked against that row and every other row let
 * through - the half-refused arrangement that batching exists to prevent. Ask {@link opBlockIds}
 * instead, which is the question a batch has an answer to.
 */
export function opBlockId(op: LiveStoryOp): StoryBlockId | null {
    switch (op.op) {
        case "insert-block":
            return op.block.id;
        case "update-block":
        case "delete-block":
        case "move-block":
        case "set-block-disabled":
            return op.blockId;
        case "insert-blocks":
        case "update-blocks":
        case "delete-blocks":
        case "move-blocks":
        case "rename-scene":
        case "set-entry-scene":
        case "rename-story":
        case "reorder-chapters":
            return null;
    }
}

/**
 * Every row an operation is about, in the order the operation names them.
 *
 * What a claim check has to ask, because the answer for a batch is a set and the answer to
 * {@link opBlockId} cannot be. **A batch is permitted only if every row in it is permitted**: one
 * held row refuses the whole operation, and the author is told which row and who holds it. Letting
 * the rest through would apply part of one gesture and leave an arrangement nobody wrote, with
 * nothing on any screen reporting that half of it is missing.
 *
 * Empty for the operations that are about the story or a scene rather than its rows.
 */
export function opBlockIds(op: LiveStoryOp): readonly StoryBlockId[] {
    switch (op.op) {
        case "insert-block":
            return [op.block.id];
        case "update-block":
        case "delete-block":
        case "move-block":
        case "set-block-disabled":
            return [op.blockId];
        case "insert-blocks":
            return op.inserts.map(insert => insert.block.id);
        case "update-blocks":
            return op.edits.map(edit => edit.blockId);
        case "delete-blocks":
            return [...op.blockIds];
        case "move-blocks":
            return op.moves.flatMap(move => [...move.blockIds]);
        case "rename-scene":
        case "set-entry-scene":
        case "rename-story":
        case "reorder-chapters":
            return [];
    }
}

/**
 * The scene an operation is about, or null when it is about the story as a whole - **or when it is
 * about more than one scene**.
 *
 * The one caller is the digest an effect carries, which fingerprints a single scene, so a batch that
 * reaches across scenes has no answer here and travels without one. A batch whose edits all name the
 * same scene - which is what a replace confined to the open scene is - keeps its digest, because
 * losing the divergence guard is a real cost and there is no reason to pay it when the answer is
 * unambiguous.
 */
export function opSceneId(op: LiveStoryOp): StorySceneId | null {
    switch (op.op) {
        case "insert-block":
        case "insert-blocks":
        case "update-block":
        case "delete-block":
        case "delete-blocks":
        case "move-block":
        case "move-blocks":
        case "set-block-disabled":
        case "rename-scene":
            return op.sceneId;
        case "update-blocks":
            return onlySceneOf(op.edits);
        case "set-entry-scene":
            return op.sceneId;
        case "rename-story":
        case "reorder-chapters":
            return null;
    }
}

/** The scene every edit names, or null when they do not all name one. */
function onlySceneOf(edits: readonly { sceneId: StorySceneId }[]): StorySceneId | null {
    const first = edits[0]?.sceneId ?? null;
    return first !== null && edits.every(edit => edit.sceneId === first) ? first : null;
}

/* ----------------------------------------------------------------------- claims */

/**
 * What one claim is over.
 *
 * **Namespaced, and a plain string on purpose.** A claim used to be a block id, which worked while a
 * session was about one story; now a claim set holds rows and character records at once, and two
 * documents' ids meeting in one map with no prefix would be a type confusion nothing could detect -
 * the ids are uuids either way, so the collision would be silent rather than merely unlikely. The
 * prefix makes the key say what it is about, which is also what lets a panel ask for its own kind
 * without knowing the others exist.
 *
 * A string rather than a structure because this is a map key that crosses the wire in
 * {@link LiveClaims}, and a structure would need a canonical spelling to be one - which is a second
 * encoder to keep in step with this file for no gain.
 */
export type LiveClaimKey = string;

/** The claim over one story row. */
export function storyRowClaimKey(blockId: StoryBlockId): LiveClaimKey {
    return `row:${blockId}`;
}

/** The claim over one character record. */
export function characterClaimKey(characterId: string): LiveClaimKey {
    return `character:${characterId}`;
}

/**
 * Every claim an operation has to hold to be allowed, in the order the operation names them.
 *
 * What a claim check asks, and the reason it is a set: **a batch is permitted only if every part of
 * it is**. One held row refuses the whole operation and the author is told which row and who holds
 * it. Letting the rest through would apply part of one gesture and leave an arrangement nobody wrote,
 * with nothing on any screen reporting that half of it is missing.
 *
 * Empty for every operation outside {@link CLAIMED_OPS} - which is checked by the caller rather than
 * relied on here, so that "is this claimed" and "what does it claim" cannot answer differently.
 */
export function opClaimKeys(op: LiveOp): readonly LiveClaimKey[] {
    switch (op.op) {
        case "insert-block":
        case "update-block":
        case "delete-block":
        case "move-block":
        case "set-block-disabled":
        case "insert-blocks":
        case "update-blocks":
        case "delete-blocks":
        case "move-blocks":
        case "rename-scene":
        case "set-entry-scene":
        case "rename-story":
        case "reorder-chapters":
            return opBlockIds(op).map(storyRowClaimKey);
        case "update-character":
        case "delete-character":
            return [characterClaimKey(op.characterId)];
        case "create-character":
            return [characterClaimKey(op.character.profile.id)];
        case "set-character-group":
        case "delete-character-group":
            return [];
    }
}

/* ---------------------------------------------------------------------- digests */

/**
 * What a digest fingerprints.
 *
 * **The unit the operation names, never the document and never the project.** A digest is computed on
 * every machine for every effect, and the cost of the unit is paid that many times: this repository
 * has measured one `JSON.stringify` of a 15.4 MB story document at 133 ms of the renderer's own
 * thread, so a per-document digest would spend that on every line of prose anybody commits, and a
 * per-project one would spend it on everything at once. A per-unit digest costs a scene, or one
 * character record, and it catches the same disagreement one message later at worst.
 *
 * Every kind of document declares its own unit here rather than sharing one, because the unit is
 * whatever the operations of that document address: scenes for a story, records for the cast, and the
 * cast-level state for the operations that are about neither.
 */
export type LiveDigestScope =
    /**
     * One scene of one story.
     *
     * The story is named because a session carries every story document in the project, so a scene id
     * alone would be an address that happens to be unique rather than one that is.
     */
    | { of: "scene"; storyId: StoryId; sceneId: StorySceneId }
    /** One character's record. */
    | { of: "character"; characterId: string }
    /** The cast's shape - its groups and who is in them - which no single record covers. */
    | { of: "cast" };

/** A fingerprint and what it is of. See {@link LiveDigestScope}. */
export type LiveDigest = {
    scope: LiveDigestScope;
    hash: string;
};

/**
 * The unit an effect for this operation should be fingerprinted over, or null when there is none.
 *
 * Null is not a failure: `set-entry-scene` names a scene it does not change, and the story-wide
 * operations change nothing a scene digest would cover, so an effect for one travels without a digest
 * and the guard rules `unproven` rather than either verdict.
 */
export function opDigestScope(op: LiveOp, storyId: StoryId): LiveDigestScope | null {
    switch (op.op) {
        case "insert-block":
        case "insert-blocks":
        case "update-block":
        case "update-blocks":
        case "delete-block":
        case "delete-blocks":
        case "move-block":
        case "move-blocks":
        case "set-block-disabled":
        case "rename-scene": {
            const sceneId = opSceneId(op);
            return sceneId === null ? null : { of: "scene", storyId, sceneId };
        }
        // Names a scene it does not change: the pointer moved, the scene did not, and a digest of it
        // would be a fingerprint of something this operation cannot have altered.
        case "set-entry-scene":
        case "rename-story":
        case "reorder-chapters":
            return null;
        case "create-character":
            return { of: "character", characterId: op.character.profile.id };
        case "update-character":
        case "delete-character":
            return { of: "character", characterId: op.characterId };
        case "set-character-group":
        case "delete-character-group":
            return { of: "cast" };
    }
}

/** Two scopes naming one unit. */
export function sameDigestScope(left: LiveDigestScope, right: LiveDigestScope): boolean {
    if (left.of === "scene") {
        return right.of === "scene" && left.storyId === right.storyId && left.sceneId === right.sceneId;
    }
    if (left.of === "character") {
        return right.of === "character" && left.characterId === right.characterId;
    }
    return right.of === "cast";
}

/* -------------------------------------------------------------------- messages */

/**
 * Entries a broadcast effect carries so that every machine can write the same ones.
 *
 * Pasting rows inside a session brings their translations and voice takes along, and that is not an
 * edit of the localization library - it is a **derivation**, performed identically on every machine
 * from one effect. Which is why the entries travel here rather than being looked up: the copier read
 * them out of its own memory at the moment of copying, and nobody else has that memory.
 *
 * Keyed by the NEW text id, because pasted rows are minted fresh ids and the old ones mean nothing
 * on the receiving side.
 *
 * ⚠ **The whole unit travels, not just the words.** A translation is its text, the hash of the source
 * it was written against, its status and its note; a take is its asset, its hash and its status. Carry
 * the text alone and every line lands with no hash, which the reader derives as stale, and with its
 * review thrown away - so pasting inside a session would quietly demote work that pasting outside one
 * preserves, and the demotion is invisible until somebody re-reviews a language.
 */
export type LiveDerived = {
    /** Locale to text id to the whole translation unit. */
    translations?: Readonly<Record<string, Readonly<Record<string, LocalizationUnit>>>>;
    /** Locale to text id to the whole voice unit. */
    voice?: Readonly<Record<string, Readonly<Record<string, VoiceUnit>>>>;
};

/**
 * A guest asking for something. **Nothing has happened yet.**
 *
 * The sender holds on to it until it sees the matching effect or refusal, and re-sends it unchanged
 * if neither arrives. That is safe because {@link clientId} is an idempotency key: an intent that
 * reaches the host twice produces one effect. Re-sending is the only repair available on a channel
 * that delivers to whoever happens to be listening, and it is the same bargain the overlay writes
 * make.
 */
export type LiveIntent = {
    kind: "intent";
    /** Minted by the sender, unique for the life of the session. The idempotency key. */
    clientId: string;
    /**
     * Which document to change. One the session does not carry is refused, and so is one the
     * operation could not be about - see {@link opBelongsTo}.
     */
    document: LiveDocument;
    op: LiveOp;
    /** Entries this operation derives, when it is a paste. See {@link LiveDerived}. */
    derived?: LiveDerived;
};

/**
 * What the host did. Also the receipt for the intent that asked for it.
 *
 * ⚠ **`op` is the operation as APPLIED, which is not always the one that was asked for.** An insert
 * whose anchor row was deleted a moment earlier still lands where that row was - the author was
 * aiming at a place in the prose, and the end of the scene is not near it - so the effect names the
 * position it actually used. A guest applies what it is told, never what it asked for.
 */
export type LiveEffect = {
    kind: "effect";
    /** The intent's id, absent when the host acted on its own behalf. */
    clientId?: string;
    /** The instance that asked. Everyone sees who did what, the asker included. */
    by: string;
    /** The host's application order. A gap means a message was missed, never that order is unclear. */
    seq: number;
    /**
     * Which document the host changed.
     *
     * Carried rather than inferred. A session used to be about one document, so a guest could apply
     * every effect to the only thing it had; now it holds several, and an effect applied to the wrong
     * one would write a character record's worth of somebody else's work over a document nobody was
     * editing - with a digest that agrees, because the digest is over the unit the operation named.
     */
    document: LiveDocument;
    op: LiveOp;
    /**
     * Every unit this effect changed, fingerprinted after applying, so a guest can prove it agrees.
     *
     * Disagreement is the most expensive way this design can fail: two documents that differ, each
     * written into its own history, with nothing anywhere reporting a problem. A guest that computes
     * a different digest leaves the session and says so.
     *
     * **A list rather than one, because an operation may change more than the unit it names.**
     * Deleting a character rewrites the dialogue rows that spoke it, in any story - work every
     * machine derives for itself rather than being sent - and derived work is exactly the kind that
     * has to be checked, not assumed. The applier reports what it touched and each of those is
     * fingerprinted here, so a machine that derived something else is caught on this message rather
     * than on some later one that happens to reach the same scene.
     *
     * Empty for the operations no unit covers - see {@link opDigestScope}.
     */
    digests?: readonly LiveDigest[];
    derived?: LiveDerived;
};

/** Why the host would not do it. */
export type LiveRefusalReason =
    /**
     * Somebody else is writing that line, or is inside that character record. Carries who, because
     * "no" without a name is a mystery.
     */
    | "row-claimed"
    /** The row is gone. The author's own text is theirs to keep - never clear it on this. */
    | "row-gone"
    /** A move's destination anchor is gone. Moving again is cheap; guessing a position is not. */
    | "anchor-gone"
    /** The scene is gone. */
    | "scene-gone"
    /**
     * The character record is gone.
     *
     * The cast's answer to `row-gone`, and it carries the same instruction: the author has a panel
     * full of their own typing, and it is theirs to keep. An update that created what it could not
     * find would put a character somebody else deleted back on every machine in the room.
     *
     * ⚠ Reachable even though a session carries no deletion verb: the room opens on a committed
     * revision and a record can be missing from this cast because the author who joined never had it,
     * or because a machine's applier failed on the creation that would have made it.
     */
    | "character-gone"
    /**
     * The operation will not fit in one payload.
     *
     * A whole character record travels in `update-character`, and a layered character with a PSD
     * fingerprint and a snapshot table is bounded by nothing while one `live.say` is 16 KB. Said out
     * loud rather than truncated: half a record is a record nobody wrote.
     */
    | "too-large"
    /** Sent by an instance that is not in the room. */
    | "not-in-session"
    /**
     * About a document this session does not carry.
     *
     * Separate from `not-in-session`, which is about the sender rather than the message: the two have
     * different remedies - one is rejoining, the other is that this document is not shared - and one
     * reason covering both would name neither.
     */
    | "document-not-shared"
    /** A vocabulary this host does not have. A newer guest, or a corrupted message. */
    | "unknown-op";

export type LiveRefusal = {
    kind: "refusal";
    clientId: string;
    reason: LiveRefusalReason;
    /** Who holds the claim, for `row-claimed`. An account name, not an id - a person is being named. */
    heldBy?: string;
};

/**
 * Who is writing which line, as the host records it.
 *
 * Broadcast rather than agreed: the host is the only place a claim exists, so there is nothing to
 * negotiate. Sent whole rather than as changes, because a full set is small and a client that missed
 * one change would otherwise show a stale name over somebody's cursor for the rest of the session.
 */
export type LiveClaims = {
    kind: "claims";
    /**
     * Which version of the claim set this is - **not a position in the effect order**.
     *
     * The two numbers answer different questions and must not be drawn from one counter. A gap in
     * {@link LiveEffect.seq} means a message was lost and something has to be re-read; claim sets
     * are whole, so a client that missed one has lost nothing and needs only the newest. Spending
     * effect numbers on them would manufacture gaps that mean nothing, and reusing one would leave
     * two different sets indistinguishable.
     *
     * Rises only when the set would actually differ, so an unchanged set is not re-broadcast.
     */
    seq: number;
    /** Claim key to the account holding it. See {@link LiveClaimKey}. */
    held: Readonly<Record<LiveClaimKey, string>>;
};

/**
 * A machine saying it is writing something, or that it has stopped. **Guest to host.**
 *
 * The other half of {@link LiveClaims}: the host is the only place a claim exists, so this is the
 * only way one is ever created or dropped, and the set that comes back is the only statement about
 * what is held.
 *
 * **One kind for taking and for giving back**, rather than a `claim` and a `release`. They are the
 * same statement about one row - "I am writing this", with a yes or a no - and one kind is one case
 * in every exhaustive switch this vocabulary has, where two would be two chances to answer only one
 * of them. A give-back that is never sent is a row nobody can edit for the rest of the session, so
 * the two halves must be impossible to wire up separately.
 *
 * **No idempotency key and no receipt**, which is what makes this unlike {@link LiveIntent}. Nothing
 * is lost when one goes missing: the box holding a row asserts its claim again as its author types,
 * so a lost take is repaired by the next assertion, and a lost give-back lapses on the host's own
 * timeout. The answer, when the set moved, is the whole of {@link LiveClaims} - and a set that does
 * not name the asker IS the refusal, which is why there is no refusal here to write down.
 *
 * **It names no document.** The host's record is keyed by {@link LiveClaimKey}, which already says
 * which kind of thing is held and identifies it across the whole project, and the worst a stray one
 * could do is put a name over something nobody in the room is looking at. Adding a document address
 * would be a second way to say what the key says, with a second way to be wrong.
 */
export type LiveClaim = {
    kind: "claim";
    key: LiveClaimKey;
    /** Whether the sender is writing it. False gives it back. */
    holding: boolean;
};

/** A guest asking to be caught up, because it saw a gap in {@link LiveEffect.seq}. */
export type LiveResync = {
    kind: "resync";
    /** The instance asking, so the host can answer without the server having to route. */
    by: string;
    /** The last sequence it applied. The host replies with everything after it. */
    after: number;
};

/** The host catching one guest up. Sent to the room; everybody else ignores it. */
export type LiveCatchUp = {
    kind: "catch-up";
    /** Who asked. */
    to: string;
    effects: readonly LiveEffect[];
};

/** Everything a machine in a session can say. */
export type LiveMessage =
    | LiveIntent
    | LiveEffect
    | LiveRefusal
    | LiveClaims
    | LiveClaim
    | LiveResync
    | LiveCatchUp;

/**
 * Whether a value is a message this build understands.
 *
 * Defensive on purpose: the payload arrives from another Studio, which may be a different version,
 * and a message this build cannot read has to be ignored rather than thrown on. The narrow check is
 * the discriminator alone - what a message MEANS is the reader's business, and a stricter gate here
 * would be a second schema to keep in step with the types above.
 */
export function isLiveMessage(value: unknown): value is LiveMessage {
    if (value === null || typeof value !== "object") {
        return false;
    }
    const kind = (value as { kind?: unknown }).kind;
    return kind === "intent"
        || kind === "effect"
        || kind === "refusal"
        || kind === "claims"
        || kind === "claim"
        || kind === "resync"
        || kind === "catch-up";
}
