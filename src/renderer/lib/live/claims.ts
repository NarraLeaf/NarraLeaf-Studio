import type { LiveClaims } from "@shared/live/ops";
import type { StoryBlockId } from "@shared/types/story";

/**
 * How long a claim survives without being asserted again, in milliseconds.
 *
 * Thirty seconds, and the number is chosen against **a machine that has gone** rather than against
 * anything an author does: the box holding a row asserts the claim again on a timer for as long as
 * it is open, so the deadline only has to outlast the gap between two of those assertions. Half a
 * minute is three of them, and short enough that a machine which died holding a line does not hold
 * it for the rest of the session.
 *
 * ⚠ It was once measured against a pause in typing, because the assertion used to ride on
 * keystrokes. That is the same number describing a different thing, and on a real machine it cost
 * somebody their draft: an author who had stopped to think about a sentence still had the box open,
 * still had a name on the row on everybody's screen, and no longer held it. See
 * `useStoryRowClaimHold`.
 *
 * Lapsing costs a holder that is still there nothing: its next assertion takes the row again, and
 * that can only fail if somebody else claimed it in the meantime - which is exactly the case the
 * lapse existed for.
 */
export const DEFAULT_CLAIM_TIMEOUT_MS = 30_000;

/**
 * How often an open box says again that it holds its row, in milliseconds.
 *
 * **This is what makes a claim last exactly as long as the box does**, and it is deliberately not a
 * message per keystroke: what travels here goes to every machine in the room, and a room of six
 * people typing would otherwise be a few hundred messages a second carrying one bit of news between
 * them.
 *
 * A third of {@link DEFAULT_CLAIM_TIMEOUT_MS}, so two assertions fit inside one deadline with room
 * to spare - a claim therefore survives a lost assertion, which matters because nothing here is
 * re-sent or acknowledged. The traffic that buys is one message per open box per ten seconds, and
 * none at all from a window whose author is not writing a row.
 *
 * The same interval is what the host sweeps its own set on, so a claim that lapses is announced
 * within one of these rather than waiting for the next thing to happen in the room. See
 * `LiveSession.scheduleClaimSweep`.
 */
export const CLAIM_REASSERT_MS = DEFAULT_CLAIM_TIMEOUT_MS / 3;

/** Who is writing a row. */
export type LiveClaimHolder = {
    /** The instance that took it. While the claim stands, only this instance may write the row. */
    instance: string;
    /**
     * The account behind that instance.
     *
     * Carried alongside the instance rather than derived later because a refusal names a **person**,
     * and an instance id means nothing at all to whoever reads it.
     */
    account: string;
};

/**
 * What came of asking for a row: it is yours, or somebody is named.
 *
 * `changed` says whether the answer a reader would be shown is now different, and therefore whether
 * the set is worth broadcasting. Re-asserting a claim already held is a success with nothing
 * changed - a second keystroke in the same box must never come back as a refusal.
 */
export type LiveClaimOutcome =
    | { ok: true; changed: boolean }
    | { ok: false; heldBy: string };

export type LiveClaimStoreOptions = {
    /**
     * Reads the clock, in milliseconds.
     *
     * Injected rather than called directly so that a lapse can be exercised by moving a number: a
     * test that waits for real seconds to pass is a test nobody runs.
     */
    now?: () => number;
    /** How long a claim outlives its last assertion. See {@link DEFAULT_CLAIM_TIMEOUT_MS}. */
    timeoutMs?: number;
};

/** A claim as it is kept, which is the holder plus when it was last asserted. */
type StandingClaim = LiveClaimHolder & { renewedAt: number };

/**
 * Who is writing which row, as the host records it.
 *
 * A claim exists in exactly **one** place - the host's memory, which is this - so there is nothing
 * to agree on and nothing to reconcile. It is broadcast, never negotiated, and a guest holds no copy
 * it could disagree with.
 *
 * What it prevents is specific. The editing atom is a committed line rather than a keystroke: prose
 * accumulates in a draft box and reaches the document on Enter or blur. So the loser of a
 * last-writer-wins race over a row does not lose a character, it loses the paragraph it has just
 * finished typing, and loses it silently. That is also why a claim covers a whole row instead of one
 * field of it - the fields of a row hold each other up, and a second kind of state to keep correct
 * would buy nothing.
 *
 * Nothing here is written to disk. A claim is a statement about this instant, and a stored one is
 * a lie the moment the machine that made it is restarted.
 *
 * **There are no timers inside.** A lapse is decided against the injected clock while answering a
 * question, so there is nothing to cancel when the session ends and nothing to wait for in a test.
 * A caller that wants to *learn* about a lapse rather than have it happen quietly under another
 * question calls {@link sweep} on whatever tick it already has.
 */
export class LiveClaimStore {
    private readonly claims = new Map<StoryBlockId, StandingClaim>();
    private readonly now: () => number;
    private readonly timeoutMs: number;
    /** Advances whenever {@link snapshot} would say something different from last time. */
    private version = 0;

