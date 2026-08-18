import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportService } from "./importService";

const mocks = vi.hoisted(() => ({
  workspace: { importProjectPackage: vi.fn() },
  fs: { list: vi.fn() },
  selectProjectPackage: vi.fn()
}));

vi.mock("@/lib/app/bridge", () => ({
  getInterface: () => ({
    workspace: mocks.workspace,
    fs: mocks.fs,
    selectProjectPackage: mocks.selectProjectPackage
  })
}));

vi.mock("@/lib/i18n", () => ({
  translate: (key: string) => key
}));

const PACKAGE = "D:/Downloads/My-Game.nlspkg";
const TARGET = "D:/Projects/unpacked";

function listing(entries: { name: string; ext: string | null; type: string }[]) {
  return { success: true, data: { ok: true, data: entries } };
}

const STUDIO_PROJECT = listing([{ name: "MyGame", ext: ".nlproj", type: "file" }]);
const LEGACY_PROJECT = listing([{ name: "project", ext: ".json", type: "file" }]);
const NOT_A_PROJECT = listing([{ name: "notes", ext: ".txt", type: "file" }]);

function unpacked(extra: Record<string, unknown> = {}) {
  return {
    success: true,
    data: { projectPath: TARGET, projectName: "My Game", fileCount: 120, ...extra }
  };
}

const runImport = () => ImportService.importProject(PACKAGE, TARGET);

describe("ImportService.selectPackage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("hands back the chosen file", async () => {
    mocks.selectProjectPackage.mockResolvedValue({ success: true, data: { dest: PACKAGE } });

    expect(await ImportService.selectPackage()).toBe(PACKAGE);
  });

  /**
   * Backing out of a file dialog is an ordinary thing to do, so it answers the same way as
   * choosing nothing: the page keeps whatever it already had, and nothing is reported.
   */
  it("answers null for a dismissed dialog", async () => {
    mocks.selectProjectPackage.mockResolvedValue({ success: true, data: { dest: null } });

    expect(await ImportService.selectPackage()).toBeNull();
  });

  it("answers null rather than throwing when the picker itself fails", async () => {
    mocks.selectProjectPackage.mockRejectedValue(new Error("no window"));

    expect(await ImportService.selectPackage()).toBeNull();
  });
});

describe("ImportService.importProject", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("unpacks the chosen package into the chosen folder", async () => {
    mocks.workspace.importProjectPackage.mockResolvedValue(unpacked());
    mocks.fs.list.mockResolvedValue(STUDIO_PROJECT);

    expect(await runImport()).toEqual({
      status: "imported",
      root: TARGET,
      projectName: "My Game",
      fileCount: 120
    });
    expect(mocks.workspace.importProjectPackage).toHaveBeenCalledWith(PACKAGE, TARGET);
  });

  it("accepts a legacy project.json layout", async () => {
    mocks.workspace.importProjectPackage.mockResolvedValue(unpacked());
    mocks.fs.list.mockResolvedValue(LEGACY_PROJECT);

    expect((await runImport()).status).toBe("imported");
  });

  /**
   * A `.nlspkg` is an archive, and an archive can hold anything. Studio writes these itself so
   * the usual case passes - which is exactly what makes a missing check here survive testing and
   * then hand the launcher a folder it cannot open.
   */
  it("refuses a package that unpacked into something Studio cannot open", async () => {
    mocks.workspace.importProjectPackage.mockResolvedValue(unpacked());
    mocks.fs.list.mockResolvedValue(NOT_A_PROJECT);

    expect(await runImport()).toEqual({ status: "notAProject", root: TARGET });
  });

  it("passes the main process's own refusal through", async () => {
    mocks.workspace.importProjectPackage.mockResolvedValue({
      success: false,
      error: "Selected import folder is inside protected Studio storage."
    });

    expect(await runImport()).toEqual({
      status: "failed",
      error: "Selected import folder is inside protected Studio storage."
    });
    expect(mocks.fs.list).not.toHaveBeenCalled();
  });

  it("survives a thrown error", async () => {
    mocks.workspace.importProjectPackage.mockRejectedValue(new Error("unreadable archive"));

    expect(await runImport()).toEqual({ status: "failed", error: "unreadable archive" });
  });
});
