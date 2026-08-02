/**
 * The one auto-save timer every document service shares.
 *
 * It replaces six byte-identical copies of the same `clearTimeout`-then-re-arm block, and fixes the
 * defect all six had: a **pure trailing debounce**. Every edit pushed the write further out, so a
 * user typing steadily for five minutes had not written a single byte to disk - the exact stretch
 * during which a crash or a force-quit costs the most. The quiet-period behaviour is unchanged;
 * {@link DebouncedSaverOptions.maxWaitMs} is the new ceiling, measured from the first edit of a
 * dirty streak rather than the last.
 *
 * It also fixes the second half of that defect: a rejected write used to be logged and forgotten,
 * leaving the service dirty with nothing scheduled to try again. A failed write now keeps the debt
 * and re-arms itself on a backoff ladder that **never gives up** - see {@link armRetry}.
 *
 * Writes are serialised: a save that is still in flight when the next one comes due runs to
 * completion first, so two overlapping writers can never interleave on one document.
 */

/**
 * What this saver owes the disk right now.
 *
 * - `clean`   nothing pending, last write landed
 * - `dirty`   a write is scheduled but has not started
 * - `saving`  a write is in flight
 * - `failed`  the last write was rejected; a retry is armed
 */
export type SaveState = "clean" | "dirty" | "saving" | "failed";

export type DebouncedSaverOptions = {
    /** How long the edits have to stop before the write goes out. */
    delayMs: number;
    /**
     * The longest a dirty document may go unwritten, measured from the first edit after the last
     * save. Continued typing cannot push this out.
     */
    maxWaitMs: number;
    /** Performs the write. Serialised against itself; never called re-entrantly. */
    save: () => Promise<void>;
    /**
     * Reports a failed *timer-driven* save. Failures from {@link DebouncedSaver.flush} are thrown to
     * that caller instead, because it asked for the write and can act on the answer.
     */
    onError?: (error: unknown) => void;
    /** Backoff ladder for retrying a rejected write. The last entry repeats forever. */
    retryDelaysMs?: readonly number[];
};

export const DEFAULT_AUTOSAVE_DELAY_MS = 800;

/**
 * ~5s: long enough that a burst of typing still coalesces into one write, short enough that the
 * worst case a crash can cost is a sentence rather than a session.
 */
export const DEFAULT_AUTOSAVE_MAX_WAIT_MS = 5_000;

/**
 * Retry a rejected write after 1s, 2s, 4s, 8s, 15s, then every 30s for as long as it keeps failing.
 *
 * There is deliberately no attempt limit. The failure modes here are a full disk, a revoked
 * permission, a project directory on an unmounted volume - all of which the user can fix while the
 * app stays open, and all of which end with the edits landing if we are still trying. Giving up
 * would silently convert "not saved yet" into "lost".
 */
export const DEFAULT_SAVE_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

export class DebouncedSaver {
    private readonly options: DebouncedSaverOptions;
    private quietTimer: ReturnType<typeof setTimeout> | null = null;
    private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private pending = false;
    private inFlight: Promise<void> | null = null;
    private consecutiveFailures = 0;
    private lastError: unknown = null;
    private state: SaveState = "clean";
    private readonly stateListeners = new Set<(state: SaveState) => void>();

    public constructor(options: DebouncedSaverOptions) {
        this.options = options;
    }

    /**
     * Note that there are unsaved changes. Re-arms the quiet period; leaves the ceiling alone, which
     * is what stops continuous editing from deferring the write indefinitely.
     */
    public schedule(): void {
        const wasPending = this.pending;
        this.pending = true;

        if (this.quietTimer) {
            clearTimeout(this.quietTimer);
        }
        this.quietTimer = setTimeout(() => this.fire(), this.options.delayMs);

        if (!wasPending) {
            this.deadlineTimer = setTimeout(() => this.fire(), this.options.maxWaitMs);
        }

        // Editing during a failing streak does not reset the backoff - the disk is still the disk -
        // and it must not downgrade the reported state from `failed` to `dirty` either.
        if (this.state !== "saving") {
            this.syncIdleState();
        }
    }

    /**
     * Drop the pending write without performing it.
     *
     * For callers that are about to write the same document themselves - the manual `save()` paths,
     * which would otherwise be followed by a redundant auto-save of state they already persisted.
     */
    public cancel(): void {
        this.pending = false;
        this.clearTimers();
        if (!this.inFlight) {
            this.syncIdleState();
        }
    }

