import { EventEmitter } from "events";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    createProgressParser,
    startMediaTranscode,
    transcodeArgs,
    type TranscodeChildProcess,
    type TranscodeSpawn,
} from "./mediaTranscode";
import { mediaConvertTargetExtension, imageConvertTargetFor } from "@shared/types/mediaConvert";
import type { MediaConvertRequest, MediaConvertTarget } from "@shared/types/mediaConvert";

/**
 * The command line, the progress stream, and the failure arms.
 *
 * Nothing here runs ffmpeg. What ffmpeg does with these arguments is proven by the real-sample
 * check against real samples - a produced file fed back through the probe and the classifier - and
 * that is the only evidence that means anything about playability. What *is* worth pinning down
 * here is everything a real run cannot distinguish: a remux that quietly re-encoded would still exit
 * zero, an image path with a quality knob would still produce a PNG, and a cancellation that left
 * its scratch file behind would still say "cancelled".
 */

/** Find the value following a flag, or undefined when the flag is absent. */
function valueAfter(args: readonly string[], flag: string): string | undefined {
    const at = args.indexOf(flag);
    return at < 0 ? undefined : args[at + 1];
}

describe("transcodeArgs / remux", () => {
    const target: MediaConvertTarget = { kind: "remux", container: "mp4", audioOnly: false };
    const args = transcodeArgs(target, "/in/clip.avi", "/out/tmp.part");

    it("copies the streams rather than encoding them", () => {
        expect(args).toContain("-c");
        expect(args[args.indexOf("-c") + 1]).toBe("copy");
        // The single thing that makes a remux lossless. An encoder here would still produce a
        // playable file, and the test that only checked playability would pass.
        expect(args.join(" ")).not.toContain("libvpx");
        expect(args.join(" ")).not.toContain("libvorbis");
    });

    it("maps video and audio only, and excludes attached cover art", () => {
        expect(args).toContain("0:V?");
        expect(args).toContain("0:a?");
        // Lowercase `0:v` would pull an MP3's album art into the output and fail the command on a
        // file the classifier called losslessly convertible.
        expect(args).not.toContain("0:v?");
        // Subtitles and data tracks may be illegal in the destination and are never played.
        expect(args.join(" ")).not.toContain("0:s");
    });

    it("names the muxer explicitly rather than trusting the output extension", () => {
        expect(valueAfter(args, "-f")).toBe("mp4");
    });

    it("puts the MP4 index at the front so a web export can start playing early", () => {
        expect(valueAfter(args, "-movflags")).toBe("+faststart");
    });

    it("spells the ADTS muxer correctly, which is not what the container is called", () => {
        // `-f aac` does not exist: `aac` is the demuxer's name, `adts` is the muxer's. Getting this
        // wrong fails at startup on a file the classifier said was a lossless container swap.
        expect(valueAfter(transcodeArgs({ kind: "remux", container: "aac", audioOnly: false }, "/in/a.mka", "/o"), "-f")).toBe("adts");
    });

    it("passes the source and the output as plain argv elements", () => {
        // Never through a shell: file names carry quotes, spaces and semicolons, and an author's
        // file name must not be able to become a command.
        expect(valueAfter(args, "-i")).toBe("/in/clip.avi");
        expect(args[args.length - 1]).toBe("/out/tmp.part");
    });
});

