// @vitest-environment jsdom
/**
 * The stopwatch has to survive the mount it is not going to keep.
 *
 * `React.StrictMode` is on in every unpackaged build (`renderApp.tsx`), so every hook in Studio
 * mounts, is torn down, and mounts again before the app is ever interactive. The first version of
 * this hook held its clock in a `useMemo` - created once, surviving both passes - and disposed it
 * from an effect cleanup, which the throwaway pass runs. The surviving mount then ticked an object
 * that had been switched off, and it did so silently: no error, no warning, a stopwatch reading
 * zero forever. Every save wrote `playtimeSeconds: 0`, and the unit tests were all green, because
 * none of them mounts React.
 *
 * It took driving the real app to find, so it gets a test that does not need one.
 */

import { StrictMode, useEffect, useState } from "react";
import { render, cleanup, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAYTIME_TOTAL_FLUSH_SECONDS } from "./playtimeClock";
import { usePlaytime, type PlaytimeRuntime } from "./usePlaytime";

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const TICK_MS = 20;

/**
 * Mount the hook and hand back a live handle to it.
 *
 * Deliberately reads the handle on every render rather than capturing the first: under StrictMode
 * the second mount's value is the one that matters, and a harness that kept the first would test
 * the pass being thrown away.
 */
function mount(options: { strict: boolean; persisted: number[] }) {
    let runtime: PlaytimeRuntime | null = null;
    const store = {};
    function Probe() {
        runtime = usePlaytime({
            isPlaying: () => true,
            persistenceSource: store,
            persistenceGetAsync: async () => undefined,
            persistenceSet: (_key, value) => options.persisted.push(value as number),
            tickIntervalMs: TICK_MS,
        });
        return null;
    }
    const tree = <Probe />;
    render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
    return () => {
        if (!runtime) {
            throw new Error("the hook never rendered");
        }
        return runtime;
    };
}

/**
 * Mount the hook wired the way `GameApp` wires it: the store arrives one commit late.
 *
 * `GameApp` reaches persistence through the blueprint runtime core, and that core is `useState`
 * that a mounting effect sets. So on the hook's own first commit there is no store — which is the
 * commit the stored total used to be read on, once, resolving to nothing every single time. This
 * harness reproduces that ordering exactly rather than handing the hook a store that was always
 * there, because a store that was always there is the one arrangement in which the defect is
 * invisible.
 */
function mountWithLateStore(options: { stored: unknown; persisted: number[]; reads: string[] }) {
    let runtime: PlaytimeRuntime | null = null;
    function Probe() {
        const [store, setStore] = useState<object | null>(null);
        useEffect(() => {
            setStore({});
        }, []);
        runtime = usePlaytime({
            isPlaying: () => true,
            persistenceSource: store,
            persistenceGetAsync: async key => {
                if (!store) {
                    return undefined;
                }
                options.reads.push(key);
                return options.stored;
            },
            persistenceSet: (_key, value) => {
                if (store) {
                    options.persisted.push(value as number);
                }
            },
            tickIntervalMs: TICK_MS,
        });
        return null;
    }
    render(<StrictMode><Probe /></StrictMode>);
    return () => {
        if (!runtime) {
            throw new Error("the hook never rendered");
        }
        return runtime;
    };
}

/** Fake-clock milliseconds that accrue the given number of seconds at `TICK_MS` per tick. */
function millisecondsFor(seconds: number): number {
    return seconds * 1000 + TICK_MS * 2;
}

describe("usePlaytime", () => {
    for (const strict of [false, true]) {
        it(`accrues while mounted${strict ? " under StrictMode" : ""}`, async () => {
            vi.useFakeTimers();
            const persisted: number[] = [];
            const get = mount({ strict, persisted });
            get().seedRun(0);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(TICK_MS * 6);
            });

            // The exact figure depends on how the fake clock and the interval line up; what this is
            // asserting is that it moved at all. Zero is the failure that shipped.
            expect(get().getRunSeconds()).toBeGreaterThan(0);
        });
    }

    it("keeps the reading a save would record across a StrictMode remount", async () => {
        vi.useFakeTimers();
        const persisted: number[] = [];
        const get = mount({ strict: true, persisted });
        get().seedRun(120);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(TICK_MS * 4);
        });

        // Inherited time is carried, not restarted: this is what a save written after a load has to
        // record, and a clock switched off by the throwaway mount would answer a flat 120.
        expect(get().getRunSeconds()).toBeGreaterThan(120);
    });

    /**
     * The title total is the one number in the game that is only ever allowed to grow. It is kept
     * out of every save file precisely so that going back to an old one cannot erase the hours that
     * led there — and a relaunch that writes the session's own seconds over it erases them anyway,
     * from the one place that was supposed to be safe.
     */
    it("never writes a title total smaller than the one already stored", async () => {
        vi.useFakeTimers();
        const persisted: number[] = [];
        const reads: string[] = [];
        const get = mountWithLateStore({ stored: 493.8, persisted, reads });
        get().seedRun(0);

        // Two crossings of the flush threshold: the defect wrote at the first and again at the
        // second, both measured from a total of zero, and the second was larger than the first -
        // so a test watching only for "it grows" would have passed on it.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(millisecondsFor(PLAYTIME_TOTAL_FLUSH_SECONDS * 2));
        });

        expect(reads.length, "the stored total was never read back").toBeGreaterThan(0);
        expect(persisted.length, "the total was never written").toBeGreaterThan(1);
        for (const written of persisted) {
            expect(written, `wrote ${written} over a stored 493.8`).toBeGreaterThan(493.8);
        }
        expect(persisted, "writes must not go backwards").toEqual([...persisted].sort((a, b) => a - b));
        expect(get().getTotalSeconds()).toBeGreaterThan(493.8);
    });

    /**
     * The degradation the hold must not swallow: a project being played for the first time has no
     * stored total, and that has to end in counting from zero rather than in never counting.
     */
    it("counts from zero, and writes, when the store has no total to give", async () => {
        vi.useFakeTimers();
        const persisted: number[] = [];
        const reads: string[] = [];
        const get = mountWithLateStore({ stored: undefined, persisted, reads });
        get().seedRun(0);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(millisecondsFor(PLAYTIME_TOTAL_FLUSH_SECONDS));
        });

        expect(reads.length).toBeGreaterThan(0);
        expect(persisted.length, "an empty store must not hold writing forever").toBeGreaterThan(0);
        expect(persisted[0]).toBeGreaterThanOrEqual(PLAYTIME_TOTAL_FLUSH_SECONDS);
    });
});
