import type { LiveEffect, LiveRefusal } from "@shared/live/ops";

/** The one answer an intent gets: what the host did, or why it would not. */
export type LiveReceipt = LiveEffect | LiveRefusal;

/**
 * How many answers the host keeps.
 *
 * See {@link LiveReceipts} for what happens at the edge of it. A thousand is chosen against the
 * window a retry lives in rather than against a memory budget: a sender re-sends while it is still
 * waiting for a receipt, which is seconds, and a thousand further operations do not pass in seconds
 * of one session's typing.
 */
export const DEFAULT_RECEIPT_MEMORY = 1024;

/**
 * The answers the host has already given, by the sender's idempotency key.
 *
 * A sender holds on to an intent until it sees the matching effect or refusal and re-sends it
 * unchanged if neither arrives - the only repair available on a channel that delivers to whoever
 * happens to be listening. So an intent can reach the host twice and must produce **one** answer.
 * A repeat gets the ORIGINAL answer back, not a fresh application: the sender is retrying because it
 * never saw the receipt, and re-applying an insert would put a second row on the page.
 *
 * Bounded, because a session runs for hours and a map that only grows is a leak wearing correctness
 * as a disguise. Past the limit the oldest answer is dropped, and **a retry that arrives after its
 * answer was dropped is treated as a new intent and applied a second time.** That is the accepted
 * cost of the bound: it can only happen to a sender that has been waiting for its receipt across a
 * thousand other operations, by which point the session has a worse problem than a duplicated row.
 */
export class LiveReceipts {
    private readonly answers = new Map<string, LiveReceipt>();
    private readonly limit: number;

    public constructor(limit: number = DEFAULT_RECEIPT_MEMORY) {
        this.limit = Math.max(1, Math.floor(limit));
    }

    /** The answer this intent already got, or null if it is being seen for the first time. */
    public get(clientId: string): LiveReceipt | null {
        return this.answers.get(clientId) ?? null;
    }

    public remember(clientId: string, receipt: LiveReceipt): void {
        this.answers.set(clientId, receipt);
        // A Map yields its keys in insertion order, so the first one out is the oldest answer -
        // which is the one whose sender is least likely to still be waiting for it.
        while (this.answers.size > this.limit) {
            const oldest = this.answers.keys().next();
            if (oldest.done) {
                break;
            }
            this.answers.delete(oldest.value);
        }
    }

    /** How many answers are being kept. */
    public get size(): number {
        return this.answers.size;
    }
}
