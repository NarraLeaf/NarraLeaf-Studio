import {
    isLiveMessage,
    type LiveCatchUp,
    type LiveClaim,
    type LiveClaimKey,
    type LiveClaims,
    type LiveDerived,
    type LiveDigestScope,
    type LiveDocument,
    type LiveEffect,
    type LiveIntent,
    type LiveOp,
    type LiveRefusal,
    type LiveResync,
} from "@shared/live/ops";

/** Everything a guest can say. The other three kinds of message are the host's to send. */
export type LiveGuestOutbound = LiveIntent | LiveResync | LiveClaim;

/**
 * How long a sent intent waits for its answer before it is sent again, unchanged.
 *
 * Three seconds, chosen against the round trip and not against a memory budget. An intent goes to a
 * relay and comes back as an effect, which is tens of milliseconds on a local network and a few
 * hundred over the internet; re-sending after a few hundred milliseconds would therefore repeat
 * messages that are merely still in flight, and every repeat costs the host a lookup and the room
 * nothing useful. Waiting much longer than this is worse in the other direction: what the author sees
 * while an intent is unanswered is a row that has not appeared, and a lost message is not rare enough
 * to leave them looking at it for ten seconds. Three is comfortably past any healthy round trip and
 * still inside the span where a person is willing to believe the line is on its way.
 */
export const DEFAULT_RESEND_AFTER_MS = 3000;

/**
 * Everything {@link LiveGuest} needs from the world, and nothing it needs to know how to reach.
 *
 * Injected for the reason the host's are: a guest is a set of rules about waiting, order and repair,
 * and rules that can only be exercised against a running session with a real clock in it are rules
 * nobody can check.
 */
export type LiveGuestDeps = {
    /** This machine's instance id. It addresses the resyncs this guest sends. */
    self: string;
    /**
     * Perform one operation on the local document.
     *
     * Only ever called with an operation an effect carried, never with one this machine asked for.
     * `derived` is handed straight on: translations and voice takes that came with a paste were read
     * out of the copier's memory, which nobody else has, so the effect is the only place they exist
     * on this machine and the guest decides nothing about them.
     */
    applyOp(op: LiveOp, document: LiveDocument, derived?: LiveDerived): void;
    /** Put one message on the wire. Whether it arrives is not this class's business. */
    send(message: LiveGuestOutbound): void;
    /**
     * Milliseconds from any source that only moves forward.
     *
     * Injected rather than read from the platform, so that "waited too long" is something a test can
     * state in a line instead of something it has to sit through.
     */
    now(): number;
    /** Run `run` after at least `delayMs`; the returned function cancels it. Injected for the same reason. */
    schedule(delayMs: number, run: () => void): () => void;
    /**
     * What this machine makes of one unit after applying an effect, for {@link onDigest}. Absent when
     * nothing is watching for divergence, in which case no digest is computed and none is needed.
     *
     * The same port the host has, and deliberately the same shape: both sides fingerprint the unit
     * `opDigestScope` names, and a guest that computed it a second way would report disagreements
     * that were only two spellings of one document.
     */
    digestOf?(scope: LiveDigestScope): string | null;
    /**
     * The seam the divergence guard hangs off: called after an effect that carried a digest has been
     * applied, with that effect and the digest this machine computed from its own copy of the scene
     * - null when the scene could not be read.
     *
     * **The guest decides nothing about the answer.** Comparing the two, and what leaving a session
     * over a disagreement looks like, belong to whoever supplies this; the guest carries on either
     * way, because a class that cannot tell which copy is wrong is in no position to act on the fact
     * that they differ.
     */
    onDigest?(effect: LiveEffect, compute: (scope: LiveDigestScope) => string | null): void;
    /**
     * The host said no. Carries the intent that was refused when it was still outstanding, so the
     * interface can name the row rather than the key.
     *
     * A refusal that reaches nobody is an edit that silently did not happen, which is why this exists
     * at all - the guest itself has nothing to do about one beyond forgetting it was waiting.
     */
    onRefusal?(refusal: LiveRefusal, intent: LiveIntent | null): void;
    /** Overrides {@link DEFAULT_RESEND_AFTER_MS}, for a caller that knows something about its link. */
    resendAfterMs?: number;
};

