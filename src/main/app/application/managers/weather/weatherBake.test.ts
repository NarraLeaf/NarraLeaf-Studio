import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WeatherBakeSpec } from "@shared/weather/model";
import { weatherBakeKey } from "@shared/weather/bakeKey";
import {
    parseBakeFrame,
    startWeatherBake,
    weatherBakeArgs,
    type BakeChildProcess,
    type BakeSpawn,
    type WeatherBakeResult,
} from "./weatherBake";
import { VP9_ARGS } from "../media/mediaTranscode";
import { devModeScreenEffectQuality, screenEffectBakeThreads } from "./screenEffectQuality";
import { SCREEN_EFFECT_QUALITY_KEY, SCREEN_EFFECT_THREADS_KEY } from "@shared/constants/screenEffects";
import { StudioTaskScheduler } from "../tasks/StudioTaskScheduler";
import { WeatherBakeManager, WeatherBakeOwner, type WeatherBakeStarter } from "./WeatherBakeManager";

/**
 * Small and short: these tests are about the plumbing, and every frame is really rendered.
 *
 * The rate is deliberately not the project default. The rate is the author's now, so a baker that
 * went back to a constant would still agree with a spec that stated 30 - and would then encode every
 * project's effects at the wrong speed while these tests stayed green.
 */
const SPEC: WeatherBakeSpec = {
    ref: { seed: "snow" },
    width: 64,
    height: 36,
    fps: 48,
    frames: 4,
};

/**
 * A stand-in for ffmpeg.
 *
 * It records what it was told to encode, so the assertions can be about the CONTRACT - one frame per
 * frame, each of the right size - rather than about whether a real encoder happened to be installed.
 */
function fakeEncoder(options: {
    exitCode?: number;
    progressBlocks?: string[];
    writeOutput?: boolean;
    onSpawn?: (binary: string, args: string[]) => void;
} = {}) {
    const chunks: number[] = [];
    let closeListener: ((code: number | null, signal: string | null) => void) | null = null;
    let stdoutListener: ((chunk: Buffer | string) => void) | null = null;

    const spawnProcess: BakeSpawn = (binary, args) => {
        options.onSpawn?.(binary, args);
        const target = args[args.length - 1];
        const child: BakeChildProcess = {
            stdin: {
                write(chunk) {
                    chunks.push(chunk.length);
                    return true;
                },
                once() {
                    return undefined;
                },
                on() {
                    return undefined;
                },
                end() {
                    // The encoder answers only once its input is closed, which is what makes the
                    // feed-then-await ordering in the module observable at all.
                    for (const block of options.progressBlocks ?? []) {
                        stdoutListener?.(block);
                    }
                    void (async () => {
                        if (options.writeOutput !== false && (options.exitCode ?? 0) === 0) {
                            await fs.writeFile(target, "webm");
                        }
                        closeListener?.(options.exitCode ?? 0, null);
                    })();
                    return undefined;
                },
            },
            stdout: {
                on(_event, listener) {
                    stdoutListener = listener;
                    return undefined;
                },
            },
            stderr: {
                on() {
                    return undefined;
                },
            },
            on(event, listener) {
                if (event === "close") {
                    closeListener = listener as (code: number | null, signal: string | null) => void;
                }
                return undefined;
            },
            kill() {
                closeListener?.(null, "SIGTERM");
                return true;
            },
        };
        return child;
    };

    return { spawnProcess, chunks };
}

