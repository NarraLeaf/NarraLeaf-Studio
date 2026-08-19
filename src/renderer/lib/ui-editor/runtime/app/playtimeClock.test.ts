import { describe, expect, it } from "vitest";
import { PLAYTIME_TICK_INTERVAL_MS, PlaytimeClock } from "./playtimeClock";

function harness(overrides?: {
    playing?: boolean;
    hidden?: boolean;
    flushThresholdSeconds?: number;
    /**
     * Whether the stored total has already been read back. True by default because that is the
     * state the clock spends a session in; the tests below that pass false are the ones about the
     * window before it, where writing is held.
     */
    totalBaselineKnown?: boolean;
}) {
    const persisted: number[] = [];
    const state = {
        playing: overrides?.playing ?? true,
        hidden: overrides?.hidden ?? false,
        now: 0,
    };
    const clock = new PlaytimeClock({
        isPlaying: () => state.playing,
        isHidden: () => state.hidden,
        persistTotal: seconds => persisted.push(seconds),
        now: () => state.now,
        flushThresholdSeconds: overrides?.flushThresholdSeconds,
    });
    if (overrides?.totalBaselineKnown ?? true) {
        clock.startTotalFromZero();
    }
    /** Advance the injected clock and tick, the way the real interval would. */
    const advance = (ms: number, ticks = 1) => {
        for (let index = 0; index < ticks; index += 1) {
            state.now += ms;
            clock.tick();
        }
    };
    return { clock, persisted, state, advance };
}

