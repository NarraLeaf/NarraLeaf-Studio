import type { App } from "@/app/app";
import { projectDistrustedRefusal } from "../../utils/projectTrustGate";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { Logger } from "@shared/utils/logger";
import { weatherBakeKey, type WeatherBakeIdentity } from "@shared/weather/bakeKey";
import type { WeatherBakeQuality, WeatherBakeSpec } from "@shared/weather/model";
import type { StudioTaskClaim, StudioTaskPriority } from "@shared/types/studioTask";
import { resolveFfmpegBinary, type FfmpegResolveOptions, type FfmpegResolverApp } from "../media/ffmpegTool";
import type { StudioTaskScheduler } from "../tasks/StudioTaskScheduler";
import type { WeatherBakeHandle, WeatherBakeProgress } from "./weatherBake";
import { startWeatherBakeInWorker, type WeatherBakeWorkerHostApp } from "./weatherBakeWorker";

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
 *
 * ## Where the work happens
 *
 * Not here. A bake draws its own frames in JavaScript - 8 MB of them, sixty times a second of clip -
 * and doing that on the main process cut the smallest IPC round trip from 0.2 ms to 39.6 ms for the
 * whole minute it takes, which is what turned a Dev Mode reload from 30 ms into fifteen seconds. So
 * every bake is forked into a utility process ({@link startWeatherBakeInWorker}); this class decides
 * WHAT to make and where to keep it, and holds a handle to the process making it.
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
    /**
     * How good the clips have to be, and therefore how long they take.
     *
     * Read as a **floor, not an equality**: a request for `draft` is satisfied by a `final` clip
     * that is already on disk, because a better answer to the same question is still an answer. The
     * reverse is not true, which is the entire point - a build must never be handed the copy some
     * Dev Mode session made in a hurry.
     *
     * Stated by every caller. A default here would be a default for `bakeWeatherClipsForPack`, and
     * the way that goes wrong is a shipped game whose weather is quietly the draft.
     */
    quality: WeatherBakeQuality;
    /**
     * How many threads may draw this clip's frames, or `null` to read the machine.
     *
     * Not part of the clip and not part of the cache key: a frame is a pure function of its phase,
     * so the same spec drawn on one thread and on four is the same picture. It rides on the request
     * only because the setting lives in Studio and the drawing happens two processes away.
     */
    threads: number | null;
    /**
     * Who is asking, for a caller whose mind is made up only until the next keystroke.
     *
     * `specs` is then read as the WHOLE of what that owner wants: anything it asked for on an earlier
     * attempt and does not name here stops being wanted, and is dropped unless somebody else wants it
     * too. This is what keeps a parameter typed digit by digit from leaving a queue of bakes for the
     * numbers it passed through - see {@link StudioTaskClaim}.
     *
     * Left out by callers that cannot abandon their ask. A build wants its clips until it has them.
     */
    claim?: StudioTaskClaim;
};

/**
 * The weather callers that are allowed to change their minds, named in one place.
 *
 * An owner is a bare string, and the two sides of a supersession have to spell it identically or the
 * retirement silently reaches nothing - a failure that looks exactly like the feature not existing.
 * Per project rather than per window, because the scheduler is one per app: two windows open on the
 * same project want the same clips, and it is the project that changed its mind about them.
 */
export const WeatherBakeOwner = {
    /** Studio having the clips ready before anyone asks. One settle pass supersedes the last. */
    prebake: (projectRoot: string): string => `weather:prebake:${projectRoot}`,
    /** What a Dev Mode session's current compile needs. A reload makes that a different compile. */
    devMode: (projectRoot: string): string => `weather:devMode:${projectRoot}`,
    /**
     * One compile's clips, for a preview, a test run or a build.
     *
     * Unique per call, unlike the two above, and that is the point: those two exist so that a LATER
     * ask retires an earlier one from the same source, which is right for a pre-baker watching a
     * document and wrong here. A preview and a build of the same project are two separate asks and
     * both want their clips; neither may retire the other by starting.
     */
    pack: (): string => `weather:pack:${crypto.randomUUID()}`,
} as const;

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

