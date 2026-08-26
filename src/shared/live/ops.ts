import type { AssetGroupEntry } from "@shared/documents/specs/assetGroups";
import type { AssetMetadataEntry } from "@shared/documents/specs/assetsMetadata";
import { APP_TAG_ID_RELEASE } from "@shared/types/appTag";
import type {
    AppTagAssetAxes,
    AppTagEndingSurfaceId,
    AppTagPluginConfig,
    AppTagReachableScenes,
    ProjectAppTag,
} from "@shared/types/appTag";
import type { BrandColor } from "@shared/types/brand";
import type { AssetSet } from "@shared/types/assetSet";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import type { CharacterGroup, StoredCharacter } from "@shared/types/character/model";
import type { ProjectDictionaryEntry, ProjectDictionaryOptions } from "@shared/types/dictionary";
import type { ProjectDlc } from "@shared/types/dlc";
import type { LocalizationUnit } from "@shared/types/localization";
import type { ProjectFontEntry } from "@shared/types/typography";
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
 * else. For a language's translations it is one entry, because `LocalizationService` takes one; same
 * for its voice takes. For an asset type's metadata it is one record, because that is what
 * `AssetsService.recordChanged` is handed. What is forbidden is the verb that would fit any
 * document - "here is the new file" - which is whole-document last-writer-wins, and the reason a
 * line of prose has a claim on it instead.
 *
 * ⚠ **A document whose changes are BYTES is not shareable at all**, and the asset library is where
 * that first bites. A session carries what the author says about a file - its name, its folder, its
 * tags - and never the file: importing, replacing and deleting are refused for the length of a
 * session, because the bulk of a project travels through version control and this channel carries
 * only what fits in one message. See {@link LiveAssetOp}.
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
 * Everything that can be done to one locale's translations.
 *
 * **Two verbs, and the addressing is the story's rather than the cast's.** `LocalizationService`
 * exposes a mutator that takes one entry - `updateUnit(locale, unitId, …)` - and every editing
 * gesture in the table ends up calling it, so the finest thing that can be stated truthfully at the
 * one point every edit passes through is one entry, exactly as a story's is one block. There was no
 * need for the cast's compromise here.
 *
 * ⚠ **A unit travels whole, and `null` is one of its values.** In this document "no entry" and
 * "no translation" are the same state - the service deletes the entry when a translator clears the
 * box, because an entry holding an empty string is what an untranslated line already looks like. So
 * there is no delete verb to pair with a set verb; there is one verb that says what the entry is
 * now, and nothing is one of the answers. Splitting them would invent a distinction the document
 * does not have, and a machine would then have to decide which of two operations an emptied box was.
 */
export type LiveLocalizationOp =
    /**
     * What one entry now is, or that there is none.
     *
     * The whole unit rather than the patch the panel produced, for the reason `update-block` carries
     * a whole payload: the receiving machines must not each recompute a result from their own copy,
     * because then the operation states an intention and the document states an outcome, and the two
     * can differ. `sourceHash` in particular is derived from the source line the editor was looking
     * at, which is not a thing every machine can be relied on to read the same way.
     */
    | { op: "set-translation"; locale: string; unitId: string; unit: LocalizationUnit | null }
    /**
     * What many entries now are, as ONE operation.
     *
     * What an exchange import is - a CSV, an XLIFF, a PO file folded back into one locale. The same
     * reasoning as the story's `update-blocks`: the host applies one operation at a time and
     * broadcasts each, so an import sent as four hundred operations would draw three hundred and
     * ninety-nine half-imported libraries on every other screen, and taking it back would cost a
     * press per row where taking it back outside a session costs one.
     *
     * One locale, because that is what an import is: the rows were read for a language.
     */
    | { op: "set-translations"; locale: string; units: readonly { unitId: string; unit: LocalizationUnit | null }[] };

/**
 * Everything that can be done to one locale's voice takes.
 *
 * The translations' mirror, one document along, and deliberately the same two verbs: `VoiceService`
 * has the same `updateUnit(locale, unitId, …)` shape, the same `applyImportedRows` for a recording
 * script coming back from the booth, and the same rule that an entry with no clip is no entry.
 *
 * ⚠ **A take is NOT claimed, where a translation is** - see {@link CLAIMED_OPS} for the test and the
 * reason.
 */
export type LiveVoiceOp =
    /** What one take now is, or that there is none. */
    | { op: "set-take"; locale: string; unitId: string; unit: VoiceUnit | null }
    /** What many takes now are, as ONE operation. What a recording script folded back in is. */
    | { op: "set-takes"; locale: string; units: readonly { unitId: string; unit: VoiceUnit | null }[] };

/**
 * One asset's authored metadata, as it travels.
 *
 * The shape the document registry already reads off disk (`AssetMetadataEntry`), rather than the
 * renderer's own `Asset` interface, and for the reason that module gives for being structural: the
 * asset model lives under `renderer/lib` and cannot be imported here, and moving it into shared is
 * the assets service's own migration rather than this one. An index signature keeps a field this
 * build has not heard of from being dropped on the way through a machine that is a version behind.
 */
export type LiveAssetRecord = AssetMetadataEntry;

/**
 * One folder of one section of the asset browser, as it travels.
 *
 * The shape the document registry reads off disk, for {@link LiveAssetRecord}'s reason: the renderer's
 * `AssetGroup` lives under `renderer/lib` and cannot be imported here.
 */
export type LiveAssetFolder = AssetGroupEntry;

/* ---------------------------------------------------------------- an asset's bytes */

/**
 * Where the bytes behind a record come from when that record arrives.
 *
 * **The whole of how a session can add a file at all**, and the three answers are not three
 * conveniences - they are the three ways bytes can already be somewhere. Only the first of them
 * moves anything over the wire, and getting that split right is what keeps a duplicate and an undo
 * free no matter how large the file is.
 *
 *  - **`transfer`** - the bytes exist on ONE machine and nowhere else: a file the author dragged in
 *    from the desktop, or a replacement picked from a file dialog. They are sliced and sent beside
 *    the operation - see {@link LiveBlobChunk} - because there is no other channel that carries them
 *    and no revision anybody else could fetch them from.
 *  - **`asset`** - the bytes are a copy of a file every machine already holds. What duplicating is.
 *    Sending them would be sending a room something it can produce for itself, which is the same
 *    test a deleted character's sweep passes: *can everybody else reach the same answer from the
 *    same effect?*
 *  - **`trash`** - the bytes are in each machine's own trash, where its own applier put them when it
 *    applied the deletion this is undoing. Per-machine on purpose: the trash is under `.nlstudio/`,
 *    which no repository stores and no session shares, and every machine trashed its own copy of the
 *    same file. Undoing a deletion of a 200 MB video therefore costs one small message.
 */
export type LiveAssetBytes =
    /** Sliced and sent. See {@link LiveBlobChunk}. */
    | { from: "transfer"; parts: readonly LiveAssetBytePart[] }
    /** Copied from a file every machine already holds. What a duplicate is. */
    | { from: "asset"; assetId: string }
    /** Taken back out of each machine's own trash. What undoing a deletion is. */
    | { from: "trash" };

/**
 * One file on its way to the room.
 *
 * **A list rather than a single blob, because a model bundle is a directory.** A bundle's manifest
 * names its siblings by relative path, so it cannot be flattened into one file and cannot be
 * rewritten without Studio learning every model format there is - the same reason the asset type
 * exists at all. So the unit that travels is a file, and an asset is one or more of them.
 */