describe("PlaytimeClock", () => {
    it("accrues nothing on the first tick, then one tick's worth per tick", () => {
        const { clock, advance } = harness();
        // The first tick only anchors: there is no previous tick to measure from.
        advance(PLAYTIME_TICK_INTERVAL_MS);
        expect(clock.getRunSeconds()).toBe(0);

        advance(PLAYTIME_TICK_INTERVAL_MS, 3);
        expect(clock.getRunSeconds()).toBe(3);
        expect(clock.getTotalSeconds()).toBe(3);
    });

    it("clamps a single delta, so a suspended machine bills one tick rather than the gap", () => {
        const { clock, advance } = harness();
        advance(PLAYTIME_TICK_INTERVAL_MS);
        // Eight hours between two ticks: a closed lid, a stepped clock, a throttled timer.
        advance(8 * 60 * 60 * 1000);
        expect(clock.getRunSeconds()).toBe(PLAYTIME_TICK_INTERVAL_MS * 2 / 1000);
    });

    it("never accrues backwards when the clock source goes back", () => {
        const { clock, advance, state } = harness();
        advance(PLAYTIME_TICK_INTERVAL_MS, 2);
        expect(clock.getRunSeconds()).toBe(1);

        state.now -= 60_000;
        clock.tick();
        expect(clock.getRunSeconds()).toBe(1);
    });

    it("stops while the window is hidden and does not bill the hidden stretch afterwards", () => {
        const { clock, advance, state } = harness();
        advance(PLAYTIME_TICK_INTERVAL_MS, 3);
        expect(clock.getRunSeconds()).toBe(2);

        state.hidden = true;
        advance(PLAYTIME_TICK_INTERVAL_MS, 5);
        expect(clock.getRunSeconds()).toBe(2);

        // Back on screen: the first tick re-anchors, the ones after it count again.
        state.hidden = false;
        advance(PLAYTIME_TICK_INTERVAL_MS);
        expect(clock.getRunSeconds()).toBe(2);
        advance(PLAYTIME_TICK_INTERVAL_MS, 2);
        expect(clock.getRunSeconds()).toBe(4);
    });

    it("stops while no playthrough is running", () => {
        const { clock, advance, state } = harness({ playing: false });
        advance(PLAYTIME_TICK_INTERVAL_MS, 5);
        expect(clock.getRunSeconds()).toBe(0);

        state.playing = true;
        advance(PLAYTIME_TICK_INTERVAL_MS, 3);
        expect(clock.getRunSeconds()).toBe(2);
    });

    it("seeds a run by assignment, so loading the same save twice never inflates it", () => {
        const { clock, advance } = harness();
        advance(PLAYTIME_TICK_INTERVAL_MS, 11);
        expect(clock.getRunSeconds()).toBe(10);

        clock.seedRun(600);
        expect(clock.getRunSeconds()).toBe(600);
        advance(PLAYTIME_TICK_INTERVAL_MS, 3);
        expect(clock.getRunSeconds()).toBe(602);

        clock.seedRun(600);
        expect(clock.getRunSeconds()).toBe(600);
    });

    it("leaves the title total alone when a run is re-seeded", () => {
        const { clock, advance } = harness();
        advance(PLAYTIME_TICK_INTERVAL_MS, 6);
        expect(clock.getTotalSeconds()).toBe(5);

        clock.seedRun(0);
        expect(clock.getRunSeconds()).toBe(0);
        expect(clock.getTotalSeconds()).toBe(5);
    });

    it("treats a negative or unusable run seed as a fresh run", () => {
        const { clock } = harness();
        clock.seedRun(Number.NaN);
        expect(clock.getRunSeconds()).toBe(0);
        clock.seedRun(-5);
        expect(clock.getRunSeconds()).toBe(0);
    });

    it("writes the total only once the flush threshold is reached", () => {
        const { clock, persisted, advance } = harness({ flushThresholdSeconds: 60 });
        advance(PLAYTIME_TICK_INTERVAL_MS, 60);
        expect(clock.getTotalSeconds()).toBe(59);
        expect(persisted).toEqual([]);

        advance(PLAYTIME_TICK_INTERVAL_MS);
        expect(persisted).toEqual([60]);

        // The counter resets, so the next write is another threshold away.
        advance(PLAYTIME_TICK_INTERVAL_MS, 59);
        expect(persisted).toEqual([60]);
        advance(PLAYTIME_TICK_INTERVAL_MS);
        expect(persisted).toEqual([60, 120]);
    });

    it("writes what is owed when play stops, rather than holding it until play resumes", () => {
        const { clock, persisted, advance, state } = harness({ flushThresholdSeconds: 60 });
        advance(PLAYTIME_TICK_INTERVAL_MS, 11);
        expect(persisted).toEqual([]);

        state.hidden = true;
        clock.tick();
        expect(persisted).toEqual([10]);

        // Nothing owed, so a second stop writes nothing.
        clock.tick();
        expect(persisted).toEqual([10]);
    });

    it("flushes on demand, and does not write when nothing is owed", () => {
        const { clock, persisted, advance } = harness({ flushThresholdSeconds: 60 });
        clock.pause();
        expect(persisted).toEqual([]);

        advance(PLAYTIME_TICK_INTERVAL_MS, 4);
        clock.flush();
        expect(persisted).toEqual([3]);

        clock.flush();
        expect(persisted).toEqual([3]);
    });

    // The clock has no off switch on purpose: an effect cleanup running on StrictMode's throwaway
    // mount would have thrown it, and every save afterwards recorded 0. See usePlaytime.test.
    it("keeps accruing after a flush, however the flush was reached", () => {
        const { clock, advance } = harness();
        advance(PLAYTIME_TICK_INTERVAL_MS, 3);
        clock.flush();
        clock.pause();
        advance(PLAYTIME_TICK_INTERVAL_MS, 5);
        expect(clock.getRunSeconds()).toBe(6);
    });

    it("puts a late total read back underneath the seconds accrued while it was in flight", () => {
        const { clock, advance } = harness({ totalBaselineKnown: false });
        clock.awaitTotalBaseline();
        advance(PLAYTIME_TICK_INTERVAL_MS, 21);
        // Nothing stored is known yet, so the total is only what this session has counted.
        expect(clock.getTotalSeconds()).toBe(20);

        // Neither number is thrown away: the player had an hour before this session and has twenty
        // seconds in it. Assigning would lose the twenty; ignoring would lose the hour.
        clock.seedTotal(3_600);
        expect(clock.getTotalSeconds()).toBe(3_620);
    });

    it("never lets a stale answer walk the stored total backwards", () => {
        const { clock, advance, persisted } = harness({ flushThresholdSeconds: 10 });
        advance(PLAYTIME_TICK_INTERVAL_MS, 12);
        expect(persisted).toEqual([10]);

        // A second store answering with a figure this session has already written past: adopting it
        // would subtract the difference from the title's history.
        clock.seedTotal(4);
        expect(clock.getTotalSeconds()).toBe(11);
    });

    it("writes nothing until the stored total it would stand on is known", () => {
        const { clock, persisted, advance } = harness({
            flushThresholdSeconds: 10,
            totalBaselineKnown: false,
        });
        advance(PLAYTIME_TICK_INTERVAL_MS, 30);
        // Well past the threshold, and past an explicit flush: a write here would carry a total
        // measured from zero and stand it on top of whatever the store already holds.
        clock.flush();
        expect(persisted).toEqual([]);

        clock.seedTotal(493.8);
        clock.flush();
        // The held seconds are not lost, and they are added to the stored figure rather than
        // replacing it.
        expect(persisted).toEqual([493.8 + 29]);
    });

    it("keeps counting from zero once a store has been asked and had nothing to give", () => {
        const { clock, persisted, advance } = harness({
            flushThresholdSeconds: 10,
            totalBaselineKnown: false,
        });
        advance(PLAYTIME_TICK_INTERVAL_MS, 12);
        expect(persisted).toEqual([]);

        // The documented degradation: an unreadable or empty store costs the history, not the
        // counting. What it must not do is stay silent forever.
        clock.startTotalFromZero();
        clock.flush();
        expect(persisted).toEqual([11]);
    });

    it("does not add a written total to itself when the store answers with it again", () => {
        const { clock, persisted, advance } = harness({ flushThresholdSeconds: 10 });
        advance(PLAYTIME_TICK_INTERVAL_MS, 12);
        expect(persisted).toEqual([10]);

        // A rebuilt store reads back exactly what was just written. Those seconds are already in
        // the stored figure; counting them twice would inflate the title total on every reload.
        clock.awaitTotalBaseline();
        clock.seedTotal(10);
        advance(PLAYTIME_TICK_INTERVAL_MS, 10);
        expect(clock.getTotalSeconds()).toBe(21);
        expect(persisted).toEqual([10, 20]);
    });
});
