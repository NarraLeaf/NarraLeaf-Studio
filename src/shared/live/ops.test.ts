import { describe, expect, it } from "vitest";
import type { CharacterGroup, StoredCharacter } from "@shared/types/character/model";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import {
    CLAIMED_OPS,
    characterClaimKey,
    isLiveMessage,
    opBelongsTo,
    opBlockId,
    opBlockIds,
    opClaimKeys,
    opDigestScope,
    opDocumentKind,
    opSceneId,
    sameLiveDocument,
    storyRowClaimKey,
    type LiveCharacterOp,
    type LiveOp,
    type LiveStoryOp,
} from "./ops";
import { sceneDigest } from "./sceneDigest";

const BLOCK: StoryBlock = {
    id: "block-1",
    payload: { kind: "dialogue", speaker: { kind: "temp", name: "Aoi" }, text: "You're late." },
} as unknown as StoryBlock;

const RECORD: StoredCharacter = {
    profile: {
        id: "char-1",
        name: "Aoi",
        description: "",
        tags: [],
        attributes: {},
        thumbnail: null,
        nicknames: [],
        appearance: { kind: "preset", poses: [], defaultPoseId: null },
    },
};

const GROUP: CharacterGroup = { id: "g1", name: "Cast", createdAt: 1, updatedAt: 1 };

/** One of each story operation, so the helpers below are exercised over the whole story vocabulary. */
const EVERY_STORY_OP: LiveStoryOp[] = [
    { op: "insert-block", sceneId: "s1", block: BLOCK, target: { parentId: null } },
    { op: "update-block", sceneId: "s1", blockId: "block-1", payload: BLOCK.payload },
    { op: "update-blocks", edits: [{ sceneId: "s1", blockId: "block-1", payload: BLOCK.payload }] },
    { op: "delete-block", sceneId: "s1", blockId: "block-1" },
    { op: "move-block", sceneId: "s1", blockId: "block-1", target: { parentId: null, beforeBlockId: "block-2" } },
    { op: "move-blocks", sceneId: "s1", moves: [{ blockIds: ["block-1"], target: { parentId: null } }] },
    { op: "set-block-disabled", sceneId: "s1", blockId: "block-1", disabled: true },
    { op: "rename-scene", sceneId: "s1", name: "Corridor" },
    { op: "set-entry-scene", sceneId: "s1" },
    { op: "rename-story", name: "Skeleton" },
    { op: "reorder-chapters", chapterIds: ["c2", "c1"] },
];

/** The same for the cast. */
const EVERY_CHARACTER_OP: LiveCharacterOp[] = [
    { op: "create-character", character: RECORD },
    { op: "update-character", characterId: "char-1", character: RECORD },
    { op: "delete-character", characterId: "char-1" },
    { op: "set-character-group", groupId: "g1", group: GROUP },
    { op: "delete-character-group", groupId: "g1" },
];

const EVERY_OP: LiveOp[] = [...EVERY_STORY_OP, ...EVERY_CHARACTER_OP];

