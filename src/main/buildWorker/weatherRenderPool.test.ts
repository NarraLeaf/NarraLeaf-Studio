import { describe, expect, it } from "vitest";
import type { WeatherBakeSpec } from "@shared/weather/model";
import {
    createWeatherRenderPool,
    resolveWeatherRenderThreads,
    weatherRenderThreadCount,
    weatherRenderThreadFootprint,
    WEATHER_RENDER_THREADS,
    type WeatherRenderThread,
} from "./weatherRenderPool";

/**
 * The pool's whole job is to be invisible.
 *
 * Frames drawn on several threads have to arrive in the same order, exactly once each, in bounded
 * memory - and a clip baked this way has to be the same bytes as one drawn in a loop, because the
 * cache is content-addressed and would otherwise start lying. The drawing itself is not under test
 * here: these fakes answer with a frame that says which phase it is.
 */

const SPEC: WeatherBakeSpec = { ref: { seed: "snow" }, width: 64, height: 36, fps: 30, frames: 10 };

/** Threads that answer only when the test says so, and remember everything they were asked. */
function fakeThreads() {
    const asked: number[] = [];
    const waiting: { index: number; resolve: (frame: Uint8Array) => void; reject: (error: Error) => void }[] = [];
    let closes = 0;

    const spawn = (): WeatherRenderThread => ({
        render: (index: number) => new Promise<Uint8Array>((resolve, reject) => {
            asked.push(index);
            waiting.push({ index, resolve, reject });
        }),
        close: () => { closes += 1; },
    });

    /** Answer whatever is outstanding, newest first, so nothing can pass by arriving in order. */
    const settleReversed = async (): Promise<void> => {
        const pending = waiting.splice(0, waiting.length).reverse();
        for (const item of pending) {
            item.resolve(Uint8Array.of(item.index));
        }
        await Promise.resolve();
        await Promise.resolve();
    };

    return { spawn, asked, waiting, settleReversed, closes: () => closes };
}

describe("the weather render pool", () => {
    it("hands frames over in order however the threads answer", async () => {
        const threads = fakeThreads();
        const pool = createWeatherRenderPool(SPEC, { threads: 4, spawn: threads.spawn });

        const seen: number[] = [];
        const reader = (async () => {
            for (;;) {
                const frame = await pool.next();
                if (!frame) {
                    return;
                }
                seen.push(frame[0]!);
            }
        })();
        for (let round = 0; round < 12 && threads.waiting.length > 0; round++) {
            await threads.settleReversed();
        }
        await reader;

        expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("draws every frame exactly once", async () => {
        const threads = fakeThreads();
        const pool = createWeatherRenderPool(SPEC, { threads: 3, spawn: threads.spawn });

        const reader = (async () => {
            while (await pool.next()) { /* drain */ }
        })();
        for (let round = 0; round < 12 && threads.waiting.length > 0; round++) {
            await threads.settleReversed();
        }
        await reader;

        expect([...threads.asked].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("stops drawing ahead of a reader that is not reading", async () => {
        // The encoder is the slower half often enough that an unbounded read-ahead would hold the
        // whole clip in memory - eleven gigabytes of it at 4K.
        const threads = fakeThreads();
        createWeatherRenderPool(SPEC, { threads: 2, spawn: threads.spawn });

        for (let round = 0; round < 6; round++) {
            await threads.settleReversed();
        }

        expect(threads.asked.length).toBeLessThanOrEqual(4);
    });

    it("closes every thread when the bake lets go", async () => {
        const threads = fakeThreads();
        const pool = createWeatherRenderPool(SPEC, { threads: 3, spawn: threads.spawn });

        pool.close();

        expect(threads.closes()).toBe(3);
        expect(await pool.next()).toBeNull();
    });

    it("reports a thread that died rather than handing back a short clip", async () => {
        // A truncated stream makes the encoder complain about its input, which names the wrong
        // thing entirely. The bake turns this into its own sentence.
        const threads = fakeThreads();
        const pool = createWeatherRenderPool(SPEC, { threads: 1, spawn: threads.spawn });

        const first = pool.next();
        threads.waiting.shift()?.reject(new Error("a weather render thread stopped (1)"));

        await expect(first).rejects.toThrow("a weather render thread stopped");
    });
});

describe("how many threads a bake asks for", () => {
    it("asks for two however big the machine is, because the encoder wants the rest", () => {
        // Measured rather than reasoned: eight threads made a 4K clip take 93 s where two took 27 s,
        // because libvpx runs row-mt across every core and the drawing was taking them away from it.
        expect(weatherRenderThreadCount({ width: 1280, height: 720, frames: 360 }, 24))
            .toBe(WEATHER_RENDER_THREADS);
        expect(weatherRenderThreadCount({ width: 1280, height: 720, frames: 360 }, 12))
            .toBe(WEATHER_RENDER_THREADS);
    });

    it("draws on one thread when there is no core to spare", () => {
        expect(weatherRenderThreadCount({ width: 1280, height: 720, frames: 360 }, 2)).toBe(1);
    });

    it("never asks for more than it can hold", () => {
        // One 4K thread carries a 100 MB float accumulator; a machine with cores to spare still has
        // a memory bill for them.
        const fourK = { width: 3840, height: 2160, frames: 360 };
        const budget = weatherRenderThreadFootprint(3840, 2160) * 2;
        expect(weatherRenderThreadCount(fourK, 64, budget)).toBe(2);
        expect(weatherRenderThreadCount(fourK, 64, weatherRenderThreadFootprint(3840, 2160))).toBe(1);
    });

    it("never asks for more threads than there are frames", () => {
        expect(weatherRenderThreadCount({ width: 640, height: 360, frames: 2 }, 64)).toBe(2);
        expect(weatherRenderThreadCount({ width: 640, height: 360, frames: 1 }, 64)).toBe(1);
    });

    it("lets an operator pin the count, which is how the threads were measured at all", () => {
        expect(resolveWeatherRenderThreads(SPEC, { NLS_WEATHER_BAKE_THREADS: "1" })).toBe(1);
        expect(resolveWeatherRenderThreads(SPEC, { NLS_WEATHER_BAKE_THREADS: "3" })).toBe(3);
        // Nonsense is ignored rather than obeyed: this is a measuring knob, not a way to wedge a bake.
        expect(resolveWeatherRenderThreads(SPEC, { NLS_WEATHER_BAKE_THREADS: "0" }))
            .toBe(weatherRenderThreadCount(SPEC, require("os").cpus().length));
        expect(resolveWeatherRenderThreads(SPEC, { NLS_WEATHER_BAKE_THREADS: "lots" }))
            .toBe(weatherRenderThreadCount(SPEC, require("os").cpus().length));
    });
});
