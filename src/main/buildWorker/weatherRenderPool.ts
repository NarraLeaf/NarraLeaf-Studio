import os from "os";
import { Worker } from "worker_threads";
import type { WeatherBakeSpec } from "@shared/weather/model";
import type { WeatherFrameSequence } from "@/app/application/managers/weather/weatherBake";

/**
 * Drawing one clip's frames on several threads at once.
 *
 * ## Why this is allowed to exist
 *
 * A frame is a pure function of its phase: the renderer zeroes its accumulator at the top of every
 * frame, and the only other state it keeps is scratch. So frame 200 does not need frame 199, and the
 * serial loop that drew them one after another was leaving a 24-thread machine idle behind a single
 * thread's arithmetic - measured at ~40 ms a frame for 1080p, which is most of a 12-second clip's
 * wall time, and four times that at 4K.
 *
 * ## What it is not allowed to change
 *
 * The frames. Each thread builds its own field from the same seed and parameters, which is
 * deterministic, and renders whichever phases it is handed; the pool's whole job is to put them back
 * in order. `weather.test.ts` pins the property this rests on - the renderer answers the same pixels
 * for a phase whatever order the phases are asked in - and the tests below pin the other half, that
 * every frame is drawn exactly once and delivered in order.
 *
 * Not the FILE, though, and it is worth knowing why the obvious check does not work: encoding the
 * same input twice with our own arguments produces two different files. libvpx with `-row-mt`
 * decides some of its work by thread scheduling, so a clip's bytes were never reproducible and
 * comparing two bakes' hashes proves nothing about this pool. What the cache addresses is the
 * key - seed, parameters, size, renderer version - and every clip that key names looks the same.
 *
 * ## How many threads are worth having
 *
 * The bake is a two-stage pipeline, and threads buy back **only the drawing half**:
 *
 *     wall clock ~= max(draw one frame / threads, encode one frame) x frames
 *
 * So the count that pays is the one where the drawing stops being the wall, and every thread past
 * that is free and useless. That ratio is the whole rule, and it moves with both halves - a seed
 * whose particles are expensive to draw wants more threads, and an encoder tier that is cheap
 * (`draft`) makes the drawing the wall for longer.
 *
 * Measured on this machine (24 cores), one 12-second clip at 1080p60 - 720 frames - taking the
 * faster of two passes, with a single-thread render benchmark before and after each row to prove the
 * machine was not busy with something else:
 *
 * |                | 1     | 2     | 3     | 4        | 6     | 8     |
 * |----------------|-------|-------|-------|----------|-------|-------|
 * | snow, draft    | 10.2s | 6.8s  | 5.0s  | **4.4s** | 3.8s  | 3.8s  |
 * | snow, final    | 11.9s | 10.2s | 10.0s | 9.9s     | 9.8s  | 9.7s  |
 * | sakura, draft  | 22.8s | 12.5s | 8.9s  | 7.2s     | 5.3s  | 4.5s  |
 * | sakura, final  | 23.5s | 13.7s | 10.5s | 10.8s    | 10.4s | 10.4s |
 *
 * Each row turns over exactly where the ratio says it should: `snow, final` is encoder-bound at one
 * thread already (9.6 ms to draw against 13.5 ms to encode), `sakura, final` at two, `snow, draft`
 * at between two and three, and `sakura, draft` - the expensive seed against the cheap encoder - not
 * until about six.
 *
 * ## Why the old answer was two, and why it is not any more
 *
 * The previous constant was 2, on a measurement that had eight threads making a 4K clip take 93 s
 * where two took 27 s. That was real, and it was a measurement of a **different encoder**: every
 * bake then ran `-deadline good -cpu-used 2`, which spreads `-row-mt` across every core it can see,
 * so a third drawing thread was taken directly off the encoder. Dev Mode now bakes at `draft`
 * (`-deadline realtime -cpu-used 4`), which wants far fewer cores, and the contention that made the
 * old number right is mostly gone: nothing in the table above is slower at 8 than at 2, including
 * the two rows that still use the slow encoder.
 *
 * ## Why the automatic answer is four rather than six or eight
 *
 * Two reasons, and neither is the curve: the curve would say six.
 *
 * The first is that four is the largest stop the settings offer, so the automatic answer can never
 * land somewhere the author cannot also choose. A setting whose automatic value is off the end of
 * its own list is one nobody can reason about.
 *
 * The second is that the region past four is exactly where the old 4K rout lived, and the machine
 * this was measured on is a large one. Four is inside every measurement anyone has taken here, and
 * it is still most of the win: it is the whole of it for both `final` rows, and 4.4s against a best
 * of 3.8s for `snow, draft`.
 *
 * Four was checked at 4K too, because that is the size the rout was found at - sakura, 240 frames,
 * the expensive seed:
 *
 * |                | 1     | 2     | 4         |
 * |----------------|-------|-------|-----------|
 * | 4K, draft      | 31.9s | 17.4s | **10.4s** |
 * | 4K, final      | 31.4s | 18.9s | **13.4s** |
 *
 * Strictly better at four than at two on both tiers, including the one that still runs the
 * core-hungry encoder. Six and eight at 4K were not measured to a conclusion - a run at those counts
 * was still going after forty minutes, which is itself worth knowing and is a reason to stay under
 * them rather than a number to put in a table.
 */

