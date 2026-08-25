import {
    CLAIMED_OPS,
    characterClaimKey,
    opBelongsTo,
    opClaimKeys,
    opDigestScope,
    type LiveBlockTarget,
    type LiveCatchUp,
    type LiveClaim,
    type LiveClaimKey,
    type LiveDerived,
    type LiveDigestScope,
    type LiveDocument,
    type LiveEffect,
    type LiveIntent,
    type LiveMessage,
    type LiveOp,
    type LiveOpKind,
    type LiveRefusal,
    type LiveRefusalReason,
    storyRowClaimKey,
    type LiveResync,
} from "@shared/live/ops";
import { liveSessionCarries } from "@shared/live/sharedDocuments";
import type { StoredCharacter } from "@shared/types/character/model";
import type { StoryBlock, StoryBlockId, StoryId, StoryScene, StorySceneId } from "@shared/types/story";
import { LiveClaimStore } from "./claims";
import { DeletedPositions, resolveInsertTarget } from "./deletedPositions";
import { LiveEffectLog } from "./effectLog";
import { LiveReceipts, type LiveReceipt } from "./receipts";

/** What the host has to say after reading one message, or nothing. */
export type LiveOutbound = LiveEffect | LiveRefusal | LiveCatchUp;

/**
 * Everything {@link LiveHost} needs from the world, and nothing it needs to know how to reach.
 *
 * All of it is injected so the rules below can be exercised without a workspace, a socket or a
 * server: the host is a decision, and a decision that can only be tested against a running session
 * is a decision nobody can check.
 */
export type LiveHostDeps = {
    /** This machine's instance id, used as the author of the host's own edits. */
    self: string;
    /**
     * The story this session was opened on.
     *
     * Which documents that makes the session responsible for is `@shared/live/sharedDocuments`'
     * answer, not a list assembled here: an intent about a document this session does not carry is
     * refused, and the set it is compared against has to be the same one the write boundary uses.
     */
    story: StoryId;
    /** The scene as it stands right now, or null when the story has no such scene. */
    readScene(sceneId: StorySceneId): StoryScene | null;
    /**
     * The character record as it stands right now, or null when the cast has no such member.
     *
     * The cast's answer to {@link readScene}, and asked for the same two reasons: an operation naming
     * a record that is gone is refused rather than allowed to create one, and an author's half-typed
     * panel is theirs to keep.
     */
    readCharacter(characterId: string): StoredCharacter | null;
    /**
     * The fingerprint of one unit after an operation landed on it, or null when this machine cannot
     * compute one.
     *
     * Injected rather than computed here because the unit differs per document - a scene, a character
     * record, the cast's shape - and knowing how to read each of them is exactly what the pure rules
     * are not allowed to know. What they do decide is *which* unit an effect is about, which is
     * `opDigestScope`, and that decision is shared with the guest so both sides fingerprint the same
     * thing.
     *
     * Null is "nothing was compared", never "they agree": see `LiveDivergenceGuard`.
     */
    digestOf(scope: LiveDigestScope): string | null;
    /**
     * Perform one operation on the document.
     *
     * Synchronous on purpose, and the reason the host needs no ordering machinery: nothing can
     * interleave between two operations if applying one never yields. An asynchronous applier would
     * let a second intent start while the first was half done, and the order the host reports would
     * stop being the order it applied things in.
     */
    applyOp(op: LiveOp): void;
    /** The next number in the host's application order. Called once per effect, after it is applied. */
    nextSeq(): number;
    /**
     * Whether an instance is in the session. Permissive when absent, so a caller that has not wired
     * the roster yet gets a host that works rather than one that refuses everything.
     */
    isMember?(instance: string): boolean;
    /**
     * The host's record of who is writing what. One is built when none is given, which is the
     * ordinary case - the claim store is the host's own memory and nothing outside a session has a
     * use for it. Injecting one is how a caller sets the clock a claim lapses against.
     */
    claims?: LiveClaimStore;
    /**
     * Who holds this claim against this sender, or null when the sender may write it.
     *
     * Consulted only for the operations in `CLAIMED_OPS`. Absent is the ordinary case: the answer
     * then comes from the host's own {@link claims} store, which says yes to everything while
     * nothing is claimed. A predicate given here answers INSTEAD of that store, for an embedder that
     * keeps the record somewhere else. The answer is an ACCOUNT name rather than an instance id
     * because it goes into a refusal, and a refusal names a person: "no" without a name is a
     * mystery. Comparing the holder against the sender is the answerer's business, since it is the
     * only thing that knows which accounts an instance belongs to.
     */
    claimBlocking?(key: LiveClaimKey, by: string): string | null;
    /**
     * The account behind an instance, or null when this host cannot say.
     *
     * Asked when an instance takes something, because a claim is recorded against a PERSON: a refusal
     * names one, and an instance id means nothing at all to whoever reads it. Nothing composes it -
     * the room's own roster is the only thing that knows which account a window signed in as.
     *
     * ⚠ **A claim that cannot name a person is not recorded**, which is why the answer may be null
     * rather than falling back to the instance id. A set carrying ids would name nobody in a
     * refusal, and worse: an editor compares the holder against its own account to decide which
     * rows are somebody else's, so an id would make its own author's line read as taken by a
     * stranger. Recording nothing degrades to what there was before a claim existed, which is a
     * race somebody occasionally loses rather than a row nobody can write.
     */
    accountOf?(instance: string): string | null;
    /** How many answers to remember for idempotency. See {@link LiveReceipts}. */
    receiptLimit?: number;
};

