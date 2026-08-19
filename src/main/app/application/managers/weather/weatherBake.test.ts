import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WEATHER_FPS, type WeatherBakeSpec } from "@shared/weather/model";
import { weatherBakeKey } from "@shared/weather/bakeKey";
import { parseBakeFrame, startWeatherBake, weatherBakeArgs, type BakeChildProcess, type BakeSpawn } from "./weatherBake";
import { WeatherBakeManager } from "./WeatherBakeManager";

/** Small and short: these tests are about the plumbing, and every frame is really rendered. */
const SPEC: WeatherBakeSpec = {
    ref: { seed: "snow" },
    width: 64,
    height: 36,
    fps: WEATHER_FPS,
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
    const args = weatherBakeArgs(SPEC, "C:/out/snow.webm");

    it("declares the raw input the renderer actually writes", () => {
        expect(args).toContain("rawvideo");
        // RGBA, not RGB24: the shared renderer writes four bytes per pixel so a canvas can take the
        // same buffer, and a mismatch here would encode a sheared picture rather than fail.
        expect(args[args.indexOf("-pix_fmt") + 1]).toBe("rgba");
        expect(args).toContain("64x36");
        expect(args[args.indexOf("-r") + 1]).toBe(String(WEATHER_FPS));
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
        const result = await startWeatherBake("ffmpeg", SPEC, target, { spawnProcess: encoder.spawnProcess }).result;

        expect(result.status).toBe("done");
        expect(encoder.chunks).toHaveLength(SPEC.frames);
        expect(new Set(encoder.chunks)).toEqual(new Set([SPEC.width * SPEC.height * 4]));
    });

    it("lands the clip at the requested path and leaves no part file", async () => {
        const encoder = fakeEncoder();
        const target = path.join(dir, "snow.webm");
        await startWeatherBake("ffmpeg", SPEC, target, { spawnProcess: encoder.spawnProcess }).result;

        await expect(fs.stat(target)).resolves.toBeTruthy();
        expect((await fs.readdir(dir)).filter(name => name.endsWith(".part"))).toEqual([]);
    });

    it("reports the encoder's own counter rather than what was fed", async () => {
        const seen: number[] = [];
        const encoder = fakeEncoder({ progressBlocks: ["frame=2\nprogress=continue\n", "frame=4\nprogress=end\n"] });
        await startWeatherBake("ffmpeg", SPEC, path.join(dir, "snow.webm"), {
            spawnProcess: encoder.spawnProcess,
            onProgress: progress => seen.push(progress.frames),
        }).result;

        expect(seen).toEqual([2, 4]);
    });

    it("reports a failed encode and removes the part file", async () => {
        const encoder = fakeEncoder({ exitCode: 1 });
        const target = path.join(dir, "snow.webm");
        const result = await startWeatherBake("ffmpeg", SPEC, target, { spawnProcess: encoder.spawnProcess }).result;

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

        const result = await startWeatherBake("ffmpeg", SPEC, path.join(dir, "snow.webm"), { spawnProcess }).result;
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

        await startWeatherBake("ffmpeg", SPEC, path.join(dir, "snow.webm"), { spawnProcess }).result;
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
        const handle = startWeatherBake("ffmpeg", SPEC, target, { spawnProcess: encoder.spawnProcess });
        handle.cancel();
        const result = await handle.result;

        expect(result.status).toBe("cancelled");
        await expect(fs.stat(target)).rejects.toBeTruthy();
    });
});

describe("WeatherBakeManager", () => {
    let dir = "";
    let toolDir = "";
    const app = { isPackaged: () => false, resolveResource: (p: string) => p };
    /**
     * The resolver looks for a real file, so the tests give it one. It is never executed - the spawn
     * is injected - but pointing the override at a directory that genuinely holds the binary is what
     * keeps "unavailable" a distinct outcome the last test can still reach.
     */
    const withTool = () => ({ env: { NLS_FFMPEG_DIR: toolDir } });

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
        const manager = new WeatherBakeManager(app);
        const target = manager.pathFor(dir, SPEC);
        expect(path.relative(dir, target).split(path.sep).slice(0, 2)).toEqual(["editor", "cache"]);
        expect(path.basename(target)).toBe(`${weatherBakeKey(SPEC)}.webm`);
    });

    it("bakes one clip for rows that describe the same weather", async () => {
        let spawns = 0;
        const encoder = fakeEncoder({ onSpawn: () => { spawns += 1; } });
        const manager = new WeatherBakeManager(app);
        const outcome = await manager.ensure(
            { projectRoot: dir, specs: [SPEC, { ...SPEC }, { ...SPEC, ref: { seed: "snow", params: {} } }] },
            { spawnProcess: encoder.spawnProcess, ...withTool() },
        );

        expect(spawns).toBe(1);
        expect(outcome.paths.size).toBe(1);
        expect(outcome.snapshot.status).toBe("done");
    });

    it("does no work at all when the clip is already on disk", async () => {
        let spawns = 0;
        const encoder = fakeEncoder({ onSpawn: () => { spawns += 1; } });
        const manager = new WeatherBakeManager(app);
        const target = manager.pathFor(dir, SPEC);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, "already here");

        const outcome = await manager.ensure(
            { projectRoot: dir, specs: [SPEC] },
            { spawnProcess: encoder.spawnProcess, ...withTool() },
        );

        expect(spawns).toBe(0);
        expect(outcome.paths.get(weatherBakeKey(SPEC))).toBe(target);
        expect(outcome.snapshot.status).toBe("idle");
    });

    it("counts the clips it has to make, so a caller can say which one it is on", async () => {
        const snapshots: string[] = [];
        const encoder = fakeEncoder();
        const manager = new WeatherBakeManager(app);
        await manager.ensure(
            { projectRoot: dir, specs: [SPEC, { ...SPEC, ref: { seed: "rain" } }] },
            {
                spawnProcess: encoder.spawnProcess,
                ...withTool(),
                onChanged: snapshot => snapshots.push(`${snapshot.status}:${snapshot.clip}/${snapshot.clips}`),
            },
        );

        expect(snapshots[0]).toBe("baking:1/2");
        expect(snapshots).toContain("baking:2/2");
        expect(snapshots[snapshots.length - 1]).toBe("done:0/0");
    });

    it("says a host without an encoder is unavailable rather than broken", async () => {
        const manager = new WeatherBakeManager(app);
        const outcome = await manager.ensure(
            { projectRoot: dir, specs: [SPEC] },
            // A directory with no binaries in it: the resolver looks, finds nothing, and says so.
            { env: { NLS_FFMPEG_DIR: path.join(dir, "no-ffmpeg-here") } },
        );

        expect(outcome.snapshot.status).toBe("unavailable");
        expect(outcome.paths.size).toBe(0);
    });
});