export type LiveAssetBytePart = {
    /**
     * Null for the asset's own file; a bundle-relative path for one file inside a directory asset.
     *
     * ⚠ Receivers must refuse a path that climbs out of the bundle. It arrives from another Studio,
     * and a path is the one field here that decides where bytes land.
     */
    path: string | null;
    /** What the slices carrying this file say they belong to. Minted by the sender. */
    transferId: string;
    /** How many bytes there are, so a receiver knows when it has them all. */
    size: number;
    /**
     * What those bytes must hash to, over `@shared/utils/contentHash`.
     *
     * Not the record's own `hash`, which is whatever the filesystem computed on the sending machine:
     * this one is computed from the bytes actually put on the wire and checked against the bytes
     * actually taken off it. The channel can drop a message - that is what `LiveEffect.seq` gaps are
     * about - and a file assembled from slices with one missing is a file that looks fine until
     * somebody opens it.
     */
    digest: string;
};

/** One asset a creation makes: the record as it will be filed, and where its bytes come from. */
export type LiveAssetCreate = {
    record: LiveAssetRecord;
    bytes: LiveAssetBytes;
};

/**
 * Everything that can be done to one asset type's metadata shard.
 *
 * **Two verbs, and the pair is the story's `update-block` / `move-block` one document along** - the
 * same split, made by the same test. `AssetsService` learns of a record edit at one point
 * (`recordChanged`), and the finest thing that can be stated truthfully there is **one record,
 * whole**: the fields of a record hold each other up, exactly as a character's do - a rename rewrites
 * `name` and `ext` together, and a replaced file rewrites `hash` and `ext` and `name` together - so a
 * field-level verb would be a precision the service never produces.
 *
 * ⚠ **Nothing here adds an asset, removes one, or replaces its bytes**, and that is a ruling
 * rather than an omission. Those three move *bytes*, and bytes do not travel on a 16 KB channel: the
 * library itself reaches a session through version control, and this carries only what the author
 * says about it. So one sentence covers the whole document: **during a session the asset library can
 * be organised and described, and nothing can be added, replaced or removed.** `AssetsService`
 * refuses those gestures for as long as a sink is installed, rather than leaving the write boundary
 * to catch a record that would have landed on one machine and nowhere else.
 *
 * ⚠ **Folders are not here either.** `assets/assets.groups.<category>.json` is a document of
 * its own with no verbs, so creating and renaming a folder stays frozen for the length of a session
 * and says so - the same half of the invariant `editor/localization/keys.json` is on. Filing an asset
 * in a folder that already exists is not affected: that writes the record's `groupId` and nothing
 * else.
 */
export type LiveAssetOp =
    /**
     * Replace one asset's record.
     *
     * The whole record rather than a patch of it, for `update-block`'s reason: the editing atom is
     * already a committed field - the inspector's boxes keep a draft in their own state and reach the
     * document on blur - so a field-level patch would buy precision the interface never produces, and
     * every receiving machine would have to resolve it against its own copy.
     *
     * **Claimed** - see {@link CLAIMED_OPS}. The description box is a draft layer of exactly the kind
     * the rule is about.
     */
    | { op: "update-asset"; assetType: string; assetId: string; record: LiveAssetRecord }
    /**
     * File any number of assets, each in its own folder, as ONE operation.
     *
     * What a drag of a multi-selection into a folder is, and a batch for `move-blocks`' reason: the
     * host applies one operation at a time and broadcasts each, so a drag of forty rows sent as forty
     * operations would draw thirty-nine half-filed libraries on every other screen and cost a press
     * per row to take back. Each entry carries its own destination so the operation can also be its
     * own inverse - the assets a drag collects came from different folders.
     *
     * **Unclaimed**, again with `move-block`: filing an asset rearranges the library without touching
     * a word anybody wrote, and the loser of that race loses a drag.
     *
     * ⚠ **One asset type, because a message names one document.** A selection under Media may
     * hold audio and video, which live in two shards; `AssetsService.moveAssetsToGroup` groups the
     * selection by type and states one operation per shard. Each of those is a complete arrangement
     * applied whole, and the cost is that a mixed drag takes two presses to undo rather than one.
     */
    | {
          op: "move-assets";
          assetType: string;
          moves: readonly { assetId: string; groupId: string | null }[];
      }
    /**
     * Add assets to the library, as ONE operation.
     *
     * **One verb for importing, duplicating and putting a deletion back**, which reads like three
     * gestures and is one statement: a record appears, and its bytes come from somewhere. Where they
     * come from is {@link LiveAssetBytes}, and it is the only thing that differs between the three.
     * Splitting them into three verbs would put the same "file this record, write these bytes,
     * announce the row" sequence in three places, and the day one of them learnt something the other
     * two would not have.
     *
     * The record travels whole and is written verbatim, ⚠ **including its name**. The library
     * resolves a colliding display name by appending a number, and a machine that re-resolved would
     * pick a different one - two libraries holding the same asset under two names, from one message.
     * The machine that minted the record is the one that decided.
     *
     * **Unclaimed**: the ids were minted by whoever built the records, so two of them colliding is a
     * uuid collision rather than a race, and a retry is answered by the receipts.
     *
     * ⚠ One asset type, for `move-assets`' reason: a message names one document. A directory import
     * is already bucketed per type before it reaches the library.
     */
    | { op: "create-assets"; assetType: string; creates: readonly LiveAssetCreate[] }
    /**
     * Point one record at different bytes.
     *
     * Separate from `create-assets` because the id survives: every reference in every story,
     * blueprint and interface document goes on resolving, which is the whole reason an author reaches
     * for replace rather than delete-and-import. The record travels too, because replacing rewrites
     * `hash`, and `ext` and the display name with it.
     *
     * **Claimed**, with `update-asset`: it writes the record, and the loser of that race is somebody
     * with a half-typed description in the inspector.
     */
    | { op: "replace-asset-content"; assetType: string; assetId: string; record: LiveAssetRecord; bytes: LiveAssetBytes }
    /**
     * Remove assets and their files, as ONE operation.
     *
     * ⚠ **The bytes are not carried anywhere and no machine is told where to put them.** Every
     * machine holds its own copy of the same file and moves it to its own trash, which is derived
     * work of exactly the kind the criterion allows: everybody reaches the same answer from the same
     * effect. It is also what makes undoing a deletion cost one message rather than a re-upload.
     *
     * **Claimed**, with `delete-block` and `delete-character`: deleting a record somebody has open
     * takes the paragraph they were writing about it.
     */
    | { op: "delete-assets"; assetType: string; assetIds: readonly string[] };

/**
 * Everything that can be done to one section's folders.
 *
 * A document of its own - `assets/assets.groups.<category>.json` - and therefore its own verbs,
 * because a message names one document and a folder is not filed in any type's shard. The pairing
 * with the records beside it is the story's: **which folder an asset is in lives on the asset**
 * (`move-assets` writes it), and **what folders exist lives here**.
 *
 * None of these is claimed, for `set-character-group`'s reason: a folder is four fields and none of
 * them is drafted anywhere, so there is no half-typed paragraph for a race to overwrite.
 */