    public constructor(options: LiveClaimStoreOptions = {}) {
        this.now = options.now ?? Date.now;
        this.timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_CLAIM_TIMEOUT_MS));
    }

    /**
     * The revision of the set, which only advances when the set changes.
     *
     * A caller broadcasts when this differs from the revision it last sent, which is the whole of
     * the "broadcast whenever it changes" rule and needs no subscription to implement.
     */
    public get revision(): number {
        this.expire();
        return this.version;
    }

    /** How many rows are being written right now. */
    public get size(): number {
        this.expire();
        return this.claims.size;
    }

    /**
     * Take a row, or re-assert one already held.
     *
     * Re-asserting is a **success**: the same author typing a second character in the same box has
     * not conflicted with anything, and answering "no" to it would refuse somebody their own line.
     * It also pushes the deadline out, which is how a claim survives a long paragraph without the
     * timeout having to be long enough for one.
     *
     * A row somebody else holds is refused with their account name, because "no" without a name is
     * a mystery.
     */
    public claim(blockId: StoryBlockId, holder: LiveClaimHolder): LiveClaimOutcome {
        this.expire();
        const standing = this.claims.get(blockId);
        if (standing && standing.instance !== holder.instance) {
            return { ok: false, heldBy: standing.account };
        }
        this.claims.set(blockId, { instance: holder.instance, account: holder.account, renewedAt: this.now() });
        // A renewal by the same holder leaves the broadcast set identical, so it is not a change and
        // nobody has to be told about it.
        const changed = !standing || standing.account !== holder.account;
        if (changed) {
            this.version += 1;
        }
        return { ok: true, changed };
    }

    /**
     * Give a row back, and say whether that changed the set.
     *
     * Only its holder can. A release from anybody else is a message about a claim that is no longer
     * the one standing - a stale one arriving late, or an instance guessing - and honouring it would
     * be a way to take a row off the person writing it without ever being refused.
     */
    public release(blockId: StoryBlockId, instance: string): boolean {
        this.expire();
        const standing = this.claims.get(blockId);
        if (!standing || standing.instance !== instance) {
            return false;
        }
        this.claims.delete(blockId);
        this.version += 1;
        return true;
    }

    /**
     * Everything one instance holds, released at once.
     *
     * The answer to an instance leaving the session and to its socket dying, which are the same
     * event seen from here: whatever it was writing, it is not writing it now.
     */
    public releaseAll(instance: string): boolean {
        this.expire();
        let released = false;
        for (const [blockId, standing] of this.claims) {
            if (standing.instance === instance) {
                this.claims.delete(blockId);
                released = true;
            }
        }
        if (released) {
            this.version += 1;
        }
        return released;
    }

    /**
     * Forget a row that has been deleted, because nobody is writing a row that is gone.
     *
     * ⚠ **The row itself, not the rows underneath it.** Deleting a container takes its children with
     * it and their claims are left to lapse on the clock, which costs a name in the set for one
     * timeout over rows that are no longer drawn anywhere: an operation naming a row that has gone
     * is answered `row-gone` before any claim is consulted, so a lingering claim can never be the
     * reason somebody is refused.
     */
    public forgetRow(blockId: StoryBlockId): boolean {
        this.expire();
        if (!this.claims.delete(blockId)) {
            return false;
        }
        this.version += 1;
        return true;
    }

    /**
     * Who holds this row against this sender, or null when the sender may write it.
     *
     * The shape the host asks in, and the holder's **own** rows answer null: a claim is what lets
     * somebody keep writing a line, not something that gets in their way.
     */
    public blocking(blockId: StoryBlockId, by: string): string | null {
        const standing = this.holder(blockId);
        return standing && standing.instance !== by ? standing.account : null;
    }

    /** Who holds this row, or null when nobody does. */
    public holder(blockId: StoryBlockId): LiveClaimHolder | null {
        this.expire();
        const standing = this.claims.get(blockId);
        return standing ? { instance: standing.instance, account: standing.account } : null;
    }

    /** Drop whatever has lapsed, and say whether anything did - so a caller knows to broadcast. */
    public sweep(): boolean {
        return this.expire();
    }

    /**
     * The whole set, as the message that is broadcast.
     *
     * Whole rather than a list of changes, because the set is small and a client that missed one
     * change would otherwise show a stale name over somebody's cursor for the rest of the session.
     *
     * `seq` is this store's own revision rather than the host's application order: a claims set is
     * ordered against other claims sets and against nothing else, and drawing from the effect order
     * would either consume numbers there - where a gap means a lost message - or repeat one, leaving
     * two different sets indistinguishable.
     */
    public snapshot(): LiveClaims {
        this.expire();
        const held: Record<StoryBlockId, string> = {};
        for (const [blockId, standing] of this.claims) {
            held[blockId] = standing.account;
        }
        return { kind: "claims", seq: this.version, held };
    }

    /**
     * Drop every claim that has stood untouched for the whole timeout.
     *
     * A scan of the map on every question, which is as cheap as it sounds: an entry is one person
     * typing one line, so this counts the people in the room.
     */
    private expire(): boolean {
        const deadline = this.now() - this.timeoutMs;
        let dropped = false;
        for (const [blockId, standing] of this.claims) {
            if (standing.renewedAt <= deadline) {
                this.claims.delete(blockId);
                dropped = true;
            }
        }
        if (dropped) {
            this.version += 1;
        }
        return dropped;
    }
}
