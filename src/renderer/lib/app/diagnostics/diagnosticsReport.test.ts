import { describe, expect, it } from "vitest";
import { buildDiagnosticsFileName, buildDiagnosticsReport } from "./diagnosticsReport";

describe("buildDiagnosticsReport", () => {
  it("carries the error message and stack", () => {
    const error = new Error("Selected folder is not a NarraLeaf project.");
    error.stack =
      "Error: Selected folder is not a NarraLeaf project.\n    at start (app://studio/index.js:1:1)";

    const report = buildDiagnosticsReport({ scope: "workspace-init", error, consoleLines: [] });

    expect(report).toContain("Selected folder is not a NarraLeaf project.");
    expect(report).toContain("at start (app://studio/index.js:1:1)");
  });

  /**
   * The complaint this screen was rebuilt for: the path on it could not be copied, so nobody
   * could tell whether Studio had mangled it or whether it really was mangled on disk. The
   * report has to reproduce whatever it was handed, byte for byte.
   */
  it("reproduces a Windows path verbatim, separators and all", () => {
    const projectPath = "C:\\Users\\hello\\AppData\\Local\\Temp\\claude\\demo-project";

    const report = buildDiagnosticsReport({
      scope: "workspace-init",
      error: new Error("boom"),
      facts: { "Project path": projectPath },
      consoleLines: []
    });

    expect(report).toContain(`Project path: ${projectPath}`);
  });

  it("states an absent fact rather than dropping it", () => {
    const report = buildDiagnosticsReport({
      scope: "workspace-init",
      facts: { "Project path": null, Skipped: undefined },
      consoleLines: []
    });

    expect(report).toContain("Project path: <none>");
    expect(report).not.toContain("Skipped");
    expect(report).toContain("<none>");
  });

  it("includes the console tail it is given", () => {
    const report = buildDiagnosticsReport({
      scope: "workspace-init",
      consoleLines: ["2026-07-31T09:00:00.000Z [ERROR] Failed to initialize workspace"]
    });

    expect(report).toContain("Failed to initialize workspace");
    expect(report).toContain("last 1 lines");
  });

  it("does not repeat the headline the stack already carries", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at start (app://studio/index.js:1:1)";

    const report = buildDiagnosticsReport({ scope: "s", error, consoleLines: [] });

    expect(report.split("Error: boom")).toHaveLength(2);
  });

  it("keeps the headline when the stack does not open with it", () => {
    const error = new Error("boom");
    error.stack = "    at start (app://studio/index.js:1:1)";

    expect(buildDiagnosticsReport({ scope: "s", error, consoleLines: [] })).toContain(
      "Error: boom"
    );
  });

  it("reports a cause chain", () => {
    const error = new Error("outer", { cause: new Error("inner") });

    expect(buildDiagnosticsReport({ scope: "s", error, consoleLines: [] })).toContain("inner");
  });
});

describe("buildDiagnosticsFileName", () => {
  it("stamps local time in a sortable order", () => {
    const name = buildDiagnosticsFileName("workspace-init", new Date(2026, 6, 31, 14, 5, 9));

    expect(name).toBe("narraleaf-studio-workspace-init-20260731-140509.log");
  });
});