    /**
     * Forget everything this saver owes, and wait for a write that is already running.
     *
     * The opposite of {@link flush}, and the one thing a working-tree reload needs: the debt is owed
     * on memory that is about to be thrown away, so paying it would write exactly the bytes the
     * reload exists to discard - the author's frozen-period edits, or a past revision over their
     * working tree. The retry ladder goes with it, because a debt kept for a retry is the same write
     * arriving a few seconds later.
     *
     * Two discards around one await, on purpose. The first stops a timer firing while we wait; the
     * await is unavoidable, because a write already in flight cannot be cancelled and a reload must
     * not read the disk out from under it; the second clears the debt the failing arm of that write
     * re-owed itself on the way out.
     */
    public async abandon(): Promise<void> {
        this.discardDebt();
        if (this.inFlight) {
            await this.inFlight;
        }
        this.discardDebt();
    }

    /**
     * Write now if anything is pending, and wait for it - including a save that was already in
     * flight. Rethrows the write's error, unlike the timer path (a failed flush still arms the
     * retry, so rethrowing informs the caller without dropping the debt).
     */
    public async flush(): Promise<void> {
        if (this.pending) {
            this.pending = false;
            this.clearTimers();
            await this.enqueue();
            return;
        }

        if (this.inFlight) {
            await this.inFlight;
        }
    }

    /** Whether a write is owed - either waiting on a timer or currently running. */
    public isPending(): boolean {
        return this.pending || this.inFlight !== null;
    }

    public getState(): SaveState {
        return this.state;
    }

    /** The error from the most recent rejected write, or null once one succeeds. */
    public getLastError(): unknown {
        return this.lastError;
    }

    /** How many writes in a row have been rejected. 0 once one lands. */
    public getConsecutiveFailures(): number {
        return this.consecutiveFailures;
    }

    public onStateChanged(listener: (state: SaveState) => void): () => void {
        this.stateListeners.add(listener);
        return () => {
            this.stateListeners.delete(listener);
        };
    }

    private fire(): void {
        if (!this.pending) {
            return;
        }
        this.pending = false;
        this.clearTimers();
        void this.enqueue().catch(error => this.options.onError?.(error));
    }

    private enqueue(): Promise<void> {
        // Chain onto whatever is still running so two writes to one document cannot interleave.
        const previous = this.inFlight ?? Promise.resolve();
        const result = previous.then(async () => {
            this.setState("saving");
            try {
                await this.options.save();
            } catch (error) {
                this.consecutiveFailures += 1;
                this.lastError = error;
                // The write is still owed. Keeping `pending` set is what makes a later flush() (or
                // the retry below) actually write, instead of reporting "nothing to do" over a
                // document that never reached the disk.
                this.pending = true;
                this.armRetry();
                this.setState("failed");
                throw error;
            }
            this.consecutiveFailures = 0;
            this.lastError = null;
            // Not necessarily `clean`: an edit that landed while the write was in flight is still
            // pending, and its timers are still armed.
            this.syncIdleState();
        });

        // `guard` is the settled-and-swallowed view of the same work: it is what other callers wait
        // on, so a rejected save cannot surface as an unhandled rejection through the chain.
        const guard: Promise<void> = result
            .catch(() => undefined)
            .finally(() => {
                if (this.inFlight === guard) {
                    this.inFlight = null;
                }
            });
        this.inFlight = guard;

        return result;
    }

    private armRetry(): void {
        const ladder = this.options.retryDelaysMs ?? DEFAULT_SAVE_RETRY_DELAYS_MS;
        if (ladder.length === 0) {
            return;
        }
        const delay = ladder[Math.min(this.consecutiveFailures - 1, ladder.length - 1)];
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
        }
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.fire();
        }, delay);
    }

    /**
     * Drop the pending write, its timers, and the failure streak that would otherwise keep the state
     * `failed` and the ladder climbing. See {@link abandon}, the only caller.
     */
    private discardDebt(): void {
        this.pending = false;
        this.clearTimers();
        this.consecutiveFailures = 0;
        this.lastError = null;
        if (!this.inFlight) {
            this.syncIdleState();
        }
    }

    private syncIdleState(): void {
        this.setState(this.consecutiveFailures > 0 ? "failed" : this.pending ? "dirty" : "clean");
    }

    private setState(state: SaveState): void {
        if (this.state === state) {
            return;
        }
        this.state = state;
        for (const listener of this.stateListeners) {
            listener(state);
        }
    }

    private clearTimers(): void {
        if (this.quietTimer) {
            clearTimeout(this.quietTimer);
            this.quietTimer = null;
        }
        if (this.deadlineTimer) {
            clearTimeout(this.deadlineTimer);
            this.deadlineTimer = null;
        }
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }
}