describe("the operation vocabulary", () => {
    it("answers a block for every operation that is about one, and null for the rest", () => {
        // Both helpers are exhaustive switches with no default: an operation added later fails to
        // compile here until somebody has said what it is about, which is what stops a new verb
        // silently escaping the claim rules below.
        const byOp = new Map(EVERY_STORY_OP.map(op => [op.op, opBlockId(op)]));
        expect(byOp.get("insert-block")).toBe("block-1");
        expect(byOp.get("update-block")).toBe("block-1");
        expect(byOp.get("delete-block")).toBe("block-1");
        expect(byOp.get("move-block")).toBe("block-1");
        expect(byOp.get("set-block-disabled")).toBe("block-1");
        expect(byOp.get("rename-scene")).toBeNull();
        expect(byOp.get("set-entry-scene")).toBeNull();
        expect(byOp.get("rename-story")).toBeNull();
        expect(byOp.get("reorder-chapters")).toBeNull();
    });

    it("answers no single block for a batch, because a batch is about many", () => {
        // The answer feeds a lookup of ONE claim. A batch that named one of its rows here would be
        // checked against that row and let the rest through - half a gesture applied, which is the
        // one outcome batching exists to prevent.
        const byOp = new Map(EVERY_STORY_OP.map(op => [op.op, opBlockId(op)]));
        expect(byOp.get("update-blocks")).toBeNull();
        expect(byOp.get("move-blocks")).toBeNull();
    });

    it("names every row a batch touches, which is what a claim check has to ask", () => {
        const edits: LiveStoryOp = {
            op: "update-blocks",
            edits: [
                { sceneId: "s1", blockId: "block-1", payload: BLOCK.payload },
                { sceneId: "s2", blockId: "block-2", payload: BLOCK.payload },
            ],
        };
        const moves: LiveStoryOp = {
            op: "move-blocks",
            sceneId: "s1",
            moves: [
                { blockIds: ["block-1", "block-2"], target: { parentId: null } },
                { blockIds: ["block-3"], target: { parentId: "g" } },
            ],
        };
        expect(opBlockIds(edits)).toEqual(["block-1", "block-2"]);
        expect(opBlockIds(moves)).toEqual(["block-1", "block-2", "block-3"]);
        // The single verbs answer with the one row they are about, so a claim check written against
        // this helper needs no second shape for them.
        expect(opBlockIds({ op: "delete-block", sceneId: "s1", blockId: "block-1" })).toEqual(["block-1"]);
        expect(opBlockIds({ op: "rename-story", name: "Skeleton" })).toEqual([]);
    });

    it("answers a scene for the operations that live inside one", () => {
        const byOp = new Map(EVERY_STORY_OP.map(op => [op.op, opSceneId(op)]));
        for (const kind of ["insert-block", "update-block", "update-blocks", "delete-block", "move-block", "move-blocks", "set-block-disabled", "rename-scene"] as const) {
            expect(byOp.get(kind)).toBe("s1");
        }
        expect(byOp.get("rename-story")).toBeNull();
        expect(byOp.get("reorder-chapters")).toBeNull();
    });

    it("answers no scene for a batch that reaches across scenes, because a digest fingerprints one", () => {
        expect(opSceneId({
            op: "update-blocks",
            edits: [
                { sceneId: "s1", blockId: "block-1", payload: BLOCK.payload },
                { sceneId: "s2", blockId: "block-2", payload: BLOCK.payload },
            ],
        })).toBeNull();
    });

    it("claims only the operations that would destroy a paragraph somebody is typing", () => {
        // The line between the two is what a loser loses. Editing, deleting or disabling a row while
        // its author is mid-paragraph takes the paragraph; renaming a scene under somebody takes a
        // word. The first is worth the ceremony of a claim and the second is not.
        expect([...CLAIMED_OPS].sort()).toEqual([
            "delete-block",
            "delete-blocks",
            "delete-character",
            "set-block-disabled",
            "update-block",
            "update-blocks",
            "update-character",
        ]);
        for (const kind of ["rename-scene", "set-entry-scene", "rename-story", "reorder-chapters", "move-block", "move-blocks", "insert-block", "insert-blocks"] as const) {
            expect(CLAIMED_OPS.has(kind)).toBe(false);
        }
    });

    it("claims a character record, and does not claim the cast's order or its groups", () => {
        // The test is whether the interface holds a draft of it. A character's description
        // accumulates in the properties panel until the field is blurred, and an arriving edit to the
        // same character would wipe it mid-sentence - the row's own reason, in another panel.
        // Rearranging the cast is a drag, and a drag costs one gesture to repeat.
        expect(CLAIMED_OPS.has("update-character")).toBe(true);
        // Deleting a record somebody else has open takes their whole panel of typing with it, which
        // is the row's own reason for a claim seen at its most expensive.
        expect(CLAIMED_OPS.has("delete-character")).toBe(true);
        for (const kind of ["create-character", "set-character-group", "delete-character-group"] as const) {
            expect(CLAIMED_OPS.has(kind)).toBe(false);
        }
    });

    it("gives a batch the claim status of the single operation it batches", () => {
        // Batching changes how many rows are at stake, never what a loser loses: `update-blocks`
        // writes prose over rows and is claimed, `move-blocks` rearranges rows without touching a
        // word of them and is not - exactly as their single-row counterparts.
        expect(CLAIMED_OPS.has("update-blocks")).toBe(CLAIMED_OPS.has("update-block"));
        expect(CLAIMED_OPS.has("move-blocks")).toBe(CLAIMED_OPS.has("move-block"));
        expect(CLAIMED_OPS.has("delete-blocks")).toBe(CLAIMED_OPS.has("delete-block"));
        expect(CLAIMED_OPS.has("insert-blocks")).toBe(CLAIMED_OPS.has("insert-block"));
    });

    it("names every row of a batch, so one held row refuses the whole gesture", () => {
        // The question a claim check asks is a set for a batch, and `opBlockId` cannot answer it:
        // a batch that named one of its rows there would have that row checked and the rest let
        // through, which is the half-applied gesture batching exists to prevent.
        const inserts: LiveStoryOp = {
            op: "insert-blocks",
            sceneId: "s1",
            inserts: [
                { block: { ...BLOCK, id: "block-1" }, target: { parentId: null } },
                { block: { ...BLOCK, id: "block-2" }, target: { parentId: "block-1" } },
            ],
        };
        const deletes: LiveStoryOp = { op: "delete-blocks", sceneId: "s1", blockIds: ["block-1", "block-2"] };
        expect(opBlockIds(inserts)).toEqual(["block-1", "block-2"]);
        expect(opBlockIds(deletes)).toEqual(["block-1", "block-2"]);
        expect(opBlockId(inserts)).toBeNull();
        expect(opBlockId(deletes)).toBeNull();
        // Both are about one scene, so both keep the digest that guards against two copies drifting.
        expect(opSceneId(inserts)).toBe("s1");
        expect(opSceneId(deletes)).toBe("s1");
    });

    it("claims by row rather than by field, so a claimed row is claimed whole", () => {
        // A row's fields hold each other up: a different speaker changes how the prose parses and
        // which translation entry the line belongs to. Two people editing "different fields" of one
        // row are editing one row.
        const text: LiveStoryOp = { op: "update-block", sceneId: "s1", blockId: "block-1", payload: BLOCK.payload };
        const disabled: LiveStoryOp = { op: "set-block-disabled", sceneId: "s1", blockId: "block-1", disabled: true };
        expect(CLAIMED_OPS.has(text.op) && CLAIMED_OPS.has(disabled.op)).toBe(true);
        expect(opBlockId(text)).toBe(opBlockId(disabled));
    });
});

