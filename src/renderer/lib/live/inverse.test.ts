import { describe, expect, it } from "vitest";
import type { LiveEffect, LiveOp } from "@shared/live/ops";
import {
    STORY_DOCUMENT_SCHEMA_VERSION,
    type StoryBlockId,
    type StoryControlBlock,
    type StoryDocument,
    type StoryNoteBlock,
    type StoryScene,
} from "@shared/types/story";
import {
    deleteBlockFromScene,
    insertBlockInScene,
    moveBlockInScene,
    updateBlockPayload,
} from "@/lib/workspace/services/story/storyModel";
import { DeletedPositions, resolveInsertTarget } from "./deletedPositions";
import {
    captureBefore,
    inverseOf,
    type LiveBefore,
    type LiveInverse,
    type LiveInverseReason,
} from "./inverse";

const SELF = "me";
const OTHER = "you";

/* ------------------------------------------------------------------ a document to edit */

function note(id: StoryBlockId, value = id): StoryNoteBlock {
    return {
        id,
        kind: "note",
        parentId: null,
        childrenIds: [],
        payload: { text: { textId: `text-${id}`, value, role: "note" } },
    };
}

function group(id: StoryBlockId): StoryControlBlock {
    return { id, kind: "control", parentId: null, childrenIds: [], payload: { control: "sequence" } };
}

/** `s1` holds `a`, a group `g` containing `one` and `two`, then `z`. `s2` is empty. */
function makeDocument(): StoryDocument {
    const s1: StoryScene = { id: "s1", name: "Scene one", runtimeName: "scene_one", rootBlockIds: [], blocks: {} };
    insertBlockInScene(s1, note("a"), { parentId: null });
    insertBlockInScene(s1, group("g"), { parentId: null });
    insertBlockInScene(s1, note("one"), { parentId: "g" });
    insertBlockInScene(s1, note("two"), { parentId: "g" });
    insertBlockInScene(s1, note("z"), { parentId: null });
    const s2: StoryScene = { id: "s2", name: "Scene two", runtimeName: "scene_two", rootBlockIds: [], blocks: {} };
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Skeleton",
        entrySceneId: "s1",
        chapters: [{ id: "c1", name: "One", sceneIds: ["s1"] }, { id: "c2", name: "Two", sceneIds: ["s2"] }],
        scenes: { s1, s2 },
    };
}

/** The applier a machine in a session runs, over a whole document rather than a scene at a time. */
function apply(document: StoryDocument, op: LiveOp): void {
    switch (op.op) {
        case "insert-block":
            // A clone, because the block arrived from somebody's memory and the document keeps what
            // it is given - the same thing writing it through IPC would do.
            insertBlockInScene(document.scenes[op.sceneId], structuredClone(op.block), op.target);
            return;
        case "update-block":
            updateBlockPayload(document.scenes[op.sceneId], op.blockId, op.payload);
            return;
        case "update-blocks":
            for (const edit of op.edits) {
                updateBlockPayload(document.scenes[edit.sceneId], edit.blockId, edit.payload);
            }
            return;
        case "delete-block":
            deleteBlockFromScene(document.scenes[op.sceneId], op.blockId);
            return;
        case "move-block":
            moveBlockInScene(document.scenes[op.sceneId], op.blockId, op.target);
            return;
        case "move-blocks":
            // Group by group, and every row of a group in front of the same anchor - what the story
            // service's own `moveBlocks` does.
            for (const move of op.moves) {
                for (const blockId of move.blockIds) {
                    moveBlockInScene(document.scenes[op.sceneId], blockId, move.target);
                }
            }
            return;
        case "set-block-disabled": {
            const block = document.scenes[op.sceneId].blocks[op.blockId];
            if (op.disabled) {
                block.disabled = true;
            } else {
                delete block.disabled;
            }
            return;
        }
        case "rename-scene":
            document.scenes[op.sceneId].name = op.name;
            return;
        case "set-entry-scene":
            document.entrySceneId = op.sceneId ?? undefined;
            return;
        case "rename-story":
            document.name = op.name;
            return;
        case "reorder-chapters":
            document.chapters = op.chapterIds.map(id => document.chapters.find(chapter => chapter.id === id)!);
            return;
    }
}

let seq = 0;

/** One effect, and what the document held before it landed. The apply seam, in two lines. */
type Done = { effect: LiveEffect; before: LiveBefore | null };