/** Every verb this host can apply, as a record so that a verb added to the vocabulary fails here. */
const KNOWN_OPS: Readonly<Record<LiveOpKind, true>> = {
    "insert-block": true,
    "insert-blocks": true,
    "update-block": true,
    "update-blocks": true,
    "delete-block": true,
    "delete-blocks": true,
    "move-block": true,
    "move-blocks": true,
    "set-block-disabled": true,
    "rename-scene": true,
    "set-entry-scene": true,
    "rename-story": true,
    "reorder-chapters": true,
    "create-character": true,
    "update-character": true,
    "set-character-group": true,
    "delete-character-group": true,
};

/** What the host decided to do about one operation: perform this, or refuse for that reason. */
type LivePlan =
    | { op: LiveOp }
    | { refuse: LiveRefusalReason; heldBy?: string };

/**
 * The host half of a live session: the thing that turns arriving intents into effects.
 *
 * **One rule governs all of it - only the host changes the document, and everybody else applies what
 * the host says happened.** A guest asks; this decides; the answer is both the receipt for the ask
 * and the instruction the whole room follows. There is therefore no transformation of concurrent
 * operations, no rollback of a speculative one and no agreement to reach, and the absence of those
 * three is not an omission to be repaired later.
 *
 * What it holds is small and all of it is a consequence of that rule: the order it applied things
 * in ({@link LiveEffectLog}), the answers it has already given so a retry does not act twice
 * ({@link LiveReceipts}), and where deleted rows used to sit so that a line aimed at one still lands
 * in the prose ({@link DeletedPositions}).
 *
 * It knows nothing about how messages travel. {@link receive} takes one and returns what to
 * broadcast; a transport does the rest.
 */
export class LiveHost {
    /** The host's application order, for catching a guest up. */
    public readonly log = new LiveEffectLog();
    /**
     * Who is writing which row. Public because it is the host's memory but not the host's decision:
     * rows are taken and given back as the interface opens and closes boxes, and the set it holds is
     * what {@link LiveClaimStore.snapshot} hands to a transport to broadcast.
     */
    public readonly claims: LiveClaimStore;

    private readonly receipts: LiveReceipts;
    private readonly positions = new DeletedPositions();

    public constructor(private readonly deps: LiveHostDeps) {
        this.receipts = new LiveReceipts(deps.receiptLimit);
        this.claims = deps.claims ?? new LiveClaimStore();
    }

    /**
     * Read one message and answer it. The single door in, so there is one order of events.
     *
     * `from` is the instance the transport says sent it, not something the message claims about
     * itself - an intent carries no author for that reason, and the effect's `by` comes from here.
     */
    public receive(message: LiveMessage, from: string): LiveOutbound | null {
        switch (message.kind) {
            case "intent":
                return this.intent(message, from);
            case "resync":
                return this.catchUp(message);
            case "claim":
                // Recorded, and answered with nothing. The set that results is broadcast from the
                // store's revision moving rather than from here, so ONE path covers a claim taken,
                // one given back, one that lapsed and one forgotten because what it held was
                // deleted - and a set is never sent twice for one change.
                this.claim(message, from);
                return null;
            case "effect":
            case "refusal":
            case "claims":
            case "catch-up":
                // Things the host itself says. One arriving here is this host's own message coming
                // back off the topic - every participant receives its own - and there is nothing to
                // do about it and nothing to say.
                return null;
        }
    }