describe("document addressing", () => {
    it("answers a document kind for every verb, so no operation can travel unaddressed", () => {
        // An exhaustive switch with no default: a verb added later fails to compile until somebody
        // has said which document it changes. Without that, an operation would reach whichever
        // document the receiver happened to have open.
        const byOp = new Map(EVERY_OP.map(op => [op.op, opDocumentKind(op)]));
        for (const op of EVERY_STORY_OP) {
            expect(byOp.get(op.op)).toBe("story");
        }
        for (const op of EVERY_CHARACTER_OP) {
            expect(byOp.get(op.op)).toBe("characters");
        }
    });

    it("refuses a pair whose operation could not be about the document it names", () => {
        // The message carries both, so the two can disagree - a story operation addressed at the cast
        // would otherwise write a scene's worth of rows into a character store.
        expect(opBelongsTo({ op: "rename-story", name: "Skeleton" }, { doc: "story", storyId: "s" })).toBe(true);
        expect(opBelongsTo({ op: "rename-story", name: "Skeleton" }, { doc: "characters" })).toBe(false);
        expect(opBelongsTo({ op: "delete-character-group", groupId: "g" }, { doc: "characters" })).toBe(true);
        expect(opBelongsTo({ op: "delete-character-group", groupId: "g" }, { doc: "story", storyId: "s" })).toBe(false);
    });

    it("tells two story documents apart, because a project has many", () => {
        expect(sameLiveDocument({ doc: "story", storyId: "a" }, { doc: "story", storyId: "a" })).toBe(true);
        expect(sameLiveDocument({ doc: "story", storyId: "a" }, { doc: "story", storyId: "b" })).toBe(false);
        expect(sameLiveDocument({ doc: "characters" }, { doc: "characters" })).toBe(true);
        expect(sameLiveDocument({ doc: "story", storyId: "a" }, { doc: "characters" })).toBe(false);
    });
});

describe("claim keys", () => {
    it("keeps a row and a character apart even when their ids are equal", () => {
        // Both are uuids, so an unprefixed map would let one document's claim answer for the other's -
        // silently, because there would be nothing to compare.
        expect(storyRowClaimKey("x")).not.toBe(characterClaimKey("x"));
    });

    it("names every claim an operation needs, so one held part refuses the whole gesture", () => {
        expect(opClaimKeys({ op: "delete-blocks", sceneId: "s1", blockIds: ["b1", "b2"] }))
            .toEqual([storyRowClaimKey("b1"), storyRowClaimKey("b2")]);
        expect(opClaimKeys({ op: "update-character", characterId: "char-1", character: RECORD }))
            .toEqual([characterClaimKey("char-1")]);
        // A creation names the record it is about, so two people cannot mint one character twice, and
        // the cast-level verbs claim nothing at all.
        expect(opClaimKeys({ op: "create-character", character: RECORD })).toEqual([characterClaimKey("char-1")]);
        expect(opClaimKeys({ op: "set-character-group", groupId: "g1", group: GROUP })).toEqual([]);
        expect(opClaimKeys({ op: "rename-story", name: "Skeleton" })).toEqual([]);
    });
});

