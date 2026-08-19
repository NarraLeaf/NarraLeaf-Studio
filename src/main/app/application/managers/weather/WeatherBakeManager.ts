import fs from "fs/promises";
import path from "path";
import { Logger } from "@shared/utils/logger";
import { weatherBakeKey, type WeatherBakeIdentity } from "@shared/weather/bakeKey";
import type { WeatherBakeSpec } from "@shared/weather/model";
import type { StudioTaskPriority } from "@shared/types/studioTask";
import { resolveFfmpegBinary, type FfmpegResolveOptions, type FfmpegResolverApp } from "../media/ffmpegTool";
import type { StudioTaskScheduler } from "../tasks/StudioTaskScheduler";
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
 * ## Who decides when this runs
 *
 * Not this class. Every bake goes through the studio task scheduler, which is where "one at a
 * time", "the same work submitted twice is one task" and "speculative work yields to work someone
 * is waiting on" are decided once for all of Studio. This manager only knows how to make a clip
 * and where to keep it.
 *
 * That is what makes pre-baking work. Studio can submit a clip at `idle` while the author is still
 * choosing parameters; if they press Run a moment later the same submission arrives at `blocking`,
 * adopts the bake already in flight, and the wait is whatever was left of it.
 */

const logger = new Logger("WeatherBake");

/** Where a project keeps its baked clips, relative to the project root. */
export const WEATHER_CACHE_DIR = path.join("editor", "cache", "weather");

export type WeatherBakeRequest = {
    projectRoot: string;
    /** The clips this compile needs, in the order the author's rows mention them. */
    specs: readonly WeatherBakeSpec[];
    /**
     * Whether anyone is waiting. `blocking` is a run, a preview or a build; `idle` is Studio deciding
     * to have the clip ready before it is asked for.
     */
    priority: StudioTaskPriority;
};

export type WeatherBakeOutcome = {
    /** Absolute path per {@link weatherBakeKey}, for every clip that is now on disk. */
    paths: Map<string, string>;
    /**
     * Why a clip is missing, keyed the same way, in English.
     *
     * Per clip rather than one run-level status: one seed failing is not a reason to say nothing
     * about the two that worked, and the caller compiles with what it has.
     */
    failures: Map<string, string>;
};

export type WeatherBakeManagerOptions = FfmpegResolveOptions & {
    spawnProcess?: BakeSpawn;
};

export class WeatherBakeManager {
    constructor(
        private readonly app: FfmpegResolverApp,
        private readonly scheduler: StudioTaskScheduler,
    ) {}

    /** The absolute path a clip would be cached at, whether or not it exists yet. */
    public pathFor(projectRoot: string, identity: WeatherBakeIdentity): string {
        return path.join(projectRoot, WEATHER_CACHE_DIR, `${weatherBakeKey(identity)}.webm`);
    }

    /**
     * Make sure every requested clip is on disk, and answer with where they are.
     *
     * Never throws. A clip that could not be produced is an entry in `failures` rather than an
     * exception, because every caller is compiling something and wants the clips that did work.
     *
     * A host with no encoder fails every clip with the resolver's own sentence, which says the tool
     * is missing rather than that the seed is broken - a distinction the caller has to be able to
     * pass on.
     */
    public async ensure(
        request: WeatherBakeRequest,
        options: WeatherBakeManagerOptions = {},
    ): Promise<WeatherBakeOutcome> {
        const paths = new Map<string, string>();
        const failures = new Map<string, string>();
        const wanted = dedupe(request.specs);
        if (wanted.length === 0) {
            return { paths, failures };
        }

        // The disk is asked first, and outside the queue: a project whose weather has not changed does
        // no work at all here, and making it wait behind someone else's bake to discover that would
        // fill the queue with tasks whose only job is to answer "already done".
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
            return { paths, failures };
        }

        const tool = await resolveFfmpegBinary(this.app, "ffmpeg", options);
        if (!tool.available) {
            logger.warn(`No ffmpeg on this host, so ${missing.length} weather clip(s) were not produced: ${tool.detail}`);
            for (const item of missing) {
                failures.set(item.key, tool.detail);
            }
            return { paths, failures };
        }

        // Submitted together and awaited together. The scheduler runs them one at a time; what this
        // caller needs is every clip it asked for, not the order they arrive in.
        const results = await Promise.all(missing.map(item => this.scheduler.submit<string>({
            kind: "weatherBake",
            // The clip IS the key, so two rows, two scenes or two windows asking for the same weather
            // are one task - and a speculative submission is the same task as the awaited one.
            key: bakeTaskKey(item.key),
            priority: request.priority,
            run: async context => {
                const handle = startWeatherBake(tool.path, item.spec, item.target, {
                    ...(options.spawnProcess ? { spawnProcess: options.spawnProcess } : {}),
                    onProgress: (progress: WeatherBakeProgress) => {
                        context.report({ done: progress.frames, total: progress.total, unit: "frame" });
                    },
                });
                context.onCancel(handle.cancel);
                const result = await handle.result;
                if (result.status === "done") {
                    return result.path;
                }
                if (result.status === "cancelled") {
                    // Thrown rather than returned: a cancellation is not a clip, and the scheduler owns
                    // the vocabulary for what happened to a task.
                    throw new Error("cancelled");
                }
                // The encoder's own words go to the log rather than to the author: stream indices and
                // codec names are internal vocabulary, and a wall of it besides.
                logger.warn(`Weather clip ${item.key} was not produced: ${result.detail}`);
                logger.warn(result.stderr);
                throw new Error(result.detail);
            },
        }).then(outcome => ({ item, outcome }))));

        for (const { item, outcome } of results) {
            if (outcome.status === "done") {
                paths.set(item.key, outcome.value);
            } else {
                failures.set(item.key, outcome.status === "error" ? outcome.error : "cancelled");
            }
        }
        return { paths, failures };
    }

    /** Stop one clip, wherever it is in the queue. Whatever already landed stays on disk. */
    public cancel(spec: WeatherBakeSpec): void {
        this.scheduler.cancel(bakeTaskKey(weatherBakeKey(spec)));
    }
}

/** One namespace for the scheduler's key space, so a weather key can never collide with another kind's. */
function bakeTaskKey(key: string): string {
    return `weather:${key}`;
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
