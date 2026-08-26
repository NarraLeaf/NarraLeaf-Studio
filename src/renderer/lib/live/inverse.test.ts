import { describe, expect, it } from "vitest";
import type { LiveCastView } from "@shared/live/cast";
import type {
    LiveAssetOp,
    LiveAssetRecord,
    LiveCharacterOp,
    LiveEffect,
    LiveLocalizationOp,
    LiveOp,
    LiveVoiceOp,
} from "@shared/live/ops";
import type { CharacterGroup, StoredCharacter } from "@shared/types/character/model";
import { makeAssetSetAxis, type AssetSet } from "@shared/types/assetSet";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import type { ProjectDictionaryDocument } from "@shared/types/dictionary";
import type { LocalizationUnit } from "@shared/types/localization";
import type { VoiceUnit } from "@shared/types/voice";
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
        case "insert-blocks":
            // In the order given, which is what lets a later entry name an earlier one as its
            // parent - a pasted container and the rows inside it.
            for (const insert of op.inserts) {
                insertBlockInScene(document.scenes[op.sceneId], structuredClone(insert.block), insert.target);
            }
            return;
        case "delete-block":
            deleteBlockFromScene(document.scenes[op.sceneId], op.blockId);
            return;
        case "delete-blocks":
            // A container takes the rows inside it, so an id already gone by the time its turn comes
            // is nothing to do rather than an error.
            for (const blockId of op.blockIds) {
                deleteBlockFromScene(document.scenes[op.sceneId], blockId);
            }
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
    const before = captureBefore(op, { story: document });
    apply(document, op);
    return {
        effect: { kind: "effect", by, seq: ++seq, document: { doc: "story", storyId: "story-1" }, op },
        before,
    };
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