/** Bytes one render thread holds: the float accumulator, its own frame, and the copy in flight. */
export function weatherRenderThreadFootprint(width: number, height: number): number {
    const pixels = width * height;
    return pixels * 3 * Float32Array.BYTES_PER_ELEMENT + pixels * 4 * 2;
}

/**
 * How much memory the drawing half of a bake may take.
 *
 * Generous because it is transient and lives in a process that exits when the clip is done, but
 * bounded because "one thread per core" at 4K would be two and a half gigabytes for a background job
 * the author did not ask for.
 */
export const WEATHER_RENDER_MEMORY_BUDGET = 1024 * 1024 * 1024;

/**
 * The most threads the automatic answer will ask for. See the tables above for why it is this.
 *
 * A ceiling rather than the answer: what a bake actually gets is this bounded by the machine's spare
 * cores, by memory, and by the clip's own length.
 */
export const WEATHER_RENDER_THREADS = 4;

export function weatherRenderThreadCount(
    spec: Pick<WeatherBakeSpec, "width" | "height" | "frames">,
    cpus: number,
    budget: number = WEATHER_RENDER_MEMORY_BUDGET,
): number {
    return clampWeatherRenderThreads(WEATHER_RENDER_THREADS, spec, cpus, budget);
}

/**
 * Bring a wanted count down to what this machine and this clip can actually take.
 *
 * Applied to an author's explicit choice as well as to the automatic one, and deliberately: the
 * stops in the settings are small, but the clip is not - a project whose stage is 4K holds a 166 MB
 * accumulator per thread, and a choice made once on a 1080p project follows the author to the next
 * one.
 */
function clampWeatherRenderThreads(
    wanted: number,
    spec: Pick<WeatherBakeSpec, "width" | "height" | "frames">,
    cpus: number,
    budget: number,
): number {
    const byMemory = Math.floor(budget / weatherRenderThreadFootprint(spec.width, spec.height));
    // A machine with two cores has no spare one to draw on while the encoder runs.
    const byCpu = Math.floor(cpus / 2);
    return Math.max(1, Math.min(wanted, byCpu, byMemory, spec.frames));
}

/** One thread's worth of drawing: ask for a phase, get its pixels back. */
export type WeatherRenderThread = {
    render(index: number): Promise<Uint8Array>;
    close(): void;
};

export type WeatherRenderPoolOptions = {
    /**
     * What the author asked for: a count, or `null` for "read the machine".
     *
     * A count is still clamped by memory, cores and the clip's own length - see
     * {@link clampWeatherRenderThreads}. `1` is the serial path with extra steps, which is the point.
     */
    threads?: number | null;
    /** Injected by tests. The default forks a real worker thread. */
    spawn?: (spec: WeatherBakeSpec) => WeatherRenderThread;
};

/**
 * The thread count this host will actually use, honouring the override an operator can set.
 *
 * `NLS_WEATHER_BAKE_THREADS` exists to answer "how much did the threads buy" without rebuilding:
 * bake once with `1` and once without, and compare. It is also the escape hatch if a host turns out
 * to be unable to fork threads at all.
 */
export function resolveWeatherRenderThreads(
    spec: WeatherBakeSpec,
    requested: number | null = null,
    env: NodeJS.ProcessEnv = process.env,
): number {
    const override = Number.parseInt(env.NLS_WEATHER_BAKE_THREADS ?? "", 10);
    if (Number.isFinite(override) && override > 0) {
        return Math.min(override, spec.frames);
    }
    if (requested !== null) {
        return clampWeatherRenderThreads(requested, spec, os.cpus().length, WEATHER_RENDER_MEMORY_BUDGET);
    }
    return weatherRenderThreadCount(spec, os.cpus().length);
}