/**
 * Do what a machine in a session does with an effect: read what the operation is about to
 * overwrite, then apply it. The record is taken here and nowhere else - before the document moves.
 */
function perform(document: StoryDocument, op: LiveOp, by = SELF): Done {
    const before = captureBefore(op, document);
    apply(document, op);
    return { effect: { kind: "effect", by, seq: ++seq, op }, before };
}

function invert(document: StoryDocument, done: Done, self = SELF): LiveInverse {
    return inverseOf(done.effect, { self, document, before: done.before });
}

/** Undo `done` and answer the effect the undo itself produced, so a redo can be asked about it. */
function undo(document: StoryDocument, done: Done): Done {
    return perform(document, asOp(invert(document, done)));
}

function asOp(result: LiveInverse): LiveOp {
    if ("impossible" in result) {
        throw new Error(`expected an inverse, got "${result.impossible}"`);
    }
    return result.op;
}

function asImpossible(result: LiveInverse): LiveInverseReason {
    if (!("impossible" in result)) {
        throw new Error(`expected a refusal, got "${result.op.op}"`);
    }
    return result.impossible;
}

/* ------------------------------------------------------------------- the whole vocabulary */

/** The payload an update writes, with a text id the document will refuse to take. */
const REWRITTEN = { text: { textId: "text-a-new", value: "a rewritten", role: "note" } } as const;

describe("the inverse of every operation", () => {
    const cases: { name: string; op: LiveOp; expected: LiveOp }[] = [
        {
            name: "an insert is taken back by deleting the row it added",
            op: { op: "insert-block", sceneId: "s1", block: note("n"), target: { parentId: null, beforeBlockId: "z" } },
            expected: { op: "delete-block", sceneId: "s1", blockId: "n" },
        },
        {
            name: "an update is taken back by writing the payload the row held",
            op: { op: "update-block", sceneId: "s1", blockId: "a", payload: REWRITTEN },
            expected: {
                op: "update-block",
                sceneId: "s1",
                blockId: "a",
                payload: { text: { textId: "text-a", value: "a", role: "note" } },
            },
        },
        {
            name: "a batch update is taken back by writing every payload the rows held",
            op: {
                op: "update-blocks",
                edits: [
                    { sceneId: "s1", blockId: "a", payload: REWRITTEN },
                    { sceneId: "s1", blockId: "one", payload: REWRITTEN },
                ],
            },
            expected: {
                op: "update-blocks",
                edits: [
                    { sceneId: "s1", blockId: "a", payload: { text: { textId: "text-a", value: "a", role: "note" } } },
                    { sceneId: "s1", blockId: "one", payload: { text: { textId: "text-one", value: "one", role: "note" } } },
                ],
            },
        },
        {
            name: "a batch move is taken back one row at a time, from the back of the document forwards",
            op: {
                op: "move-blocks",
                sceneId: "s1",
                moves: [{ blockIds: ["a", "g"], target: { parentId: null, beforeBlockId: null } }],
            },
            expected: {
                op: "move-blocks",
                sceneId: "s1",
                moves: [
                    { blockIds: ["g"], target: { parentId: null, beforeBlockId: "z" } },
                    { blockIds: ["a"], target: { parentId: null, beforeBlockId: "g" } },
                ],
            },
        },
        {
            name: "a delete is taken back by putting the row back where it sat",
            op: { op: "delete-block", sceneId: "s1", blockId: "a" },
            expected: {
                op: "insert-block",
                sceneId: "s1",
                block: note("a"),
                target: { parentId: null, beforeBlockId: "g" },
            },
        },
        {
            name: "a move is taken back by moving the row to where it came from",
            op: { op: "move-block", sceneId: "s1", blockId: "a", target: { parentId: "g", beforeBlockId: "two" } },
            expected: {
                op: "move-block",
                sceneId: "s1",
                blockId: "a",
                target: { parentId: null, beforeBlockId: "g" },
            },
        },
        {
            name: "disabling a row is taken back by restoring the state it was in",
            op: { op: "set-block-disabled", sceneId: "s1", blockId: "a", disabled: true },
            expected: { op: "set-block-disabled", sceneId: "s1", blockId: "a", disabled: false },
        },
        {
            name: "a scene rename is taken back by writing the name it had",
            op: { op: "rename-scene", sceneId: "s1", name: "Corridor" },
            expected: { op: "rename-scene", sceneId: "s1", name: "Scene one" },
        },
        {
            name: "an entry scene is taken back by naming the one it was",
            op: { op: "set-entry-scene", sceneId: "s2" },
            expected: { op: "set-entry-scene", sceneId: "s1" },
        },
        {
            name: "a story rename is taken back by writing the name it had",
            op: { op: "rename-story", name: "Nomen" },
            expected: { op: "rename-story", name: "Skeleton" },
        },
        {
            name: "a chapter reorder is taken back by writing the order they were in",
            op: { op: "reorder-chapters", chapterIds: ["c2", "c1"] },
            expected: { op: "reorder-chapters", chapterIds: ["c1", "c2"] },
        },
    ];

    for (const { name, op, expected } of cases) {
        it(name, () => {
            const document = makeDocument();
            expect(asOp(invert(document, perform(document, op)))).toEqual(expected);
        });
    }

    it("hands over a copy of a deleted row, not the record itself", () => {
        // Applying an insert writes the block into the document and edits it on the way in - the
        // story service does exactly that, without a copy of its own. If the record were handed
        // over rather than copied, the document and the undo entry would be the same object, and
        // every later edit to the row would rewrite the state the entry says it came from.
        const document = makeDocument();
        const done = perform(document, { op: "delete-block", sceneId: "s1", blockId: "one" });
        const restored = asOp(invert(document, done));
        expect(restored.op).toBe("insert-block");
        if (restored.op !== "insert-block") {
            return;
        }
        insertBlockInScene(document.scenes.s1, restored.block, restored.target);

        expect(document.scenes.s1.blocks.one).toBe(restored.block);
        expect(done.before).toEqual({
            op: "delete-block",
            block: { ...note("one"), parentId: "g" },
            at: { parentId: "g", beforeBlockId: "two" },
        });
    });
});