describe("taking back a whole gesture", () => {
    /**
     * ⚠ Why the batch verbs exist at all.
     *
     * A paste sent as a run of single inserts is a run of undo steps: taking one back inside a
     * session costs a press per row, while the same paste outside a session costs one. One gesture
     * is one operation, and the vocabulary says so for updates and moves already.
     */
    it("takes a whole paste back in one operation", () => {
        const document = makeDocument();
        const done = perform(document, {
            op: "insert-blocks",
            sceneId: "s1",
            inserts: [
                { block: note("p1"), target: { parentId: null, beforeBlockId: "z" } },
                { block: note("p2"), target: { parentId: null, beforeBlockId: "z" } },
                { block: note("p3"), target: { parentId: null, beforeBlockId: "z" } },
            ],
        });
        expect(document.scenes.s1.rootBlockIds).toEqual(["a", "g", "p1", "p2", "p3", "z"]);

        const taken = asOp(invert(document, done));

        expect(taken).toEqual({ op: "delete-blocks", sceneId: "s1", blockIds: ["p1", "p2", "p3"] });
        apply(document, taken);
        expect(document.scenes.s1.rootBlockIds).toEqual(["a", "g", "z"]);
    });

    it("puts a deleted selection back where it sat, in one operation", () => {
        const document = makeDocument();
        const done = perform(document, { op: "delete-blocks", sceneId: "s1", blockIds: ["a", "z"] });
        expect(document.scenes.s1.rootBlockIds).toEqual(["g"]);

        undo(document, done);

        expect(document.scenes.s1.rootBlockIds).toEqual(["a", "g", "z"]);
    });

    it("puts a pasted container back with the rows that were inside it", () => {
        // The round trip a paste of a subtree has to survive: undo removes the container and its
        // rows, redo brings both back. The container comes back empty and each row re-fills it,
        // which is why the entries are ordered parent-first.
        const document = makeDocument();
        const done = perform(document, {
            op: "insert-blocks",
            sceneId: "s1",
            inserts: [
                { block: group("g2"), target: { parentId: null, beforeBlockId: null } },
                { block: note("k1"), target: { parentId: "g2" } },
                { block: note("k2"), target: { parentId: "g2" } },
            ],
        });
        expect(document.scenes.s1.blocks.g2.childrenIds).toEqual(["k1", "k2"]);

        const undone = undo(document, done);
        expect(document.scenes.s1.rootBlockIds).toEqual(["a", "g", "z"]);
        expect(document.scenes.s1.blocks.k1).toBeUndefined();

        perform(document, asOp(invert(document, undone)));

        expect(document.scenes.s1.rootBlockIds).toEqual(["a", "g", "z", "g2"]);
        expect(document.scenes.s1.blocks.g2.childrenIds).toEqual(["k1", "k2"]);
    });

    it("refuses to put back a container whose rows are not coming with it", () => {
        // A selection delete names the roots only, so the rows inside a container are gone with no
        // record of them anywhere. Restoring the container alone would give the author back an empty
        // one, which is not the document they asked to have back.
        const document = makeDocument();
        const done = perform(document, { op: "delete-blocks", sceneId: "s1", blockIds: ["g"] });

        expect(asImpossible(invert(document, done))).toBe("subtree-lost");
    });

    it("refuses to take back a paste somebody has since written into", () => {
        const document = makeDocument();
        const done = perform(document, {
            op: "insert-blocks",
            sceneId: "s1",
            inserts: [{ block: group("g2"), target: { parentId: null, beforeBlockId: null } }],
        });
        // Somebody else put a line inside the container this paste created. Taking the paste back
        // would take their line with it.
        perform(document, { op: "insert-block", sceneId: "s1", block: note("theirs"), target: { parentId: "g2" } }, OTHER);

        expect(asImpossible(invert(document, done))).toBe("container-filled");
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

/* ----------------------------------------------------------------------------- the cast */

function record(id: string, name = id, groupId?: string): StoredCharacter {
    return {
        profile: {
            id,
            name,
            description: "",
            tags: [],
            attributes: {},
            thumbnail: null,
            nicknames: [],
            ...(groupId === undefined ? {} : { groupId }),
            appearance: { kind: "preset", poses: [], defaultPoseId: null },
        },
    };
}

function makeCast(members: StoredCharacter[] = [], groups: CharacterGroup[] = []): LiveCastView & {
    characters: Record<string, StoredCharacter>;
    order: string[];
    groups: Record<string, CharacterGroup>;
} {
    return {
        characters: Object.fromEntries(members.map(member => [member.profile.id, member])),
        order: members.map(member => member.profile.id),
        groups: Object.fromEntries(groups.map(group => [group.id, group])),
    };
}

/** The cast's half of {@link perform}: read what is about to be overwritten, then overwrite it. */
function performOnCast(cast: ReturnType<typeof makeCast>, op: LiveCharacterOp, by = SELF): Done {
    const before = captureBefore(op, { cast });
    applyToCast(cast, op);
    return {
        effect: { kind: "effect", by, seq: ++seq, document: { doc: "characters" }, op },
        before,
    };
}

function invertOnCast(cast: ReturnType<typeof makeCast>, done: Done, self = SELF): LiveInverse {
    return inverseOf(done.effect, { self, cast, before: done.before });
}

function applyToCast(cast: ReturnType<typeof makeCast>, op: LiveCharacterOp): void {
    switch (op.op) {
        case "create-character":
            cast.characters[op.character.profile.id] = structuredClone(op.character);
            if (!cast.order.includes(op.character.profile.id)) {
                cast.order.push(op.character.profile.id);
            }
            return;
        case "update-character":
            cast.characters[op.characterId] = structuredClone(op.character);
            return;
        case "delete-character":
            delete cast.characters[op.characterId];
            cast.order = cast.order.filter(id => id !== op.characterId);
            return;
        case "set-character-group":
            cast.groups[op.groupId] = { ...op.group };
            for (const memberId of op.members ?? []) {
                const member = cast.characters[memberId];
                if (member) {
                    member.profile.groupId = op.groupId;
                }
            }
            return;
        case "delete-character-group":
            delete cast.groups[op.groupId];
            for (const member of Object.values(cast.characters)) {
                if (member.profile.groupId === op.groupId) {
                    delete member.profile.groupId;
                }
            }
            return;
    }
}

describe("undoing what this window did to the cast", () => {
    it("puts a record back exactly as it was, and carries the whole record to do it", () => {
        const cast = makeCast([record("c1", "Ada")]);
        const done = performOnCast(cast, {
            op: "update-character",
            characterId: "c1",
            character: record("c1", "Ada Lovelace"),
        });

        expect(asOp(invertOnCast(cast, done)))
            .toEqual({ op: "update-character", characterId: "c1", character: record("c1", "Ada") });
    });

    it("keeps a copy, so the record still describes the state before the operation", () => {
        // The store is edited in place. A record that pointed into it would describe the state after
        // the operation - the one mistake that makes every inverse a no-op.
        const cast = makeCast([record("c1", "Ada")]);
        const before = captureBefore({ op: "update-character", characterId: "c1", character: record("c1", "X") }, { cast });
        applyToCast(cast, { op: "update-character", characterId: "c1", character: record("c1", "X") });

        expect(before).toEqual({ op: "update-character", character: record("c1", "Ada") });
    });

    it("refuses to undo an update whose record has gone, rather than creating one", () => {
        const cast = makeCast([record("c1", "Ada")]);
        const done = performOnCast(cast, {
            op: "update-character",
            characterId: "c1",
            character: record("c1", "Ada Lovelace"),
        });
        delete cast.characters.c1;
        cast.order = [];

        // Putting a record back that somebody else deleted is not undoing an edit, it is making a
        // character - and the author asked for neither.
        expect(asImpossible(invertOnCast(cast, done))).toBe("character-gone");
    });

    it("takes a creation back by deleting the record it made", () => {
        const cast = makeCast();
        const done = performOnCast(cast, { op: "create-character", character: record("c1", "Ada") });

        expect(asOp(invertOnCast(cast, done))).toEqual({ op: "delete-character", characterId: "c1" });
    });

    it("takes a deletion back with the record, its place, and the lines it was speaking", () => {
        const cast = makeCast([record("c1", "Ada")]);
        const spoke = [{ storyId: "story-1", sceneId: "s1", blockId: "b1" }];
        const before = captureBefore({ op: "delete-character", characterId: "c1" }, { cast, spoke });
        applyToCast(cast, { op: "delete-character", characterId: "c1" });
        const done: Done = {
            effect: { kind: "effect", by: SELF, seq: ++seq, document: { doc: "characters" }, op: { op: "delete-character", characterId: "c1" } },
            before,
        };

        // The rows are carried where the deletion's own sweep was derived: they hold a bare name now,
        // and a name is not an identifier - two characters may share one, and the author may have
        // written more lines under it since.
        expect(asOp(invertOnCast(cast, done))).toEqual({
            op: "create-character",
            character: record("c1", "Ada"),
            rebind: spoke,
        });
    });

    it("refuses to undo a deletion whose record is back, rather than making a second one", () => {
        const cast = makeCast([record("c1", "Ada")]);
        const before = captureBefore({ op: "delete-character", characterId: "c1" }, { cast, spoke: [] });
        const done: Done = {
            effect: { kind: "effect", by: SELF, seq: ++seq, document: { doc: "characters" }, op: { op: "delete-character", characterId: "c1" } },
            before,
        };
        // Applied nowhere: the record is still there, which is what a redo or somebody else's undo
        // leaves behind.
        expect(asImpossible(invertOnCast(cast, done))).toBe("character-restored");
    });

    it("takes a new group back by removing it, and a renamed one back by its old name", () => {
        const cast = makeCast();
        const created = performOnCast(cast, {
            op: "set-character-group",
            groupId: "g1",
            group: { id: "g1", name: "Cast", createdAt: 1, updatedAt: 1 },
        });
        // There was no group, so the operation created one and taking it back is removing it.
        expect(asOp(invertOnCast(cast, created))).toEqual({ op: "delete-character-group", groupId: "g1" });

        const renamed = performOnCast(cast, {
            op: "set-character-group",
            groupId: "g1",
            group: { id: "g1", name: "Extras", createdAt: 1, updatedAt: 2 },
        });
        expect(asOp(invertOnCast(cast, renamed))).toEqual({
            op: "set-character-group",
            groupId: "g1",
            group: { id: "g1", name: "Cast", createdAt: 1, updatedAt: 1 },
        });
    });

    it("puts a deleted group back with the members it had, as one operation", () => {
        const cast = makeCast([record("c1", "Ada", "g1"), record("c2", "Bea", "g1"), record("c3", "Cy")],
            [{ id: "g1", name: "Cast", createdAt: 1, updatedAt: 1 }]);
        const done = performOnCast(cast, { op: "delete-character-group", groupId: "g1" });
        expect(cast.characters.c1?.profile.groupId).toBeUndefined();

        // A group put back empty is a group with the right name and the cast still scattered, and
        // the author would have to re-assign every member by hand.
        expect(asOp(invertOnCast(cast, done))).toEqual({
            op: "set-character-group",
            groupId: "g1",
            group: { id: "g1", name: "Cast", createdAt: 1, updatedAt: 1 },
            members: ["c1", "c2"],
        });
    });

    it("keeps nothing for a deletion of a group that was already gone", () => {
        const cast = makeCast();
        expect(captureBefore({ op: "delete-character-group", groupId: "g1" }, { cast })).toBeNull();
    });

    it("offers nothing for somebody else's edit to the cast", () => {
        // Not merely refused: an effect somebody else caused is not this machine's to take back at
        // all, and the interface must not be able to draw an entry for one.
        const cast = makeCast([record("c1", "Ada")]);
        const done = performOnCast(cast, {
            op: "update-character",
            characterId: "c1",
            character: record("c1", "Theirs"),
        }, OTHER);
        expect(asImpossible(invertOnCast(cast, done))).toBe("not-mine");
    });

    it("refuses an inverse with no record behind it", () => {
        const cast = makeCast([record("c1", "Ada")]);
        const done = performOnCast(cast, {
            op: "update-character",
            characterId: "c1",
            character: record("c1", "Ada Lovelace"),
        });
        expect(asImpossible(invertOnCast(cast, { ...done, before: null }))).toBe("no-record");
    });
});

/* --------------------------------------------------------------------------- the record */

describe("what a caller has to keep", () => {
    it("keeps nothing for an insert, because the effect already carries the row", () => {
        const document = makeDocument();
        const op: LiveOp = { op: "insert-block", sceneId: "s1", block: note("n"), target: { parentId: null } };
        expect(captureBefore(op, { story: document })).toBeNull();
    });

    it("keeps a copy, so the record still describes the state before the operation", () => {
        // The document is edited in place. A record that pointed into it would describe the state
        // after the operation - the one mistake that makes every inverse a no-op.
        const document = makeDocument();
        const before = captureBefore({ op: "update-block", sceneId: "s1", blockId: "a", payload: REWRITTEN }, { story: document });
        apply(document, { op: "update-block", sceneId: "s1", blockId: "a", payload: REWRITTEN });

        expect(before).toEqual({ op: "update-block", payload: { text: { textId: "text-a", value: "a", role: "note" } } });
    });

    it("reads where a row sits out of the document, at the moment the operation lands", () => {
        const document = makeDocument();
        expect(captureBefore({ op: "delete-block", sceneId: "s1", blockId: "one" }, { story: document }))
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
        expect(captureBefore({ op: "update-block", sceneId: "s1", blockId: "stranger", payload: REWRITTEN }, { story: document })).toBeNull();
        expect(captureBefore({ op: "rename-scene", sceneId: "gone", name: "Corridor" }, { story: document })).toBeNull();
    });
});

/* ---------------------------------------------------------- the translation and voice libraries */

/** The library applier a machine runs, for both kinds: a null entry removes. */
function applyLibrary<T>(units: Record<string, T>, entries: readonly { unitId: string; unit: T | null }[]): void {
    for (const entry of entries) {
        if (entry.unit === null) {
            delete units[entry.unitId];
        } else {
            units[entry.unitId] = entry.unit;
        }
    }
}

const JA = "ja";

function translation(target: string): LocalizationUnit {
    return { target, sourceHash: "h", status: "translated" };
}

/** Capture, apply, and answer the effect - the library half of {@link perform}. */
function performTranslation(
    units: Record<string, LocalizationUnit>,
    op: LiveLocalizationOp,
    by = SELF,
): Done {
    const before = captureBefore(op, { translations: locale => (locale === JA ? units : null) });
    applyLibrary(units, op.op === "set-translation" ? [{ unitId: op.unitId, unit: op.unit }] : op.units);
    return {
        effect: { kind: "effect", by, seq: ++seq, document: { doc: "localization", locale: JA }, op },
        before,
    };
}

function invertTranslation(units: Record<string, LocalizationUnit>, done: Done): LiveInverse {
    return inverseOf(done.effect, { self: SELF, before: done.before });
}

describe("undoing what this window did to a language", () => {
    it("puts the entry back to what it held", () => {
        const units: Record<string, LocalizationUnit> = { "text-a": translation("遅いよ。") };
        const done = performTranslation(units, {
            op: "set-translation", locale: JA, unitId: "text-a", unit: translation("早いね。"),
        });
        expect(units["text-a"].target).toBe("早いね。");

        const back = asOp(invertTranslation(units, done));
        applyLibrary(units, back.op === "set-translation" ? [{ unitId: back.unitId, unit: back.unit }] : []);
        expect(units["text-a"].target).toBe("遅いよ。");
    });

    it("undoes the FIRST translation of a line by putting the nothing back", () => {
        // ⚠ The case a record that could not tell "there was no entry" from "nothing was kept" would
        // make impossible to undo - and that is every line's first translation.
        const units: Record<string, LocalizationUnit> = {};
        const done = performTranslation(units, {
            op: "set-translation", locale: JA, unitId: "text-a", unit: translation("遅いよ。"),
        });
        expect(done.before).toEqual({ op: "set-translation", unit: null });

        expect(asOp(invertTranslation(units, done)))
            .toEqual({ op: "set-translation", locale: JA, unitId: "text-a", unit: null });
    });

    it("takes back a whole import in one operation", () => {
        // An import is one gesture, so taking it back is one press - the same bargain a paste makes
        // in the story editor.
        const units: Record<string, LocalizationUnit> = { "text-a": translation("old") };
        const done = performTranslation(units, {
            op: "set-translations",
            locale: JA,
            units: [
                { unitId: "text-a", unit: translation("new") },
                { unitId: "text-b", unit: translation("fresh") },
            ],
        });
        expect(Object.keys(units).sort()).toEqual(["text-a", "text-b"]);

        const inverse = asOp(invertTranslation(units, done)) as LiveLocalizationOp;
        expect(inverse).toEqual({
            op: "set-translations",
            locale: JA,
            units: [
                { unitId: "text-a", unit: translation("old") },
                // Never there before the import, so it goes back to not being there.
                { unitId: "text-b", unit: null },
            ],
        });
        applyLibrary(units, inverse.op === "set-translations" ? inverse.units : []);
        expect(units).toEqual({ "text-a": translation("old") });
    });

    it("keeps nothing for a language this machine does not hold", () => {
        // Not the same fact as "the entry was absent": nothing could be read, so there is nothing to
        // put back and the undo says so rather than writing an emptiness nobody asked for.
        expect(captureBefore(
            { op: "set-translation", locale: "fr", unitId: "text-a", unit: translation("x") },
            { translations: () => null },
        )).toBeNull();
    });

    it("refuses to undo somebody else's translation", () => {
        const units: Record<string, LocalizationUnit> = {};
        const done = performTranslation(units, {
            op: "set-translation", locale: JA, unitId: "text-a", unit: translation("遅いよ。"),
        }, OTHER);
        expect(asImpossible(inverseOf(done.effect, { self: SELF, before: done.before }))).toBe("not-mine");
    });

    it("undoes a take the same way, without a claim ever being involved", () => {
        const takes: Record<string, VoiceUnit> = { "text-a": { assetId: "clip-1", sourceHash: "h", status: "linked" } };
        const op: LiveVoiceOp = { op: "set-take", locale: JA, unitId: "text-a", unit: null };
        const before = captureBefore(op, { takes: locale => (locale === JA ? takes : null) });
        applyLibrary(takes, [{ unitId: "text-a", unit: null }]);

        const effect: LiveEffect = {
            kind: "effect", by: SELF, seq: ++seq, document: { doc: "voice", locale: JA }, op,
        };
        expect(asOp(inverseOf(effect, { self: SELF, before })))
            .toEqual({ op: "set-take", locale: JA, unitId: "text-a", unit: { assetId: "clip-1", sourceHash: "h", status: "linked" } });
    });
});

/* ------------------------------------------------------------------------ the asset library */

/** Apply one asset operation to a shard, the way the service does. */
function applyAssets(records: Record<string, LiveAssetRecord>, op: LiveAssetOp): void {
    if (op.op === "update-asset") {
        records[op.assetId] = { ...op.record };
        return;
    }
    if (op.op !== "move-assets") {
        return;
    }
    for (const move of op.moves) {
        const record = records[move.assetId];
        if (!record) {
            continue;
        }
        if (move.groupId === null) {
            delete (record as Record<string, unknown>).groupId;
        } else {
            (record as Record<string, unknown>).groupId = move.groupId;
        }
    }
}

function assetRecord(id: string, name = `${id}.png`, groupId?: string): LiveAssetRecord {
    return { id, type: "image", name, hash: `hash-${id}`, tags: [], description: "", ...(groupId ? { groupId } : {}) };
}

/** Capture, apply, and answer the effect - the library half of {@link perform}, one document along. */
function performAsset(records: Record<string, LiveAssetRecord>, op: LiveAssetOp, by = SELF): Done {
    const before = captureBefore(op, { assets: type => (type === "image" ? records : null) });
    applyAssets(records, op);
    return {
        effect: { kind: "effect", by, seq: ++seq, document: { doc: "assets", assetType: "image" }, op },
        before,
    };
}

function invertAsset(records: Record<string, LiveAssetRecord>, done: Done): LiveInverse {
    return inverseOf(done.effect, { self: SELF, before: done.before, assets: type => (type === "image" ? records : null) });
}

describe("undoing what this window did to the asset library", () => {
    it("puts the record back to what it held", () => {
        const records: Record<string, LiveAssetRecord> = { a1: assetRecord("a1", "room.png") };
        const done = performAsset(records, {
            op: "update-asset", assetType: "image", assetId: "a1", record: assetRecord("a1", "hall.jpg"),
        });
        expect(records.a1.name).toBe("hall.jpg");

        applyAssets(records, asOp(invertAsset(records, done)) as LiveAssetOp);
        expect(records.a1.name).toBe("room.png");
    });

    it("refuses when somebody deleted the file after the edit landed", () => {
        // Putting the record back would be a row in the browser with nothing under it - the cast's
        // answer to the same question, one document along.
        const records: Record<string, LiveAssetRecord> = { a1: assetRecord("a1", "room.png") };
        const done = performAsset(records, {
            op: "update-asset", assetType: "image", assetId: "a1", record: assetRecord("a1", "hall.jpg"),
        });
        delete records.a1;

        expect(invertAsset(records, done)).toEqual({ impossible: "asset-gone" });
    });

    it("puts every row of a drag back where IT came from, not where they all went", () => {
        // ⚠ The whole reason the operation carries a destination per row. A drag collects assets
        // that were in different folders, and an undo that filed them all in one place would be a
        // rearrangement nobody asked for wearing the word "undo".
        const records: Record<string, LiveAssetRecord> = {
            a1: assetRecord("a1", "a1.png", "chapter-1"),
            a2: assetRecord("a2"),
        };
        const done = performAsset(records, {
            op: "move-assets",
            assetType: "image",
            moves: [{ assetId: "a1", groupId: "chapter-2" }, { assetId: "a2", groupId: "chapter-2" }],
        });
        expect([records.a1.groupId, records.a2.groupId]).toEqual(["chapter-2", "chapter-2"]);

        const back = asOp(invertAsset(records, done)) as LiveAssetOp;
        expect(back).toEqual({
            op: "move-assets",
            assetType: "image",
            moves: [{ assetId: "a1", groupId: "chapter-1" }, { assetId: "a2", groupId: null }],
        });
        applyAssets(records, back);
        expect(records.a1.groupId).toBe("chapter-1");
        expect(records.a2.groupId).toBeUndefined();
    });

    it("refuses a drag whose rows are not all still there, rather than putting half of it back", () => {
        const records: Record<string, LiveAssetRecord> = { a1: assetRecord("a1"), a2: assetRecord("a2") };
        const done = performAsset(records, {
            op: "move-assets",
            assetType: "image",
            moves: [{ assetId: "a1", groupId: "chapter-2" }, { assetId: "a2", groupId: "chapter-2" }],
        });
        delete records.a2;

        expect(invertAsset(records, done)).toEqual({ impossible: "asset-gone" });
    });

    it("keeps nothing for a shard this window does not hold, and answers `no-record`", () => {
        const done: Done = {
            effect: {
                kind: "effect",
                by: SELF,
                seq: ++seq,
                document: { doc: "assets", assetType: "font" },
                op: { op: "update-asset", assetType: "font", assetId: "f1", record: assetRecord("f1") },
            },
            before: captureBefore(
                { op: "update-asset", assetType: "font", assetId: "f1", record: assetRecord("f1") },
                { assets: () => null },
            ),
        };
        expect(done.before).toBeNull();
        expect(inverseOf(done.effect, { self: SELF, before: done.before, assets: () => null }))
            .toEqual({ impossible: "no-record" });
    });
});


/* ---------------------------------------------------------- the three project tables */

/**
 * A dictionary, a mixer and a list of asset sets, each small enough to hold in a test.
 *
 * The appliers below are the services' own, cut down to what an inverse has to be checked against:
 * what matters here is that undoing a gesture puts the table back the way it was, and a fixture that
 * applied operations differently from the service would be checking itself.
 */
type Tables = {
    dictionary: ProjectDictionaryDocument;
    tracks: ProjectAudioTrack[];
    sets: AssetSet[];
};

function makeTables(): Tables {
    return {
        dictionary: {
            schemaVersion: 2,
            entries: [{ term: "Kagurazaka", reading: "かぐらざか" }],
            options: { suggestReadings: true, checkVariants: true },
        },
        tracks: [
            { id: "master-ish", name: "Music", parentId: null, volume: 1, loop: false },
            { id: "sub", name: "Strings", parentId: "master-ish", volume: 0.8, loop: true },
            { id: "last", name: "Voices", parentId: null, volume: 1, loop: false },
        ],
        sets: [
            { id: "s1", name: "Alice", type: "image", filter: [], axis: makeAssetSetAxis("release", []) },
            { id: "s2", name: "Alice happy", type: "image", filter: [], groupId: "cast", axis: makeAssetSetAxis("release", []) },
        ],
    };
}

function applyTables(tables: Tables, op: LiveOp): void {
    switch (op.op) {
        case "set-dictionary-entry": {
            const rest = tables.dictionary.entries
                .filter(entry => entry.term !== op.term && entry.term !== op.entry?.term);
            tables.dictionary.entries = op.entry ? [...rest, { ...op.entry }] : rest;
            return;
        }
        case "set-dictionary-options":
            tables.dictionary.options = { ...op.options };
            return;
        case "create-audio-track": {
            const reparent = new Set(op.reparent ?? []);
            const rest = tables.tracks
                .filter(track => track.id !== op.track.id)
                .map(track => (reparent.has(track.id) ? { ...track, parentId: op.track.id } : track));
            const index = op.beforeId === null ? -1 : rest.findIndex(track => track.id === op.beforeId);
            rest.splice(index < 0 ? rest.length : index, 0, { ...op.track });
            tables.tracks = rest;
            return;
        }
        case "update-audio-track":
            tables.tracks = tables.tracks.map(track => (
                track.id === op.trackId ? { ...op.track, id: op.trackId } : track
            ));
            return;
        case "delete-audio-track": {
            const doomed = tables.tracks.find(track => track.id === op.trackId);
            if (!doomed) {
                return;
            }
            tables.tracks = tables.tracks
                .filter(track => track.id !== op.trackId)
                .map(track => (track.parentId === op.trackId ? { ...track, parentId: doomed.parentId } : track));
            return;
        }
        case "move-audio-track": {
            const moving = tables.tracks.find(track => track.id === op.trackId);
            if (!moving) {
                return;
            }
            const rest = tables.tracks.filter(track => track.id !== op.trackId);
            const index = op.beforeId === null ? -1 : rest.findIndex(track => track.id === op.beforeId);
            rest.splice(index < 0 ? rest.length : index, 0, moving);
            tables.tracks = rest;
            return;
        }
        case "create-asset-sets": {
            const next = tables.sets.filter(set => !op.creates.some(create => create.set.id === set.id));
            for (const create of op.creates) {
                const index = create.beforeId === null ? -1 : next.findIndex(set => set.id === create.beforeId);
                next.splice(index < 0 ? next.length : index, 0, structuredClone(create.set));
            }
            tables.sets = next;
            return;
        }
        case "update-asset-set":
            tables.sets = tables.sets.map(set => (
                set.id === op.setId ? { ...structuredClone(op.set), id: op.setId } : set
            ));
            return;
        case "delete-asset-sets": {
            const doomed = new Set(op.setIds);
            tables.sets = tables.sets.filter(set => !doomed.has(set.id));
            return;
        }
        case "move-asset-sets": {
            const moves = new Map(op.moves.map(move => [move.setId, move.groupId]));
            tables.sets = tables.sets.map(set => {
                if (!moves.has(set.id)) {
                    return set;
                }
                const groupId = moves.get(set.id) ?? null;
                const { groupId: _current, ...rest } = set;
                return groupId ? { ...rest, groupId } : rest;
            });
            return;
        }
        default:
            throw new Error(`the tables fixture has no applier for ${op.op}`);
    }
}

function tableSources(tables: Tables) {
    return {
        dictionary: () => tables.dictionary,
        audioTracks: () => tables.tracks,
        assetSets: () => tables.sets,
    };
}

/** Capture, apply, and hand back what an undo would be asked about. */
function performTable(tables: Tables, op: LiveOp, document: LiveEffect["document"], by = SELF): Done {
    const before = captureBefore(op, tableSources(tables));
    applyTables(tables, op);
    return { effect: { kind: "effect", by, seq: ++seq, document, op }, before };
}

function invertTable(tables: Tables, done: Done): LiveInverse {
    return inverseOf(done.effect, { self: SELF, before: done.before, ...tableSources(tables) });
}

describe("undoing what this window did to the project dictionary", () => {
    it("takes back an added term by removing it", () => {
        const tables = makeTables();
        const done = performTable(tables, {
            op: "set-dictionary-entry", term: "Nattou", entry: { term: "Nattou" },
        }, { doc: "dictionary" });
        expect(tables.dictionary.entries.map(entry => entry.term)).toContain("Nattou");

        applyTables(tables, asOp(invertTable(tables, done)));
        expect(tables.dictionary.entries.map(entry => entry.term)).not.toContain("Nattou");
    });

    it("puts a removed term back with everything that described it", () => {
        // The reason `null` is a value here rather than the absence of a record: clearing an entry
        // IS the removal, so the undo has to know what the entry held.
        const tables = makeTables();
        const done = performTable(tables, {
            op: "set-dictionary-entry", term: "Kagurazaka", entry: null,
        }, { doc: "dictionary" });
        expect(tables.dictionary.entries).toHaveLength(0);

        applyTables(tables, asOp(invertTable(tables, done)));
        expect(tables.dictionary.entries).toEqual([{ term: "Kagurazaka", reading: "かぐらざか" }]);
    });

    it("takes a rename back by clearing the new spelling and restoring the old entry", () => {
        // ⚠ The address of the inverse is where the entry ENDED UP. A rename is one gesture, so it
        // is one operation, and taking it back has to remove what it wrote as well as put back what
        // it moved - which is why the term is the entry's identity rather than a field of it.
        const tables = makeTables();
        const done = performTable(tables, {
            op: "set-dictionary-entry",
            term: "Kagurazaka",
            entry: { term: "Kagura-zaka", reading: "かぐらざか" },
        }, { doc: "dictionary" });
        expect(tables.dictionary.entries.map(entry => entry.term)).toEqual(["Kagura-zaka"]);

        applyTables(tables, asOp(invertTable(tables, done)));
        expect(tables.dictionary.entries).toEqual([{ term: "Kagurazaka", reading: "かぐらざか" }]);
    });

    it("keeps nothing for a rename onto a spelling the project already writes", () => {
        // Studio refuses to produce one, so this is a machine a version apart - and one operation
        // names one address, so nothing here could put both entries back. Answered as "nothing was
        // kept" rather than as a half-restoration.
        const tables = makeTables();
        tables.dictionary.entries.push({ term: "Nattou" });
        const op: LiveOp = { op: "set-dictionary-entry", term: "Kagurazaka", entry: { term: "Nattou" } };
        expect(captureBefore(op, tableSources(tables))).toBeNull();
    });

    it("puts both checks back as one statement", () => {
        const tables = makeTables();
        const done = performTable(tables, {
            op: "set-dictionary-options", options: { suggestReadings: false, checkVariants: false },
        }, { doc: "dictionary" });

        applyTables(tables, asOp(invertTable(tables, done)));
        expect(tables.dictionary.options).toEqual({ suggestReadings: true, checkVariants: true });
    });
});

describe("undoing what this window did to the mixer", () => {
    it("brings the buses that were promoted back under the one that was deleted", () => {
        // ⚠ The asymmetry `create-character.rebind` has. Going down the promotion is derived; coming
        // back up it is not, because a promoted bus is indistinguishable from one that always hung
        // where it now hangs.
        const tables = makeTables();
        const done = performTable(tables, { op: "delete-audio-track", trackId: "master-ish" }, { doc: "audio-tracks" });
        expect(tables.tracks.map(track => track.id)).toEqual(["sub", "last"]);
        expect(tables.tracks[0]!.parentId).toBeNull();

        applyTables(tables, asOp(invertTable(tables, done)));
        expect(tables.tracks.map(track => track.id)).toEqual(["master-ish", "sub", "last"]);
        expect(tables.tracks.find(track => track.id === "sub")!.parentId).toBe("master-ish");
    });

    it("refuses when the bus is in the mixer again", () => {
        const tables = makeTables();
        const done = performTable(tables, { op: "delete-audio-track", trackId: "sub" }, { doc: "audio-tracks" });
        tables.tracks.push({ id: "sub", name: "Strings again", parentId: null, volume: 1, loop: false });

        expect(invertTable(tables, done)).toEqual({ impossible: "track-restored" });
    });

    it("refuses to put a record back on a bus somebody deleted", () => {
        const tables = makeTables();
        const done = performTable(tables, {
            op: "update-audio-track",
            trackId: "sub",
            track: { id: "sub", name: "Strings", parentId: "master-ish", volume: 0.2, loop: true },
        }, { doc: "audio-tracks" });
        tables.tracks = tables.tracks.filter(track => track.id !== "sub");

        expect(invertTable(tables, done)).toEqual({ impossible: "track-gone" });
    });

    it("puts a moved bus back where it sat", () => {
        const tables = makeTables();
        const done = performTable(tables, {
            op: "move-audio-track", trackId: "sub", beforeId: null,
        }, { doc: "audio-tracks" });
        expect(tables.tracks.map(track => track.id)).toEqual(["master-ish", "last", "sub"]);

        applyTables(tables, asOp(invertTable(tables, done)));
        expect(tables.tracks.map(track => track.id)).toEqual(["master-ish", "sub", "last"]);
    });
});

describe("undoing what this window did to the asset sets", () => {
    it("takes a declaration back by removing exactly what it made", () => {
        const tables = makeTables();
        const set: AssetSet = { id: "s3", name: "Ben", type: "image", filter: [], axis: makeAssetSetAxis("release", []) };
        const done = performTable(tables, {
            op: "create-asset-sets", creates: [{ set, beforeId: null }],
        }, { doc: "asset-sets" });
        expect(tables.sets.map(entry => entry.id)).toEqual(["s1", "s2", "s3"]);

        applyTables(tables, asOp(invertTable(tables, done)));
        expect(tables.sets.map(entry => entry.id)).toEqual(["s1", "s2"]);
    });

    it("puts a deleted subtree back in the order it was in", () => {
        // The anchors skip the sets that went with them, which is what lets one pass from the front
        // restore two sets that shared a surviving successor without swapping them.
        const tables = makeTables();
        tables.sets.push({ id: "s3", name: "Cara", type: "image", filter: [], axis: makeAssetSetAxis("release", []) });
        const done = performTable(tables, {
            op: "delete-asset-sets", setIds: ["s1", "s2"],
        }, { doc: "asset-sets" });
        expect(tables.sets.map(entry => entry.id)).toEqual(["s3"]);

        applyTables(tables, asOp(invertTable(tables, done)));
        expect(tables.sets.map(entry => entry.id)).toEqual(["s1", "s2", "s3"]);
        expect(tables.sets[1]!.groupId).toBe("cast");
    });

    it("files every set of a drag back where IT came from, not where they all went", () => {
        const tables = makeTables();
        const done = performTable(tables, {
            op: "move-asset-sets",
            moves: [{ setId: "s1", groupId: "shared" }, { setId: "s2", groupId: "shared" }],
        }, { doc: "asset-sets" });
        expect(tables.sets.map(entry => entry.groupId)).toEqual(["shared", "shared"]);

        applyTables(tables, asOp(invertTable(tables, done)));
        expect(tables.sets[0]!.groupId).toBeUndefined();
        expect(tables.sets[1]!.groupId).toBe("cast");
    });

    it("refuses when a set the batch named has gone", () => {
        const tables = makeTables();
        const done = performTable(tables, {
            op: "move-asset-sets", moves: [{ setId: "s1", groupId: "shared" }],
        }, { doc: "asset-sets" });
        tables.sets = tables.sets.filter(set => set.id !== "s1");

        expect(invertTable(tables, done)).toEqual({ impossible: "set-gone" });
    });
});
