import { describe, expect, it } from "vitest";
import { LIVE_LINT_MAX_QUIET_MS, LIVE_LINT_MIN_QUIET_MS, LiveLintScheduler, quietDelayMs } from "./liveScheduler";

/** A hand-cranked clock and timer queue, so the schedule can be stepped without real time. */
function harness(sweepMs = 0) {
    let now = 0;
    let nextHandle = 1;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const sweeps: number[] = [];
    let release: (() => void) | null = null;
    let holdSweeps = false;

    const scheduler = new LiveLintScheduler({
        sweep: () => {
            sweeps.push(now);
            if (holdSweeps) {
                return new Promise<void>(resolve => {
                    release = () => {
                        now += sweepMs;
                        resolve();
                    };
                });
            }
            now += sweepMs;
            return Promise.resolve();
        },
        setTimer: (callback, ms) => {
            const handle = nextHandle++;
            timers.set(handle, { at: now + ms, callback });
            return handle;
        },
        clearTimer: handle => {
            timers.delete(handle as number);
        },
        now: () => now,
    });

    /** Move the clock on, firing every timer that falls due, and let the sweeps they start settle. */
    async function advance(ms: number): Promise<void> {
        const until = now + ms;
        for (;;) {
            const due = [...timers.entries()]
                .filter(([, timer]) => timer.at <= until)
                .sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) {
                break;
            }
            timers.delete(due[0]);
            now = Math.max(now, due[1].at);
            due[1].callback();
            await flush();
        }
        now = Math.max(now, until);
    }

    return {
        scheduler,
        sweeps,
        advance,
        hold: () => {
            holdSweeps = true;
        },
        finishSweep: async () => {
            const done = release;
            release = null;
            done?.();
            await flush();
        },
        pendingTimers: () => timers.size,
    };
}

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
    }
}

describe("quietDelayMs", () => {
    it("waits the minimum before anything has been measured", () => {
        expect(quietDelayMs(null)).toBe(LIVE_LINT_MIN_QUIET_MS);
    });

    it("waits twice as long as the last sweep took, within its bounds", () => {
        expect(quietDelayMs(10)).toBe(LIVE_LINT_MIN_QUIET_MS);
        expect(quietDelayMs(1500)).toBe(3000);
        expect(quietDelayMs(60_000)).toBe(LIVE_LINT_MAX_QUIET_MS);
    });
});

describe("LiveLintScheduler", () => {
    it("sweeps once after a burst of edits has stopped, not once per edit", async () => {
        const { scheduler, sweeps, advance } = harness();
        for (let i = 0; i < 10; i++) {
            scheduler.markChanged();
            await advance(100);
        }
        expect(sweeps).toHaveLength(0);
        await advance(LIVE_LINT_MIN_QUIET_MS);
        expect(sweeps).toHaveLength(1);
        expect(scheduler.getPhase()).toBe("idle");
        expect(scheduler.isPending()).toBe(false);
    });

    it("runs the first sweep at once when asked to", async () => {
        const { scheduler, sweeps, advance } = harness();
        scheduler.runSoon();
        await advance(0);
        expect(sweeps).toHaveLength(1);
    });

    it("lets a running sweep finish and sweeps again for an edit made during it", async () => {
        const h = harness(200);
        h.hold();
        h.scheduler.runSoon();
        await h.advance(0);
        expect(h.scheduler.getPhase()).toBe("running");

        h.scheduler.markChanged();
        expect(h.scheduler.isPending()).toBe(true);
        expect(h.sweeps).toHaveLength(1);

        await h.finishSweep();
        // The edit arrived mid-sweep, so another one is waiting - after a pause scaled to the sweep.
        expect(h.scheduler.getPhase()).toBe("waiting");
        await h.advance(quietDelayMs(200) - 1);
        expect(h.sweeps).toHaveLength(1);
        await h.advance(1);
        expect(h.sweeps).toHaveLength(2);
    });

    it("holds the schedule while a requested sweep runs, and picks up an edit made meanwhile", async () => {
        const { scheduler, sweeps, advance } = harness();
        scheduler.markChanged();
        scheduler.suspend();
        // The waiting edit is still unchecked, but nothing may run until the requested sweep is done.
        await advance(LIVE_LINT_MAX_QUIET_MS);
        expect(sweeps).toHaveLength(0);
        expect(scheduler.isPending()).toBe(true);

        scheduler.markChanged();
        scheduler.resume();
        await advance(LIVE_LINT_MIN_QUIET_MS);
        expect(sweeps).toHaveLength(1);
    });

    it("forgets what a requested sweep covered", async () => {
        const { scheduler, sweeps, advance } = harness();
        scheduler.markChanged();
        scheduler.suspend();
        // The requested sweep reads the project after this point, so the edit above is covered.
        scheduler.clearPending();
        scheduler.resume();
        await advance(LIVE_LINT_MAX_QUIET_MS);
        expect(sweeps).toHaveLength(0);
        expect(scheduler.isPending()).toBe(false);
    });

    it("stops for good when disposed", async () => {
        const { scheduler, sweeps, advance, pendingTimers } = harness();
        scheduler.markChanged();
        scheduler.dispose();
        expect(pendingTimers()).toBe(0);
        scheduler.markChanged();
        await advance(LIVE_LINT_MAX_QUIET_MS);
        expect(sweeps).toHaveLength(0);
    });
});