describe("weatherBakeArgs", () => {
    const args = weatherBakeArgs(SPEC, "final", "C:/out/snow.webm");

    it("declares the raw input the renderer actually writes", () => {
        expect(args).toContain("rawvideo");
        // RGBA, not RGB24: the shared renderer writes four bytes per pixel so a canvas can take the
        // same buffer, and a mismatch here would encode a sheared picture rather than fail.
        expect(args[args.indexOf("-pix_fmt") + 1]).toBe("rgba");
        expect(args).toContain("64x36");
        // The spec's rate, not a constant: `SPEC.fps` is 48 precisely so this cannot pass by accident.
        expect(args[args.indexOf("-r") + 1]).toBe("48");
    });

    it("encodes with the project's own VP9 settings", () => {
        expect(args).toContain("libvpx-vp9");
        expect(args[args.lastIndexOf("-pix_fmt") + 1]).toBe("yuv420p");
        expect(args).toContain("-crf");
    });

    it("asks for no audio track and writes the output last", () => {
        expect(args).toContain("-an");
        expect(args[args.length - 1]).toBe("C:/out/snow.webm");
    });

    it("asks the encoder to report progress", () => {
        expect(args).toContain("-progress");
    });

    it("encodes a final clip with exactly what an imported asset is converted with", () => {
        // Not "both mention libvpx": the whole justification for one exported constant is that a
        // project's video is ONE decision, and the two would drift silently because either set
        // produces a playable file. Only the speed is allowed to differ, and only for a draft.
        for (const arg of VP9_ARGS) {
            expect(args).toContain(arg);
        }
        expect(args[args.indexOf("-deadline") + 1]).toBe("good");
        expect(args[args.indexOf("-cpu-used") + 1]).toBe("2");
    });

    it("encodes a draft with the fast encoder and changes nothing else about the file", () => {
        const draft = weatherBakeArgs(SPEC, "draft", "C:/out/snow.webm");

        expect(draft[draft.indexOf("-deadline") + 1]).toBe("realtime");
        // Four, not five: libvpx drops to its non-RD decision path at 5, which measured the same
        // wall-clock and 27% more bytes. The number is the measurement, not a preference.
        expect(draft[draft.indexOf("-cpu-used") + 1]).toBe("4");
        // Everything that decides whether the clip PLAYS is the same in both tiers - the codec, the
        // profile, the quality target. A draft has to be a legal answer to the same question, or the
        // manager's "a better file will do" rule would be serving files a target cannot decode.
        expect(draft[draft.lastIndexOf("-pix_fmt") + 1]).toBe("yuv420p");
        expect(draft).toContain("libvpx-vp9");
        expect(draft[draft.indexOf("-crf") + 1]).toBe(args[args.indexOf("-crf") + 1]);
    });

    it("names the container, because the file it writes has no extension to infer one from", () => {
        // Regression: the clip lands through a random `.part` name, and ffmpeg picks its muxer from
        // the extension unless told. Without this it refused the output outright - a failure the
        // fake encoder in these tests cannot see, because only a real one parses the name.
        expect(args[args.indexOf("-f", args.indexOf("-an")) + 1]).toBe("webm");
    });
});

describe("parseBakeFrame", () => {
    it("reads the counter out of a progress block", () => {
        expect(parseBakeFrame("frame=42\nfps=30\nout_time_ms=1400000\nprogress=continue\n")).toBe(42);
    });

    it("takes the last counter when a block carries several", () => {
        expect(parseBakeFrame("frame=1\nprogress=continue\nframe=9\nprogress=continue\n")).toBe(9);
    });

    it("answers null for a block that carries none", () => {
        expect(parseBakeFrame("fps=30\nspeed=1.2x\n")).toBeNull();
    });
});