export type LiveAssetFolderOp =
    /**
     * Add or replace one folder.
     *
     * One verb for creating, renaming and re-parenting, again with `set-character-group`: the three
     * write the same record and the split that exists for assets - create versus update - is there to
     * stop a resurrection overwriting a draft, which a folder does not have.
     */
    | { op: "set-asset-folder"; category: string; folderId: string; folder: LiveAssetFolder }
    /**
     * Remove one folder, and everything filed under it.
     *
     * **One operation for something that empties two documents**, and the second document's share is
     * DERIVED rather than carried - the same shape as deleting a character and letting every machine
     * rewrite the rows that spoke it. Which folders are below this one, and which assets are in them,
     * is a question about documents the room already agrees on; sending them would be a second
     * statement of something every receiver can compute.
     *
     * ⚠ What the cascade touched is fingerprinted rather than taken on trust: the applier reports
     * every shard it emptied and each is digested into {@link LiveEffect.digests}, so a machine that
     * swept differently is caught on this message rather than on some later one.
     *
     * `recursive` is the author's answer to "this folder has folders in it", asked before anything is
     * removed. False against a folder with children is refused rather than partly applied.
     */
    | { op: "delete-asset-folder"; category: string; folderId: string; recursive: boolean }
    /**
     * Put a deleted folder back, with everything that was in it.
     *
     * ⚠ **Reachable only as the inverse of `delete-asset-folder`**, the way `create-character`'s
     * `rebind` is only reachable as the inverse of a deletion. It carries what the deletion's own
     * cascade destroyed and no machine can work out afterwards: the folder records, and the asset
     * records that were filed under them. The bytes are not here - each machine takes its own back
     * out of its own trash, which is the same asymmetry `LiveAssetBytes` is built on.
     */
    | {
          op: "restore-asset-folder";
          category: string;
          folders: readonly LiveAssetFolder[];
          /** The records, by the shard each belongs to. Their bytes come from each machine's trash. */
          assets: readonly { assetType: string; record: LiveAssetRecord }[];
      };

/* ------------------------------------------------- the project's configuration tables */

/**
 * Everything that can be done to the build variants - `editor/app-tags.json`.
 *
 * **One row of a project table, and the addressing is the cast's rather than the story's.**
 * `AppTagService` funnels every gesture through one write path that takes a whole-document mutator
 * and can therefore state nothing finer than "the document is now this"; the rows themselves are
 * what the panel edits, one accordion at a time, so a record is the finest thing that can be stated
 * truthfully and still be about something an author points at. A whole-document verb would be the
 * last-writer-wins this design refuses: the variant name and the three identity overrides are
 * blur-committed text fields that re-sync from their props, so the loser of that race loses a name
 * they had half typed, silently.
 *
 * Three verbs plus one, and the plus one is what the release variant is. A project's own plugin
 * values, asset-axis positions, scene declarations and ending page live at the document root rather
 * than on a record, because the release variant is synthesized and stores nothing - see
 * `ProjectAppTagDocument`. They are edited through the same panel rows as a variant's, so they need a
 * verb of their own; {@link LiveAppTagDefaults} is what it carries.
 *
 * ⚠ **Deleting a variant rewrites nothing.** References to it resolve to the release variant from
 * then on, which is `AppTagService.deleteTag`'s stated behaviour and the reason the panel counts them
 * before the author presses the button. So there is no sweep to derive and no second document to
 * fingerprint - unlike deleting a character, which reaches every story that holds a line it spoke.
 */
export type LiveAppTagOp =
    /**
     * Add a variant. The record arrives whole, with the id its author minted.
     *
     * Separate from `update-app-tag` for the reason `create-character` is separate from
     * `update-character`: an update naming a record that is gone has to be refused so the author
     * keeps what they just typed, and a single verb that created whatever it could not find would
     * silently put back a variant somebody else deleted - along with the overrides that decide what
     * that edition builds as.
     *
     * Appended unless `beforeId` says otherwise: `AppTagService.createTag` appends, and every machine
     * applies the same operations in the same order, so an ordinary creation needs no position at all.
     *
     * ⚠ **`beforeId` is reachable only as the inverse of a deletion**, the way `create-character`'s
     * `rebind` is. Undoing "delete the middle variant" has to put it back where it was; appending it
     * would be a rearrangement wearing the word "undo", and the author would have to notice. A row
     * that has gone since is treated as absent and the record lands at the end.
     */
    | { op: "create-app-tag"; tag: ProjectAppTag; beforeId?: string }
    /** Replace a variant's record. The whole record, for {@link LiveCharacterOp}'s reason. */
    | { op: "update-app-tag"; tagId: string; tag: ProjectAppTag }
    /** Remove a variant. What pointed at it reads as the release variant from now on. */
    | { op: "delete-app-tag"; tagId: string }
    /**
     * What every variant inherits: the project's own plugin values, axis positions, scene
     * declarations and ending page.
     *
     * Whole rather than one key at a time, because that is what the document holds - four optional
     * records at its root, normalized as a unit on every write, with an absent key meaning "nothing
     * declared" rather than "unchanged". A per-key verb would have to invent a spelling for the
     * difference and every machine would have to agree on it.
     *
     * ⚠ `tagPluginConfig` is the one gesture here that reaches the variant records too. Writing a
     * plugin field that is not per-variant also takes that field off every variant, because such an
     * entry is inert - resolution never reads it - and leaving it would give one field two stored
     * answers.
     */
    | {
          op: "set-app-tag-defaults";
          defaults: LiveAppTagDefaults;
          /**
           * The variants whose plugin records this write also rewrites, whole.
           *
           * **Carried rather than derived, and the direction is why.** Going down, which entries a
           * field that is not per-variant makes inert is a question every machine could answer. Going
           * back up it is not: the entries are gone, and nothing left in the document says what they
           * were. One field that works in both directions is one statement of one fact; a derived
           * sweep plus a carried restore would be two, and the inverse of an ordinary build-config
           * edit would quietly not restore what the edit removed.
           *
           * Absent for every other write to the project's own record, which is almost all of them.
           */
          tagPluginConfig?: readonly { tagId: string; pluginConfig: AppTagPluginConfig }[];
      };

/**
 * The project's own half of `editor/app-tags.json` - what an unstated key on a variant resolves to.
 *
 * Spelled as the four optional records rather than as the document, so the operation cannot carry
 * the variant list: two statements of who the variants are, arriving in one message, is a second
 * chance for the two to disagree.
 */
export type LiveAppTagDefaults = {
    pluginConfig?: AppTagPluginConfig;
    assetAxes?: AppTagAssetAxes;
    reachableScenes?: AppTagReachableScenes;
    endingSurfaceId?: AppTagEndingSurfaceId;
};

/**
 * Everything that can be done to the DLC list - `editor/dlc.json`.
 *
 * The variants' mirror, one document along, and deliberately the same three verbs: `DlcService` is
 * `AppTagService` down to the bookkeeping, its panel is the same accordion of blur-committed text
 * fields, and its deletion rewrites nothing either - a story marked for a deleted DLC ships with the
 * base build, which is what the delete confirmation already says.
 *
 * ⚠ **`update-dlc` also changes the id**, which is the filename the DLC ships as. It is addressed by
 * the id it had, and the record it carries may state a different one: `DlcService.changeId` is one
 * gesture, and splitting it into a delete and a create would make it two operations, two undo steps
 * and - for the moment between them - a project where the DLC does not exist.
 */
export type LiveDlcOp =
    /** Add a DLC. Appended, and `beforeId` is the inverse of a deletion - see `create-app-tag`. */
    | { op: "create-dlc"; dlc: ProjectDlc; beforeId?: string }
    /** Replace a DLC's record, id included. See {@link LiveDlcOp}. */
    | { op: "update-dlc"; dlcId: string; dlc: ProjectDlc }
    /** Remove a DLC. The stories marked for it ship with the base build from now on. */
    | { op: "delete-dlc"; dlcId: string };