    /**
     * The host's own edit, applied and announced.
     *
     * The host is not exempt from its own rule: its editing gestures are changes to the one copy
     * that counts, so they go through the same door, take the same sequence number and reach the log
     * the same way. Skipping it would leave guests holding a document that has quietly diverged and
     * a position memory with the host's own deletions missing from it.
     *
     * No client id, because nobody is waiting for a receipt - which is exactly what an absent
     * `clientId` on an effect means.
     */
    public applyLocal(op: LiveOp, document: LiveDocument, derived?: LiveDerived): LiveEffect | LiveRefusal {
        if (!liveSessionCarries(this.deps.story, document) || !opBelongsTo(op, document)) {
            return this.refuse(undefined, "document-not-shared");
        }
        return this.perform(op, this.deps.self, undefined, derived, document);
    }

    /**
     * This window is writing something, or has stopped. **The host's own box, through the guest's
     * door.**
     *
     * The host is not exempt from the rule it enforces: a row it took without recording it here
     * would be held by nobody as far as the set is concerned, so nothing would refuse a guest
     * writing over the paragraph the host is in the middle of - and no mark would appear on any
     * other screen. Same message, same record, same broadcast.
     */
    public claimLocal(key: LiveClaimKey, holding: boolean): void {
        this.claim({ kind: "claim", key, holding }, this.deps.self);
    }

    /**
     * Whatever an instance was writing, released at once.
     *
     * For a window that has left the room, which is the one ending a give-back cannot cover: the
     * machine that would have sent one is gone. Without it the claims it held stay held until they
     * lapse, and a lapse is a safety net measured in a pause in typing rather than in how long
     * somebody has been away.
     */
    public forgetInstance(instance: string): void {
        this.claims.releaseAll(instance);
    }

    private intent(intent: LiveIntent, from: string): LiveReceipt {
        const answered = this.receipts.get(intent.clientId);
        if (answered) {
            // The sender never saw its receipt and asked again. It gets the answer it already had:
            // applying a second time would be a second row, or a second rename over somebody's work.
            return answered;
        }
        const answer = this.decide(intent, from);
        this.receipts.remember(intent.clientId, answer);
        return answer;
    }

    private decide(intent: LiveIntent, from: string): LiveReceipt {
        if (!this.isMember(from)) {
            return this.refuse(intent.clientId, "not-in-session");
        }
        if (!isKnownOp(intent.op)) {
            // A newer build, or a corrupted message. Either way it is a "no" rather than a throw:
            // one unreadable message must not take the session down with it.
            return this.refuse(intent.clientId, "unknown-op");
        }
        // Two questions, deliberately not one. Whether the session carries that document is a fact
        // about this room; whether the operation could be about it is a fact about the message, and a
        // message whose two halves disagree is malformed rather than out of scope. Folding them would
        // report a build mismatch as "not shared" and send somebody looking in the wrong place.
        if (!intent.document || !liveSessionCarries(this.deps.story, intent.document)
            || !opBelongsTo(intent.op, intent.document)) {
            return this.refuse(intent.clientId, "document-not-shared");
        }
        return this.perform(intent.op, from, intent.clientId, intent.derived, intent.document);
    }

