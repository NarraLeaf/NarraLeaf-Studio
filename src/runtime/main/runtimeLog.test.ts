import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatRuntimeLogLine,
  installRuntimeLogSink,
  RUNTIME_LOG_MAX_BYTES,
  runtimeLogPath
} from "./runtimeLog";

describe("formatRuntimeLogLine", () => {
  it("writes a sortable timestamp, the level, and the message", () => {
    const line = formatRuntimeLogLine(
      "warning",
      "Asset preload timed out",
      new Date(Date.UTC(2026, 7, 11, 9, 30, 0))
    );

    expect(line).toBe("2026-08-11T09:30:00.000Z [WARNING] Asset preload timed out\n");
  });
});

describe("installRuntimeLogSink", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nls-runtime-log-"));
    // The sink mirrors to the console, which is right in a real run and noise in a test.
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes to a file that outlives the session", () => {
    const log = installRuntimeLogSink(dir);

    log("error", "Blueprint execution failed");

    expect(fs.readFileSync(runtimeLogPath(dir), "utf-8")).toContain(
      "[ERROR] Blueprint execution failed"
    );
  });

  it("creates the logs directory when the profile is new", () => {
    installRuntimeLogSink(dir)("info", "first line");

    expect(fs.existsSync(path.join(dir, "logs"))).toBe(true);
  });

  it("appends rather than replacing across sessions", () => {
    installRuntimeLogSink(dir)("info", "first session");
    installRuntimeLogSink(dir)("info", "second session");

    const contents = fs.readFileSync(runtimeLogPath(dir), "utf-8");
    expect(contents).toContain("first session");
    expect(contents).toContain("second session");
  });

  it("rotates once so a runaway warning cannot fill the player's disk", () => {
    const filePath = runtimeLogPath(dir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "x".repeat(RUNTIME_LOG_MAX_BYTES + 1), "utf-8");

    installRuntimeLogSink(dir)("info", "after rotation");

    expect(fs.readFileSync(filePath, "utf-8")).toContain("after rotation");
    expect(fs.statSync(filePath).size).toBeLessThan(RUNTIME_LOG_MAX_BYTES);
    expect(fs.existsSync(`${filePath}.1`)).toBe(true);
  });

  it("keeps the console mirror, which is how preview reaches Studio's console panel", () => {
    installRuntimeLogSink(dir)("warning", "something to say");

    expect(console.warn).toHaveBeenCalledWith("[GameRuntime] something to say");
  });

  it("does not throw when the log cannot be written at all", () => {
    // A profile directory that is really a file: nothing can be created under it.
    const blocked = path.join(dir, "blocked");
    fs.writeFileSync(blocked, "not a directory", "utf-8");

    const log = installRuntimeLogSink(blocked);

    expect(() => log("error", "still has to reach the console")).not.toThrow();
    expect(console.error).toHaveBeenCalledWith("[GameRuntime] still has to reach the console");
  });
});
