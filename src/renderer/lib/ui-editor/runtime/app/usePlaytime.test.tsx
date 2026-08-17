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

import { StrictMode } from "react";
import { render, cleanup, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    function Probe() {
        runtime = usePlaytime({
            isPlaying: () => true,
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
});
