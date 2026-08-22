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
 * The whole vocabulary. **Deliberately the story service's own methods** rather than a second set of
 * verbs invented for the wire: those methods already address by id, already take a relative target,
 * and are already what every editing gesture ends up calling. A parallel vocabulary would be a
 * second model of the document to keep in step with the first.
 *
 * Closed for this version. Story documents are the only thing a session collaborates on - see the
 * freeze that surrounds one - so an operation on anything else is not an operation this vocabulary
 * is missing, it is one that has no meaning here.
 */
export type LiveOp =
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
    | { op: "delete-block"; sceneId: StorySceneId; blockId: StoryBlockId }
    | { op: "move-block"; sceneId: StorySceneId; blockId: StoryBlockId; target: LiveBlockTarget }
    | { op: "set-block-disabled"; sceneId: StorySceneId; blockId: StoryBlockId; disabled: boolean }
    | { op: "rename-scene"; sceneId: StorySceneId; name: string }
    /** The scene the story starts at, or null to leave it unset. */
    | { op: "set-entry-scene"; sceneId: StorySceneId | null }
    | { op: "rename-story"; name: string }
    /** Chapters in their new order, named by id. */
    | { op: "reorder-chapters"; chapterIds: readonly string[] };

/** Every operation kind, for a caller that has to enumerate them. */
export type LiveOpKind = LiveOp["op"];

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
 */
export const CLAIMED_OPS: ReadonlySet<LiveOpKind> = new Set<LiveOpKind>([
    "update-block",
    "delete-block",
    "set-block-disabled",
]);

/** The block an operation is about, or null for the ones that are about the story as a whole. */
export function opBlockId(op: LiveOp): StoryBlockId | null {
    switch (op.op) {
        case "insert-block":
            return op.block.id;
        case "update-block":
        case "delete-block":
        case "move-block":
        case "set-block-disabled":
            return op.blockId;
        case "rename-scene":
        case "set-entry-scene":
        case "rename-story":
        case "reorder-chapters":
            return null;
    }
}

/** The scene an operation is about, or null when it is about the story as a whole. */
export function opSceneId(op: LiveOp): StorySceneId | null {
    switch (op.op) {
        case "insert-block":
        case "update-block":
        case "delete-block":
        case "move-block":
        case "set-block-disabled":
        case "rename-scene":
            return op.sceneId;
        case "set-entry-scene":
            return op.sceneId;
        case "rename-story":
        case "reorder-chapters":
            return null;
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
    /** The story document this session is about; an intent naming another is refused. */
    story: StoryId;
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
    op: LiveOp;
    /**
     * The scene's content after applying, so a guest can prove it agrees.
     *
     * Disagreement is the most expensive way this design can fail: two documents that differ, each
     * written into its own history, with nothing anywhere reporting a problem. A guest that computes
     * a different digest leaves the session and says so.
     *
     * Absent for the operations that are about the story rather than a scene.
     */
    sceneDigest?: string;
    derived?: LiveDerived;
};

/** Why the host would not do it. */
export type LiveRefusalReason =
    /** Somebody else is writing that line. Carries who, because "no" without a name is a mystery. */
    | "row-claimed"
    /** The row is gone. The author's own text is theirs to keep - never clear it on this. */
    | "row-gone"
    /** A move's destination anchor is gone. Moving again is cheap; guessing a position is not. */
    | "anchor-gone"
    /** The scene is gone. */
    | "scene-gone"
    /** Sent by an instance that is not in the room, or about another story. */
    | "not-in-session"
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
    /** Block id to the account holding it. */
    held: Readonly<Record<StoryBlockId, string>>;
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
        || kind === "resync"
        || kind === "catch-up";
}