/* ------------------------------------------------------------------------- inverse twice */

describe("the inverse of the inverse", () => {
    /**
     * All nine round-trip to the operation that was applied, which is what makes redo the inverse
     * of the undo and not a second mechanism. Two of them do so with a caveat worth stating:
     *
     *  - insert and delete are inverses of each other only for a row with nothing inside it. A
     *    container's delete has no inverse at all (see `subtree-lost` below), so the pair is
     *    involutive over exactly the rows it can express.
     *  - an update round-trips the payload the DOCUMENT ended up holding, which is not always the
     *    payload the operation carried: writing a row keeps the text ids it already had. The redo
     *    below therefore carries the row's original text id rather than the one the update asked
     *    for, and that is the point - a redo that reasserted the asked-for id would move the row's
     *    translations to an entry nothing else names.
     */
    const cases: { name: string; op: LiveOp }[] = [
        { name: "insert", op: { op: "insert-block", sceneId: "s1", block: note("n"), target: { parentId: null, beforeBlockId: "z" } } },
        { name: "delete", op: { op: "delete-block", sceneId: "s1", blockId: "a" } },
        { name: "move", op: { op: "move-block", sceneId: "s1", blockId: "a", target: { parentId: "g", beforeBlockId: "two" } } },
        { name: "disable", op: { op: "set-block-disabled", sceneId: "s1", blockId: "a", disabled: true } },
        { name: "rename-scene", op: { op: "rename-scene", sceneId: "s1", name: "Corridor" } },
        { name: "set-entry-scene", op: { op: "set-entry-scene", sceneId: "s2" } },
        { name: "rename-story", op: { op: "rename-story", name: "Nomen" } },
        { name: "reorder-chapters", op: { op: "reorder-chapters", chapterIds: ["c2", "c1"] } },
    ];

    for (const { name, op } of cases) {
        it(`redoes a ${name} as the operation that was applied`, () => {
            const document = makeDocument();
            const done = perform(document, op);
            expect(asOp(invert(document, undo(document, done)))).toEqual(op);
        });
    }

    it("redoes an update with the payload the document kept, not the one the update asked for", () => {
        const document = makeDocument();
        const done = perform(document, { op: "update-block", sceneId: "s1", blockId: "a", payload: REWRITTEN });
        const redo = asOp(invert(document, undo(document, done)));

        expect(redo).toEqual({
            op: "update-block",
            sceneId: "s1",
            blockId: "a",
            // The row's own text id, reinstated by the applier and read back out of the document.
            payload: { text: { textId: "text-a", value: "a rewritten", role: "note" } },
        });
        expect(redo).not.toEqual(done.effect.op);
    });

    it("redoes an insert where the host put the row, not where its author aimed", () => {
        // The effect carries the operation as APPLIED. An insert aimed at a row somebody had just
        // deleted lands where that row stood, and everything downstream - the undo, and the redo
        // that puts the row back - has to be about the place it actually went. A record taken from
        // the intent instead of from the document would send the row back to an anchor that has not
        // existed since before the insert.
        const document = makeDocument();
        const positions = new DeletedPositions();
        positions.remember(document.scenes.s1, "g");
        deleteBlockFromScene(document.scenes.s1, "g");

        const asked = { parentId: null, beforeBlockId: "g" };
        const applied = resolveInsertTarget(document.scenes.s1, positions, asked);
        expect(applied).toEqual({ parentId: null, beforeBlockId: "z" });

        const done = perform(document, { op: "insert-block", sceneId: "s1", block: note("n"), target: applied! });
        const redo = asOp(invert(document, undo(document, done)));

        expect(redo.op).toBe("insert-block");
        if (redo.op === "insert-block") {
            expect(redo.target).toEqual({ parentId: null, beforeBlockId: "z" });
            expect(redo.target).not.toEqual(asked);
        }
    });
});