describe("transcodeArgs / reencode", () => {
    it("configures both encoders when the file has video and audio", () => {
        const args = transcodeArgs(
            { kind: "reencode", container: "webm", video: "vp9", audio: "vorbis" },
            "/in/a.mp4",
            "/out/tmp.part",
        );
        expect(valueAfter(args, "-c:v")).toBe("libvpx-vp9");
        expect(valueAfter(args, "-c:a")).toBe("libvorbis");
        expect(valueAfter(args, "-f")).toBe("webm");
    });

    it("pairs -crf with -b:v 0, without which libvpx ignores the quality it was given", () => {
        const args = transcodeArgs(
            { kind: "reencode", container: "webm", video: "vp9", audio: null },
            "/in/a.mp4",
            "/out/tmp.part",
        );
        expect(valueAfter(args, "-b:v")).toBe("0");
        expect(valueAfter(args, "-crf")).toBe("32");
    });

    it("forces VP9 profile 0, so a 10-bit or 4:2:2 source does not become an unplayable file", () => {
        const args = transcodeArgs(
            { kind: "reencode", container: "webm", video: "vp9", audio: null },
            "/in/phone.mp4",
            "/out/tmp.part",
        );
        expect(valueAfter(args, "-pix_fmt")).toBe("yuv420p");
    });

    it("configures no video encoder and maps no video when the source has none", () => {
        const args = transcodeArgs(
            { kind: "reencode", container: "mp4", video: null, audio: "aac" },
            "/in/a.mkv",
            "/out/tmp.part",
        );
        expect(args).not.toContain("-c:v");
        expect(args).not.toContain("0:V?");
        // And in particular no `-vn`: "there is no video" needs no flag, and the flag that says
        // "drop the video" is one keystroke from the flag that drops the audio instead.
        expect(args).not.toContain("-vn");
        expect(args).not.toContain("-an");
        expect(valueAfter(args, "-c:a")).toBe("aac");
        expect(valueAfter(args, "-f")).toBe("mp4");
    });

    it("configures no audio encoder and maps no audio when the source has none", () => {
        const args = transcodeArgs(
            { kind: "reencode", container: "webm", video: "vp9", audio: null },
            "/in/silent.mov",
            "/out/tmp.part",
        );
        expect(args).not.toContain("-c:a");
        expect(args).not.toContain("0:a?");
        expect(args).not.toContain("-an");
        expect(args).not.toContain("-vn");
    });

    it("uses the native AAC encoder, not the nonfree one the build does not ship", () => {
        const args = transcodeArgs(
            { kind: "reencode", container: "mp4", video: null, audio: "aac" },
            "/in/a.mkv",
            "/out/tmp.part",
        );
        expect(valueAfter(args, "-c:a")).toBe("aac");
        expect(args.join(" ")).not.toContain("libfdk");
    });
});

describe("transcodeArgs / image", () => {
    const args = transcodeArgs({ kind: "image", container: "png" }, "/in/art.tif", "/out/tmp.part");

    it("writes one frame of PNG through the image muxer", () => {
        expect(valueAfter(args, "-frames:v")).toBe("1");
        expect(valueAfter(args, "-c:v")).toBe("png");
        expect(valueAfter(args, "-f")).toBe("image2");
    });

    it("treats the output name as a literal, not as a frame-number pattern", () => {
        // Without `-update 1` the image2 muxer reads `%d` in the output name as a sequence pattern.
        expect(valueAfter(args, "-update")).toBe("1");
    });

    it("carries no quality parameter of any kind, because PNG is lossless", () => {
        // The conversion exists because the editor has no TIFF decoder, not because the file is
        // large. A quality knob here would silently degrade artwork the author believes was merely
        // relabelled - and the result would still open, so nothing downstream would notice.
        for (const knob of ["-crf", "-q:v", "-qscale", "-qscale:v", "-b:v", "-compression_level"]) {
            expect(args, knob).not.toContain(knob);
        }
    });
});

describe("mediaConvertTargetExtension", () => {
    it("writes an audio-only MP4 as .m4a", () => {
        expect(mediaConvertTargetExtension({ kind: "reencode", container: "mp4", video: null, audio: "aac" }))
            .toBe("m4a");
    });

    it("leaves every other target on its container's own name", () => {
        expect(mediaConvertTargetExtension({ kind: "reencode", container: "webm", video: "vp9", audio: "vorbis" }))
            .toBe("webm");
        expect(mediaConvertTargetExtension({ kind: "remux", container: "mp4", audioOnly: false })).toBe("mp4");
        expect(mediaConvertTargetExtension({ kind: "image", container: "png" })).toBe("png");
    });
});

describe("imageConvertTargetFor", () => {
    it("claims the three formats a browser cannot display", () => {
        for (const name of ["art.tif", "art.TIFF", "D:\\p\\icon.xbm"]) {
            expect(imageConvertTargetFor(name), name).toEqual({ kind: "image", container: "png" });
        }
    });

    it("leaves formats that already display alone", () => {
        for (const name of ["art.png", "art.webp", "art.jpg", "no-extension"]) {
            expect(imageConvertTargetFor(name), name).toBeNull();
        }
    });
});