describe("startWeatherBake", () => {
    let dir = "";

    beforeEach(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-weather-"));
    });

    afterEach(async () => {
        await fs.rm(dir, { recursive: true, force: true });
    });

    it("feeds one frame per frame, each the size of the picture", async () => {
        const encoder = fakeEncoder();
        const target = path.join(dir, "snow.webm");
        const result = await startWeatherBake("ffmpeg", SPEC, target, { quality: "final", spawnProcess: encoder.spawnProcess }).result;

        expect(result.status).toBe("done");
        expect(encoder.chunks).toHaveLength(SPEC.frames);
        expect(new Set(encoder.chunks)).toEqual(new Set([SPEC.width * SPEC.height * 4]));
    });

    it("lands the clip at the requested path and leaves no part file", async () => {
        const encoder = fakeEncoder();
        const target = path.join(dir, "snow.webm");
        await startWeatherBake("ffmpeg", SPEC, target, { quality: "final", spawnProcess: encoder.spawnProcess }).result;

        await expect(fs.stat(target)).resolves.toBeTruthy();
        expect((await fs.readdir(dir)).filter(name => name.endsWith(".part"))).toEqual([]);
    });

    it("reports the encoder's own counter rather than what was fed", async () => {
        const seen: number[] = [];
        const encoder = fakeEncoder({ progressBlocks: ["frame=2\nprogress=continue\n", "frame=4\nprogress=end\n"] });
        await startWeatherBake("ffmpeg", SPEC, path.join(dir, "snow.webm"), {
            quality: "final",
            spawnProcess: encoder.spawnProcess,
            onProgress: progress => seen.push(progress.frames),
        }).result;

        expect(seen).toEqual([2, 4]);
    });

    it("reports a failed encode and removes the part file", async () => {
        const encoder = fakeEncoder({ exitCode: 1 });
        const target = path.join(dir, "snow.webm");
        const result = await startWeatherBake("ffmpeg", SPEC, target, { quality: "final", spawnProcess: encoder.spawnProcess }).result;

        expect(result.status).toBe("error");
        // An encoder that printed nothing is a finding, not a gap in the report.
        expect(result.status === "error" && result.stderr).toContain("wrote nothing");
        await expect(fs.stat(target)).rejects.toBeTruthy();
        expect(await fs.readdir(dir)).toEqual([]);
    });

    it("does not hang when the encoder dies with a frame parked on backpressure", async () => {
        // Regression, and the reason this one is worth a test of its own: a frame is far larger than
        // a pipe's watermark, so essentially every write parks waiting for drain. An encoder that
        // exits while one is parked never sends that drain - waiting on it alone is a bake that never
        // returns, rather than one that reports what happened.
        let closeListener: ((code: number | null, signal: string | null) => void) | null = null;
        const spawnProcess: BakeSpawn = () => ({
            stdin: {
                write: () => false,
                // Deliberately never fires: this stream is the one that will not drain.
                once: () => undefined,
                on: () => undefined,
                end: () => undefined,
            },
            stdout: { on: () => undefined },
            stderr: { on: () => undefined },
            on(event, listener) {
                if (event === "close") {
                    closeListener = listener as (code: number | null, signal: string | null) => void;
                    setTimeout(() => closeListener?.(1, null), 0);
                }
                return undefined;
            },
            kill: () => true,
        });

        const result = await startWeatherBake("ffmpeg", SPEC, path.join(dir, "snow.webm"), { quality: "final", spawnProcess }).result;
        expect(result.status).toBe("error");
    });

    it("hands the encoder a copy, so the next frame cannot rewrite a queued one", async () => {
        // The renderer reuses one buffer. A stream keeps what it is handed until the write completes,
        // so passing that buffer straight through lets frame N+1 overwrite frame N while it waits.
        // Captured by REFERENCE on purpose. Copying here would make the test unable to see the very
        // aliasing it exists to catch: with a shared buffer every capture is the same object, and a
        // snapshot taken at capture time would hide that.
        const written: (Uint8Array | Uint8ClampedArray)[] = [];
        let closeListener: ((code: number | null, signal: string | null) => void) | null = null;
        const spawnProcess: BakeSpawn = (_binary, args) => ({
            stdin: {
                write(chunk) {
                    written.push(chunk);
                    return true;
                },
                once: () => undefined,
                on: () => undefined,
                end() {
                    void fs.writeFile(args[args.length - 1], "webm").then(() => closeListener?.(0, null));
                    return undefined;
                },
            },
            stdout: { on: () => undefined },
            stderr: { on: () => undefined },
            on(event, listener) {
                if (event === "close") {
                    closeListener = listener as (code: number | null, signal: string | null) => void;
                }
                return undefined;
            },
            kill: () => true,
        });

        await startWeatherBake("ffmpeg", SPEC, path.join(dir, "snow.webm"), { quality: "final", spawnProcess }).result;
        expect(written).toHaveLength(SPEC.frames);
        // Distinct objects, so a later frame cannot be rewriting an earlier one that is still queued.
        expect(new Set(written).size).toBe(SPEC.frames);
        // And distinct CONTENT, which is what proves those objects hold different frames rather than
        // copies taken at the same moment.
        expect(written.some(frame => !frame.every((byte, index) => byte === written[0][index]))).toBe(true);
    });

    it("answers cancelled without leaving a clip behind", async () => {
        const encoder = fakeEncoder();
        const target = path.join(dir, "snow.webm");
        const handle = startWeatherBake("ffmpeg", SPEC, target, { quality: "final", spawnProcess: encoder.spawnProcess });
        handle.cancel();
        const result = await handle.result;

        expect(result.status).toBe("cancelled");
        await expect(fs.stat(target)).rejects.toBeTruthy();
    });
});