/** An intent that has been sent and not yet answered. */
type LivePending = {
    intent: LiveIntent;
    /** When it last went out, for the re-send. */
    sentAt: number;
};

/**
 * The guest half of a live session: the thing that asks, waits, and applies what it is told.
 *
 * **One rule governs all of it, and it is the mirror of the host's - this machine never changes its
 * own document on its own initiative.** An editing gesture becomes an intent, the intent goes out,
 * and the row on screen does not move until an effect comes back saying it did. Nothing here applies
 * an operation optimistically and nothing here takes one back, and the absence of both is the whole
 * reason the session needs no transformation, no rollback and no agreement.
 *
 * What it holds is small and every piece of it is a consequence of that rule: the intents it is still
 * waiting on, so a lost one can be sent again unchanged; the last sequence it applied and the effects
 * that arrived ahead of a gap, so the order it applies in stays the order the host applied in; and
 * the claim snapshot, which it records for the interface and acts on not at all.
 *
 * It knows nothing about how messages travel. {@link receive} takes whatever arrived and
 * {@link intend} hands what to say to a `send` it was given; a transport does the rest.
 */
export class LiveGuest {
    private readonly resendAfterMs: number;
    /** Sent and unanswered, by idempotency key. Insertion-ordered, so the oldest is the first out. */
    private readonly outstanding = new Map<string, LivePending>();
    /**
     * Effects that arrived ahead of a gap, by sequence, waiting for what belongs in front of them.
     *
     * Held rather than dropped, because they are the ones a catch-up would otherwise have to fetch
     * again. Unbounded for the reason the host's log is: what travels here is the difference since a
     * committed revision, a few hundred bytes at a time, and every entry leaves the moment the hole
     * in front of it is filled.
     */
    private readonly ahead = new Map<number, LiveEffect>();
    private lastApplied = 0;
    /** A resync has gone out and the catch-up answering it has not arrived. */
    private catchingUp = false;
    private held: Readonly<Record<LiveClaimKey, string>> = {};
    private heldSeq = 0;
    private minted = 0;
    private cancelResend: (() => void) | null = null;

    public constructor(private readonly deps: LiveGuestDeps) {
        this.resendAfterMs = Math.max(0, deps.resendAfterMs ?? DEFAULT_RESEND_AFTER_MS);
    }

    /**
     * Ask for one operation. **Nothing happens to the document here.**
     *
     * The intent is minted, remembered and sent, and that is the whole of it: the row changes when
     * the effect answering this comes back, and if the answer is a refusal it never changes at all.
     * Returned so a caller can hold on to what it asked for - the key on it is what every later
     * answer is matched by.
     */
    public intend(op: LiveOp, document: LiveDocument, derived?: LiveDerived): LiveIntent {
        const intent: LiveIntent = {
            kind: "intent",
            clientId: this.mintClientId(),
            document,
            op,
        };
        if (derived) {
            intent.derived = derived;
        }
        this.outstanding.set(intent.clientId, { intent, sentAt: this.deps.now() });
        this.deps.send(intent);
        this.armResend();
        return intent;
    }

    /**
     * Say that this machine is writing something, or that it has stopped. **Nothing is held here.**
     *
     * The mirror of {@link intend}: the host is the only place a claim exists, so this asks and
     * records nothing of its own. It is held when a set arrives naming this author on it, and until
     * then it is held by whoever the last set said - which may be somebody else, in which case this
     * ask changed nothing and no set will come back.
     */
    public claim(key: LiveClaimKey, holding: boolean): void {
        this.deps.send({ kind: "claim", key, holding });
    }

