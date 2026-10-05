/**
 * When the project is checked again by itself: after it has been edited and then left alone for a
 * moment.
 *
 * The Problems panel shows the findings of the project as it is now, not as it was the last time
 * somebody pressed a button, so every edit has to lead to a sweep. Not to one sweep per edit, though:
 * a sweep reads the whole project and a typed sentence is dozens of edits. This waits for the edits
 * to stop for a moment ({@link quietDelayMs}) and then runs one.
 *
 * Three behaviours matter:
 *
 *  - **A sweep in progress is never abandoned for an edit.** It finishes, its findings are published,
 *    and the edit that arrived meanwhile schedules the next one. Abandoning it would mean that an
 *    author who pauses for less than a sweep takes would never see a result at all; finishing it
 *    means the panel is at most one sweep behind.
 *  - **The pause scales with how long a sweep takes.** A small project is re-checked under a second
 *    after the last keystroke; a project whose sweep takes two seconds waits longer, so that its
 *    sweeps cannot fill the time the author spends typing. Nothing to configure: the measurement is
 *    the setting.
 *  - **A sweep somebody asked for comes first.** `suspend` holds the schedule while a requested
 *    sweep (the command, the build gate) runs, and `resume` picks it up again; an edit made in
 *    between is not lost, it is waiting.
 *
 * Pure scheduling: the timer and the clock are injected, so the tests drive it without a window.
 */

export type LiveLintPhase =
    /** Nothing has changed since the last sweep. */
    | "idle"
    /** The project changed; a sweep starts once it has been left alone for a moment. */
    | "waiting"
    | "running";

export interface LiveLintSchedulerOptions {
    /** One sweep. Resolves when it is over, whatever its outcome. */
    sweep: () => Promise<void>;
    onPhaseChanged?: (phase: LiveLintPhase) => void;
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    now?: () => number;
}

/** The shortest pause: long enough to cover one burst of typing, short enough to read as live. */
export const LIVE_LINT_MIN_QUIET_MS = 700;

/** The longest pause, for a project whose sweep takes seconds. Past this the panel reads as stale. */
export const LIVE_LINT_MAX_QUIET_MS = 8000;

/**
 * How long the project has to be left alone before a sweep, given how long the last one took.
 *
 * Twice the sweep, so that at most a third of the author's time can go to sweeps while they work in
 * short bursts - the yield between rules keeps the window responsive, but each rule still runs to
 * completion once started.
 */
export function quietDelayMs(lastSweepMs: number | null): number {
    if (lastSweepMs === null || !Number.isFinite(lastSweepMs)) {
        return LIVE_LINT_MIN_QUIET_MS;
    }
    return Math.min(LIVE_LINT_MAX_QUIET_MS, Math.max(LIVE_LINT_MIN_QUIET_MS, Math.round(lastSweepMs * 2)));
}

export class LiveLintScheduler {
    private readonly options: Required<Omit<LiveLintSchedulerOptions, "onPhaseChanged">> &
        Pick<LiveLintSchedulerOptions, "onPhaseChanged">;
    private phase: LiveLintPhase = "idle";
    private timer: unknown = null;
    /** A change arrived while a sweep was running, or while the schedule was suspended. */
    private dirty = false;
    private suspended = 0;
    private lastSweepMs: number | null = null;
    private disposed = false;

    public constructor(options: LiveLintSchedulerOptions) {
        this.options = {
            sweep: options.sweep,
            onPhaseChanged: options.onPhaseChanged,
            setTimer: options.setTimer ?? ((callback, ms) => setTimeout(callback, ms)),
            clearTimer: options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>)),
            now: options.now ?? (() => performance.now()),
        };
    }

    public getPhase(): LiveLintPhase {
        return this.phase;
    }

    /** Whether the findings on show may be behind the project: a change is waiting or being checked. */
    public isPending(): boolean {
        return this.phase !== "idle" || this.dirty;
    }

    /** The project changed. Restarts the pause; a running sweep is left to finish. */
    public markChanged(): void {
        if (this.disposed) {
            return;
        }
        if (this.phase === "running" || this.suspended > 0) {
            this.dirty = true;
            // Reported as pending even though nothing is scheduled yet: the panel's "checking" mark
            // has to cover an edit made while a requested sweep holds the schedule.
            this.options.onPhaseChanged?.(this.phase);
            return;
        }
        this.arm(quietDelayMs(this.lastSweepMs));
    }

    /** Sweep as soon as possible - the first sweep after the project opens. */
    public runSoon(): void {
        if (this.disposed) {
            return;
        }
        if (this.phase === "running" || this.suspended > 0) {
            this.dirty = true;
            return;
        }
        this.arm(0);
    }

    /** Hold the schedule while a requested sweep runs. Nestable; pair every call with `resume`. */
    public suspend(): void {
        this.suspended += 1;
        if (this.timer !== null) {
            this.options.clearTimer(this.timer);
            this.timer = null;
            // The change it was waiting to check is still unchecked.
            this.dirty = true;
            this.setPhase("idle");
        }
    }

    public resume(): void {
        if (this.suspended === 0) {
            return;
        }
        this.suspended -= 1;
        if (this.suspended === 0 && this.dirty && this.phase === "idle") {
            this.dirty = false;
            this.arm(quietDelayMs(this.lastSweepMs));
        }
    }

    /**
     * Forget a change that a requested sweep has just checked.
     *
     * A sweep somebody asked for reads the project as it is when it starts, so the edits that
     * suspended the schedule before it began are covered by it - only the ones that arrive while it
     * runs are not. The caller clears before the sweep starts; anything marked after that survives.
     */
    public clearPending(): void {
        this.dirty = false;
    }

    public dispose(): void {
        this.disposed = true;
        if (this.timer !== null) {
            this.options.clearTimer(this.timer);
            this.timer = null;
        }
    }

    private arm(ms: number): void {
        if (this.timer !== null) {
            this.options.clearTimer(this.timer);
        }
        this.timer = this.options.setTimer(() => {
            this.timer = null;
            void this.fire();
        }, ms);
        this.setPhase("waiting");
    }

    private async fire(): Promise<void> {
        if (this.disposed || this.suspended > 0) {
            this.dirty = true;
            this.setPhase("idle");
            return;
        }
        this.dirty = false;
        this.setPhase("running");
        const startedAt = this.options.now();
        try {
            await this.options.sweep();
        } catch {
            // The sweep reports its own failure; the schedule only needs to carry on.
        } finally {
            this.lastSweepMs = this.options.now() - startedAt;
        }
        if (this.disposed) {
            return;
        }
        if (this.dirty && this.suspended === 0) {
            this.dirty = false;
            this.arm(quietDelayMs(this.lastSweepMs));
            return;
        }
        this.setPhase("idle");
    }

    private setPhase(phase: LiveLintPhase): void {
        this.phase = phase;
        this.options.onPhaseChanged?.(phase);
    }
}