/* ------------------------------------------------------------------- when there is none */

describe("taking back a batch", () => {
    it("puts a multi-row selection back in the order it was in", () => {
        // The case that decides the rule. `a` and `g` go to the end together; putting them back
        // front-to-back would aim `a` at `g` while `g` is still at the end, leaving [g, z, a] -
        // an arrangement neither author wrote. From the back forwards, every row is placed in
        // front of a neighbour that is already home.
        const document = makeDocument();
        const done = perform(document, {
            op: "move-blocks",
            sceneId: "s1",
            moves: [{ blockIds: ["a", "g"], target: { parentId: null, beforeBlockId: null } }],
        });
        expect(document.scenes.s1.rootBlockIds).toEqual(["z", "a", "g"]);

        undo(document, done);

        expect(document.scenes.s1.rootBlockIds).toEqual(["a", "g", "z"]);
    });

    it("redoes a batch move as the arrangement it produced, not as the operation that was sent", () => {
        // A batch's inverse addresses rows one at a time, so the inverse of THAT does too: what
        // round-trips is the arrangement, which is the thing the author is looking at, and not the
        // spelling of the operation that produced it.
        const document = makeDocument();
        const done = perform(document, {
            op: "move-blocks",
            sceneId: "s1",
            moves: [{ blockIds: ["a", "g"], target: { parentId: null, beforeBlockId: null } }],
        });
        const undone = undo(document, done);

        perform(document, asOp(invert(document, undone)));

        expect(document.scenes.s1.rootBlockIds).toEqual(["z", "a", "g"]);
    });

    it("puts every payload of a batch back in one operation", () => {
        const document = makeDocument();
        const done = perform(document, {
            op: "update-blocks",
            edits: [
                { sceneId: "s1", blockId: "a", payload: REWRITTEN },
                { sceneId: "s1", blockId: "z", payload: REWRITTEN },
            ],
        });

        undo(document, done);

        // One operation, so one arrival on every other machine, and never a document holding half
        // of an undo.
        expect(asOp(invert(document, done)).op).toBe("update-blocks");
        expect(document.scenes.s1.blocks.a.payload).toEqual({ text: { textId: "text-a", value: "a", role: "note" } });
        expect(document.scenes.s1.blocks.z.payload).toEqual({ text: { textId: "text-z", value: "z", role: "note" } });
    });
});