/**
 * Everything that can be done to the project's palette - `editor/brand.json`.
 *
 * The document holds two lists that are edited apart, and the verbs follow that split because
 * `BrandService` does: colours go through `applyColorMutation`, the font stack through
 * `applyFontMutation`, and neither is ever a step of the other.
 *
 * **A colour is a record; the font stack is one value.** A colour has a name somebody typed into a
 * blur-committed field and a value they picked, and there may be dozens of them - so it is addressed
 * and it is claimed. The stack is at most a handful of rungs, has nothing typed into it at all (a
 * picker, two arrows and a set of language checkboxes), and every one of its gestures rewrites the
 * whole order anyway.
 *
 * ⚠ **The seeded entries are records like any other.** Re-pointing `button.primary` is the whole
 * feature, so `update-brand-color` addresses them exactly as it addresses an author's own; what it
 * cannot do is delete one, and `BrandService.deleteColor` is where that is refused.
 */
export type LiveBrandOp =
    /**
     * Add a colour of the author's own. Appended after the seeds, and `beforeId` is the inverse of a
     * deletion - see `create-app-tag`.
     */
    | { op: "create-brand-color"; color: BrandColor; beforeId?: string }
    /** Replace one colour - its name, its value, or both. */
    | { op: "update-brand-color"; colorId: string; color: BrandColor }
    /** Remove one of the author's colours. Links that pointed at it resolve to nothing and are linted. */
    | { op: "delete-brand-color"; colorId: string }
    /**
     * Move a colour to sit before another, or to the end when `beforeId` is null.
     *
     * Relative rather than an index, for `LiveBlockTarget`'s reason. Unclaimed, with `move-block` and
     * `move-assets`: a drag rearranges the palette without touching a word anybody wrote.
     */
    | { op: "move-brand-color"; colorId: string; beforeId: string | null }
    /**
     * The whole font stack, in priority order.
     *
     * The one verb here that is not about a record, and the exception is argued in {@link LiveBrandOp}:
     * appending a rung, restricting one to some languages, removing one and moving one up or down are
     * four gestures that all state a new order of at most `PROJECT_FONT_STACK_MAX` entries, and none
     * of them has a draft layer to lose.
     */
    | { op: "set-brand-fonts"; fonts: readonly ProjectFontEntry[] };

/**
 * Everything that can be done to the project dictionary.
 *
 * **Two verbs for a document with no ids at all**, and that is what shapes both of them. A
 * dictionary entry is keyed by its own spelling: the term IS the identity, every other field
 * describes it, and nothing on either side of an edit says that the term on the left and the term
 * on the right are the same entry. So the address of an entry is a word the author typed, and
 * renaming one is not a field edit - it is the entry moving house.
 *
 * `DictionaryService` reaches its document through one private mutator that takes a function over
 * the whole list, exactly as the audio mixer and the asset sets do, so the operations here are
 * stated where the service knows what it MEANS - at `addTerm`, `updateEntry` and `removeTerm` -
 * rather than at the point the list is rewritten. That is `AssetsService.recordChanged`'s answer to
 * the same shape of service, one document along.
 */
export type LiveDictionaryOp =
    /**
     * What the entry at one spelling now is, or that there is none.
     *
     * **One verb where the cast has three**, and the reason is the libraries': in this document
     * "no entry" and "the project does not write that word" are the same state, so a delete verb to
     * pair with a set verb would invent a distinction the file does not have. `term` is the address
     * the entry has now; `entry` is what it becomes, and its own `term` may differ - which is what a
     * rename is, in one operation, because renaming is one gesture in the panel.
     *
     * ⚠ **A rename onto a spelling the project already writes is not reachable from Studio** -
     * `updateEntry` refuses it rather than merging two entries whose readings, variants and notes
     * would have to be chosen between. A machine that receives one applies it as written, and the
     * author who sent it keeps the undo entry; see `LiveBefore` for why that undo answers "nothing
     * was kept".
     */
    | { op: "set-dictionary-entry"; term: string; entry: ProjectDictionaryEntry | null }
    /**
     * Both of the checks the dictionary drives, as they now stand.
     *
     * Whole rather than one switch at a time because they are one record on the document and the
     * panel writes them through one patch; last-writer-wins, with the story's scene name, since the
     * loser of that race loses a click.
     */
    | { op: "set-dictionary-options"; options: ProjectDictionaryOptions };

/**
 * Everything that can be done to the project's mixer.
 *
 * `AudioTrackService`'s own mutators, one per gesture, for `LiveStoryOp`'s reason: they already
 * address by id, they already take a relative position, and they are already what every control in
 * the audio section ends up calling. What they do NOT share is a single point that could state
 * them - `applyTrackMutation` takes a function over the whole list and can only say "the tracks
 * changed" - so the operations are stated at the mutators, where the service knows what it meant.
 *
 * None of these is claimed. A bus is a name, a fader, a routing choice and a loop switch: nothing
 * on it accumulates prose, so the loser of a race loses a word or a drag rather than a paragraph
 * nobody else can see. See {@link CLAIMED_OPS}.
 */
export type LiveAudioTrackOp =
    /**
     * Add a bus, in front of the sibling named, or last when that is null.
     *
     * Separate from `update-audio-track` with `insert-block` and `create-character`, and for their
     * reason: an update naming a bus that is gone has to be refused so that the author keeps what
     * they were editing, and one verb that created whatever it could not find would silently bring
     * back a track somebody else deleted - with every reference that had fallen back to a seeded bus
     * quietly re-pointing at it.
     */
    | {
          op: "create-audio-track";
          track: ProjectAudioTrack;
          /** The bus this one sits in front of in the stored order, or null for last. */
          beforeId: string | null;
          /**
           * Buses to route back into this one, for the creation that undoes a deletion.
           *
           * **Carried, where the deletion's own promotion is derived, and the asymmetry is
           * `create-character.rebind`'s.** Going down, "which buses feed this one" is a question
           * about the document. Coming back up it is not: those buses now name the deleted track's
           * own parent, and so do the ones that always did - the two are indistinguishable
           * afterwards. So the only correct answer is the one recorded when the deletion happened.
           * Absent for an ordinary creation, which has nothing to reclaim.
           */
          reparent?: readonly string[];
      }
    /**
     * Replace one bus's record.
     *
     * The whole record rather than a patch, for `update-block`'s reason and one of the mixer's own:
     * a track's fields hold each other up - a volume is read against the routing it is multiplied
     * through - and the panel commits a field at a time into a record it then re-normalizes, so a
     * field-level verb would state something the service never produces.
     */
    | { op: "update-audio-track"; trackId: string; track: ProjectAudioTrack }
    /**
     * Remove one bus, and let every machine promote what fed into it.
     *
     * **One operation for something that rewrites other records, because their share of it is
     * DERIVED** - the same shape as deleting a character and letting every machine rewrite the rows
     * that spoke it. The children move to the deleted bus's own parent, which is a fact every
     * machine can work out from a mixer the room already agrees on, so sending them would be a
     * second statement of it.
     *
     * ⚠ The seeded buses cannot be deleted; a message naming one is refused rather than applied,
     * because they are where every unresolvable reference lands and what the player's own volume
     * sliders alias onto.
     */
    | { op: "delete-audio-track"; trackId: string }
    /**
     * Move one bus in the drawn order, in front of the sibling named or last when that is null.
     *
     * Order is not routing - the tree is rebuilt from `parentId`, and re-routing is an
     * `update-audio-track` - so this changes what the author sees and nothing about what the game
     * hears.
     */
    | { op: "move-audio-track"; trackId: string; beforeId: string | null };