/**
 * How a clip gets made, so a test can watch one without an encoder or a worker.
 *
 * The default forks a utility process. It is injectable rather than mocked at the module boundary
 * because the seam is the point: what this manager promises is a handle - frames on the way out, one
 * cancel on the way in - and anything that keeps that promise is a bake as far as it is concerned.
 */
export type WeatherBakeStarter = (
    binaryPath: string,
    spec: WeatherBakeSpec,
    targetPath: string,
    options: {
        quality: WeatherBakeQuality;
        threads: number | null;
        onProgress?: (progress: WeatherBakeProgress) => void;
    },
) => WeatherBakeHandle;

export type WeatherBakeManagerOptions = FfmpegResolveOptions & {
    startBake?: WeatherBakeStarter;
};

export class WeatherBakeManager {
    constructor(
        // `projectTrustManager` because a bake spawns ffmpeg, and the prebake starts one on a
        // timer a few seconds after a project opens. The ledger is the smallest thing that can
        // answer whether the project it would run for is allowed to make Studio do that.
        private readonly app: FfmpegResolverApp & WeatherBakeWorkerHostApp & Pick<App, "projectTrustManager">,
        private readonly scheduler: StudioTaskScheduler,
    ) {}

    /**
     * The absolute path a clip would be cached at, whether or not it exists yet.
     *
     * The tier is in the FILE NAME and deliberately not in {@link weatherBakeKey}. The key becomes
     * the asset id a packaged game asks for (`weatherClipAssetId`), and a shipped game has no idea
     * which tier produced what it is looking for; folding the tier in would make every build depend
     * on the runtime spelling `final` the same way, and the failure mode for getting that wrong is
     * silent - a valid pack, a story that plays, and no weather. Two names in one cache directory
     * cost nothing and cannot be got wrong.
     */
    public pathFor(projectRoot: string, identity: WeatherBakeIdentity, quality: WeatherBakeQuality): string {
        const suffix = quality === "draft" ? ".draft.webm" : ".webm";
        return path.join(projectRoot, WEATHER_CACHE_DIR, `${weatherBakeKey(identity)}${suffix}`);
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
        // Ahead of everything else, including the claim bookkeeping below, because this is the one
        // caller that starts on a timer: the prebake settles a few seconds after a project opens,
        // with no gesture behind it, and it reads every story rather than the open one. A project
        // that arrived from elsewhere must not get an ffmpeg process out of merely being opened.
        //
        // Silent: nothing asked for this, so a console error would be Studio complaining about a
        // decision the author already made. The failures below say it per clip, where anything
        // actually waiting on a bake will read it.
        const distrusted = projectDistrustedRefusal(this.app, request.projectRoot, "weather clip bake");
        if (distrusted) {
            for (const spec of request.specs) {
                failures.set(weatherBakeKey(spec), distrusted);
            }
            if (request.claim) {
                this.scheduler.supersede(request.claim);
            }
            return { paths, failures };
        }
        // Every path out of here retires the claim, including the ones that submit nothing. Asking
        // for no clips at all is how deleting the last weather row arrives, and a bake for the row
        // that is gone has to stop on that news rather than on the next one that happens to come.
        const retire = (): void => {
            if (request.claim) {
                this.scheduler.supersede(request.claim);
            }
        };
        const wanted = dedupe(request.specs);
        if (wanted.length === 0) {
            retire();
            return { paths, failures };
        }

        // The disk is asked first, and outside the queue: a project whose weather has not changed does
        // no work at all here, and making it wait behind someone else's bake to discover that would
        // fill the queue with tasks whose only job is to answer "already done".
        const missing: { spec: WeatherBakeSpec; key: string; target: string }[] = [];
        for (const spec of wanted) {
            const key = weatherBakeKey(spec);
            const found = await this.findAtLeast(request.projectRoot, spec, request.quality);
            if (found) {
                paths.set(key, found);
            } else {
                missing.push({ spec, key, target: this.pathFor(request.projectRoot, spec, request.quality) });
            }
        }
        if (missing.length === 0) {
            retire();
            return { paths, failures };
        }

        const tool = await resolveFfmpegBinary(this.app, "ffmpeg", options);
        if (!tool.available) {
            logger.warn(`No ffmpeg on this host, so ${missing.length} weather clip(s) were not produced: ${tool.detail}`);
            for (const item of missing) {
                failures.set(item.key, tool.detail);
            }
            retire();
            return { paths, failures };
        }

        // Submitted together and awaited together, as one ask rather than several. The scheduler
        // runs them one at a time; what this caller needs is every clip it asked for, not the order
        // they arrive in - and submitting the set in one call is also what lets a claim retire the
        // previous ask without cutting into this one.
        const outcomes = await this.scheduler.submitAll<string>(missing.map(item => ({
            kind: "weatherBake",
            // The clip IS the key, so two rows, two scenes or two windows asking for the same weather
            // are one task - and a speculative submission is the same task as the awaited one.
            key: bakeTaskKey(item.key, request.quality),
            priority: request.priority,
            run: async context => {
                const startBake = options.startBake
                    ?? ((binaryPath, bakeSpec, target, bakeOptions) =>
                        startWeatherBakeInWorker(this.app, binaryPath, bakeSpec, target, bakeOptions));
                const handle = startBake(tool.path, item.spec, item.target, {
                    quality: request.quality,
                    threads: request.threads,
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
        })), request.claim);

        missing.forEach((item, index) => {
            const outcome = outcomes[index];
            if (outcome?.status === "done") {
                paths.set(item.key, outcome.value);
            } else {
                failures.set(item.key, outcome?.status === "error" ? outcome.error : "cancelled");
            }
        });
        return { paths, failures };
    }

    /**
     * Give up everything a claim asked for.
     *
     * A clip nobody else is left wanting stops encoding where it stands; a clip somebody else is
     * waiting on carries on, which is the scheduler's rule and the right one - a build being
     * cancelled is not a reason to take the weather away from a Dev Mode session watching the same
     * scene. The attempt is derived rather than random so this is a pure function of the claim: what
     * `supersede` acts on is "claimed under some OTHER attempt", so it only has to differ.
     */
    public abandon(claim: StudioTaskClaim): void {
        this.scheduler.supersede({ owner: claim.owner, attempt: `${claim.attempt}:abandoned` });
    }

    /** Stop one clip, wherever it is in the queue. Whatever already landed stays on disk. */
    public cancel(spec: WeatherBakeSpec, quality: WeatherBakeQuality): void {
        this.scheduler.cancel(bakeTaskKey(weatherBakeKey(spec), quality));
    }

    /**
     * A cached clip that is at least as good as asked for, or `null`.
     *
     * `final` first for a draft request, so a project that has been built once stops re-baking its
     * weather every time Dev Mode starts: the better file is already there and is a strictly better
     * answer. A `final` request looks at one name only - the whole reason the tiers are separate
     * files is that a draft can never stand in for the thing a player receives.
     */
    private async findAtLeast(
        projectRoot: string,
        identity: WeatherBakeIdentity,
        quality: WeatherBakeQuality,
    ): Promise<string | null> {
        const candidates: WeatherBakeQuality[] = quality === "draft" ? ["final", "draft"] : ["final"];
        for (const candidate of candidates) {
            const target = this.pathFor(projectRoot, identity, candidate);
            if (await exists(target)) {
                return target;
            }
        }
        return null;
    }
}

/**
 * One namespace for the scheduler's key space, so a weather key can never collide with another kind's.
 *
 * The tier is part of it, and that is what keeps the pre-baker useful: a speculative submission and
 * the run that overtakes it are the same task only if they agree about the tier, so both read the
 * same setting. Two tiers of one clip are two tasks because they produce two files - a build waiting
 * on `final` must not be handed the draft that happens to be encoding.
 */
function bakeTaskKey(key: string, quality: WeatherBakeQuality): string {
    return `weather:${key}:${quality}`;
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