describe("what has no inverse", () => {
    it("refuses somebody else's effect, whatever else is in place", () => {
        // The row is there, the record is there, and the answer is still no: an effect this machine
        // did not cause is not this machine's to take back, and nothing built on this may draw an
        // undo entry for one.
        const document = makeDocument();
        const done = perform(document, { op: "rename-scene", sceneId: "s1", name: "Corridor" }, OTHER);
        expect(asImpossible(invert(document, done))).toBe("not-mine");
    });

    it("refuses an operation nothing was recorded for", () => {
        const document = makeDocument();
        const done = perform(document, { op: "rename-story", name: "Nomen" });
        expect(asImpossible(inverseOf(done.effect, { self: SELF, document, before: null }))).toBe("no-record");
    });

    it("refuses a record that belongs to another operation", () => {
        // Two undo entries, and the wrong one paired with the wrong record, is not a state anything
        // should be able to reach - but it is one where restoring the wrong row would be silent.
        const document = makeDocument();
        const done = perform(document, { op: "delete-block", sceneId: "s1", blockId: "a" });
        const stranger: LiveBefore = { op: "delete-block", block: note("z"), at: { parentId: null, beforeBlockId: null } };
        expect(asImpossible(inverseOf(done.effect, { self: SELF, document, before: stranger }))).toBe("no-record");
    });

    const gone: { name: string; op: LiveOp; then: (document: StoryDocument) => void; reason: LiveInverseReason }[] = [
        {
            name: "a scene that has gone takes every operation inside it with it",
            op: { op: "update-block", sceneId: "s1", blockId: "a", payload: REWRITTEN },
            then: document => {
                delete document.scenes.s1;
            },
            reason: "scene-gone",
        },
        {
            name: "an entry scene that has gone cannot be named again",
            op: { op: "set-entry-scene", sceneId: "s2" },
            then: document => {
                delete document.scenes.s1;
            },
            reason: "scene-gone",
        },
        {
            name: "a row somebody deleted cannot have its payload put back",
            op: { op: "update-block", sceneId: "s1", blockId: "a", payload: REWRITTEN },
            then: document => deleteBlockFromScene(document.scenes.s1, "a"),
            reason: "row-gone",
        },
        {
            name: "one row of a batch update being gone refuses the whole batch",
            op: {
                op: "update-blocks",
                edits: [
                    { sceneId: "s1", blockId: "a", payload: REWRITTEN },
                    { sceneId: "s1", blockId: "z", payload: REWRITTEN },
                ],
            },
            then: document => deleteBlockFromScene(document.scenes.s1, "z"),
            reason: "row-gone",
        },
        {
            name: "one row of a batch move having lost its neighbour refuses the whole batch",
            op: {
                op: "move-blocks",
                sceneId: "s1",
                moves: [{ blockIds: ["a"], target: { parentId: null, beforeBlockId: null } }],
            },
            // `a` sat in front of `g`, and there is no other row that means "where a was".
            then: document => deleteBlockFromScene(document.scenes.s1, "g"),
            reason: "anchor-gone",
        },
        {
            name: "a row somebody deleted cannot be moved back",
            op: { op: "move-block", sceneId: "s1", blockId: "a", target: { parentId: "g", beforeBlockId: "two" } },
            then: document => deleteBlockFromScene(document.scenes.s1, "a"),
            reason: "row-gone",
        },
        {
            name: "a row somebody deleted cannot have its disabled state put back",
            op: { op: "set-block-disabled", sceneId: "s1", blockId: "a", disabled: true },
            then: document => deleteBlockFromScene(document.scenes.s1, "a"),
            reason: "row-gone",
        },
        {
            name: "a row somebody deleted is no longer there to delete again",
            op: { op: "insert-block", sceneId: "s1", block: note("n"), target: { parentId: null, beforeBlockId: "z" } },
            then: document => deleteBlockFromScene(document.scenes.s1, "n"),
            reason: "row-gone",
        },
        {
            name: "a row that is in the scene again has nothing left to put back",
            op: { op: "delete-block", sceneId: "s1", blockId: "a" },
            then: document => insertBlockInScene(document.scenes.s1, note("a"), { parentId: null, beforeBlockId: "g" }),
            reason: "row-restored",
        },
        {
            name: "a row cannot go back inside a container that has gone",
            op: { op: "delete-block", sceneId: "s1", blockId: "one" },
            then: document => deleteBlockFromScene(document.scenes.s1, "g"),
            reason: "container-gone",
        },
        {
            name: "a row cannot move back into a container that has gone",
            op: { op: "move-block", sceneId: "s1", blockId: "one", target: { parentId: null, beforeBlockId: "z" } },
            then: document => deleteBlockFromScene(document.scenes.s1, "g"),
            reason: "container-gone",
        },
        {
            name: "a move cannot go back to a neighbour that has gone",
            op: { op: "move-block", sceneId: "s1", blockId: "one", target: { parentId: null, beforeBlockId: "z" } },
            then: document => deleteBlockFromScene(document.scenes.s1, "two"),
            reason: "anchor-gone",
        },
        {
            name: "a container somebody has written in is not this author's to delete",
            op: { op: "insert-block", sceneId: "s1", block: group("gg"), target: { parentId: null, beforeBlockId: "z" } },
            then: document => insertBlockInScene(document.scenes.s1, note("theirs"), { parentId: "gg" }),
            reason: "container-filled",
        },
        {
            name: "an order written for chapters that are not the ones there now would drop one",
            op: { op: "reorder-chapters", chapterIds: ["c2", "c1"] },
            then: document => {
                document.chapters = document.chapters.filter(chapter => chapter.id !== "c2");
            },
            reason: "chapters-changed",
        },
    ];

    for (const { name, op, then, reason } of gone) {
        it(name, () => {
            const document = makeDocument();
            const done = perform(document, op);
            then(document);
            expect(asImpossible(invert(document, done))).toBe(reason);
        });
    }
});