/**
 * Everything that can be done to the project's asset sets.
 *
 * `AssetSetService`'s gestures, and two of them name every set they touch rather than one.
 * Deleting a set takes the sets drawn inside it, and filing one in a folder takes them along - both
 * cascades are computable from a document the room already agrees on, so the criterion that decides
 * a paste's translations would make them derived.
 *
 * ⚠ **They are carried anyway, and that is a ruling rather than an oversight.** Neither cascade can
 * be derived coming BACK: a deletion's records are gone, and a move's old folders are gone with it.
 * Deriving the forward half while carrying the backward half would be two different answers to
 * "which sets is this gesture about", and the cascade is a handful of ids in a document whose
 * digest covers all of it either way. Naming them in both directions is what lets a move be its own
 * inverse - which is `move-assets`' ruling, one document along.
 *
 * None of these is claimed: a set is a name, a filter and an axis, and the loser of a race loses a
 * word or a drag. See {@link CLAIMED_OPS}.
 */
export type LiveAssetSetOp =
    /**
     * Declare sets, each in front of the sibling named or last when that is null, as ONE operation.
     *
     * The wizard states one. Undoing a deletion states every set the cascade destroyed, which is
     * why this is plural: a run of single creations would draw a half-restored panel on every other
     * screen and cost a press per row to take back.
     */
    | { op: "create-asset-sets"; creates: readonly { set: AssetSet; beforeId: string | null }[] }
    /**
     * Replace one set's record. Renaming, re-filtering and re-axing all write it whole, which is
     * what `updateSet` is handed - see {@link LiveAudioTrackOp}'s update for the reason.
     */
    | { op: "update-asset-set"; setId: string; set: AssetSet }
    /**
     * Remove sets, as ONE operation.
     *
     * Dissolving a set and deleting a set with its sub-sets are the same edit to this document and
     * two different things to the author; both arrive here, and the second names every set it
     * removes. A set that is already gone is not an error - the second of two deletions changes
     * nothing.
     */
    | { op: "delete-asset-sets"; setIds: readonly string[] }
    /**
     * File sets, each in its own folder, as ONE operation.
     *
     * Each entry carries its own destination so that the operation can also be its own inverse,
     * which is `move-assets`' shape and its reason: the sets a drag collects were not all in the
     * same place, and one destination for all of them would make an undo into a rearrangement
     * nobody asked for.
     */
    | { op: "move-asset-sets"; moves: readonly { setId: string; groupId: string | null }[] };

/**
 * Everything a session can be asked to do, whichever document it is about.
 *
 * Flat rather than nested by document, because every consumer of this type switches over `op` and a
 * nesting would make each of them switch twice. Which document a verb belongs to is
 * {@link opDocumentKind}'s answer, and it is a property of the verb rather than of the message.
 */
export type LiveOp =
    | LiveStoryOp
    | LiveCharacterOp
    | LiveLocalizationOp
    | LiveVoiceOp
    | LiveAssetOp
    | LiveAssetFolderOp
    | LiveAppTagOp
    | LiveDlcOp
    | LiveBrandOp
    | LiveDictionaryOp
    | LiveAudioTrackOp
    | LiveAssetSetOp;

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
    | { doc: "characters" }
    /**
     * One language's translations - `editor/localization/<locale>.json`.
     *
     * Parameterised for the story's reason, not the cast's: a project has a library per language and
     * an operation applied to the wrong one writes a French line into the Japanese file, which reads
     * as a translation somebody made rather than as a fault.
     */
    | { doc: "localization"; locale: string }
    /** One language's voice takes - `editor/voice/<locale>.json`. The translations' mirror. */
    | { doc: "voice"; locale: string }
    /**
     * One asset type's metadata shard - `assets/assets.metadata.<type>.json`.
     *
     * Parameterised by TYPE rather than by the category the browser draws, because the address is a
     * file and a category is one or two of them: Media holds audio and video, and a message that
     * named the category would be a message about two documents at once. The panel's own gestures
     * are grouped by type before they are stated - see `move-assets`.
     */
    | { doc: "assets"; assetType: string }
    /**
     * One section's folders - `assets/assets.groups.<category>.json`.
     *
     * Parameterised by CATEGORY where the records beside it are parameterised by type, and the two
     * are not the same axis: a folder under Media holds audio and video alike, so it cannot belong to
     * either type's shard. That asymmetry is the asset browser's own, and following it here keeps one
     * spelling of "which document" rather than two.
     */
    | { doc: "asset-groups"; category: string }
    /**
     * The build variants - `editor/app-tags.json`.
     *
     * Unparameterised, with the cast: there is one of these per project, so the kind is the whole
     * address. The same is true of the two below it.
     */
    | { doc: "app-tags" }
    /** The DLC list - `editor/dlc.json`. */
    | { doc: "dlc" }
    /** The palette and the default font stack - `editor/brand.json`. */
    | { doc: "brand" }
    /**
     * The project dictionary - `editor/dictionary.json`.
     *
     * Unparameterised with the cast, and for its reason: there is one of these per project, so the
     * kind is the whole address and a session cannot be opened on "some of" it.
     */
    | { doc: "dictionary" }
    /** The project's mixer - `editor/audio-tracks.json`. One per project, with the dictionary. */
    | { doc: "audio-tracks" }
    /** The project's asset sets - `editor/asset-sets.json`. One per project. */
    | { doc: "asset-sets" };

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
        case "set-translation":
        case "set-translations":
            return "localization";
        case "set-take":
        case "set-takes":
            return "voice";
        case "update-asset":
        case "move-assets":
        case "create-assets":
        case "replace-asset-content":
        case "delete-assets":
            return "assets";
        case "set-asset-folder":
        case "delete-asset-folder":
        case "restore-asset-folder":
            return "asset-groups";
        case "create-app-tag":
        case "update-app-tag":
        case "delete-app-tag":
        case "set-app-tag-defaults":
            return "app-tags";
        case "create-dlc":
        case "update-dlc":
        case "delete-dlc":
            return "dlc";
        case "create-brand-color":
        case "update-brand-color":
        case "delete-brand-color":
        case "move-brand-color":
        case "set-brand-fonts":
            return "brand";
        case "set-dictionary-entry":
        case "set-dictionary-options":
            return "dictionary";
        case "create-audio-track":
        case "update-audio-track":
        case "delete-audio-track":
        case "move-audio-track":
            return "audio-tracks";
        case "create-asset-sets":
        case "update-asset-set":
        case "delete-asset-sets":
        case "move-asset-sets":
            return "asset-sets";
    }
}

/**
 * Whether a message's operation and the document it states agree. See {@link opDocumentKind}.
 *
 * ⚠ **The kind agreeing is not the whole of the check for a parameterised document.** A
 * `set-translation` names the locale it is about, and a message pairing it with a different locale's
 * address would pass this and write the entry into the wrong file. See {@link opAddresses}, which
 * the host asks as well.
 */
export function opBelongsTo(op: LiveOp, document: LiveDocument): boolean {
    return opDocumentKind(op) === document.doc;
}

/**
 * Whether an operation that names its own address agrees with the address the message states.
 *
 * The story's operations do not name their document at all - a scene id says nothing about which
 * story holds it - which is why an address travels on the message in the first place. The library
 * operations DO name their locale, because the service they came from is addressed by it, and two
 * spellings of one fact are two chances to be wrong: an entry written into the wrong language's file
 * is a translation nobody made, sitting in a document with a digest that agrees with itself.
 *
 * True for everything that has nothing of its own to compare, which is the ordinary case.
 */