describe("createProgressParser", () => {
    it("emits one record per progress block", () => {
        const parser = createProgressParser(10_000_000);
        const emitted = parser.push("bitrate=1kbits/s\nout_time_us=5000000\nprogress=continue\n");
        expect(emitted).toHaveLength(1);
        expect(emitted[0].outTimeUs).toBe(5_000_000);
        expect(emitted[0].fraction).toBeCloseTo(0.5);
    });

    it("reassembles a block split across chunks", () => {
        // A pipe splits wherever it likes, and a boundary in the middle of `out_time_us=` is
        // routine. A parser that treated each chunk as whole lines would report a position of zero
        // every time that happened.
        const parser = createProgressParser(10_000_000);
        expect(parser.push("out_time_us=25")).toEqual([]);
        expect(parser.push("00000\nprogr")).toEqual([]);
        const emitted = parser.push("ess=continue\n");
        expect(emitted).toHaveLength(1);
        expect(emitted[0].outTimeUs).toBe(2_500_000);
    });

    it("reports null rather than a fraction when the duration is unknown", () => {
        const parser = createProgressParser(null);
        const [progress] = parser.push("out_time_us=1000000\nprogress=end\n");
        // The image case, and the live-muxed-source case. Not zero, not an estimate: a bar that
        // invents a number for these reads as a hung conversion either way it guesses.
        expect(progress.fraction).toBeNull();
        expect(progress.durationUs).toBeNull();
        expect(progress.outTimeUs).toBe(1_000_000);
    });

    it("holds the last real position through ffmpeg's not-started sentinels", () => {
        const parser = createProgressParser(10_000_000);
        parser.push("out_time_us=3000000\nprogress=continue\n");
        // "N/A" before the first frame, and a large negative when the output is open but empty.
        const [progress] = parser.push("out_time_us=N/A\nprogress=continue\n");
        expect(progress.outTimeUs).toBe(3_000_000);
        const [next] = parser.push("out_time_us=-9223372036854775807\nprogress=continue\n");
        expect(next.outTimeUs).toBe(3_000_000);
    });

    it("falls back to the clock form only while the microsecond field has never been usable", () => {
        const parser = createProgressParser(7_200_000_000);
        const [first] = parser.push("out_time_us=N/A\nout_time=00:01:30.500000\nprogress=continue\n");
        expect(first.outTimeUs).toBe(90_500_000);
        // Once the microsecond field works, the clock form is ignored, so the two can never disagree.
        const [second] = parser.push("out_time_us=95000000\nout_time=00:00:01.000000\nprogress=continue\n");
        expect(second.outTimeUs).toBe(95_000_000);
    });

    it("clamps a position past the declared duration", () => {
        // ffmpeg routinely writes a few frames past a container's stated length. 103% is a bug report.
        const parser = createProgressParser(1_000_000);
        const [progress] = parser.push("out_time_us=1030000\nprogress=end\n");
        expect(progress.fraction).toBe(1);
    });

    it("emits nothing for a stream that never completes a block", () => {
        const parser = createProgressParser(1_000_000);
        expect(parser.push("out_time_us=500000\n")).toEqual([]);
    });
});

/* -------------------------------------------------------------------------------------------- */
/* Running                                                                                        */
/* -------------------------------------------------------------------------------------------- */

/** A stand-in for a spawned ffmpeg, driven by the test rather than by a process. */
class FakeChild extends EventEmitter implements TranscodeChildProcess {
    readonly stdout = new EventEmitter();
    readonly stderr = new EventEmitter();
    public killedWith: string[] = [];
    /** What the fake "writes" when it is allowed to finish. */
    public output: string | null = "converted bytes";
    private outputPath = "";

    setOutputPath(outputPath: string): void {
        this.outputPath = outputPath;
    }

    kill(signal?: string): boolean {
        this.killedWith.push(signal ?? "SIGTERM");
        // A killed ffmpeg leaves its partial output on disk. Reproducing that is the whole point:
        // a fake that tidied up after itself could not show that cancellation cleans up.
        setImmediate(() => this.emit("close", null, signal ?? "SIGTERM"));
        return true;
    }

    /** Exit with a code, having written the partial/complete file first. */
    async finish(code: number, stderr = ""): Promise<void> {
        if (this.output !== null) {
            await fs.writeFile(this.outputPath, this.output);
        }
        if (stderr) {
            this.stderr.emit("data", stderr);
        }
        this.emit("close", code, null);
    }

