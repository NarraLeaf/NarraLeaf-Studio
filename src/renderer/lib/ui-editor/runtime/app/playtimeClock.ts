/**
 * The playtime stopwatch, kept free of React so it can be driven and asserted directly.
 * {@link usePlaytime} is the thin hook that owns the timer and the visibility listener.
 *
 * Two quantities come out of one clock, and conflating them is the mistake this file exists to
 * prevent:
 *
 * - **The run's playtime** — seconds spent reaching wherever the player is now. It is what a save
 *   records, and it is *inherited*: loading a save sets the stopwatch to that save's reading and
 *   carries on. Seeding is assignment, never addition, so loading the same save a hundred times
 *   never inflates it.
 * - **The title's total** — seconds ever spent in this project, across every playthrough. It only
 *   ever goes up, lives in host persistence rather than in any save file, and is untouched by
 *   loading.
 *
 * # Why the total is two numbers rather than one
 *
 * The stored figure and the seconds accrued since it was last written are kept apart, and the total
 * is their sum. Holding one combined number forces the arrival of the stored figure to be a choice
 * between overwriting what has been played and discarding what was stored, and both are wrong: the
 * read is asynchronous, so a player can easily have banked a minute before it lands. Kept apart,
 * arrival order stops mattering — the stored figure is installed underneath whatever has accrued.
 *
 * The same split is what lets writing be *held*. Nothing is written until a read has actually come
 * back, because a write before then would carry a total built on a baseline of zero and stand on
 * top of however many hours the store already held. That is not a hypothetical either: the read was
 * once issued before the store it reads through existed, always resolved to nothing, and every
 * relaunch wrote the session's own seconds over the title's history (493.8 stored, 60.9 written
 * back one launch later). Holding costs nothing — the seconds stay counted either way, they are
 * merely not yet on disk.
 *
 * # Why time is accrued per tick and clamped, rather than measured end to end
 *
 * Subtracting two timestamps across a whole session attributes every kind of gap to the player: a
 * suspended laptop, a window Chromium throttled down to one timer callback a minute, a clock the OS
 * stepped. A lid closed overnight would bill eight hours of playtime to the next save.
 *
 * So each tick adds only the time since the previous tick, and each delta is clamped to a small
 * multiple of the nominal tick spacing. Every anomaly then degrades the same way — it contributes
 * one clamped tick and nothing more — without this file needing to know which anomaly it was. That
 * clamp, not the visibility handling below, is what makes the number trustworthy; visibility is a
 * policy on top of it.
 */

/** Nominal spacing between ticks. */
export const PLAYTIME_TICK_INTERVAL_MS = 1_000;

/**
 * Ceiling on a single tick's contribution, as a multiple of the nominal spacing. Two rather than
 * one because a healthy timer routinely runs a little late, and billing a punctual tick as if it
 * were late would lose real time on every one.
 */
const MAX_TICK_MULTIPLE = 2;

/**
 * Seconds that must accrue before the title total is written again.
 *
 * Sixty because playtime is read in minutes: a crash then costs the player less than one displayed
 * unit, which is the point at which a shorter interval stops buying anything. It buys a great deal
 * on the writing side — none of the three shells coalesces a steady stream of persistence writes.
 * Dev Mode is the worst of them, rewriting its whole store file synchronously on the main process
 * thread for every single value set, and Dev Mode is exactly where an author sits while working.
 */
export const PLAYTIME_TOTAL_FLUSH_SECONDS = 60;

export type PlaytimeClockDeps = {
    /** True while a playthrough is running. The same gate the autosave scheduler asks. */
    isPlaying: () => boolean;
    /** True while the window is hidden (minimised, or occluded where the platform reports it). */
    isHidden: () => boolean;
    /** Persist the title total, in seconds. Called only when the flush threshold is reached. */
    persistTotal: (seconds: number) => void;
    /** Monotonic milliseconds. Injected so tests drive time instead of waiting for it. */
    now?: () => number;
    tickIntervalMs?: number;
    flushThresholdSeconds?: number;
};

export class PlaytimeClock {
    /** Playtime inherited by this run: 0 for a new game, the save's reading after a load. */
    private seededSeconds = 0;
    /** Accrued since the last seed. The run's playtime is this plus the seed. */
    private accruedSeconds = 0;
    /** The title total as persistence last had it: read back at boot, then advanced by each write. */
    private storedTotalSeconds = 0;
    /** Accrued into the total since it was last written. The total is this plus the stored figure. */
    private unwrittenTotalSeconds = 0;
    /**
     * Whether a read of the stored total has come back for the store currently in use.
     *
     * False is the starting state and the state after {@link awaitTotalBaseline}, and it holds every
     * write: a total written before the stored figure is known is a total measured from zero.
     */
    private totalBaselineKnown = false;
    /**
     * When the last accrual happened, or null when the clock is not accruing. Null is also how a
     * resume re-anchors: the first tick after it contributes nothing rather than billing the gap.
     */
    private lastTickAt: number | null = null;

    private readonly now: () => number;
    private readonly tickIntervalMs: number;
    private readonly flushThresholdSeconds: number;

