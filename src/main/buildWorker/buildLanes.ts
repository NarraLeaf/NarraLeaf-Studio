import os from "os";

/**
 * Running a build's per-file work several files at a time.
 *
 * The asset passes ahead of a production build - images through Chromium's WebP encoder, sound
 * through FFmpeg - are each a long list of independent jobs, and each job keeps one core busy. Run
 * one at a time, a project of a few hundred sprites or a few thousand voice lines leaves every other
 * core idle for minutes: measured on a real 500 MB project, 506 images took 51 seconds at 1.3 cores
 * out of 24. Nothing about one file's encode depends on another's, so the only things that bound how
 * many may run together are the machine's cores and the memory each job holds.
 *
 * Both are read from the machine rather than asked of the author. How many encodes a build can
 * afford is not something a person can answer from a settings page - it depends on the hardware the
 * build happens to run on - and getting it wrong costs nothing they would see except time.
 */

/**
 * How many jobs may be in flight at once: one per core, less the one the process feeding them needs,
 * and never more than `ceiling`.
 *
 * The ceiling belongs to the caller because each pass knows what one of its lanes costs - a Chromium
 * page, an FFmpeg process - and past some point another one buys contention rather than throughput.
 */
export function buildLaneCount(ceiling: number, cpus: number = availableCores()): number {
    return Math.max(1, Math.min(ceiling, cpus - 1));
}

/**
 * {@link buildLaneCount}, unless the environment names a count.
 *
 * The variable exists so that "how much did the lanes buy" can be answered by building twice -
 * once with `1` - without rebuilding Studio, and as the way out if a host turns out not to cope with
 * several encoders at once. It is not a setting and nothing in the interface mentions it.
 */
export function resolveBuildLanes(
    variable: string,
    ceiling: number,
    env: NodeJS.ProcessEnv = process.env,
): number {
    const override = Number.parseInt(env[variable] ?? "", 10);
    if (Number.isFinite(override) && override > 0) {
        return override;
    }
    return buildLaneCount(ceiling);
}

/**
 * The most pieces a zip compresses at once (see parallelZip). Higher than the asset passes' ceilings
 * because a lane here is a zlib call on a thread, not a renderer or a process: it costs a megabyte of
 * input and the output it makes.
 */
export const ARCHIVE_LANE_CEILING = 16;

/**
 * The most threads the shipped-content audit reads a sealed package back on. Each holds one entry
 * whole while it proves it, and on a 1.5 GB package eight came within half a second of sixteen.
 */
export const SEALED_PROBE_LANE_CEILING = 8;

/**
 * How many threads the packaging worker's libuv pool should have, for its environment at fork time.
 *
 * zlib's asynchronous calls run on that pool, and it has four threads unless `UV_THREADPOOL_SIZE`
 * says otherwise before the process starts - so without this a zip's lanes would queue for four
 * threads. Four more than the lanes, so the reads feeding them and every other file operation in the
 * worker never wait behind a compression.
 */
export function packagingThreadPoolSize(cpus: number = availableCores()): number {
    return Math.max(4, buildLaneCount(ARCHIVE_LANE_CEILING, cpus) + 4);
}

function availableCores(): number {
    return typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
}

/**
 * Run `job` over `items`, at most `lanes` at a time, starting them in order.
 *
 * `stop` is asked before each item starts, never while one is running: a job that has begun is
 * allowed to finish, so whatever it writes is written whole. The first job to fail stops any more
 * from starting; the ones already running are waited for, and then that first failure is thrown -
 * so the caller's cleanup never runs underneath a job that is still using what it cleans up.
 */
export async function forEachInLanes<T>(
    items: readonly T[],
    lanes: number,
    job: (item: T, index: number) => Promise<void>,
    stop?: () => boolean,
): Promise<void> {
    let next = 0;
    // A holder rather than a plain local: it is written inside the lanes, which the compiler cannot
    // follow, and a bare `let` would still read as unset after they have all finished.
    const failure: { failed: boolean; error: unknown } = { failed: false, error: undefined };
    const lane = async (): Promise<void> => {
        while (!failure.failed && next < items.length) {
            if (stop?.()) {
                return;
            }
            const index = next;
            next += 1;
            try {
                await job(items[index], index);
            } catch (error) {
                if (!failure.failed) {
                    failure.failed = true;
                    failure.error = error;
                }
            }
        }
    };
    const count = Math.max(1, Math.min(lanes, items.length));
    await Promise.all(Array.from({ length: count }, lane));
    if (failure.failed) {
        throw failure.error;
    }
}

/**
 * A way for jobs that share a key to take turns, while jobs with different keys run as they like.
 *
 * The asset passes key their caches by the source bytes, so two library entries holding the same
 * file - an import made twice, a sound effect copied under a second name - are one cache entry. Run
 * one at a time, the second simply finds what the first wrote. Run side by side, both would miss the
 * cache, both would write the same entry, and the slower would find its target taken and record the
 * file as one that cannot be compressed. Taking turns per key gives back the serial answer: the
 * second waits, then finds the first one's result.
 */
export function createKeyedTurns(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
    const last = new Map<string, Promise<void>>();
    return async <T>(key: string, task: () => Promise<T>): Promise<T> => {
        const previous = last.get(key) ?? Promise.resolve();
        const run = previous.then(task);
        const settled = run.then(() => undefined, () => undefined);
        last.set(key, settled);
        try {
            return await run;
        } finally {
            if (last.get(key) === settled) {
                last.delete(key);
            }
        }
    };
}

/**
 * A budget of bytes that jobs reserve before they hold the memory and give back after.
 *
 * Grants are first come, first served: a large job at the head of the queue waits for room rather
 * than being overtaken indefinitely by small ones. A job larger than the whole budget is not refused
 * - it is let in once nothing else holds any, so it runs alone, which is exactly what a build that
 * did one file at a time would have done with it.
 */
export class MemoryBudget {
    private used = 0;
    private readonly waiting: Array<{ bytes: number; grant: () => void }> = [];

    constructor(private readonly capacity: number) {}

    /** Resolves once `bytes` are reserved, with the function that returns them. */
    async reserve(bytes: number): Promise<() => void> {
        const amount = Math.max(0, bytes);
        if (this.waiting.length === 0 && this.fits(amount)) {
            this.used += amount;
            return this.releaser(amount);
        }
        await new Promise<void>(resolve => {
            this.waiting.push({ bytes: amount, grant: resolve });
        });
        return this.releaser(amount);
    }

    private fits(bytes: number): boolean {
        return this.used === 0 || this.used + bytes <= this.capacity;
    }

    private releaser(bytes: number): () => void {
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            this.used -= bytes;
            this.drain();
        };
    }

    private drain(): void {
        while (this.waiting.length > 0 && this.fits(this.waiting[0].bytes)) {
            const head = this.waiting.shift()!;
            this.used += head.bytes;
            head.grant();
        }
    }
}