describe("WeatherBakeManager", () => {
    let dir = "";
    let toolDir = "";
    // `getDistDir` is where the real manager finds its worker; these tests hand it a bake instead,
    // so nothing ever reads it.
    const app = { isPackaged: () => false, resolveResource: (p: string) => p, getDistDir: () => "" };
    /**
     * The resolver looks for a real file, so the tests give it one. It is never executed - the bake
     * is injected - but pointing the override at a directory that genuinely holds the binary is what
     * keeps "unavailable" a distinct outcome the last test can still reach.
     */
    const withTool = () => ({ env: { NLS_FFMPEG_DIR: toolDir } });
    /**
     * The bake the manager would fork, run here instead.
     *
     * Production forks a utility process because drawing frames on the main process makes the app
     * answer 200x slower; a test has no main process to protect, and injecting at the seam keeps
     * these cases about what the MANAGER does - dedupe, cache, queue, cancel.
     */
    /** Poll until something the scheduler is doing in the background has actually happened. */
    const until = async (condition: () => boolean): Promise<void> => {
        for (let i = 0; i < 400 && !condition(); i++) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
    };

    const inThisProcess = (spawnProcess: BakeSpawn): WeatherBakeStarter =>
        (binaryPath, spec, targetPath, options) =>
            startWeatherBake(binaryPath, spec, targetPath, { ...options, spawnProcess });

    beforeEach(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-weather-project-"));
        toolDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-weather-tool-"));
        await fs.writeFile(path.join(toolDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"), "");
    });

    afterEach(async () => {
        await fs.rm(dir, { recursive: true, force: true });
        await fs.rm(toolDir, { recursive: true, force: true });
    });

    it("keeps its clips inside the project cache, which version control excludes", () => {
        const manager = new WeatherBakeManager(app, new StudioTaskScheduler());
        const target = manager.pathFor(dir, SPEC, "final");
        expect(path.relative(dir, target).split(path.sep).slice(0, 2)).toEqual(["editor", "cache"]);
        expect(path.basename(target)).toBe(`${weatherBakeKey(SPEC)}.webm`);
    });

    it("bakes one clip for rows that describe the same weather", async () => {
        let spawns = 0;
        const encoder = fakeEncoder({ onSpawn: () => { spawns += 1; } });
        const manager = new WeatherBakeManager(app, new StudioTaskScheduler());
        const outcome = await manager.ensure(
            { projectRoot: dir, specs: [SPEC, { ...SPEC }, { ...SPEC, ref: { seed: "snow", params: {} } }], priority: "blocking", quality: "final", threads: null },
            { startBake: inThisProcess(encoder.spawnProcess), ...withTool() },
        );

        expect(spawns).toBe(1);
        expect(outcome.paths.size).toBe(1);
        expect(outcome.failures.size).toBe(0);
    });

    it("does no work at all when the clip is already on disk", async () => {
        let spawns = 0;
        const encoder = fakeEncoder({ onSpawn: () => { spawns += 1; } });
        const manager = new WeatherBakeManager(app, new StudioTaskScheduler());
        const target = manager.pathFor(dir, SPEC, "final");
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, "already here");

        const outcome = await manager.ensure(
            { projectRoot: dir, specs: [SPEC], priority: "blocking", quality: "final", threads: null },
            { startBake: inThisProcess(encoder.spawnProcess), ...withTool() },
        );

        expect(spawns).toBe(0);
        expect(outcome.paths.get(weatherBakeKey(SPEC))).toBe(target);
        expect(outcome.failures.size).toBe(0);
    });

    it("keeps the two tiers in separate files, so neither can be mistaken for the other", () => {
        const manager = new WeatherBakeManager(app, new StudioTaskScheduler());

        expect(path.basename(manager.pathFor(dir, SPEC, "final"))).toBe(`${weatherBakeKey(SPEC)}.webm`);
        expect(path.basename(manager.pathFor(dir, SPEC, "draft"))).toBe(`${weatherBakeKey(SPEC)}.draft.webm`);
        // The KEY does not move. It becomes the asset id a packaged game asks for, and a shipped
        // game has no idea which tier made what it is looking for: fold the tier in and a build and
        // a runtime that spell it differently produce a valid pack with no weather in it.
        expect(weatherBakeKey(SPEC)).toBe(weatherBakeKey({ ...SPEC }));
    });

    it("hands a draft request the final clip when there is one", async () => {
        // A project that has been built once should not re-bake its weather every time Dev Mode
        // starts. The tier is a floor, not an equality: a better file answers the same question.
        let spawns = 0;
        const encoder = fakeEncoder({ onSpawn: () => { spawns += 1; } });
        const manager = new WeatherBakeManager(app, new StudioTaskScheduler());
        const finalPath = manager.pathFor(dir, SPEC, "final");
        await fs.mkdir(path.dirname(finalPath), { recursive: true });
        await fs.writeFile(finalPath, "built earlier");

        const outcome = await manager.ensure(
            { projectRoot: dir, specs: [SPEC], priority: "blocking", quality: "draft", threads: null },
            { startBake: inThisProcess(encoder.spawnProcess), ...withTool() },
        );

        expect(spawns).toBe(0);
        expect(outcome.paths.get(weatherBakeKey(SPEC))).toBe(finalPath);
    });

    it("never hands a build the draft some Dev Mode session left behind", async () => {
        // The one that matters. A draft on disk must not satisfy `final`, or a shipped game carries
        // the copy that was made in a hurry - and nothing anywhere would say so.
        let spawns = 0;
        const encoder = fakeEncoder({ onSpawn: () => { spawns += 1; } });
        const manager = new WeatherBakeManager(app, new StudioTaskScheduler());
        const draftPath = manager.pathFor(dir, SPEC, "draft");
        await fs.mkdir(path.dirname(draftPath), { recursive: true });
        await fs.writeFile(draftPath, "made while editing");

        const outcome = await manager.ensure(
            { projectRoot: dir, specs: [SPEC], priority: "blocking", quality: "final", threads: null },
            { startBake: inThisProcess(encoder.spawnProcess), ...withTool() },
        );

        expect(spawns).toBe(1);
        expect(outcome.paths.get(weatherBakeKey(SPEC))).toBe(manager.pathFor(dir, SPEC, "final"));
    });

    it("does not let a build adopt a draft that is already encoding", async () => {
        // Same clip, two tiers, so two TASKS. Adoption is a real feature here - a blocking request
        // for work already running at idle attaches to it instead of starting again - and across
        // tiers it is exactly the wrong answer: the build would attach to the draft and ship
        // whatever it produced. The evidence is the queue. With the draft held open, a build that
        // adopted it would return without the queue ever growing.
        const scheduler = new StudioTaskScheduler();
        const manager = new WeatherBakeManager(app, scheduler);
        const started: string[] = [];
        let releaseDraft = (): void => undefined;
        const draftGate = new Promise<void>(resolve => { releaseDraft = resolve; });
        const starter: WeatherBakeStarter = (_binary, _spec, targetPath, options) => {
            started.push(options.quality);
            const done: WeatherBakeResult = { status: "done", path: targetPath, bytes: 1 };
            return {
                result: options.quality === "draft" ? draftGate.then(() => done) : Promise.resolve(done),
                cancel: () => undefined,
            };
        };
        const draft = manager.ensure(
            { projectRoot: dir, specs: [SPEC], priority: "idle", quality: "draft", threads: null },
            { startBake: starter, ...withTool() },
        );
        // The draft is running and cannot finish, so anything submitted after this either queues or
        // adopts - which is the question, with no race left in it.
        await until(() => started.includes("draft"));
        const built = manager.ensure(
            { projectRoot: dir, specs: [SPEC], priority: "blocking", quality: "final", threads: null },
            { startBake: starter, ...withTool() },
        );
        await until(() => scheduler.getOverview().queued > 0);

        expect(scheduler.getOverview().queued).toBe(1);
        releaseDraft();
        expect((await built).paths.get(weatherBakeKey(SPEC))).toBe(manager.pathFor(dir, SPEC, "final"));
        expect((await draft).paths.get(weatherBakeKey(SPEC))).toBe(manager.pathFor(dir, SPEC, "draft"));
        expect(started).toEqual(["draft", "final"]);
    });

    it("cannot stop a bake nobody claimed, which is why a pack claims one", async () => {
        // The defect this pins, stated as the scheduler states it: an unclaimed task is immune to
        // `supersede` on purpose, because a caller saying it has moved on is not a caller speaking
        // for everybody else. A build that submitted anonymously therefore had no way to be stopped
        // at all - it reported itself cancelled while the encoder ran to the end.
        const scheduler = new StudioTaskScheduler();
        const manager = new WeatherBakeManager(app, scheduler);
        let release = (): void => undefined;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let started = false;
        const starter: WeatherBakeStarter = (_binary, _spec, targetPath) => {
            started = true;
            return {
                result: gate.then(() => ({ status: "done", path: targetPath, bytes: 1 }) as WeatherBakeResult),
                cancel: () => undefined,
            };
        };
        const claim = { owner: WeatherBakeOwner.pack(), attempt: "1" };

        const anonymous = manager.ensure(
            { projectRoot: dir, specs: [SPEC], priority: "blocking", quality: "final", threads: null },
            { startBake: starter, ...withTool() },
        );
        // `ensure` reaches the scheduler only after it has looked at the disk and resolved a tool, so
        // an abandon sent before that would prove nothing at all - it would find no task to act on.
        await until(() => started);
        manager.abandon(claim);
        release();

        expect((await anonymous).failures.size).toBe(0);
    });

    it("stops a bake the only caller waiting on it has abandoned", async () => {
        const scheduler = new StudioTaskScheduler();
        const manager = new WeatherBakeManager(app, scheduler);
        let started = false;
        let stop = (): void => undefined;
        const starter: WeatherBakeStarter = () => {
            started = true;
            // Settles only when cancelled, exactly as the real bake does - so the only way out of
            // this test is the abandon reaching the handle.
            return {
                result: new Promise<WeatherBakeResult>(resolve => { stop = () => resolve({ status: "cancelled" }); }),
                cancel: () => stop(),
            };
        };
        const claim = { owner: WeatherBakeOwner.pack(), attempt: "1" };

        const pending = manager.ensure(
            { projectRoot: dir, specs: [SPEC], priority: "blocking", quality: "final", threads: null, claim },
            { startBake: starter, ...withTool() },
        );
        await until(() => started);
        manager.abandon(claim);

        expect((await pending).failures.get(weatherBakeKey(SPEC))).toBe("cancelled");
        expect(scheduler.getOverview().active).toBeNull();
    });

    it("keeps baking for whoever else is still waiting on the same clip", async () => {
        // The negative control, and the reason this goes through claims rather than a plain kill: a
        // build being cancelled is not a reason to take the weather away from the Dev Mode session
        // watching the same scene.
        const scheduler = new StudioTaskScheduler();
        const manager = new WeatherBakeManager(app, scheduler);
        let release = (): void => undefined;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let claimed = 0;
        const starter: WeatherBakeStarter = (_binary, _spec, targetPath) => {
            claimed += 1;
            return {
                result: gate.then(() => ({ status: "done", path: targetPath, bytes: 1 }) as WeatherBakeResult),
                cancel: () => release(),
            };
        };
        const packClaim = { owner: WeatherBakeOwner.pack(), attempt: "1" };
        const devClaim = { owner: WeatherBakeOwner.devMode(dir), attempt: "1" };

        const pack = manager.ensure(
            { projectRoot: dir, specs: [SPEC], priority: "blocking", quality: "final", threads: null, claim: packClaim },
            { startBake: starter, ...withTool() },
        );
        const devMode = manager.ensure(
            { projectRoot: dir, specs: [SPEC], priority: "blocking", quality: "final", threads: null, claim: devClaim },
            { startBake: starter, ...withTool() },
        );
        // Both claims have to be on the task before one of them lets go, or this would be measuring
        // an abandon that arrived before anyone else had asked.
        await until(() => claimed === 1);
        manager.abandon(packClaim);
        release();

        expect((await devMode).paths.get(weatherBakeKey(SPEC))).toBe(manager.pathFor(dir, SPEC, "final"));
        // One bake, not two, and that is the guard rather than a detail: the two asks are the same
        // clip, so they are one task. Had the abandon taken it away, Dev Mode's join would have
        // started a second one - and this would read 2 while every other assertion still passed.
        expect(claimed).toBe(1);
        await pack;
    });

    it("puts every clip through the scheduler, where the progress is visible", async () => {
        const encoder = fakeEncoder();
        const scheduler = new StudioTaskScheduler();
        const kinds: string[] = [];
        scheduler.onChanged(overview => {
            if (overview.active) {
                kinds.push(`${overview.active.kind}:${overview.active.status}`);
            }
        });
        const manager = new WeatherBakeManager(app, scheduler);

        const outcome = await manager.ensure(
            { projectRoot: dir, specs: [SPEC, { ...SPEC, ref: { seed: "rain" } }], priority: "idle", quality: "final", threads: null },
            { startBake: inThisProcess(encoder.spawnProcess), ...withTool() },
        );

        expect(outcome.paths.size).toBe(2);
        expect(kinds).toContain("weatherBake:running");
        // And the queue is empty afterwards - a task that never settles would hold every later one.
        expect(scheduler.getOverview().active).toBeNull();
    });

    it("reaches a running bake's cancel, whatever is making it", async () => {
        // The manager holds a handle to something in another process now, so "stop" has to travel:
        // the scheduler cancels the task, the task cancels the handle, and the outcome says
        // cancelled rather than reporting a clip that was never written.
        const scheduler = new StudioTaskScheduler();
        const manager = new WeatherBakeManager(app, scheduler);
        let stop = (): void => undefined;
        let announceStart = (): void => undefined;
        const startedOnce = new Promise<void>(resolve => { announceStart = resolve; });
        const starter: WeatherBakeStarter = () => {
            const result = new Promise<WeatherBakeResult>(resolve => {
                stop = () => resolve({ status: "cancelled" });
            });
            announceStart();
            return { result, cancel: () => stop() };
        };

        const pending = manager.ensure(
            { projectRoot: dir, specs: [SPEC], priority: "blocking", quality: "final", threads: null },
            { startBake: starter, ...withTool() },
        );
        await startedOnce;
        manager.cancel(SPEC, "final");
        const outcome = await pending;

        expect(outcome.paths.size).toBe(0);
        expect(outcome.failures.get(weatherBakeKey(SPEC))).toBe("cancelled");
        expect(scheduler.getOverview().active).toBeNull();
    });

    it("says a host without an encoder is missing a tool rather than broken", async () => {
        const manager = new WeatherBakeManager(app, new StudioTaskScheduler());
        const outcome = await manager.ensure(
            { projectRoot: dir, specs: [SPEC], priority: "blocking", quality: "final", threads: null },
            // A directory with no binaries in it: the resolver looks, finds nothing, and says so.
            { env: { NLS_FFMPEG_DIR: path.join(dir, "no-ffmpeg-here") } },
        );

        expect(outcome.paths.size).toBe(0);
        // The sentence names the missing tool, which is what lets a caller say something other than
        // "this seed is broken".
        expect(outcome.failures.get(weatherBakeKey(SPEC))).toContain("ffmpeg");
    });
});

