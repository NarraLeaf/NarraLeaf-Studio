import { describe, expect, it } from "vitest";
import type { CharacterGroup, StoredCharacter } from "@shared/types/character/model";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { APP_TAG_ID_RELEASE, normalizeProjectAppTags, type ProjectAppTag } from "@shared/types/appTag";
import type { BrandColor } from "@shared/types/brand";
import type { ProjectDlc } from "@shared/types/dlc";
import {
    APP_TAG_DEFAULTS_CLAIM_ID,
    CLAIMED_OPS,
    appTagClaimKey,
    assetClaimKey,
    brandColorClaimKey,
    characterClaimKey,
    dlcClaimKey,
    isLiveMessage,
    localizationKeyClaimKey,
    opAddresses,
    opBelongsTo,
    opBlockId,
    opBlockIds,
    opClaimKeys,
    opDigestScope,
    opDocumentKind,
    opSceneId,
    sameDigestScope,
    sameLiveDocument,
    storyRowClaimKey,
    translationClaimKey,
    variableClaimKey,
    type LiveAssetOp,
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
            "delete-app-tag",
            "delete-assets",
            "delete-block",
            "delete-blocks",
            "delete-brand-color",
            "delete-character",
            "delete-dlc",
            "delete-variable",
            "remove-key",
            "replace-asset-content",
            "set-app-tag-defaults",
            "set-block-disabled",
            "set-key",
            "set-translation",
            "set-translations",
            "update-app-tag",
            "update-asset",
            "update-block",
            "update-blocks",
            "update-brand-color",
            "update-character",
            "update-dlc",
            "update-variable",
            "write-ui",
            "write-ui-graphs",
        ]);
        for (const kind of ["rename-scene", "set-entry-scene", "rename-story", "reorder-chapters", "move-block", "move-blocks", "insert-block", "insert-blocks", "move-assets", "create-assets", "set-asset-folder", "delete-asset-folder", "restore-asset-folder", "create-app-tag", "create-dlc", "create-brand-color", "move-brand-color", "set-brand-fonts", "create-variable"] as const) {
            expect(CLAIMED_OPS.has(kind)).toBe(false);
        }
    });

    it("claims a variable entry and a named string, which is the same test reaching a different box", () => {
        // Neither box keeps a draft the way the properties panel's fields do - both are controlled
        // inputs that write on every keystroke - so the usual diagnostic says no. The question behind
        // it says yes: with a session installed the box's value IS the document, so somebody else's
        // edit to the same entry lands under the author's cursor and takes what they had typed. A
        // creation is unclaimed with every other creation: the id was minted by whoever built it.
        expect(CLAIMED_OPS.has("update-variable")).toBe(true);
        expect(CLAIMED_OPS.has("delete-variable")).toBe(true);
        expect(CLAIMED_OPS.has("create-variable")).toBe(false);
        expect(CLAIMED_OPS.has("set-key")).toBe(true);
        expect(CLAIMED_OPS.has("remove-key")).toBe(true);
    });

    it("claims a translation and not a voice take, which is the same test applied twice", () => {
        // The translation field IS the working copy while a translator types - a contentEditable the
        // browser edits, reaching the document on Enter or blur - so the loser of a race loses the
        // line they were halfway through writing, silently. A take is dropped on a row and approved
        // with a button; the one drafted thing on it is a short direction note, and its loser can
        // read the winner's in the box.
        expect(CLAIMED_OPS.has("set-translation")).toBe(true);
        expect(CLAIMED_OPS.has("set-translations")).toBe(true);
        expect(CLAIMED_OPS.has("set-take")).toBe(false);
        expect(CLAIMED_OPS.has("set-takes")).toBe(false);
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

/**
 * The asset library's half of the vocabulary.
 *
 * What these guard is the one thing an asset operation can do that no other can: write a record into
 * a sibling type's shard. Every other document a session carries is addressed by something the
 * operation cannot state wrongly - a story operation names no story at all - while these name their
 * own type twice, once on the message and once inside the verb.
 */
describe("the asset operations", () => {
    const UPDATE: LiveAssetOp = {
        op: "update-asset",
        assetType: "image",
        assetId: "asset-1",
        record: { id: "asset-1", type: "image", name: "classroom.png" },
    };
    const MOVE: LiveAssetOp = {
        op: "move-assets",
        assetType: "audio",
        moves: [{ assetId: "asset-2", groupId: "group-1" }, { assetId: "asset-3", groupId: null }],
    };

    it("belongs to the asset library and fingerprints the shard it names", () => {
        expect(opDocumentKind(UPDATE)).toBe("assets");
        expect(opDocumentKind(MOVE)).toBe("assets");
        expect(opDigestScope(UPDATE, "story-1" as never)).toEqual({ of: "assets", assetType: "image" });
        expect(opDigestScope(MOVE, "story-1" as never)).toEqual({ of: "assets", assetType: "audio" });
    });

    it("refuses a message whose type disagrees with the one inside the operation", () => {
        // ⚠ The failure this catches has no other symptom. A record written into a sibling type's
        // shard is a file the browser no longer draws anywhere, sitting in a document whose own
        // digest agrees with itself.
        expect(opBelongsTo(UPDATE, { doc: "assets", assetType: "audio" })).toBe(true);
        expect(opAddresses(UPDATE, { doc: "assets", assetType: "audio" })).toBe(false);
        expect(opAddresses(UPDATE, { doc: "assets", assetType: "image" })).toBe(true);
        expect(opAddresses(MOVE, { doc: "assets", assetType: "audio" })).toBe(true);
    });

    it("claims a record and not a drag, which is the story's own split", () => {
        expect(opClaimKeys(UPDATE)).toEqual([assetClaimKey("asset-1")]);
        expect(opClaimKeys(MOVE)).toEqual([]);
    });

    it("keys a claim by the id alone, because an id is unique across the whole library", () => {
        // Unlike a translation, whose locale is in the key: the same line has an entry in every
        // language, and two translators are not in each other's way. An asset is one record.
        expect(assetClaimKey("asset-1")).not.toBe(characterClaimKey("asset-1"));
        expect(assetClaimKey("asset-1")).not.toBe(storyRowClaimKey("asset-1"));
    });

    it("tells two shards apart, and one shard from itself", () => {
        expect(sameLiveDocument({ doc: "assets", assetType: "image" }, { doc: "assets", assetType: "image" })).toBe(true);
        expect(sameLiveDocument({ doc: "assets", assetType: "image" }, { doc: "assets", assetType: "audio" })).toBe(false);
        expect(sameLiveDocument({ doc: "assets", assetType: "image" }, { doc: "characters" })).toBe(false);
    });
});

describe("the project's three configuration tables", () => {
    const VARIANT: ProjectAppTag = { id: "tag-1", name: "Demo", overrides: { displayName: "Skeleton Demo" } };
    const DLC: ProjectDlc = { id: "side", name: "Side Story", attachTo: "release" };
    const COLOR: BrandColor = { id: "c1a2b3c", name: "Ink", value: "#101318" };

    it("says which document each verb is about, and every verb has one", () => {
        expect(opDocumentKind({ op: "create-app-tag", tag: VARIANT })).toBe("app-tags");
        expect(opDocumentKind({ op: "set-app-tag-defaults", defaults: {} })).toBe("app-tags");
        expect(opDocumentKind({ op: "delete-dlc", dlcId: "side" })).toBe("dlc");
        expect(opDocumentKind({ op: "move-brand-color", colorId: "c1a2b3c", beforeId: null })).toBe("brand");
        expect(opDocumentKind({ op: "set-brand-fonts", fonts: [] })).toBe("brand");
    });

    it("addresses each of them by kind alone, because there is one per project", () => {
        expect(sameLiveDocument({ doc: "app-tags" }, { doc: "app-tags" })).toBe(true);
        expect(sameLiveDocument({ doc: "dlc" }, { doc: "brand" })).toBe(false);
        expect(opBelongsTo({ op: "delete-dlc", dlcId: "side" }, { doc: "dlc" })).toBe(true);
        expect(opBelongsTo({ op: "delete-dlc", dlcId: "side" }, { doc: "app-tags" })).toBe(false);
        // Nothing of their own to compare, so the kind agreeing is the whole of the check.
        expect(opAddresses({ op: "delete-dlc", dlcId: "side" }, { doc: "dlc" })).toBe(true);
    });

    it("keeps its three key spaces apart, and apart from the four that came before", () => {
        // Every kind of claim lives in one map, so a bare id shared between two tables would let one
        // document's claim answer for the other's - the confusion nothing could detect.
        for (const key of [appTagClaimKey("x"), dlcClaimKey("x"), brandColorClaimKey("x")]) {
            expect(key.startsWith("x")).toBe(false);
        }
        expect(new Set([
            appTagClaimKey("x"),
            dlcClaimKey("x"),
            brandColorClaimKey("x"),
            storyRowClaimKey("x"),
            characterClaimKey("x"),
            assetClaimKey("x"),
        ]).size).toBe(6);
    });

    it("holds the project's own defaults under the release variant's reserved id", () => {
        // Not a trick: the release variant is what the document's root records belong to - it is
        // synthesized and stores nothing of its own - and the panel draws it as a row beside the
        // others. The id cannot collide with a stored one, because it is exactly the id the
        // normalizer refuses to store.
        expect(APP_TAG_DEFAULTS_CLAIM_ID).toBe(APP_TAG_ID_RELEASE);
        expect(normalizeProjectAppTags([{ id: APP_TAG_ID_RELEASE, name: "Forged", overrides: {} }])).toEqual([]);
        expect(opClaimKeys({ op: "set-app-tag-defaults", defaults: {} }))
            .toEqual([appTagClaimKey(APP_TAG_ID_RELEASE)]);
    });

    it("claims a row and not a creation or a rearrangement, which is the story's own split", () => {
        expect(opClaimKeys({ op: "update-app-tag", tagId: "tag-1", tag: VARIANT }))
            .toEqual([appTagClaimKey("tag-1")]);
        expect(opClaimKeys({ op: "delete-dlc", dlcId: "side" })).toEqual([dlcClaimKey("side")]);
        expect(opClaimKeys({ op: "update-brand-color", colorId: "c1a2b3c", color: COLOR }))
            .toEqual([brandColorClaimKey("c1a2b3c")]);
        // A creation names an id nobody else has; a drag and the font stack touch nothing typed.
        expect(opClaimKeys({ op: "create-app-tag", tag: VARIANT })).toEqual([]);
        expect(opClaimKeys({ op: "create-dlc", dlc: DLC })).toEqual([]);
        expect(opClaimKeys({ op: "create-brand-color", color: COLOR })).toEqual([]);
        expect(opClaimKeys({ op: "move-brand-color", colorId: "c1a2b3c", beforeId: null })).toEqual([]);
        expect(opClaimKeys({ op: "set-brand-fonts", fonts: [] })).toEqual([]);
    });

    it("fingerprints each table whole, which is what catches a rearrangement", () => {
        // The one place a per-row digest would say nothing at all: `move-brand-color` names a row it
        // does not change, and the palette's order is what the panel draws.
        expect(opDigestScope({ op: "update-app-tag", tagId: "tag-1", tag: VARIANT }, "story-1"))
            .toEqual({ of: "app-tags" });
        expect(opDigestScope({ op: "create-dlc", dlc: DLC }, "story-1")).toEqual({ of: "dlc" });
        expect(opDigestScope({ op: "move-brand-color", colorId: "c1a2b3c", beforeId: null }, "story-1"))
            .toEqual({ of: "brand" });
        expect(sameDigestScope({ of: "brand" }, { of: "brand" })).toBe(true);
        expect(sameDigestScope({ of: "brand" }, { of: "dlc" })).toBe(false);
    });
});

/**
 * The two project-level registries: the variable registry and the named strings.
 *
 * One per project, so the verb is the whole address - with the cast, and unlike everything that is
 * parameterised. What they add to the vocabulary is one claim key space each, and a digest per
 * entry rather than per document.
 */
describe("the project registries a session carries", () => {
    const ENTRY = { id: "v1", name: "Gold", scope: "saved", valueType: "number", storageKey: "v1" } as const;
    const CREATE: LiveOp = { op: "create-variable", entry: ENTRY };
    const UPDATE: LiveOp = { op: "update-variable", variableId: "v1", entry: { ...ENTRY, name: "Coins" } };
    const REMOVE: LiveOp = { op: "delete-variable", variableId: "v1" };
    const SET_KEY: LiveOp = { op: "set-key", name: "menu.start", definition: { sourceText: "Start" } };
    const REMOVE_KEY: LiveOp = { op: "remove-key", name: "menu.start" };

    it("routes each verb to the document it can only ever be about", () => {
        expect([CREATE, UPDATE, REMOVE].map(opDocumentKind)).toEqual(["variables", "variables", "variables"]);
        expect([SET_KEY, REMOVE_KEY].map(opDocumentKind)).toEqual(["localization-keys", "localization-keys"]);
        expect(opBelongsTo(UPDATE, { doc: "variables" })).toBe(true);
        expect(opBelongsTo(UPDATE, { doc: "localization-keys" })).toBe(false);
        // Nothing of their own to compare, because neither document is parameterised: the kind
        // agreeing IS the whole check here, unlike a translation that names its own language.
        expect(opAddresses(UPDATE, { doc: "variables" })).toBe(true);
        expect(opAddresses(SET_KEY, { doc: "localization-keys" })).toBe(true);
    });

    it("fingerprints one entry rather than the document, which is the ordinary rule", () => {
        // No exception is needed here: every operation about either registry names exactly one
        // entry, so nothing reaches across them the way an import reaches across a locale library.
        expect(opDigestScope(CREATE, "story-1" as never)).toEqual({ of: "variable", variableId: "v1" });
        expect(opDigestScope(UPDATE, "story-1" as never)).toEqual({ of: "variable", variableId: "v1" });
        expect(opDigestScope(REMOVE, "story-1" as never)).toEqual({ of: "variable", variableId: "v1" });
        expect(opDigestScope(SET_KEY, "story-1" as never)).toEqual({ of: "localization-key", name: "menu.start" });
        expect(opDigestScope(REMOVE_KEY, "story-1" as never)).toEqual({ of: "localization-key", name: "menu.start" });
    });

    it("keys each claim in its own prefix, so one set can hold every kind at once", () => {
        expect(opClaimKeys(UPDATE)).toEqual([variableClaimKey("v1")]);
        expect(opClaimKeys(REMOVE)).toEqual([variableClaimKey("v1")]);
        expect(opClaimKeys(SET_KEY)).toEqual([localizationKeyClaimKey("menu.start")]);
        expect(opClaimKeys(REMOVE_KEY)).toEqual([localizationKeyClaimKey("menu.start")]);
        // ⚠ A named string has BOTH kinds of claim in the same set: `named-key:` over its source
        // text, and `translation:<locale>:key:<name>` over each language's box. Spelling the first
        // one `key:` would make the two read as one to anybody scanning the set.
        expect(localizationKeyClaimKey("menu.start")).not.toBe(translationClaimKey("ja", "key:menu.start"));
        expect(variableClaimKey("v1")).not.toBe(characterClaimKey("v1"));
        expect(variableClaimKey("v1")).not.toBe(assetClaimKey("v1"));
        expect(variableClaimKey("v1")).not.toBe(storyRowClaimKey("v1"));
    });

    it("tells the two registries apart, and each from itself", () => {
        expect(sameLiveDocument({ doc: "variables" }, { doc: "variables" })).toBe(true);
        expect(sameLiveDocument({ doc: "localization-keys" }, { doc: "localization-keys" })).toBe(true);
        expect(sameLiveDocument({ doc: "variables" }, { doc: "localization-keys" })).toBe(false);
        // ⚠ Not the per-language libraries either: the same service owns both, and the key registry
        // holds the source texts the libraries are translations of.
        expect(sameLiveDocument({ doc: "localization-keys" }, { doc: "localization", locale: "ja" })).toBe(false);
    });
});