    /**
     * Decide about one operation and, if it stands, do it.
     *
     * The sequence number is taken *after* the change lands, so an applier that throws leaves no gap
     * in an order that promises a gap means a lost message.
     */
    private perform(
        op: LiveOp,
        by: string,
        clientId: string | undefined,
        derived: LiveDerived | undefined,
        document: LiveDocument,
    ): LiveEffect | LiveRefusal {
        const planned = this.plan(op, by);
        if ("refuse" in planned) {
            return this.refuse(clientId, planned.refuse, planned.heldBy);
        }
        const applied = planned.op;

        if (applied.op === "delete-block") {
            // Before the delete, while the rows are still there to be read. Afterwards there is
            // nowhere left to learn where they sat.
            const scene = this.deps.readScene(applied.sceneId);
            if (scene) {
                this.positions.remember(scene, applied.blockId);
            }
        }
        this.deps.applyOp(applied);
        if (applied.op === "delete-block") {
            // Nobody is writing a row that is gone.
            this.claims.forget(storyRowClaimKey(applied.blockId));
        }
        if (applied.op === "insert-block") {
            // A row that exists again has a real position, and a remembered one would outrank it.
            this.positions.forget(applied.sceneId, applied.block.id);
        }

        const effect: LiveEffect = {
            kind: "effect",
            by,
            seq: this.deps.nextSeq(),
            document,
            op: applied,
        };
        if (clientId !== undefined) {
            effect.clientId = clientId;
        }
        const scope = opDigestScope(applied);
        if (scope !== null) {
            const hash = this.deps.digestOf(scope);
            if (hash !== null) {
                effect.digest = { scope, hash };
            }
        }
        if (derived) {
            // Carried through untouched. Translations and voice takes that came with a paste are
            // read out of the copier's own memory, which nobody else has, so the effect is the only
            // way every machine can write the same ones.
            effect.derived = derived;
        }
        this.log.append(effect);
        return effect;
    }

