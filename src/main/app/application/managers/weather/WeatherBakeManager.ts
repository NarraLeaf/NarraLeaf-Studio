import fs from "fs/promises";
import path from "path";
import { Logger } from "@shared/utils/logger";
import { weatherBakeKey, type WeatherBakeIdentity } from "@shared/weather/bakeKey";
import type { WeatherBakeSpec } from "@shared/weather/model";
import { resolveFfmpegBinary, type FfmpegResolveOptions, type FfmpegResolverApp } from "../media/ffmpegTool";
import { startWeatherBake, type BakeSpawn, type WeatherBakeProgress } from "./weatherBake";

/**
 * The clips a project's weather seeds describe, produced once and then found.
 *
 * ## Why this is a cache and not a library
 *
 * A baked clip is a build product. The author chose a seed and moved some sliders; the file that
 * comes out of that is derived, reproducible from the document alone, and must never appear among
 * the things they imported — the asset library holds what an author brought, and filling it with
 * files they did not put there would be a second, parallel idea of what a project contains.
 *
 * So it lives under the project's `editor/cache/`, which version control already excludes, and it
 * obeys that directory's rule exactly: **deleting it costs time, never work.** Everything needed to
 * make it again is in the story document.
 *
 * ## Why the key is the whole description
 *
 * Content-addressing is what removes the preset matrix. There is no list of "snow at four densities"
 * anywhere, because the author's own numbers ARE the key: bake what this project asks for, find it
 * next time, and carry only what is used. {@link weatherBakeKey} folds in the renderer's version too
 * — the code that draws the frames is as much an input to the pixels as any slider.
 *
 * ## What a caller gets while it waits
 *
 * One snapshot for the whole run, not one per clip. The author is not waiting for "clip 2 of 3";
 * they are waiting for the weather in their project, and a readout that resets its bar three times
 * describes the implementation rather than the wait. The counters are honest about both halves:
 * which clip of how many, and the encoder's own frame counter within it.
 */

const logger = new Logger("WeatherBake");

/** Where a project keeps its baked clips, relative to the project root. */
export const WEATHER_CACHE_DIR = path.join("editor", "cache", "weather");

export type WeatherBakeRunSnapshot = {
    status: "idle" | "baking" | "done" | "error" | "unavailable" | "cancelled";
    /** Which clip this run is on, 1-based, and how many it has to make. Both zero while idle. */
    clip: number;
    clips: number;
    /** The encoder's frame counter within the current clip, and that clip's total. */
    frames: number;
    totalFrames: number;
    /** One sentence, for a caller that has to say why nothing came back. */
    error?: string;
};

export type WeatherBakeRequest = {
    projectRoot: string;
    /** The clips this compile needs, in the order the author's rows mention them. */
    specs: readonly WeatherBakeSpec[];
};

export type WeatherBakeOutcome = {
    /** Absolute path per {@link weatherBakeKey}, for every clip that is now on disk. */
    paths: Map<string, string>;
    snapshot: WeatherBakeRunSnapshot;
};

export type WeatherBakeManagerOptions = FfmpegResolveOptions & {
    spawnProcess?: BakeSpawn;
    /** Called on every snapshot change; the status bar reads this. */
    onChanged?: (snapshot: WeatherBakeRunSnapshot) => void;
};

const IDLE: WeatherBakeRunSnapshot = { status: "idle", clip: 0, clips: 0, frames: 0, totalFrames: 0 };

export class WeatherBakeManager {
    private snapshot: WeatherBakeRunSnapshot = IDLE;
    private cancelCurrent: (() => void) | null = null;

    constructor(private readonly app: FfmpegResolverApp) {}

    public getSnapshot(): WeatherBakeRunSnapshot {
        return this.snapshot;
    }

    /** The absolute path a clip would be cached at, whether or not it exists yet. */
    public pathFor(projectRoot: string, identity: WeatherBakeIdentity): string {
        return path.join(projectRoot, WEATHER_CACHE_DIR, `${weatherBakeKey(identity)}.webm`);
    }