    /** Write the partial file the way a running conversion would, without exiting. */
    async writePartial(): Promise<void> {
        await fs.writeFile(this.outputPath, "half a file");
    }
}

describe("startMediaTranscode", () => {
    let dir = "";
    let source = "";
    let target = "";

    beforeEach(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-transcode-"));
        source = path.join(dir, "in.mkv");
        target = path.join(dir, "out.webm");
        await fs.writeFile(source, "source bytes");
    });

    afterEach(async () => {
        await fs.rm(dir, { recursive: true, force: true });
    });

    function request(overrides: Partial<MediaConvertRequest> = {}): MediaConvertRequest {
        return {
            sourcePath: source,
            targetPath: target,
            target: { kind: "reencode", container: "webm", video: "vp9", audio: "vorbis" },
            durationUs: 1_000_000,
            ...overrides,
        };
    }

    /** A spawn that hands the fake child back to the test through a promise. */
    function spawningInto(children: FakeChild[]): TranscodeSpawn {
        return (_binary, args) => {
            const child = new FakeChild();
            // The last argument is the temporary path, which the test needs in order to act like
            // ffmpeg and write there.
            child.setOutputPath(args[args.length - 1]);
            children.push(child);
            return child;
        };
    }

    /**
     * Wait until the spawn has happened.
     *
     * Waits on a clock rather than on a tick count. Two `fs.stat` calls run before the spawn, and a
     * `setImmediate` loop spins through hundreds of iterations without either of them completing
     * when the filesystem threadpool is busy - which it is whenever the rest of the suite is running
     * beside this one. Counting ticks made this pass alone and fail under load.
     */
    async function nextChild(children: FakeChild[]): Promise<FakeChild> {
        const deadline = Date.now() + 10_000;
        while (children.length === 0 && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 2));
        }
        expect(children.length).toBeGreaterThan(0);
        return children[0];
    }

    /** Every entry in the working directory, so a leftover scratch file is visible. */
    async function entries(): Promise<string[]> {
        return (await fs.readdir(dir)).sort();
    }

    it("lands the finished file at the target and leaves no scratch file behind", async () => {
        const children: FakeChild[] = [];
        const handle = startMediaTranscode("ffmpeg", request(), { spawnProcess: spawningInto(children) });
        const child = await nextChild(children);
        await child.finish(0);

        const result = await handle.result;
        expect(result).toEqual({ status: "done", outputPath: target });
        expect(await entries()).toEqual(["in.mkv", "out.webm"]);
        expect(await fs.readFile(target, "utf8")).toBe("converted bytes");
    });

    it("never writes to the source", async () => {
        const children: FakeChild[] = [];
        const handle = startMediaTranscode("ffmpeg", request(), { spawnProcess: spawningInto(children) });
        const child = await nextChild(children);
        await child.finish(0);
        await handle.result;
        expect(await fs.readFile(source, "utf8")).toBe("source bytes");
    });

    it("reports the source missing, before spawning anything", async () => {
        const children: FakeChild[] = [];
        await fs.rm(source);
        const handle = startMediaTranscode("ffmpeg", request(), { spawnProcess: spawningInto(children) });
        const result = await handle.result;
        expect(result).toMatchObject({ status: "error", reason: "source-missing" });
        expect(children).toHaveLength(0);
    });

    it("refuses an occupied target instead of overwriting it", async () => {
        const children: FakeChild[] = [];
        await fs.writeFile(target, "something the author cares about");
        const handle = startMediaTranscode("ffmpeg", request(), { spawnProcess: spawningInto(children) });
        const result = await handle.result;
        expect(result).toMatchObject({ status: "error", reason: "target-exists" });
        expect(children).toHaveLength(0);
        expect(await fs.readFile(target, "utf8")).toBe("something the author cares about");
    });

    it("reports spawn failure when the process cannot be started", async () => {
        const handle = startMediaTranscode("ffmpeg", request(), {
            spawnProcess: () => {
                throw Object.assign(new Error("spawn ffmpeg EACCES"), { code: "EACCES" });
            },
        });
        const result = await handle.result;
        expect(result).toMatchObject({ status: "error", reason: "spawn-failed" });
        expect(await entries()).toEqual(["in.mkv"]);
    });

    it("reports a non-zero exit with the tail of stderr, not the whole of it", async () => {
        const children: FakeChild[] = [];
        const handle = startMediaTranscode("ffmpeg", request(), { spawnProcess: spawningInto(children) });
        const child = await nextChild(children);
        const noise = Array.from({ length: 400 }, (_, index) => `line ${index}`).join("\n");
        await child.finish(1, `${noise}\nInvalid data found when processing input\n`);

        const result = await handle.result;
        expect(result).toMatchObject({ status: "error", reason: "exited" });
        if (result.status !== "error") return;
        expect(result.detail).toContain("Invalid data found when processing input");
        // The whole of a failed encode's stderr is thousands of lines and unreadable in a dialog.
        expect(result.detail).not.toContain("line 0");
        expect(result.detail.length).toBeLessThan(1000);
        // And the partial output is gone, so nothing downstream can mistake it for a result.
        expect(await entries()).toEqual(["in.mkv"]);
    });

    it("blames the source, not the encoder, when the source vanished mid-run", async () => {
        const children: FakeChild[] = [];
        const handle = startMediaTranscode("ffmpeg", request(), { spawnProcess: spawningInto(children) });
        const child = await nextChild(children);
        await fs.rm(source);
        await child.finish(1, "Error opening input: No such file or directory\n");

        const result = await handle.result;
        // Two different sentences to show an author, and only one of them names something they can
        // do about it.
        expect(result).toMatchObject({ status: "error", reason: "source-missing" });
    });

    it("cancels, kills the process, and deletes the partial file", async () => {
        const children: FakeChild[] = [];
        const handle = startMediaTranscode("ffmpeg", request(), { spawnProcess: spawningInto(children) });
        const child = await nextChild(children);
        await child.writePartial();
        expect(await entries()).toHaveLength(2);

        handle.cancel();
        const result = await handle.result;
        expect(result).toEqual({ status: "cancelled" });
        expect(child.killedWith).toContain("SIGTERM");
        // The scratch file is gone. A surviving one is indistinguishable from a finished conversion
        // to whatever runs next, and the next thing here is an asset import.
        expect(await entries()).toEqual(["in.mkv"]);
    });

    it("spawns nothing at all when cancelled before the checks finish", async () => {
        const children: FakeChild[] = [];
        const handle = startMediaTranscode("ffmpeg", request(), { spawnProcess: spawningInto(children) });
        handle.cancel();
        const result = await handle.result;
        expect(result).toEqual({ status: "cancelled" });
        expect(children).toHaveLength(0);
    });

    it("tolerates being cancelled twice", async () => {
        const children: FakeChild[] = [];
        const handle = startMediaTranscode("ffmpeg", request(), { spawnProcess: spawningInto(children) });
        const child = await nextChild(children);
        handle.cancel();
        handle.cancel();
        expect(await handle.result).toEqual({ status: "cancelled" });
        expect(child.killedWith.length).toBeGreaterThanOrEqual(1);
    });

    it("reports progress from the process as it runs", async () => {
        const children: FakeChild[] = [];
        const seen: (number | null)[] = [];
        const handle = startMediaTranscode("ffmpeg", request(), {
            spawnProcess: spawningInto(children),
            onProgress: progress => seen.push(progress.fraction),
        });
        const child = await nextChild(children);
        child.stdout.emit("data", Buffer.from("out_time_us=250000\nprogress=continue\n"));
        child.stdout.emit("data", Buffer.from("out_time_us=750000\nprogress=continue\n"));
        await child.finish(0);
        await handle.result;
        expect(seen).toEqual([0.25, 0.75]);
    });

    it("reports no percentage for an image, whatever duration it was handed", async () => {
        const children: FakeChild[] = [];
        const seen: (number | null)[] = [];
        // ffprobe reports a nominal fraction of a second for a single-frame input. Dividing by it
        // would produce a bar that jumps to 100% and then waits for the encode.
        const handle = startMediaTranscode("ffmpeg", request({
            target: { kind: "image", container: "png" },
            targetPath: path.join(dir, "out.png"),
            durationUs: 40_000,
        }), {
            spawnProcess: spawningInto(children),
            onProgress: progress => seen.push(progress.fraction),
        });
        const child = await nextChild(children);
        child.stdout.emit("data", "out_time_us=40000\nprogress=end\n");
        await child.finish(0);
        await handle.result;
        expect(seen).toEqual([null]);
    });
});
