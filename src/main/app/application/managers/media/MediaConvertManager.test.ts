import { EventEmitter } from "events";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger, type LogEntry } from "@shared/utils/logger";
import type { MediaConvertRequest } from "@shared/types/mediaConvert";
import { MediaConvertManager } from "./MediaConvertManager";
import type { FfmpegResolverApp } from "./ffmpegTool";
import type { TranscodeChildProcess, TranscodeSpawn } from "./mediaTranscode";

/**
 * That a failed conversion leaves a diagnosable trace.
 *
 * Nothing on screen carries ffmpeg's own words - by design, see the class doc - so the log file is
 * the only place they exist. That makes "the stderr reached a sink" the whole feature, and it is
 * exactly the kind of wiring that survives a refactor as a call that no longer says anything.
 *
 * What ffmpeg is *asked* is tested in `mediaTranscode.test.ts` against argv. This file only asserts
 * what comes back out.
 */

/** An app that claims the staged binary is right here - this file, which certainly exists. */
const presentToolApp: FfmpegResolverApp = {
  isPackaged: () => true,
  resolveResource: () => __filename
};

/** An app whose resources directory holds nothing, the way an unstaged checkout's does. */
const missingToolApp: FfmpegResolverApp = {
  isPackaged: () => true,
  resolveResource: (p: string) => path.join("/nonexistent-resources", p)
};

/** The minimum of a child process this module drives, with the exit under the test's control. */
class FakeChild extends EventEmitter implements TranscodeChildProcess {
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  private outputPath = "";

  setOutputPath(value: string): void {
    this.outputPath = value;
  }

  kill(): boolean {
    return true;
  }

  /** Act like ffmpeg: say something on stderr, maybe write the file, then exit. */
  async finish(code: number, stderr?: string): Promise<void> {
    if (code === 0) {
      await fs.writeFile(this.outputPath, "converted bytes");
    }
    if (stderr) {
      this.stderr.emit("data", stderr);
    }
    this.emit("close", code, null);
  }
}

describe("MediaConvertManager logging", () => {
  let dir = "";
  let source = "";
  let target = "";
  let entries: LogEntry[] = [];
  let removeSink: () => void = () => undefined;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-convert-log-"));
    source = path.join(dir, "in.mkv");
    target = path.join(dir, "out.webm");
    await fs.writeFile(source, "source bytes");
    entries = [];
    removeSink = Logger.addSink((entry) => entries.push(entry));
    // The logger writes to the console before it reaches a sink, and a failing conversion is
    // the normal case in this file. Silenced so a passing run is quiet.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    removeSink();
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  function request(): MediaConvertRequest {
    return {
      sourcePath: source,
      targetPath: target,
      target: { kind: "reencode", container: "webm", video: "vp9", audio: "vorbis" },
      durationUs: 1_000_000
    };
  }

  /** A spawn that hands the fake child back to the test. */
  function spawningInto(children: FakeChild[]): TranscodeSpawn {
    return (_binary, args) => {
      const child = new FakeChild();
      // The last argument is the temporary path the conversion writes to.
      child.setOutputPath(args[args.length - 1]);
      children.push(child);
      return child;
    };
  }

  async function nextChild(children: FakeChild[]): Promise<FakeChild> {
    const deadline = Date.now() + 10_000;
    while (children.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(children.length).toBeGreaterThan(0);
    return children[0];
  }

  /** Poll the way a renderer does, until the job stops being in flight. */
  async function settle(manager: MediaConvertManager, jobId: string): Promise<string> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const status = manager.getStatus(jobId).status;
      if (status !== "converting") {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    throw new Error("the conversion never finished");
  }

  function errorLines(): string {
    return entries
      .filter((entry) => entry.level === "error")
      .map((entry) => entry.message)
      .join("\n");
  }

  it("writes ffmpeg's own output to the log when a conversion fails", async () => {
    const children: FakeChild[] = [];
    const manager = new MediaConvertManager(presentToolApp);
    const opened = await manager.start(request(), { spawnProcess: spawningInto(children) });
    const child = await nextChild(children);
    await child.finish(1, "[libvpx-vp9 @ 0x1] Unknown encoder 'libvpx-vp9'\nConversion failed!\n");

    expect(await settle(manager, opened.jobId)).toBe("error");

    const logged = errorLines();
    // The encoder's words, verbatim. This is the line that has no other home: the snapshot the
    // dialog reads carries only the one-sentence `detail`.
    expect(logged).toContain("Unknown encoder 'libvpx-vp9'");
    expect(logged).toContain("Conversion failed!");
    // And enough around them to tell two concurrent conversions apart.
    expect(logged).toContain(source);
    expect(logged).toContain(target);
    expect(logged).toContain("reencode -> webm");
  });

  it("says so rather than going quiet when ffmpeg failed without a word", async () => {
    const children: FakeChild[] = [];
    const manager = new MediaConvertManager(presentToolApp);
    const opened = await manager.start(request(), { spawnProcess: spawningInto(children) });
    const child = await nextChild(children);
    await child.finish(1);

    expect(await settle(manager, opened.jobId)).toBe("error");
    // An empty stderr is a finding - it rules out a decode error and points at the spawn - so
    // it must not read as "the log line is missing".
    expect(errorLines()).toContain("ffmpeg wrote nothing to stderr");
  });

  it("logs nothing at error level when the conversion succeeds", async () => {
    const children: FakeChild[] = [];
    const manager = new MediaConvertManager(presentToolApp);
    const opened = await manager.start(request(), { spawnProcess: spawningInto(children) });
    const child = await nextChild(children);
    await child.finish(0);

    expect(await settle(manager, opened.jobId)).toBe("done");
    expect(errorLines()).toBe("");
    expect(entries.some((entry) => entry.level === "info" && entry.message.includes(target))).toBe(
      true
    );
  });

  it("records a host with no ffmpeg as a warning rather than a failure", async () => {
    const manager = new MediaConvertManager(missingToolApp);
    const opened = await manager.start(request(), {
      spawnProcess: () => {
        throw new Error("nothing may be spawned when the tool is missing");
      }
    });

    expect(opened.status).toBe("unavailable");
    expect(errorLines()).toBe("");
    expect(
      entries.some((entry) => entry.level === "warn" && entry.message.includes("No ffmpeg"))
    ).toBe(true);
  });
});