describe("devModeScreenEffectQuality", () => {
    const host = (value: unknown) => ({ globalState: { get: () => value } });

    it("is draft when the author has never chosen", () => {
        // Reverse control: a reader that ignored the store entirely would pass this alone, so the
        // next case has to be able to move it.
        expect(devModeScreenEffectQuality(host(undefined))).toBe("draft");
    });

    it("is whatever the author chose", () => {
        expect(devModeScreenEffectQuality(host("final"))).toBe("final");
    });

    it("treats a value that is not a tier as no answer at all", () => {
        // Global state is a JSON file on disk and this value reaches an ffmpeg argument. Trusting it
        // costs an encoder that refuses to start, and the symptom is "the weather stopped working".
        expect(devModeScreenEffectQuality(host("fastest"))).toBe("draft");
        expect(devModeScreenEffectQuality(host(4))).toBe("draft");
    });

    it("is auto by default, is whatever the author chose, and refuses nonsense", () => {
        const threadHost = (value: unknown) => ({ globalState: { get: () => value } });

        // Null is "read the machine", which is what auto means to the pool.
        expect(screenEffectBakeThreads(threadHost(undefined))).toBeNull();
        expect(screenEffectBakeThreads(threadHost("auto"))).toBeNull();
        expect(screenEffectBakeThreads(threadHost("3"))).toBe(3);
        // One is a real stop, not a degenerate case: it is how an author says "leave the rest of
        // this machine alone", and how a bug report takes the pool out of the question.
        expect(screenEffectBakeThreads(threadHost("1"))).toBe(1);
        // Reverse control on the stop list: a count outside the offered stops is not honoured just
        // because it parses, or the setting would be a way to ask for sixty-four render threads.
        expect(screenEffectBakeThreads(threadHost("64"))).toBeNull();
        expect(screenEffectBakeThreads(threadHost(3))).toBeNull();
    });

    it("reads the keys the settings rows write", () => {
        const seen: string[] = [];
        screenEffectBakeThreads({ globalState: { get: key => { seen.push(key); return undefined; } } });
        expect(seen).toEqual([SCREEN_EFFECT_THREADS_KEY]);
    });

    it("reads the key the settings row writes", () => {
        // The two halves cannot import each other's spelling by accident: the row stores under this
        // constant, and a reader that looked at a different string would answer the default forever
        // while the setting appeared to work.
        const seen: string[] = [];
        devModeScreenEffectQuality({ globalState: { get: key => { seen.push(key); return undefined; } } });
        expect(seen).toEqual([SCREEN_EFFECT_QUALITY_KEY]);
    });
});