    /**
     * Make sure every requested clip is on disk, and answer with where they are.
     *
     * Sequential rather than parallel: one bake already occupies the machine — the renderer runs
     * inside the encoder's own wait — so a second in parallel would contend for the same cores and
     * finish neither sooner. It also keeps the readout meaningful, since "clip 2 of 3" only means
     * something when there is one clip in flight.
     *
     * Never throws. A host with no ffmpeg answers `unavailable` and an empty map, which is a
     * different sentence from "this seed is broken" and has to stay one.
     */
    public async ensure(
        request: WeatherBakeRequest,
        options: WeatherBakeManagerOptions = {},
    ): Promise<WeatherBakeOutcome> {
        const paths = new Map<string, string>();
        const wanted = dedupe(request.specs);
        if (wanted.length === 0) {
            return { paths, snapshot: this.publish(IDLE, options) };
        }

        // Ask the disk first. A project that has not changed its weather since the last build does no
        // work at all here, which is the point of keying on the description.
        const missing: { spec: WeatherBakeSpec; key: string; target: string }[] = [];
        for (const spec of wanted) {
            const key = weatherBakeKey(spec);
            const target = this.pathFor(request.projectRoot, spec);
            if (await exists(target)) {
                paths.set(key, target);
            } else {
                missing.push({ spec, key, target });
            }
        }
        if (missing.length === 0) {
            return { paths, snapshot: this.publish(IDLE, options) };
        }

        const tool = await resolveFfmpegBinary(this.app, "ffmpeg", options);
        if (!tool.available) {
            logger.warn(`No ffmpeg on this host, so ${missing.length} weather clip(s) were not produced: ${tool.detail}`);
            return { paths, snapshot: this.publish({ ...IDLE, status: "unavailable", error: tool.detail }, options) };
        }

        let index = 0;
        for (const item of missing) {
            index += 1;
            this.publish({
                status: "baking",
                clip: index,
                clips: missing.length,
                frames: 0,
                totalFrames: item.spec.frames,
            }, options);

            const handle = startWeatherBake(tool.path, item.spec, item.target, {
                ...(options.spawnProcess ? { spawnProcess: options.spawnProcess } : {}),
                onProgress: (progress: WeatherBakeProgress) => {
                    // Dropped once the run has moved on: the progress pipe can deliver a buffered
                    // block after the process has already closed, and it must not reopen a clip the
                    // readout has finished with.
                    if (this.snapshot.status === "baking" && this.snapshot.clip === index) {
                        this.publish({ ...this.snapshot, frames: progress.frames, totalFrames: progress.total }, options);
                    }
                },
            });
            this.cancelCurrent = handle.cancel;
            const result = await handle.result;
            this.cancelCurrent = null;

            if (result.status === "done") {
                paths.set(item.key, result.path);
                continue;
            }
            if (result.status === "cancelled") {
                return { paths, snapshot: this.publish({ ...IDLE, status: "cancelled" }, options) };
            }
            // The encoder's own words go to the log rather than to the author: they are stream
            // indices and codec names, which is internal vocabulary and a wall of it besides. What
            // the caller gets is one sentence it can put in front of someone.
            logger.warn(`Weather clip ${item.key} was not produced: ${result.detail}\n${result.stderr}`);
            return {
                paths,
                snapshot: this.publish({ ...IDLE, status: "error", error: result.detail }, options),
            };
        }

        return { paths, snapshot: this.publish({ ...IDLE, status: "done" }, options) };
    }

    /** Stop the clip in flight. The run reports `cancelled` and keeps whatever it had already landed. */
    public cancel(): void {
        this.cancelCurrent?.();
    }

    private publish(snapshot: WeatherBakeRunSnapshot, options: WeatherBakeManagerOptions): WeatherBakeRunSnapshot {
        this.snapshot = snapshot;
        options.onChanged?.(snapshot);
        return snapshot;
    }
}

/**
 * One entry per distinct clip.
 *
 * Two rows asking for the same weather at the same size are one bake — an author who writes
 * `/vfx snow` in nine scenes should wait for one clip, not nine — and the key is exactly the test for
 * "the same", since it is derived from everything that decides the pixels.
 */
function dedupe(specs: readonly WeatherBakeSpec[]): WeatherBakeSpec[] {
    const seen = new Set<string>();
    const out: WeatherBakeSpec[] = [];
    for (const spec of specs) {
        const key = weatherBakeKey(spec);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(spec);
        }
    }
    return out;
}

async function exists(target: string): Promise<boolean> {
    return fs.stat(target).then(stat => stat.isFile() && stat.size > 0).catch(() => false);
}