/* --------------------------------------------------------------------- a deleted subtree */

describe("deleting a container", () => {
    it("has no inverse at all, because one insert carries one block", () => {
        // The alternative is worse than the refusal. `insert-block` puts back the container and
        // nothing that was in it, so an inverse that "worked" would leave a tree that looks whole
        // and is not - and the author is looking at the one place where they cannot see what is
        // missing. Restoring the rows one at a time is not available either: the host applies
        // operations one at a time, so every machine in the room would draw each half-built state.
        const document = makeDocument();
        const done = perform(document, { op: "delete-block", sceneId: "s1", blockId: "g" });

        expect(asImpossible(invert(document, done))).toBe("subtree-lost");
    });

    it("refuses on what the record says, without reading the scene", () => {
        // The reason is a fact about the operation rather than about the document, so an interface
        // can settle it the moment the delete lands and never ask again - including when the scene
        // it was in has since gone, which would otherwise answer something less true.
        const document = makeDocument();
        const done = perform(document, { op: "delete-block", sceneId: "s1", blockId: "g" });
        delete document.scenes.s1;

        expect(asImpossible(invert(document, done))).toBe("subtree-lost");
    });

    it("puts back an empty container, which is a row like any other", () => {
        const document = makeDocument();
        deleteBlockFromScene(document.scenes.s1, "one");
        deleteBlockFromScene(document.scenes.s1, "two");
        const done = perform(document, { op: "delete-block", sceneId: "s1", blockId: "g" });

        expect(asOp(invert(document, done))).toEqual({
            op: "insert-block",
            sceneId: "s1",
            block: group("g"),
            target: { parentId: null, beforeBlockId: "z" },
        });
    });
});

/* --------------------------------------------------------------------------- the record */

describe("what a caller has to keep", () => {
    it("keeps nothing for an insert, because the effect already carries the row", () => {
        const document = makeDocument();
        const op: LiveOp = { op: "insert-block", sceneId: "s1", block: note("n"), target: { parentId: null } };
        expect(captureBefore(op, document)).toBeNull();
    });

    it("keeps a copy, so the record still describes the state before the operation", () => {
        // The document is edited in place. A record that pointed into it would describe the state
        // after the operation - the one mistake that makes every inverse a no-op.
        const document = makeDocument();
        const before = captureBefore({ op: "update-block", sceneId: "s1", blockId: "a", payload: REWRITTEN }, document);
        apply(document, { op: "update-block", sceneId: "s1", blockId: "a", payload: REWRITTEN });

        expect(before).toEqual({ op: "update-block", payload: { text: { textId: "text-a", value: "a", role: "note" } } });
    });

    it("reads where a row sits out of the document, at the moment the operation lands", () => {
        const document = makeDocument();
        expect(captureBefore({ op: "delete-block", sceneId: "s1", blockId: "one" }, document))
            .toEqual({ op: "delete-block", block: { ...note("one"), parentId: "g" }, at: { parentId: "g", beforeBlockId: "two" } });
    });

    it("keeps which state a row was in rather than which spelling the document used", () => {
        // Absent and false are one state and both are written, so `!disabled` is not the inverse of
        // a disable: disabling a row that was already disabled changes nothing, and enabling it
        // would be an edit nobody asked for.
        const document = makeDocument();
        document.scenes.s1.blocks.a.disabled = true;
        const done = perform(document, { op: "set-block-disabled", sceneId: "s1", blockId: "a", disabled: true });

        expect(asOp(invert(document, done)))
            .toEqual({ op: "set-block-disabled", sceneId: "s1", blockId: "a", disabled: true });
    });

    it("keeps nothing readable for an operation about a row that is not there", () => {
        const document = makeDocument();
        expect(captureBefore({ op: "update-block", sceneId: "s1", blockId: "stranger", payload: REWRITTEN }, document)).toBeNull();
        expect(captureBefore({ op: "rename-scene", sceneId: "gone", name: "Corridor" }, document)).toBeNull();
    });
});