describe("digest scopes", () => {
    it("fingerprints the unit the operation names, never the document", () => {
        // A per-document digest would re-encode a whole story on every committed line; this
        // repository has measured that at 133 ms of the renderer's thread for a 15.4 MB document.
        expect(opDigestScope({ op: "update-block", sceneId: "s1", blockId: "b1", payload: BLOCK.payload }, "s"))
            .toEqual({ of: "scene", storyId: "s", sceneId: "s1" });
        expect(opDigestScope({ op: "update-character", characterId: "char-1", character: RECORD }, "s"))
            .toEqual({ of: "character", characterId: "char-1" });
        expect(opDigestScope({ op: "set-character-group", groupId: "g1", group: GROUP }, "s")).toEqual({ of: "cast" });
        expect(opDigestScope({ op: "delete-character-group", groupId: "g1" }, "s")).toEqual({ of: "cast" });
    });

    it("has no scope for the operations no unit covers, which is not the same as agreeing", () => {
        // `set-entry-scene` names a scene it does not change, and a digest of it would fingerprint
        // something the operation cannot have altered. The guard rules `unproven` on these.
        expect(opDigestScope({ op: "set-entry-scene", sceneId: "s1" }, "s")).toBeNull();
        expect(opDigestScope({ op: "rename-story", name: "Skeleton" }, "s")).toBeNull();
        expect(opDigestScope({ op: "reorder-chapters", chapterIds: ["c1"] }, "s")).toBeNull();
        // And a batch across two scenes has no single scene to fingerprint.
        expect(opDigestScope({
            op: "update-blocks",
            edits: [
                { sceneId: "s1", blockId: "b1", payload: BLOCK.payload },
                { sceneId: "s2", blockId: "b2", payload: BLOCK.payload },
            ],
        }, "s")).toBeNull();
    });
});

describe("isLiveMessage", () => {
    it("recognises every kind a machine in a session can send", () => {
        const kinds = ["intent", "effect", "refusal", "claims", "claim", "resync", "catch-up"];
        for (const kind of kinds) {
            expect(isLiveMessage({ kind })).toBe(true);
        }
    });

    it("rejects anything else, because the payload comes from another build", () => {
        // The channel carries whatever another Studio put on it, which may be a version this one has
        // never seen. Something unreadable has to be ignored rather than handed on.
        for (const value of [null, undefined, 42, "effect", {}, { kind: "nonsense" }, []]) {
            expect(isLiveMessage(value)).toBe(false);
        }
    });
});

describe("sceneDigest", () => {
    const scene = (blocks: Record<string, unknown>): StoryScene =>
        ({ id: "s1", name: "Corridor", blocks, order: Object.keys(blocks) } as unknown as StoryScene);

    it("agrees for two copies of one scene built in different key orders", () => {
        // The comparison has to survive key order or it reports a disagreement nobody can act on:
        // two machines assemble the same scene through different code paths every day.
        const a = { id: "s1", name: "Corridor", blocks: { b1: { id: "b1", text: "one" } } };
        const b = { name: "Corridor", blocks: { b1: { text: "one", id: "b1" } }, id: "s1" };
        expect(sceneDigest(a as unknown as StoryScene)).toBe(sceneDigest(b as unknown as StoryScene));
    });

    it("differs when the content differs, which is the whole point of computing it", () => {
        expect(sceneDigest(scene({ b1: { id: "b1", text: "one" } })))
            .not.toBe(sceneDigest(scene({ b1: { id: "b1", text: "two" } })));
    });

    it("differs when a row is added, so a missed operation cannot hide", () => {
        const before = sceneDigest(scene({ b1: { id: "b1", text: "one" } }));
        const after = sceneDigest(scene({ b1: { id: "b1", text: "one" }, b2: { id: "b2", text: "two" } }));
        expect(after).not.toBe(before);
    });

    it("ignores the timestamp each machine stamps for itself", () => {
        // Renaming a scene stamps `meta.updatedAt` from the clock of whichever machine applied it,
        // so two machines that did the same thing hold two different values and agree about every
        // word. Hashing that would eject every guest in the room on the first rename.
        const a = { id: "s1", name: "Corridor", blocks: {}, meta: { updatedAt: "2026-08-22T09:00:00.000Z" } };
        const b = { id: "s1", name: "Corridor", blocks: {}, meta: { updatedAt: "2026-08-22T09:00:04.881Z" } };
        expect(sceneDigest(a as unknown as StoryScene)).toBe(sceneDigest(b as unknown as StoryScene));
        // And a scene with no meta at all is the same scene as one that has been touched.
        expect(sceneDigest({ id: "s1", name: "Corridor", blocks: {} } as unknown as StoryScene))
            .toBe(sceneDigest(a as unknown as StoryScene));
    });

    it("still notices the rename itself", () => {
        const before = { id: "s1", name: "Corridor", blocks: {}, meta: { updatedAt: "x" } };
        const after = { id: "s1", name: "The corridor", blocks: {}, meta: { updatedAt: "x" } };
        expect(sceneDigest(before as unknown as StoryScene))
            .not.toBe(sceneDigest(after as unknown as StoryScene));
    });

    it("is short enough to ride on every effect", () => {
        // It travels with each operation down a channel with a payload cap, so its size is part of
        // the contract rather than an implementation detail.
        expect(sceneDigest(scene({ b1: { id: "b1" } }))).toMatch(/^[0-9a-f]{16}$/);
    });
});