    constructor(private readonly deps: PlaytimeClockDeps) {
        this.now = deps.now ?? (() => performance.now());
        this.tickIntervalMs = deps.tickIntervalMs ?? PLAYTIME_TICK_INTERVAL_MS;
        this.flushThresholdSeconds = deps.flushThresholdSeconds ?? PLAYTIME_TOTAL_FLUSH_SECONDS;
    }

    /** The reading a save written right now would record. */
    public getRunSeconds(): number {
        return this.seededSeconds + this.accruedSeconds;
    }

    /** The title total, including time not yet written to persistence. */
    public getTotalSeconds(): number {
        return this.storedTotalSeconds + this.unwrittenTotalSeconds;
    }

    /**
     * Set the run's playtime. The three moments that call this are starting a new game (zero),
     * finishing a successful load (the save's reading), and restoring the title total at boot —
     * never a failed load, whose rollback leaves the player on the run they were already having.
     *
     * Re-anchors the clock, so however long the load itself took is not billed to anyone.
     */
    public seedRun(seconds: number): void {
        this.seededSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
        this.accruedSeconds = 0;
        this.lastTickAt = null;
    }

    /**
     * Declare that a read of the stored total is on its way, and hold writes until it arrives.
     *
     * Called once per store rather than once per boot: the runtime core is rebuilt whenever the
     * bundle or the persistence adapter changes, and a total read through the store that went away
     * says nothing about the one that replaced it.
     */
    public awaitTotalBaseline(): void {
        this.totalBaselineKnown = false;
    }

    /**
     * Install the title total read back from persistence, and let writing resume.
     *
     * The figure goes underneath whatever has accrued since boot rather than replacing the total,
     * so a read that lands late costs nothing; and it only ever moves the stored figure up, so a
     * read that lands late *and* stale — a second store answering with a number this session has
     * already written past — cannot walk it backwards either.
     */
    public seedTotal(seconds: number): void {
        if (Number.isFinite(seconds) && seconds > this.storedTotalSeconds) {
            this.storedTotalSeconds = seconds;
        }
        this.totalBaselineKnown = true;
    }

    /**
     * Settle the total with nothing to install: the store holds no total, or could not be read.
     *
     * This session then counts from zero, which is worth strictly less than refusing to count at
     * all and is the whole of the degradation. It is deliberately a separate call from
     * {@link seedTotal} rather than seeding zero, because the two differ in what they are allowed
     * to do to the store: this one is only ever reached once the store has been asked and answered.
     */
    public startTotalFromZero(): void {
        this.totalBaselineKnown = true;
    }

    /**
     * One timer tick. Accrues nothing at all unless a playthrough is running and the window is on
     * screen, and re-anchors whenever it is not, so the paused stretch cannot be billed later.
     */
    public tick(): void {
        if (!this.deps.isPlaying() || this.deps.isHidden()) {
            // Flushes on the way down so a player who stops playing does not leave the last stretch
            // sitting unwritten until they happen to play again.
            this.pause();
            return;
        }
        const at = this.now();
        if (this.lastTickAt === null) {
            this.lastTickAt = at;
            return;
        }
        const elapsedMs = Math.min(
            Math.max(0, at - this.lastTickAt),
            this.tickIntervalMs * MAX_TICK_MULTIPLE,
        );
        this.lastTickAt = at;
        const seconds = elapsedMs / 1000;
        this.accruedSeconds += seconds;
        this.unwrittenTotalSeconds += seconds;
        if (this.unwrittenTotalSeconds >= this.flushThresholdSeconds) {
            this.flush();
        }
    }

    /**
     * Stop accruing and write out what is owed.
     *
     * Called on the way to hidden as well as from {@link tick}, because a hidden window's timer is
     * throttled and may not tick at all — leaving the re-anchor to the next tick would let the whole
     * hidden stretch arrive as one (clamped, but non-zero) delta on the way back.
     */
    public pause(): void {
        this.lastTickAt = null;
        this.flush();
    }

    /**
     * Write the title total if anything is owed and the stored figure it stands on is known. Cheap
     * and idempotent when nothing is owed, and cheap and repeatable while the read is outstanding —
     * the seconds simply stay owed until it lands.
     *
     * There is deliberately no `dispose`. A stopwatch that can be switched off permanently is one
     * an effect cleanup will eventually switch off by accident: `React.StrictMode` - on in every
     * unpackaged build - mounts, tears down and remounts, and an irreversible teardown taken on the
     * throwaway pass leaves the surviving mount ticking a dead object. That is not hypothetical; it
     * is what the first version of this did, and the symptom was every save recording `0`. Stopping
     * the interval is the owner's job and `clearInterval` already does it, so nothing here needs a
     * one-way switch. Every operation on this class is repeatable.
     */
    public flush(): void {
        if (this.unwrittenTotalSeconds <= 0 || !this.totalBaselineKnown) {
            return;
        }
        // Folded in before the write, not after: what is written becomes what the store holds, so a
        // later read of it must not be added on top of these same seconds a second time.
        this.storedTotalSeconds += this.unwrittenTotalSeconds;
        this.unwrittenTotalSeconds = 0;
        this.deps.persistTotal(this.storedTotalSeconds);
    }
}
