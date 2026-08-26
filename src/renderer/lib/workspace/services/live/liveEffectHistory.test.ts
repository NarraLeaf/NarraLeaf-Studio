import { describe, expect, it } from "vitest";
import { insertBlockInScene } from "@/lib/workspace/services/story/storyModel";
import type { LiveCastView } from "@shared/live/cast";
import type { LiveDerived, LiveEffect, LiveOp } from "@shared/live/ops";
import {
    STORY_DOCUMENT_SCHEMA_VERSION,
    type StoryBlockId,
    type StoryDocument,
    type StoryNoteBlock,
    type StoryScene,
} from "@shared/types/story";
import { LiveEffectHistory } from "./liveEffectHistory";

const SELF = "me";

function note(id: StoryBlockId, value = id): StoryNoteBlock {
    return {
        id,
        kind: "note",
        parentId: null,
        childrenIds: [],
        payload: { text: { textId: `text-${id}`, value, role: "note" } },
    };
}

/** One scene holding `a` and `b`. */
function makeDocument(): StoryDocument {
    const scene: StoryScene = { id: "s1", name: "One", runtimeName: "one", rootBlockIds: [], blocks: {} };
    insertBlockInScene(scene, note("a"), { parentId: null });
    insertBlockInScene(scene, note("b"), { parentId: null });
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Tale",
        entrySceneId: "s1",
        chapters: [{ id: "c1", name: "One", sceneIds: ["s1"] }],
        scenes: { s1: scene },
    };
}

/** An empty cast, for the tests that are only about the story. */
const EMPTY_CAST: LiveCastView = { characters: {}, order: [], groups: {} };

/** No configuration table holds anything, for the tests that are only about the story. */
const NO_CONFIG = {
    hasAppTag: () => false,
    hasDlc: () => false,
    hasBrandColor: () => false,
    audioTracks: () => null,
    assetSets: () => null,
    variables: () => null,
    keys: () => null,
};

function effect(seq: number, op: LiveOp, patch: Partial<LiveEffect> = {}): LiveEffect {
    return { kind: "effect", by: SELF, seq, document: { doc: "story", storyId: "story-1" }, op, ...patch };
}

const renamed = (name: string): LiveOp => ({ op: "rename-story", name });