    /**
     * Read one message. The single door in, so there is one order of events.
     *
     * Takes `unknown` rather than a message, because what arrives is the payload of somebody else's
     * `live.say` and that somebody may be a newer build or may be sending nonsense: one unreadable
     * message has to be dropped where it lands rather than thrown out of the transport.
     */
    public receive(message: unknown): void {
        if (!isLiveMessage(message)) {
            return;
        }
        switch (message.kind) {
            case "effect":
                this.effect(message);
                return;
            case "refusal":
                this.refusal(message);
                return;
            case "claims":
                this.claims(message);
                return;
            case "catch-up":
                this.catchUp(message);
                return;
            case "intent":
            case "resync":
            case "claim":
                // The things a guest itself says. One arriving here is this guest's own message
                // coming back off the topic, or another guest's - every participant receives
                // everything - and neither is anything to act on: only the host answers an intent,
                // and only the host holds a claim. What a guest knows about claims arrives as a
                // `claims` set and in no other way.
                return;
            case "blob":
            case "blob-needed":
            case "handover":
                // Not about the document. Slices are carried beside the operation stream and a
                // handover is about the room, and both are settled before a message reaches these
                // rules at all - see `LiveSession.onMessage`.
                return;
        }
    }

    /** Stop waiting. The session is over; the pending intents will never be answered now. */
    public close(): void {
        this.disarmResend();
        this.outstanding.clear();
        this.ahead.clear();
    }

    /** The last sequence this machine applied. What a resync names, and what the interface reports. */
    public get appliedSeq(): number {
        return this.lastApplied;
    }

    /** The intents still waiting for an answer, oldest first. */
    public get pending(): readonly LiveIntent[] {
        return [...this.outstanding.values()].map(entry => entry.intent);
    }

    /** Whether this guest is waiting on the host to fill a gap it saw. */
    public get waitingForCatchUp(): boolean {
        return this.catchingUp;
    }

    /** Who is writing what, as the host last said. Recorded for the interface; acted on nowhere. */
    public get claimed(): Readonly<Record<LiveClaimKey, string>> {
        return this.held;
    }

    /* ------------------------------------------------------------------ answers */

    private effect(effect: LiveEffect): void {
        // Settled on arrival rather than on application: an effect carrying this machine's key is
        // proof the host answered, so there is nothing left to re-send even when the effect itself
        // has to wait behind a gap before it can be applied.
        this.settle(effect.clientId);
        this.ingest(effect);
        this.drain();
    }

    private refusal(refusal: LiveRefusal): void {
        const pending = this.outstanding.get(refusal.clientId);
        if (!pending) {
            // Refusals carry no addressee, so this guest sees the ones meant for everybody else, and
            // the ones answering an intent it has already had an answer to. Neither is its business.
            return;
        }
        this.settle(refusal.clientId);
        // Nothing is applied and nothing is undone, because nothing was ever applied: the document
        // has not moved since the intent went out. What the author typed is still theirs.
        this.deps.onRefusal?.(refusal, pending.intent);
    }

    private claims(claims: LiveClaims): void {
        if (claims.seq < this.heldSeq) {
            // An older snapshot overtaking a newer one would put a name back over a row somebody has
            // already let go of, and nothing would come along later to correct it.
            return;
        }
        this.heldSeq = claims.seq;
        this.held = claims.held;
    }

    private catchUp(catchUp: LiveCatchUp): void {
        if (catchUp.to !== this.deps.self) {
            // A catch-up goes to the room and names the guest that asked, which is what lets the
            // answer reach it without the server having to route anything. Everybody else ignores it.
            return;
        }
        for (const effect of catchUp.effects) {
            this.settle(effect.clientId);
            this.ingest(effect);
        }
        // Cleared after the batch rather than before it, so a hole inside the batch - which the
        // host's log makes impossible, since it holds in order everything the host ever did - cannot
        // turn into an ask per effect. The question re-opens on the next effect to arrive instead.
        this.catchingUp = false;
        this.drain();
    }

    /* ----------------------------------------------------------------- ordering */

    /**
     * Take one effect into the order.
     *
     * Three cases, and the sequence decides which: already behind us, next, or ahead of a gap. An
     * effect that is ahead is kept rather than applied - the host's application order is the only
     * order there is, and applying out of it would produce a document the host never held.
     */
    private ingest(effect: LiveEffect): void {
        if (effect.seq <= this.lastApplied) {
            // Already applied. A repeat, which is what a catch-up overlapping what arrived normally
            // looks like, and applying it again would be a second row or a second rename.
            return;
        }
        this.ahead.set(effect.seq, effect);
        if (effect.seq > this.lastApplied + 1) {
            this.askForCatchUp();
        }
    }