    /**
     * What to do about an operation, without doing any of it.
     *
     * The switch is exhaustive over the vocabulary and has no default, so a verb added to it fails
     * to compile here until somebody has said what the host does about it.
     */
    private plan(op: LiveOp, by: string): LivePlan {
        switch (op.op) {
            case "rename-story":
            case "reorder-chapters":
                // Single-valued and last-writer-wins. Two people renaming a story is not a conflict,
                // it is two renames, and the loser lost a word.
                return { op };

            case "set-entry-scene": {
                if (op.sceneId !== null && !this.deps.readScene(op.sceneId)) {
                    return { refuse: "scene-gone" };
                }
                return { op };
            }

            case "rename-scene": {
                if (!this.deps.readScene(op.sceneId)) {
                    return { refuse: "scene-gone" };
                }
                return { op };
            }

            case "insert-block": {
                const scene = this.deps.readScene(op.sceneId);
                if (!scene) {
                    return { refuse: "scene-gone" };
                }
                // A deleted anchor does NOT stop an insert. The author was aiming at a place in the
                // prose and that place is still describable, so the row lands where the vanished one
                // sat - and the effect carries the target that was used, never the one that was
                // asked for, because a guest applies what it is told.
                const target = resolveInsertTarget(scene, this.positions, op.target);
                if (!target) {
                    return { refuse: "anchor-gone" };
                }
                return { op: { ...op, target } };
            }

            case "insert-blocks": {
                const scene = this.deps.readScene(op.sceneId);
                if (!scene) {
                    return { refuse: "scene-gone" };
                }
                // The ids this operation is about to create. A row aimed inside or beside one of
                // them names a place this very operation is making, so there is nothing in the
                // document to resolve it against and nothing to check: it is correct by
                // construction, and the entries are ordered so that it exists by the time the row
                // is placed. Everything aimed at the document proper resolves exactly as a single
                // insert does, deleted anchors included.
                const own = new Set(op.inserts.map(insert => insert.block.id));
                const inserts: { block: StoryBlock; target: LiveBlockTarget }[] = [];
                for (const insert of op.inserts) {
                    const parentId = insert.target.parentId ?? null;
                    const beforeBlockId = insert.target.beforeBlockId ?? null;
                    if ((parentId !== null && own.has(parentId)) || (beforeBlockId !== null && own.has(beforeBlockId))) {
                        inserts.push(insert);
                        continue;
                    }
                    const target = resolveInsertTarget(scene, this.positions, insert.target);
                    if (!target) {
                        // Whole or not at all, as every batch is: half a paste is an arrangement
                        // the author never asked for, sitting in everybody's document.
                        return { refuse: "anchor-gone" };
                    }
                    inserts.push({ block: insert.block, target });
                }
                return { op: { ...op, inserts } };
            }

            case "delete-blocks": {
                const scene = this.deps.readScene(op.sceneId);
                if (!scene) {
                    return { refuse: "scene-gone" };
                }
                // Every row first, then the claims, and one failure refuses the lot - the rule every
                // batch follows. ⚠ A row named after its own container is NOT missing: the container
                // takes its children with it, so a subtree deleted whole names rows that are gone by
                // the time their turn comes. Present-or-covered is the test.
                const covered = new Set(op.blockIds);
                for (const blockId of op.blockIds) {
                    if (scene.blocks[blockId]) {
                        continue;
                    }
                    const wasAt = this.positions.get(scene.id, blockId);
                    if (!wasAt || wasAt.parentId === null || !covered.has(wasAt.parentId)) {
                        return { refuse: "row-gone" };
                    }
                }
                return this.claimed(op, by) ?? { op };
            }

            case "move-block": {
                const scene = this.deps.readScene(op.sceneId);
                if (!scene) {
                    return { refuse: "scene-gone" };
                }
                const gone = this.rowGone(scene, op.blockId);
                if (gone) {
                    return gone;
                }
                const { parentId, beforeBlockId } = op.target;
                if (parentId && !scene.blocks[parentId]) {
                    return { refuse: "anchor-gone" };
                }
                if (beforeBlockId && !scene.blocks[beforeBlockId]) {
                    // Deliberately not resolved against the position memory the way an insert is.
                    // Moving again costs the author one gesture; landing a paragraph somewhere it
                    // was never sent invents an arrangement nobody wrote, and the author would have
                    // to find it before they could undo it.
                    return { refuse: "anchor-gone" };
                }
                return { op };
            }

            case "move-blocks": {
                const scene = this.deps.readScene(op.sceneId);
                if (!scene) {
                    return { refuse: "scene-gone" };
                }
                // Whole or not at all, and checked before a single row moves. Half a drag is an
                // arrangement the author never asked for, sitting in everybody's document with
                // nothing on any screen saying the other half was refused.
                for (const move of op.moves) {
                    for (const blockId of move.blockIds) {
                        const gone = this.rowGone(scene, blockId);
                        if (gone) {
                            return gone;
                        }
                    }
                    const { parentId, beforeBlockId } = move.target;
                    if (parentId && !scene.blocks[parentId]) {
                        return { refuse: "anchor-gone" };
                    }
                    if (beforeBlockId && !scene.blocks[beforeBlockId]) {
                        // Not resolved against the position memory, for the reason `move-block` is
                        // not: moving again costs one gesture, and a selection that lands where
                        // nobody sent it has to be found before it can be undone.
                        return { refuse: "anchor-gone" };
                    }
                }
                return { op };
            }

            case "update-blocks": {
                // Every scene and every row first, then the claims, and one failure of either
                // refuses the lot: a replace that wrote nine rows of ten would leave the tenth
                // holding the text the author asked to be rid of, and no report of it anywhere.
                for (const edit of op.edits) {
                    const scene = this.deps.readScene(edit.sceneId);
                    if (!scene) {
                        return { refuse: "scene-gone" };
                    }
                    const gone = this.rowGone(scene, edit.blockId);
                    if (gone) {
                        return gone;
                    }
                }
                return this.claimed(op, by) ?? { op };
            }

            case "update-block":
            case "delete-block":
            case "set-block-disabled": {
                const scene = this.deps.readScene(op.sceneId);
                if (!scene) {
                    return { refuse: "scene-gone" };
                }
                const gone = this.rowGone(scene, op.blockId);
                if (gone) {
                    return gone;
                }
                return this.claimed(op, by) ?? { op };
            }

            case "create-character":
                // Not checked against a record already there, and not claimed. The id was minted by
                // whoever built the record, so two of them colliding is a uuid collision rather than
                // a race; a *retry* of one create is answered by the receipts, which is where every
                // "did this already happen" question belongs. Refusing here would need a reason for a
                // case nobody can produce, and a reason nobody can reach is a reason nobody maintains.
                return { op };

            case "update-character": {
                if (!this.deps.readCharacter(op.characterId)) {
                    // ⚠ Says the record is gone. It never says the author's typing is: the panel is
                    // full of their own work and it is theirs to keep, exactly as `row-gone` is
                    // forbidden from being read as licence to clear a box.
                    return { refuse: "character-gone" };
                }
                return this.claimed(op, by) ?? { op };
            }

            case "set-character-group":
            case "delete-character-group":
                // Also last-writer-wins, and deliberately tolerant of a group that is already gone:
                // the second of two deletions changes nothing, and refusing it would report a
                // conflict where there is only agreement.
                return { op };
        }
    }

