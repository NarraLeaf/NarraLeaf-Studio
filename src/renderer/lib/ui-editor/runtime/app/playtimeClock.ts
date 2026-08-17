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
    /** Title total, seeded from persistence at boot. */
    private totalSeconds = 0;
    /** Accrued into the total since it was last written. */
    private unflushedSeconds = 0;
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
        return this.totalSeconds;
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
     * Install the title total read back from persistence.
     *
     * Ignores a value lower than what is already counted: the read is asynchronous, so a game that
     * has been playing while it was in flight would otherwise have its accrued seconds thrown away
     * by a stale number. The total only ever goes up.
     */
    public seedTotal(seconds: number): void {
        if (!Number.isFinite(seconds) || seconds <= this.totalSeconds) {
            return;
        }
        this.totalSeconds = seconds;
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
        this.totalSeconds += seconds;
        this.unflushedSeconds += seconds;
        if (this.unflushedSeconds >= this.flushThresholdSeconds) {
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
     * Write the title total if anything is owed. Cheap and idempotent when nothing is.
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
        if (this.unflushedSeconds <= 0) {
            return;
        }
        this.unflushedSeconds = 0;
        this.deps.persistTotal(this.totalSeconds);
    }
}
