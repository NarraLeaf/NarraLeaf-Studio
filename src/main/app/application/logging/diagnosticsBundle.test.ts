import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_LOG_TAIL_BYTES,
  composeDiagnosticsBundle,
  readMainLogTail,
  sanitizeBundleFileName,
  type DiagnosticsEnvironment
} from "./diagnosticsBundle";

const ENVIRONMENT: DiagnosticsEnvironment = {
  appVersion: "1.2.3",
  electronVersion: "38.0.0",
  chromeVersion: "140.0.0.0",
  nodeVersion: "22.0.0",
  platform: "win32",
  osRelease: "10.0.26200",
  arch: "x64",
  packaged: false,
  locale: "zh",
  userDataDir: "C:\\Users\\author\\AppData\\Roaming\\NarraLeaf Studio",
  logsDir: "C:\\Users\\author\\AppData\\Roaming\\NarraLeaf Studio\\logs",
  generatedAt: "2026-07-31T09:00:00.000Z"
};

describe("sanitizeBundleFileName", () => {
  it("keeps an ordinary name", () => {
    expect(
      sanitizeBundleFileName("narraleaf-studio-workspace-init-20260731-120000.log", "fallback.log")
    ).toBe("narraleaf-studio-workspace-init-20260731-120000.log");
  });

  it("reduces a path to its basename, so a renderer cannot steer the dialog", () => {
    expect(sanitizeBundleFileName("../../evil/report.log", "fallback.log")).toBe("report.log");
    expect(sanitizeBundleFileName("C:\\Windows\\System32\\report.log", "fallback.log")).toBe(
      "report.log"
    );
  });

  it("drops reserved characters and falls back when nothing is left", () => {
    expect(sanitizeBundleFileName("re:po*rt", "fallback.log")).toBe("report.log");
    expect(sanitizeBundleFileName("   ", "fallback.log")).toBe("fallback.log");
    expect(sanitizeBundleFileName("...", "fallback.log")).toBe("fallback.log");
  });

  it("appends .log unless the name already carries a text extension", () => {
    expect(sanitizeBundleFileName("report", "fallback.log")).toBe("report.log");
    expect(sanitizeBundleFileName("report.txt", "fallback.log")).toBe("report.txt");
    expect(sanitizeBundleFileName("report.LOG", "fallback.log")).toBe("report.LOG");
  });

  // The settings export reuses this and does NOT want a log extension. It inherited the
  // diagnostics pair once and offered to save `…-settings.json.log`.
  it("honours a caller's own extension set", () => {
    expect(
      sanitizeBundleFileName("narraleaf-studio-settings.json", "fallback.json", [".json"])
    ).toBe("narraleaf-studio-settings.json");
    expect(sanitizeBundleFileName("my-settings", "fallback.json", [".json"])).toBe(
      "my-settings.json"
    );
    expect(sanitizeBundleFileName("my-settings.JSON", "fallback.json", [".json"])).toBe(
      "my-settings.JSON"
    );
    // A name carrying the *other* caller's extension is still corrected to this caller's.
    expect(sanitizeBundleFileName("settings.log", "fallback.json", [".json"])).toBe(
      "settings.log.json"
    );
  });
});

describe("readMainLogTail", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-diag-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns a note instead of throwing when there is no log", async () => {
    const tail = await readMainLogTail(dir);
    expect(tail).toContain("no main.log");
    expect(tail).toContain(dir);
  });

  it("returns the whole file when it fits", async () => {
    await fs.writeFile(path.join(dir, "main.log"), "one\ntwo\nthree\n", "utf-8");
    expect(await readMainLogTail(dir)).toBe("one\ntwo\nthree\n");
  });

  it("keeps the tail and drops the partial first line", async () => {
    const lines = Array.from({ length: 200 }, (_, index) => `line-${index}`).join("\n");
    await fs.writeFile(path.join(dir, "main.log"), lines, "utf-8");

    const tail = await readMainLogTail(dir, 40);

    expect(tail).toContain("truncated");
    expect(tail).toContain("line-199");
    expect(tail).not.toContain("line-0\n");
    // The byte offset lands mid-line; that half line must not be reported as a log line.
    const body = tail.split("\n").slice(1);
    expect(body.every((line) => line === "" || /^line-\d+$/.test(line))).toBe(true);
  });
});

describe("composeDiagnosticsBundle", () => {
  it("keeps Windows paths exactly as given", () => {
    const bundle = composeDiagnosticsBundle(
      ENVIRONMENT,
      "--- Report ---\nProject path: D:\\Dev\\Game One",
      "2026-07-31T09:00:00.000Z [INFO] [Main] started"
    );

    expect(bundle).toContain("D:\\Dev\\Game One");
    expect(bundle).toContain("C:\\Users\\author\\AppData\\Roaming\\NarraLeaf Studio\\logs");
  });

  it("puts the report before the log tail", () => {
    const bundle = composeDiagnosticsBundle(ENVIRONMENT, "REPORT-MARKER", "LOG-MARKER");

    expect(bundle.indexOf("=== NarraLeaf Studio diagnostics ===")).toBeLessThan(
      bundle.indexOf("REPORT-MARKER")
    );
    expect(bundle.indexOf("REPORT-MARKER")).toBeLessThan(bundle.indexOf("LOG-MARKER"));
    expect(bundle).toContain(String(MAX_LOG_TAIL_BYTES));
  });

  it("marks a development build", () => {
    expect(composeDiagnosticsBundle(ENVIRONMENT, "", "")).toContain("development build");
    expect(composeDiagnosticsBundle({ ...ENVIRONMENT, packaged: true }, "", "")).not.toContain(
      "development build"
    );
  });
});