    /**
     * The refusal for an operation whose row is not there any more, or null if it is.
     *
     * ⚠ **A `row-gone` refusal says the row is gone. It never says the words are.** What the author
     * typed is theirs, and the interface built on this tells them the line has vanished while
     * leaving the box exactly as they left it - nothing in this answer may be read as licence to
     * clear it, which is why the host reports the reason and stops there rather than sending
     * anything the caller could mistake for a correction.
     */
    private rowGone(scene: StoryScene, blockId: StoryBlockId): LivePlan | null {
        return scene.blocks[blockId] ? null : { refuse: "row-gone" };
    }

    /**
     * The refusal for a row somebody else is writing, or null when the sender may proceed.
     *
     * Driven by `CLAIMED_OPS` rather than by a list written here, so the line between what a claim
     * governs and what is last-writer-wins is drawn in one place - the vocabulary the whole session
     * shares - and cannot come to mean two different things on two machines.
     *
     * **Every claim the operation names, and one held one refuses all of them.** A batch is one
     * gesture: applying the rows nobody holds and dropping the rest would produce a document that is
     * neither what the author asked for nor what it was before, and the author would be told a row
     * was claimed while seeing most of their edit land anyway.
     *
     * ⚠ **This is called from the cases of {@link plan}, one by one, and not from a single door.**
     * A verb added to `CLAIMED_OPS` whose case forgets `this.claimed(op, by) ??` is not checked at
     * all, and nothing anywhere says so - the operation simply applies over somebody's draft. There
     * is a test that walks every claimed verb for that reason.
     */
    private claimed(op: LiveOp, by: string): LivePlan | null {
        if (!CLAIMED_OPS.has(op.op)) {
            return null;
        }
        for (const key of opClaimKeys(op)) {
            const heldBy = this.deps.claimBlocking
                ? this.deps.claimBlocking(key, by)
                : this.claims.blocking(key, by);
            if (heldBy !== null) {
                return { refuse: "row-claimed", heldBy };
            }
        }
        return null;
    }

    /**
     * Record that an instance is writing something, or that it has stopped.
     *
     * The one place a claim is created or dropped by somebody asking, whichever half of the session
     * asked - see {@link claimLocal}. Something somebody else holds is simply not taken: the asker is
     * told by the set it already has, which names the holder, and there is nothing to send it that
     * it does not already know.
     *
     * **It does not check what the key is over.** A key names a row or a character record and this
     * store holds either; validating it against the document would be a second place that has to know
     * every kind of claim, and the worst a key for nothing can do is put a name over something nobody
     * in the room is looking at.
     */
    private claim(message: LiveClaim, from: string): void {
        if (!this.isMember(from)) {
            return;
        }
        if (!message.holding) {
            this.claims.release(message.key, from);
            return;
        }
        const account = this.deps.accountOf?.(from) ?? null;
        if (account === null) {
            // Nothing rather than a claim held by an id nobody would recognise. See `accountOf`.
            return;
        }
        this.claims.claim(message.key, { instance: from, account });
    }

    private catchUp(resync: LiveResync): LiveCatchUp {
        // Addressed to the instance the message names rather than to the transport's sender, which
        // is what lets the answer go to the room and reach the asker without the server routing it.
        return { kind: "catch-up", to: resync.by, effects: this.log.after(resync.after) };
    }

    private refuse(clientId: string | undefined, reason: LiveRefusalReason, heldBy?: string): LiveRefusal {
        // An empty client id is the host refusing one of its own edits, which nobody is waiting on
        // and nothing broadcasts; a refusal is addressed to the intent that asked, and there was no
        // intent. It reaches the caller as the return value and goes no further.
        const refusal: LiveRefusal = { kind: "refusal", clientId: clientId ?? "", reason };
        if (heldBy !== undefined) {
            refusal.heldBy = heldBy;
        }
        return refusal;
    }

    private isMember(instance: string): boolean {
        return this.deps.isMember ? this.deps.isMember(instance) : true;
    }
}

/**
 * Whether an operation is one this build can apply.
 *
 * Defensive about the shape and not only the verb, for the reason `isLiveMessage` is: the payload
 * arrives from another Studio, which may be a different version or may be sending nonsense.
 */
function isKnownOp(op: LiveOp | undefined | null): op is LiveOp {
    if (op === null || typeof op !== "object") {
        return false;
    }
    const kind = (op as { op?: unknown }).op;
    return typeof kind === "string" && Object.prototype.hasOwnProperty.call(KNOWN_OPS, kind);
}
