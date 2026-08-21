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
 * ## Why two threads and not the machine
 *
 * Because the encoder is the co-tenant, and it is not a polite one: libvpx runs `-row-mt` across
 * every core it can see. A bake is the two halves in a pipeline of roughly equal cost - measured on
 * this project's own clips, drawing a 4K frame takes about as long as encoding it - so threads are
 * only worth what they recover from the pipe stall, and every one past that is taken off the
 * encoder. Measured, one 12-second clip, 24-thread machine:
 *
 * |            | 1 thread | 2 threads | 8 threads |
 * |------------|----------|-----------|-----------|
 * | 1080p snow | 10.3 s   | **6.6 s** | 12.8 s    |
 * | 4K snow    | 35.2 s   | **26.7 s**| 93.2 s    |
 *
 * Eight threads is not a smaller win, it is a rout: the drawing takes the machine away from the half
 * that was actually the wall. So the count is two, bounded further by memory (one thread at 4K holds
 * a 100 MB float accumulator) and by tiny machines.
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
 * The number that measured fastest, on every size tried.
 *
 * Not a fraction of the machine: see the table above. One thread leaves the encoder waiting whenever
 * a frame is being drawn, and more than two take the cores the encoder needed.
 */
export const WEATHER_RENDER_THREADS = 2;

export function weatherRenderThreadCount(
    spec: Pick<WeatherBakeSpec, "width" | "height" | "frames">,
    cpus: number,
    budget: number = WEATHER_RENDER_MEMORY_BUDGET,
): number {
    const byMemory = Math.floor(budget / weatherRenderThreadFootprint(spec.width, spec.height));
    // A machine with two cores has no spare one to draw on while the encoder runs.
    const byCpu = Math.floor(cpus / 2);
    return Math.max(1, Math.min(WEATHER_RENDER_THREADS, byCpu, byMemory, spec.frames));
}

/** One thread's worth of drawing: ask for a phase, get its pixels back. */
export type WeatherRenderThread = {
    render(index: number): Promise<Uint8Array>;
    close(): void;
};

export type WeatherRenderPoolOptions = {
    /** Overrides the computed count. `1` is the serial path with extra steps, which is the point. */
    threads?: number;
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
export function resolveWeatherRenderThreads(spec: WeatherBakeSpec, env: NodeJS.ProcessEnv = process.env): number {
    const override = Number.parseInt(env.NLS_WEATHER_BAKE_THREADS ?? "", 10);
    if (Number.isFinite(override) && override > 0) {
        return Math.min(override, spec.frames);
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
