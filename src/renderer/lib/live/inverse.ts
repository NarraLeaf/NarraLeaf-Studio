import type { LiveEffect, LiveOp } from "@shared/live/ops";
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
    | "chapters-changed";

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
    | { op: "reorder-chapters"; chapterIds: readonly string[] };

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
export function captureBefore(op: LiveOp, document: StoryDocument): LiveBefore | null {
    switch (op.op) {
        case "insert-block":
            // Nothing. The inverse is a delete of a row the effect already names.
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
    }
}

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
    /** The document as it stands NOW - after the effect, and after everything that followed it. */
    document: StoryDocument;
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

    const { before, document } = context;
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
    }
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
