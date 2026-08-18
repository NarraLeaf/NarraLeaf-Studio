import { beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { defaultProjectData } from "../constants";
import type { ProjectData } from "../types";
import { ValidationService } from "./validationService";

const mocks = vi.hoisted(() => ({
  fs: {
    isDirExists: vi.fn(),
    isDir: vi.fn(),
    list: vi.fn()
  }
}));

vi.mock("@/lib/app/bridge", () => ({
  getInterface: () => ({
    fs: mocks.fs
  })
}));

const data = (over: Partial<ProjectData> = {}): ProjectData => ({ ...defaultProjectData, ...over });

describe("which page may be left", () => {
  it("waits for a template only in the flow that uses one", () => {
    expect(ValidationService.isStepValid("origin", data(), "create")).toBe(false);
    expect(ValidationService.isStepValid("origin", data({ template: "empty" }), "create")).toBe(
      true
    );
    expect(ValidationService.isStepValid("origin", data(), "import")).toBe(true);
    expect(ValidationService.isStepValid("origin", data(), "clone")).toBe(true);
  });

  /** Both answers are picked on the page, so both gate the button that unpacks. */
  it("holds the import page until a package and a folder are both chosen", () => {
    expect(ValidationService.isStepValid("import", data(), "import")).toBe(false);
    expect(
      ValidationService.isStepValid(
        "import",
        data({
          packagePath: "D:/Downloads/My-Game.nlspkg"
        }),
        "import"
      )
    ).toBe(false);
    expect(
      ValidationService.isStepValid(
        "import",
        data({
          location: "D:/Projects/my-game"
        }),
        "import"
      )
    ).toBe(false);
    expect(
      ValidationService.isStepValid(
        "import",
        data({
          packagePath: "D:/Downloads/My-Game.nlspkg",
          location: "D:/Projects/my-game"
        }),
        "import"
      )
    ).toBe(true);
  });

  it("holds the project page until the three permanent answers are there", () => {
    expect(ValidationService.isStepValid("project", data({ name: "Game" }), "create")).toBe(false);
    expect(
      ValidationService.isStepValid(
        "project",
        data({
          name: "Game",
          appId: "game",
          location: "D:/Projects/game"
        }),
        "create"
      )
    ).toBe(true);
  });

  it("refuses an app id the project could not be identified by", () => {
    expect(
      ValidationService.isStepValid(
        "project",
        data({
          name: "Game",
          appId: "Game Two",
          location: "D:/Projects/game"
        }),
        "create"
      )
    ).toBe(false);
  });

  /**
   * An out-of-range custom size leaves `resolution` empty rather than at its last good value,
   * so this is the only thing standing between a typed mistake and a project written at a stage
   * nobody chose.
   */
  it("refuses a stage page whose typed size was cleared as unusable", () => {
    expect(ValidationService.isStepValid("stage", data({ resolution: "" }), "create")).toBe(false);
    expect(
      ValidationService.isStepValid("stage", data({ resolution: "1080x1920" }), "create")
    ).toBe(true);
  });

  it("re-asserts every earlier gate on the page that writes", () => {
    const complete = data({
      name: "Game",
      appId: "game",
      location: "D:/Projects/game",
      resolution: "1920x1080"
    });
    expect(ValidationService.isStepValid("review", complete, "create")).toBe(true);
    expect(ValidationService.isStepValid("review", { ...complete, resolution: "" }, "create")).toBe(
      false
    );
    expect(ValidationService.isStepValid("review", { ...complete, appId: "" }, "create")).toBe(
      false
    );
  });
});

describe("ValidationService directory validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reports permission errors instead of treating denied paths as creatable", async () => {
    mocks.fs.isDirExists.mockResolvedValue({
      success: true,
      data: {
        ok: false,
        error: {
          code: FsRejectErrorCode.PERMISSION_DENIED,
          message: "File system access is not allowed for path: /Users/me/Documents/Game"
        }
      }
    });

    const result = await ValidationService.validateProjectDirectory("/Users/me/Documents/Game");

    expect(result.success).toBe(false);
    expect(result.errors.directory).toBe(
      "File system access is not allowed for path: /Users/me/Documents/Game"
    );
    expect(mocks.fs.isDirExists).toHaveBeenCalledWith("/Users/me/Documents/Game");
    expect(mocks.fs.isDir).not.toHaveBeenCalled();
    expect(mocks.fs.list).not.toHaveBeenCalled();
  });

  it("allows an authorized project directory that will be created later", async () => {
    mocks.fs.isDirExists.mockResolvedValue({
      success: true,
      data: {
        ok: true,
        data: false
      }
    });

    const result = await ValidationService.validateProjectDirectory("/Users/me/Documents/Game");

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      exists: false,
      isDirectory: false,
      isEmpty: true,
      canWrite: true
    });
    expect(mocks.fs.isDir).not.toHaveBeenCalled();
    expect(mocks.fs.list).not.toHaveBeenCalled();
  });
});