describe("the stack Ctrl+Z reads inside a session", () => {
    it("has nothing to offer before anything has been done", () => {
        const history = new LiveEffectHistory();
        expect(history.canUndo).toBe(false);
        expect(history.plan("undo", { self: SELF, cast: EMPTY_CAST, document: makeDocument(), assets: () => null, assetFolders: () => null, ...NO_CONFIG }))
            .toEqual({ impossible: "nothing-to-undo" });
    });

    it("answers with the inverse of the last thing this window did", () => {
        const history = new LiveEffectHistory();
        history.record({ effect: effect(1, renamed("Second")), before: { op: "rename-story", name: "Tale" } });
        expect(history.plan("undo", { self: SELF, cast: EMPTY_CAST, document: makeDocument(), assets: () => null, assetFolders: () => null, ...NO_CONFIG })).toEqual({
            index: 0,
            direction: "undo",
            op: { op: "rename-story", name: "Tale" },
        });
    });

    it("refuses an effect somebody else caused, whatever else is on the stack", () => {
        // Not merely discouraged: an effect this window did not cause is not this window's to take
        // back, so there is no inverse to offer at all.
        const history = new LiveEffectHistory();
        history.record({
            effect: effect(1, renamed("Second"), { by: "somebody-else" }),
            before: { op: "rename-story", name: "Tale" },
        });
        expect(history.plan("undo", { self: SELF, cast: EMPTY_CAST, document: makeDocument(), assets: () => null, assetFolders: () => null, ...NO_CONFIG }))
            .toEqual({ impossible: "not-mine" });
    });

    it("takes steps back one at a time and puts them back in the same order", () => {
        const history = new LiveEffectHistory();
        history.record({ effect: effect(1, renamed("Second")), before: { op: "rename-story", name: "First" } });
        history.record({ effect: effect(2, renamed("Third")), before: { op: "rename-story", name: "Second" } });

        const first = history.plan("undo", { self: SELF, cast: EMPTY_CAST, document: makeDocument(), assets: () => null, assetFolders: () => null, ...NO_CONFIG });
        expect(first).toMatchObject({ index: 1, op: { op: "rename-story", name: "Second" } });
        history.expect("k1", first as { index: number; direction: "undo" });
        // The effect that answers the step becomes what the step now stands on, which is what makes
        // redo the inverse of the inverse rather than a second mechanism.
        history.record({ effect: effect(3, renamed("Second")), before: { op: "rename-story", name: "Third" } }, "k1");
        expect(history.canRedo).toBe(true);

        const second = history.plan("undo", { self: SELF, cast: EMPTY_CAST, document: makeDocument(), assets: () => null, assetFolders: () => null, ...NO_CONFIG });
        expect(second).toMatchObject({ index: 0, op: { op: "rename-story", name: "First" } });

        const redo = history.plan("redo", { self: SELF, cast: EMPTY_CAST, document: makeDocument(), assets: () => null, assetFolders: () => null, ...NO_CONFIG });
        expect(second).toMatchObject({ index: 0, op: { op: "rename-story", name: "First" } });

        expect(redo).toMatchObject({ index: 1, op: { op: "rename-story", name: "Third" } });
    });

    it("has nothing to put back until something has been taken back", () => {
        const history = new LiveEffectHistory();
        history.record({ effect: effect(1, renamed("Second")), before: { op: "rename-story", name: "Tale" } });
        expect(history.plan("redo", { self: SELF, cast: EMPTY_CAST, document: makeDocument(), assets: () => null, assetFolders: () => null, ...NO_CONFIG }))
            .toEqual({ impossible: "nothing-to-redo" });
    });

    it("leaves the stack where it was when the host refuses a step", () => {
        const history = new LiveEffectHistory();
        history.record({ effect: effect(1, renamed("Second")), before: { op: "rename-story", name: "Tale" } });
        const plan = history.plan("undo", { self: SELF, cast: EMPTY_CAST, document: makeDocument(), assets: () => null, assetFolders: () => null, ...NO_CONFIG });
        history.expect("k1", plan as { index: number; direction: "undo" });
        history.abandon("k1");
        // Nothing was applied, so the step is still there to be taken.
        expect(history.canUndo).toBe(true);
        expect(history.canRedo).toBe(false);
    });

    it("drops what had been taken back as soon as something new is done", () => {
        const history = new LiveEffectHistory();
        history.record({ effect: effect(1, renamed("Second")), before: { op: "rename-story", name: "First" } });
        const plan = history.plan("undo", { self: SELF, cast: EMPTY_CAST, document: makeDocument(), assets: () => null, assetFolders: () => null, ...NO_CONFIG });
        history.expect("k1", plan as { index: number; direction: "undo" });
        history.record({ effect: effect(2, renamed("First")), before: { op: "rename-story", name: "Second" } }, "k1");
        expect(history.canRedo).toBe(true);

        history.record({ effect: effect(3, renamed("Elsewhere")), before: { op: "rename-story", name: "First" } });
        // The undone entry described a document that has since moved on.
        expect(history.canRedo).toBe(false);
        expect(history.length).toBe(1);
    });

    it("refuses when the row the last operation was about is gone", () => {
        const history = new LiveEffectHistory();
        const document = makeDocument();
        history.record({
            effect: effect(1, { op: "update-block", sceneId: "s1", blockId: "a", payload: note("a", "new").payload }),
            before: { op: "update-block", payload: note("a").payload },
        });
        delete document.scenes["s1"].blocks["a"];
        document.scenes["s1"].rootBlockIds = ["b"];
        expect(history.plan("undo", { self: SELF, cast: EMPTY_CAST, document, assets: () => null, assetFolders: () => null, ...NO_CONFIG })).toEqual({ impossible: "row-gone" });
    });

    it("carries the entries a deleted row came with into the insert that puts it back", () => {
        // The gap `inverseOf` leaves: it answers with an operation, and an operation carries no
        // translations. Without this the row comes back and its translations do not.
        const derived: LiveDerived = {
            translations: { fr: { "text-b": { target: "salut", sourceHash: "h", status: "translated" } } },
        };
        const history = new LiveEffectHistory();
        const document = makeDocument();
        const block = structuredClone(document.scenes["s1"].blocks["b"]);
        delete document.scenes["s1"].blocks["b"];
        document.scenes["s1"].rootBlockIds = ["a"];
        history.record({
            effect: effect(1, { op: "delete-block", sceneId: "s1", blockId: "b" }),
            before: { op: "delete-block", block, at: { parentId: null, beforeBlockId: null } },
            derived,
        });

        const plan = history.plan("undo", { self: SELF, cast: EMPTY_CAST, document, assets: () => null, assetFolders: () => null, ...NO_CONFIG });
        expect(plan).toMatchObject({ op: { op: "insert-block" }, derived });
    });

    it("does not attach those entries to an inverse that puts no row back", () => {
        const derived: LiveDerived = { translations: { fr: {} } };
        const history = new LiveEffectHistory();
        history.record({ effect: effect(1, renamed("Second")), before: { op: "rename-story", name: "Tale" }, derived });
        expect(history.plan("undo", { self: SELF, cast: EMPTY_CAST, document: makeDocument(), assets: () => null, assetFolders: () => null, ...NO_CONFIG })).not.toHaveProperty("derived");
    });
});