/**
 * Frames in order, drawn by `threads` of them at once.
 *
 * Two rules keep the memory bounded. A thread is handed its next frame only once it has answered for
 * the last one, and no frame is started while more than `threads + 2` are already drawn and waiting
 * to be written - the encoder is the slower half often enough that an unbounded read-ahead would
 * hold the whole clip in memory, which at 4K is eleven gigabytes.
 */
export function createWeatherRenderPool(
    spec: WeatherBakeSpec,
    options: WeatherRenderPoolOptions = {},
): WeatherFrameSequence {
    const spawn = options.spawn ?? spawnWeatherRenderThread;
    // An explicit count wins outright, including over the environment override: it is what a caller
    // that has already resolved the author's choice hands in, and what a test pins.
    const count = Math.max(1, Math.min(options.threads ?? resolveWeatherRenderThreads(spec), spec.frames));
    const threads = Array.from({ length: count }, () => spawn(spec));
    const idle = [...threads];
    const ready = new Map<number, Uint8Array>();
    // Enough to keep every thread busy across one write that parks on drain, and no more: a frame
    // at 4K is 33 MB, so read-ahead is measured in hundreds of megabytes.
    const window = count + 2;

    let assigned = 0;
    let delivered = 0;
    let inFlight = 0;
    let closed = false;
    let failure: Error | null = null;
    let wake: (() => void) | null = null;

    const announce = (): void => {
        const resume = wake;
        wake = null;
        resume?.();
    };

    const fill = (): void => {
        while (!closed && !failure && idle.length > 0 && assigned < spec.frames && ready.size + inFlight < window) {
            const thread = idle.pop();
            if (!thread) {
                return;
            }
            const index = assigned;
            assigned += 1;
            inFlight += 1;
            thread.render(index).then(
                frame => {
                    inFlight -= 1;
                    if (closed) {
                        return;
                    }
                    ready.set(index, frame);
                    idle.push(thread);
                    fill();
                    announce();
                },
                (error: unknown) => {
                    inFlight -= 1;
                    failure ??= error instanceof Error ? error : new Error(String(error));
                    announce();
                },
            );
        }
    };

    const close = (): void => {
        if (closed) {
            return;
        }
        closed = true;
        ready.clear();
        for (const thread of threads) {
            thread.close();
        }
        announce();
    };

    fill();

    return {
        next: async () => {
            for (;;) {
                if (failure) {
                    throw failure;
                }
                if (closed) {
                    return null;
                }
                const frame = ready.get(delivered);
                if (frame) {
                    ready.delete(delivered);
                    delivered += 1;
                    fill();
                    return frame;
                }
                if (delivered >= spec.frames) {
                    return null;
                }
                await new Promise<void>(resolve => {
                    wake = resolve;
                });
            }
        },
        close,
    };
}

/**
 * One render thread, running this same bundle with `workerData` set.
 *
 * The bundle rather than a second entry point because there is only one file to build and register,
 * and registering a worker is the step this project has now forgotten three times. `weatherWorker.ts`
 * reads {@link WEATHER_RENDER_THREAD_DATA} out of `workerData` and becomes a renderer instead of a
 * bake host.
 */
export const WEATHER_RENDER_THREAD_DATA = "weatherRenderSpec" as const;

function spawnWeatherRenderThread(spec: WeatherBakeSpec): WeatherRenderThread {
    const worker = new Worker(__filename, { workerData: { [WEATHER_RENDER_THREAD_DATA]: spec } });
    let pending: { resolve: (frame: Uint8Array) => void; reject: (error: Error) => void } | null = null;
    const fail = (error: Error): void => {
        const waiting = pending;
        pending = null;
        waiting?.reject(error);
    };

    worker.on("message", (message: { index: number; frame: Uint8Array }) => {
        const waiting = pending;
        pending = null;
        waiting?.resolve(message.frame);
    });
    worker.on("error", error => fail(error instanceof Error ? error : new Error(String(error))));
    worker.on("exit", code => fail(new Error(`a weather render thread stopped (${code})`)));
    // Nothing is waiting on this thread between frames, and an idle one must not hold the process
    // open if the bake is abandoned.
    worker.unref();

    return {
        render: index => new Promise<Uint8Array>((resolve, reject) => {
            pending = { resolve, reject };
            worker.postMessage({ index });
        }),
        close: () => {
            void worker.terminate();
        },
    };
}