    /** Apply everything that is now contiguous, in order, and stop at the first hole. */
    private drain(): void {
        for (;;) {
            const next = this.ahead.get(this.lastApplied + 1);
            if (!next) {
                return;
            }
            this.ahead.delete(next.seq);
            this.apply(next);
        }
    }

    private apply(effect: LiveEffect): void {
        // The operation as the effect carries it, which is not always the one that was asked for: an
        // insert whose anchor row had just been deleted still lands where that row was, and the
        // effect names the position the host actually used. A guest applies what it is told.
        this.deps.applyOp(effect.op, effect.document, effect.derived);
        this.lastApplied = effect.seq;
        this.reportDigest(effect);
    }

    private askForCatchUp(): void {
        if (this.catchingUp) {
            // One ask per gap. A second effect arriving while the first ask is outstanding is the
            // same hole seen again, and a resync per effect would answer a lost message with a flood.
            return;
        }
        this.catchingUp = true;
        const resync: LiveResync = { kind: "resync", by: this.deps.self, after: this.lastApplied };
        this.deps.send(resync);
    }

    /**
     * Hand the divergence guard the effect and what this machine makes of the same unit after
     * applying it. Skipped when nobody is watching, since the digest is real work per effect.
     *
     * ⚠ **The scopes come from the effect, not from this machine's reading of the operation.** The
     * two agree today, and they have to keep agreeing for the comparison to mean anything - so the
     * values that travelled are the ones used, and an effect from a build that fingerprints something
     * else reports `unproven` rather than a disagreement about which unit was measured. It is also
     * what lets an effect fingerprint work it derived rather than carried: this machine is asked about
     * the units the host actually touched.
     */
    private reportDigest(effect: LiveEffect): void {
        if (!this.deps.onDigest || effect.digests === undefined || effect.digests.length === 0) {
            return;
        }
        this.deps.onDigest(effect, scope => this.deps.digestOf?.(scope) ?? null);
    }

    /* ------------------------------------------------------------- the re-send */

    private settle(clientId: string | undefined): void {
        if (clientId === undefined || !this.outstanding.delete(clientId)) {
            return;
        }
        this.armResend();
    }

    /**
     * Point the timer at whichever outstanding intent falls due first, or put it away when none does.
     *
     * Re-armed from scratch on every change rather than kept running, because an intent that is
     * answered stops being a deadline and one that is re-sent gets a new one; a single timer aimed at
     * the earliest of them is always correct and costs a walk over a handful of entries.
     */
    private armResend(): void {
        this.disarmResend();
        let earliest: number | null = null;
        for (const entry of this.outstanding.values()) {
            if (earliest === null || entry.sentAt < earliest) {
                earliest = entry.sentAt;
            }
        }
        if (earliest === null) {
            return;
        }
        const delay = Math.max(0, earliest + this.resendAfterMs - this.deps.now());
        this.cancelResend = this.deps.schedule(delay, () => {
            this.cancelResend = null;
            this.resendOverdue();
        });
    }

    private disarmResend(): void {
        if (this.cancelResend) {
            this.cancelResend();
            this.cancelResend = null;
        }
    }

    /**
     * Send every intent that has waited too long again, **unchanged**.
     *
     * Safe because the key on it is an idempotency key: the host remembers the answer it gave and
     * hands the same one back rather than acting twice. Re-sending is also the only repair available
     * on a channel that delivers to whoever happens to be listening - there is nobody to ask whether
     * a message arrived, so the only question a guest can answer is whether it has waited long enough.
     */
    private resendOverdue(): void {
        const now = this.deps.now();
        for (const entry of this.outstanding.values()) {
            if (now - entry.sentAt >= this.resendAfterMs) {
                entry.sentAt = now;
                this.deps.send(entry.intent);
            }
        }
        this.armResend();
    }

    /**
     * A key unique for the life of the session, without a random source.
     *
     * The instance id is unique among the machines in the room and the counter is unique within this
     * one, so the pair cannot collide with another guest's - which is what an idempotency key has to
     * promise, since the host stores answers under it for everybody at once.
     */
    private mintClientId(): string {
        this.minted += 1;
        return `${this.deps.self}:${this.minted}`;
    }
}