export function opAddresses(op: LiveOp, document: LiveDocument): boolean {
    switch (op.op) {
        case "set-translation":
        case "set-translations":
            return document.doc === "localization" && document.locale === op.locale;
        case "set-take":
        case "set-takes":
            return document.doc === "voice" && document.locale === op.locale;
        // The asset operations name their type for the library operations' reason: the service they
        // came from is addressed by it, and a record written into a sibling type's shard is a file
        // the browser no longer draws anywhere, in a shard whose digest agrees with itself.
        case "update-asset":
        case "move-assets":
        case "create-assets":
        case "replace-asset-content":
        case "delete-assets":
            return document.doc === "assets" && document.assetType === op.assetType;
        // A folder operation names its section for the same reason, and it matters more here: a
        // folder record written into a sibling section's shard is a folder the browser draws under
        // a heading whose files can never be filed in it.
        case "set-asset-folder":
        case "delete-asset-folder":
        case "restore-asset-folder":
            return document.doc === "asset-groups" && document.category === op.category;
        default:
            return true;
    }
}

/** Two addresses naming one document. */
export function sameLiveDocument(left: LiveDocument, right: LiveDocument): boolean {
    switch (left.doc) {
        case "story":
            return right.doc === "story" && left.storyId === right.storyId;
        case "characters":
            return right.doc === "characters";
        case "localization":
            return right.doc === "localization" && right.locale === left.locale;
        case "voice":
            return right.doc === "voice" && right.locale === left.locale;
        case "assets":
            return right.doc === "assets" && right.assetType === left.assetType;
        case "asset-groups":
            return right.doc === "asset-groups" && right.category === left.category;
        case "app-tags":
            return right.doc === "app-tags";
        case "dlc":
            return right.doc === "dlc";
        case "brand":
            return right.doc === "brand";
        case "dictionary":
            return right.doc === "dictionary";
        case "audio-tracks":
            return right.doc === "audio-tracks";
        case "asset-sets":
            return right.doc === "asset-sets";
    }
}

/** A document address in one line, for a log line or a refusal that has to name it. */
export function describeLiveDocument(document: LiveDocument): string {
    switch (document.doc) {
        case "story":
            return `story ${document.storyId}`;
        case "characters":
            return "characters";
        case "localization":
            return `translations ${document.locale}`;
        case "voice":
            return `voice ${document.locale}`;
        case "assets":
            return `assets ${document.assetType}`;
        case "asset-groups":
            return `asset folders ${document.category}`;
        case "app-tags":
            return "build variants";
        case "dlc":
            return "DLC";
        case "brand":
            return "brand palette";
        case "dictionary":
            return "dictionary";
        case "audio-tracks":
            return "audio tracks";
        case "asset-sets":
            return "asset sets";
    }
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
 *
 * **A translation is claimed; a voice take is not**, and the two answers come from the same test.
 * The translation field is a draft layer of exactly the kind the rule is about - the contentEditable
 * IS the working copy while the translator types, and it reaches the document on Enter or blur - so
 * the loser of a race loses a line of prose they have just written, silently. A take is assigned by
 * dropping a clip on a row and approved by pressing a button; the one drafted thing on it is a
 * director's short note, and the loser of that race loses a sentence and can see the winner's in the
 * box. Claiming it would cost the ceremony of holding a record for as long as a panel is open, for a
 * document two people are almost never inside at once.
 *
 * ⚠ That ruling turns over the day a take grows a field somebody writes paragraphs into.
 *
 * **An asset record is claimed; filing assets in a folder is not**, and the pair repeats the story's
 * `update-block` / `move-block` split for the same reason. The inspector's name and description are
 * `TextField`s, which commit on blur and re-sync from their props: somebody else's edit to the same
 * record arriving mid-sentence takes the sentence with it, silently, which is the injury this rule
 * exists to name. A drag into a folder writes `groupId` and touches nothing anybody typed.
 *
 * **Nothing in the dictionary, the mixer or the asset sets is claimed, and the three answers come
 * from one reading of the same test.** Every field on them is a word: a term and its reading, a
 * bus's name and its fader, a set's name and the tag it filters on. A draft layer is there - the
 * dictionary panel's four boxes commit on blur and re-read themselves from the entry - but what it
 * drafts is a spelling rather than a paragraph, and the loser reads the winner's answer in the box
 * the moment it arrives. The take's ruling is the one this follows: a claim is worth its ceremony
 * where the losing author has typing nobody else can see and nothing else would report, and none of
 * these three has that. The gesture a session actually produces most is adding a term from the
 * story editor's spelling popover, which has no draft at all.
 *
 * ⚠ That ruling turns over the day one of them grows a field somebody writes paragraphs into.
 */
export const CLAIMED_OPS: ReadonlySet<LiveOpKind> = new Set<LiveOpKind>([
    "update-block",
    "update-blocks",
    "delete-block",
    "delete-blocks",
    "update-character",
    "delete-character",
    "set-block-disabled",
    "set-translation",
    "set-translations",
    "update-asset",
    "replace-asset-content",
    "delete-assets",
    // The three configuration tables, and the same test answers for all of them: every one of their
    // rows is edited through a field that keeps a draft in its own state until it is blurred and
    // re-syncs from its props when somebody else's edit arrives. A variant's name and its three
    // identity overrides, a DLC's name and the filename it ships as, a colour's name - the loser of
    // any of those races loses what they had half typed, with nothing on screen to say so.
    //
    // ⚠ **Creating and rearranging are not here**, with `insert-block` and `move-block`: a creation
    // names an id nobody else has, and a drag rewrites an order without touching a word anybody
    // wrote. `set-brand-fonts` is out for the second reason - the stack has no typing on it at all.
    "update-app-tag",
    "delete-app-tag",
    "set-app-tag-defaults",
    "update-dlc",
    "delete-dlc",
    "update-brand-color",
    "delete-brand-color",
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
 * The claim over one translation, in one language.
 *
 * The locale is in the key because the same line has an entry in every language and two translators
 * working in two languages are not in each other's way - a key that named only the unit would have
 * the Japanese translator holding the French one's line.
 *
 * ⚠ A locale code cannot contain a colon (`isValidLocaleCode`), so the two segments after the prefix
 * are unambiguous however the reader splits them.
 */
export function translationClaimKey(locale: string, unitId: string): LiveClaimKey {
    return `translation:${locale}:${unitId}`;
}

/**
 * The claim over one asset record.
 *
 * No asset type in the key, unlike the translation's locale, and the difference is what the two
 * parameters are for. A line has an entry in every language, so a translation key that named only the
 * unit would put two translators in each other's way; an asset id is minted once and is unique across
 * the whole library, so the type would be a second way to say something the id already says - and a
 * second way for two spellings of one claim to fail to cancel out.
 */
export function assetClaimKey(assetId: string): LiveClaimKey {
    return `asset:${assetId}`;
}

/**
 * The claim over one build variant's row.
 *
 * ⚠ **The project's own defaults are held under {@link APP_TAG_DEFAULTS_CLAIM_ID}**, which is the
 * release variant's reserved id. That is not a trick: the release variant is what the root records
 * belong to - it is synthesized and stores nothing of its own - and the panel draws it as a row
 * beside the others. An id that could collide with a stored one would be, but the release id is
 * exactly the id the normalizer refuses to store.
 */
export function appTagClaimKey(tagId: string): LiveClaimKey {
    return `app-tag:${tagId}`;
}

/**
 * Whose row the project's own defaults are, for a claim.
 *
 * The release variant's own id, taken from the model rather than spelled again here: it is the id
 * the normalizer refuses to store, so nothing this key space holds can ever collide with it - and a
 * second spelling would be a collision waiting for the day that id changed.
 */
export const APP_TAG_DEFAULTS_CLAIM_ID = APP_TAG_ID_RELEASE;

/** The claim over one DLC's row. */
export function dlcClaimKey(dlcId: string): LiveClaimKey {
    return `dlc:${dlcId}`;
}

/** The claim over one colour of the project's palette. */
export function brandColorClaimKey(colorId: string): LiveClaimKey {
    return `brand-color:${colorId}`;
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
        case "set-translation":
            return [translationClaimKey(op.locale, op.unitId)];
        case "set-translations":
            // Every entry, and one held entry refuses the whole import - the rule every batch
            // follows. Half an import is a library nobody produced, and the translator whose file it
            // was would be told a line was taken while watching the rest of it land.
            return op.units.map(entry => translationClaimKey(op.locale, entry.unitId));
        case "set-take":
        case "set-takes":
            // Not claimed - see {@link CLAIMED_OPS}.
            return [];
        case "update-asset":
        case "replace-asset-content":
            return [assetClaimKey(op.assetId)];
        case "delete-assets":
            // Every record, and one held record refuses the whole gesture - the rule every batch
            // follows. Half a delete is a library nobody produced.
            return op.assetIds.map(assetClaimKey);
        case "move-assets":
            // Not claimed either, with `move-blocks`: filing rearranges the library without touching
            // a word anybody wrote. See {@link CLAIMED_OPS}.
            return [];
        case "create-assets":
        case "set-asset-folder":
        case "delete-asset-folder":
        case "restore-asset-folder":
            // Nothing to hold: a creation names ids nobody else has, and a folder has no draft
            // layer behind it. See {@link CLAIMED_OPS}.
            return [];
        case "update-app-tag":
        case "delete-app-tag":
            return [appTagClaimKey(op.tagId)];
        case "set-app-tag-defaults":
            // The release variant's row - see {@link appTagClaimKey}. The panel draws the project's
            // own values there, so that is the row somebody is inside while they are edited.
            return [appTagClaimKey(APP_TAG_DEFAULTS_CLAIM_ID)];
        case "update-dlc":
        case "delete-dlc":
            return [dlcClaimKey(op.dlcId)];
        case "update-brand-color":
        case "delete-brand-color":
            return [brandColorClaimKey(op.colorId)];
        case "create-app-tag":
        case "create-dlc":
        case "create-brand-color":
        case "move-brand-color":
        case "set-brand-fonts":
            // Nothing to hold, for the reasons `create-assets` and `move-assets` give. See
            // {@link CLAIMED_OPS}.
        case "set-dictionary-entry":
        case "set-dictionary-options":
        case "create-audio-track":
        case "update-audio-track":
        case "delete-audio-track":
        case "move-audio-track":
        case "create-asset-sets":
        case "update-asset-set":
        case "delete-asset-sets":
        case "move-asset-sets":
            // Nothing to hold either: every field on these three documents is a word, so the loser
            // of a race loses a word and reads the winner's. See {@link CLAIMED_OPS}.
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
    | { of: "cast" }
    /**
     * One language's translations, whole.
     *
     * **The one shared document whose digest covers all of it**, and `@shared/live/libraries` gives
     * the two reasons: these operations reach across entries freely - an import restates hundreds,
     * a paste derives entries into every language at once - so a per-entry digest would not fit in
     * the message, and a locale library is the smallest document in the project anyway.
     */
    | { of: "translations"; locale: string }
    /** One language's voice takes, whole. The translations' mirror, for the same two reasons. */
    | { of: "takes"; locale: string }
    /**
     * One asset type's metadata shard, whole.
     *
     * The third document to be fingerprinted entire, and `@shared/live/assets` gives the same two
     * reasons the libraries give: filing a multi-selection reaches across records freely, so a
     * per-record digest would not fit in the message, and a shard of short records about files is a
     * small document beside a story.
     */
    | { of: "assets"; assetType: string }
    /**
     * One section's folders, whole.
     *
     * The asset shard's counterpart, and whole for the same two reasons - a folder deletion reaches
     * across every folder below it, and a section's folder list is a handful of four-field records.
     */
    | { of: "asset-groups"; category: string }
    /**
     * The build variants, whole - and the same for the two below it.
     *
     * The fourth, fifth and sixth documents to be fingerprinted entire, and `@shared/live/config`
     * gives the reason the libraries give second: these are the smallest documents in the project.
     * A palette is a couple of dozen short entries, a variant list and a DLC list are a handful of
     * records each, and they are edited a few times in a session rather than on every keystroke -
     * so the encode a whole-document digest pays for is cheaper here than the bookkeeping a
     * per-record one would need, and it catches a rearrangement no per-record digest would.
     */
    | { of: "app-tags" }
    /** The DLC list, whole. */
    | { of: "dlc" }
    /** The palette and the font stack, whole. */
    | { of: "brand" }
    /**
     * The project dictionary, whole.
     *
     * One of three whole-document scopes added together, and `@shared/live/projectTables` gives the
     * reasons they share. The dictionary has one of its own: its entries are keyed by the author's
     * own spelling, so a rename is one unit leaving and another arriving, and a per-entry digest
     * would have to fingerprint two units for one operation to say anything at all.
     */
    | { of: "dictionary" }
    /**
     * The project's mixer, whole.
     *
     * Its own reason beside the shared two: deleting a bus promotes the buses that fed it, which is
     * derived work reaching records the operation never names - and a whole-document digest covers
     * it without the applier having to report what it touched.
     */
    | { of: "audio-tracks" }
    /** The project's asset sets, whole. Its cascades reach across the list for the mixer's reason. */
    | { of: "asset-sets" };

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
        case "set-translation":
        case "set-translations":
            return { of: "translations", locale: op.locale };
        case "set-take":
        case "set-takes":
            return { of: "takes", locale: op.locale };
        case "update-asset":
        case "move-assets":
        case "create-assets":
        case "replace-asset-content":
        case "delete-assets":
            return { of: "assets", assetType: op.assetType };
        // ⚠ A folder deletion empties asset shards too, and none of them is named here. The applier
        // reports those and they reach {@link LiveEffect.digests} beside this one - derived work is
        // exactly the work that has to be fingerprinted rather than assumed.
        case "set-asset-folder":
        case "delete-asset-folder":
        case "restore-asset-folder":
            return { of: "asset-groups", category: op.category };
        case "create-app-tag":
        case "update-app-tag":
        case "delete-app-tag":
        case "set-app-tag-defaults":
            return { of: "app-tags" };
        case "create-dlc":
        case "update-dlc":
        case "delete-dlc":
            return { of: "dlc" };
        case "create-brand-color":
        case "update-brand-color":
        case "delete-brand-color":
        case "move-brand-color":
        case "set-brand-fonts":
            return { of: "brand" };
        case "set-dictionary-entry":
        case "set-dictionary-options":
            return { of: "dictionary" };
        // ⚠ A deletion promotes the buses that fed the one it removes, and none of them is named
        // here - which is exactly why the unit is the whole document rather than one record.
        case "create-audio-track":
        case "update-audio-track":
        case "delete-audio-track":
        case "move-audio-track":
            return { of: "audio-tracks" };
        case "create-asset-sets":
        case "update-asset-set":
        case "delete-asset-sets":
        case "move-asset-sets":
            return { of: "asset-sets" };
    }
}

/** Two scopes naming one unit. */
export function sameDigestScope(left: LiveDigestScope, right: LiveDigestScope): boolean {
    switch (left.of) {
        case "scene":
            return right.of === "scene" && left.storyId === right.storyId && left.sceneId === right.sceneId;
        case "character":
            return right.of === "character" && left.characterId === right.characterId;
        case "cast":
            return right.of === "cast";
        case "translations":
            return right.of === "translations" && right.locale === left.locale;
        case "takes":
            return right.of === "takes" && right.locale === left.locale;
        case "assets":
            return right.of === "assets" && right.assetType === left.assetType;
        case "asset-groups":
            return right.of === "asset-groups" && right.category === left.category;
        case "app-tags":
            return right.of === "app-tags";
        case "dlc":
            return right.of === "dlc";
        case "brand":
            return right.of === "brand";
        case "dictionary":
            return right.of === "dictionary";
        case "audio-tracks":
            return right.of === "audio-tracks";
        case "asset-sets":
            return right.of === "asset-sets";
    }
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
 *
 * **It stays a derivation now that the libraries have verbs of their own, and that is not an
 * oversight.** A paste is one gesture, and one gesture is one operation; sending it as an insert plus
 * a set of library operations would put a paste's rows in every document one press of undo apart from
 * its translations, and would make an operation about the story reach three other documents anyway.
 * The criterion has not moved either - the entries were read out of the copier's memory, so nobody
 * else can compute them.
 *
 * ⚠ **What the derivation writes is fingerprinted like everything else.** The machine that adopts
 * these entries reports the libraries it touched, and each is digested into {@link LiveEffect.digests}
 * - which is what catches the machine that skipped half of them, the failure this mechanism has
 * already produced once.
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
     * The asset record is gone.
     *
     * The library's answer to `row-gone` and to `character-gone`, and it carries the same
     * instruction: the author's inspector is full of their own typing and it is theirs to keep. An
     * update that created what it could not find would put back a file's record after somebody
     * deleted the file, leaving a row in the browser with no bytes under it.
     *
     * ⚠ Reachable even though a session carries no deletion verb, for `character-gone`'s reason: the
     * room opens on a committed revision, and a record can be missing from this shard because the
     * author who joined never had it.
     */
    | "asset-gone"
    /**
     * An id a creation names is already in this library.
     *
     * Not a race - the ids are uuids minted by whoever built the record - so this is a retry that
     * escaped the receipts, or a message from a build that mints them differently. Refused rather
     * than applied, because writing over an existing record's bytes under its own id is the one way
     * an import can destroy a file that was already there.
     */
    | "asset-id-taken"
    /**
     * A folder with folders inside it, and the author did not ask for those to go too.
     *
     * ⚠ There is deliberately no refusal for "the bytes have not arrived". The host decides about
     * records, and whether a particular machine has a file yet is that machine's own business: the
     * slices are still in flight when the operation is stated, so a host that waited for them would
     * refuse almost every import. A machine short of a file asks for it (`LiveBlobNeeded`) and the
     * library reports an unresolved reference until it lands - which is a state it already has, for
     * assets that arrived by every other route.
     */
    | "folder-not-empty"
    /**
     * The row of a configuration table is gone - a build variant, a DLC, a colour of the palette.
     *
     * The three tables' answer to `row-gone` and to `character-gone`, and it carries the same
     * instruction: the field the author is typing into is theirs to keep. An update that created what
     * it could not find would put back a variant, a DLC or a colour somebody else deleted - and for
     * the first two that is an edition of the game, or a file already in players' hands.
     *
     * **One reason for the three**, where the cast and the library have one each. What differs
     * between them is which panel the author is looking at, and the panel is already in front of
     * them; three sentences saying the same thing about three tables would be three ways to write
     * "that entry is no longer in this project".
     */
    | "config-entry-gone"
    /**
     * The bus is gone. Somebody deleted it after the author reached for it.
     *
     * The mixer's answer to `row-gone`, carrying the same instruction: the panel the author is
     * looking at is full of their own typing and it is theirs to keep. An update that created what
     * it could not find would bring back a bus somebody deleted, and every reference that had fallen
     * back to a seeded one would quietly re-point at it.
     */
    | "track-gone"
    /**
     * The asset set is gone. The mixer's `track-gone`, one document along.
     *
     * ⚠ Reachable even against a document nobody deleted from: a session opens on a committed
     * revision, and a set can be missing from this list because the author who joined never had it.
     */
    | "set-gone"
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

/* ------------------------------------------------------------------ bytes in flight */

/**
 * How much of a file one message carries.
 *
 * Derived from the payload cap rather than chosen: one `live.say` is capped at
 * `TEAM_LIVE_PAYLOAD_LIMIT` (16 KiB), base64 costs four bytes for every three, and the envelope
 * around the data - the kind, a uuid, two numbers - is a couple of hundred more. 12000 leaves room
 * for all of it and stays a round number in the logs.
 *
 * ⚠ Raising it does not make transfers faster; it makes them fail. The cap is the server's.
 */
export const LIVE_BLOB_CHUNK_BYTES = 12000;

/**
 * The largest file a session will carry.
 *
 * **A limit worth stating rather than a limit worth hiding.** At {@link LIVE_BLOB_CHUNK_BYTES} a
 * message, 32 MiB is about 2800 messages - a few seconds on the sort of link a room runs over, and
 * already far past what an image, a piece of music, a font or a script weighs. What it does not
 * cover is video, and an author who drops a 400 MB file into a live session is told so by name
 * rather than left watching a progress bar that will not finish.
 *
 * The escape is the one every other size limit here has: end the session, import, and open it again -
 * the bulk of a project reaches the room through version control, and this channel carries only what
 * has happened since.
 */
export const LIVE_BLOB_MAX_BYTES = 32 * 1024 * 1024;

/**
 * One slice of a file, on its way to the room.
 *
 * **Not an operation, and that distinction is the whole design.** An operation changes a document and
 * is applied by the host in an order everybody follows; a slice changes nothing. It travels beside
 * the operation stream rather than through it, which is what keeps a forty-megabyte import from
 * stopping everybody else's typing for the length of the transfer.
 *
 * Sent by whoever holds the file - the host and a guest alike - because the server delivers a room's
 * messages to the whole room. Nothing is applied when the last slice lands: the bytes wait until the
 * operation naming their transfer is applied, and are dropped if it never is.
 */
export type LiveBlobChunk = {
    kind: "blob";
    /** What this belongs to. Minted by the sender; named by {@link LiveAssetBytePart}. */
    transferId: string;
    /** Which slice, counting from zero. */
    index: number;
    /** How many there are, so a receiver knows what it is waiting for. */
    total: number;
    /** The slice, base64. */
    data: string;
};

/**
 * A machine saying a transfer did not arrive whole, and which parts it is missing.
 *
 * The repair for the one thing this channel does not promise. It is the same bargain
 * {@link LiveResync} makes about effects, one layer down: nothing is retransmitted on a timer, and
 * nothing is acknowledged - a receiver that finds itself short says exactly what it is short of, and
 * the machine that has the file sends those slices again.
 *
 * Addressed to the room rather than to the sender, for {@link LiveCatchUp}'s reason: a message
 * reaches whoever is listening, and the holder recognises its own transfer.
 */
export type LiveBlobNeeded = {
    kind: "blob-needed";
    /** The instance asking. */
    by: string;
    transferId: string;
    /** The slices it does not have. Empty means it has none of them. */
    missing: readonly number[];
};

/** Everything a machine in a session can say. */
export type LiveMessage =
    | LiveIntent
    | LiveEffect
    | LiveRefusal
    | LiveClaims
    | LiveClaim
    | LiveResync
    | LiveCatchUp
    | LiveBlobChunk
    | LiveBlobNeeded;

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
        || kind === "catch-up"
        || kind === "blob"
        || kind === "blob-needed";
}
