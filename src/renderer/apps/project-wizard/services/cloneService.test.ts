import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloneService } from "./cloneService";

const mocks = vi.hoisted(() => ({
  vcs: { clone: vi.fn() },
  fs: { list: vi.fn() }
}));

vi.mock("@/lib/app/bridge", () => ({
  getInterface: () => ({
    vcs: mocks.vcs,
    fs: mocks.fs
  })
}));

vi.mock("@/lib/i18n", () => ({
  translate: (key: string) => key
}));

const DESTINATION = "D:/Projects/my-game";

/** A listing of a folder that holds a Studio project, as `fs.list` reports one. */
function studioProjectListing() {
  return {
    success: true,
    data: {
      ok: true,
      data: [
        { name: ".lore", ext: null, type: "directory" },
        { name: "MyGame", ext: ".nlproj", type: "file" }
      ]
    }
  };
}

/** A repository that is not a Studio project - which every Lore server can also serve. */
function bareRepositoryListing() {
  return {
    success: true,
    data: {
      ok: true,
      data: [
        { name: ".lore", ext: null, type: "directory" },
        { name: "README", ext: ".md", type: "file" }
      ]
    }
  };
}

function cloneSucceeded() {
  return { success: true, data: { root: DESTINATION, branch: "main", fileCount: 42 } };
}

describe("CloneService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("refuses an address with no project name on it, without contacting anything", async () => {
    const result = await CloneService.cloneProject("lore://studio.example.lan:41337", DESTINATION);

    expect(result).toEqual({ status: "failed", error: "wizard.source.addressInvalid" });
    expect(mocks.vcs.clone).not.toHaveBeenCalled();
  });

  it("accepts a clone that brought down a Studio project", async () => {
    mocks.vcs.clone.mockResolvedValue(cloneSucceeded());
    mocks.fs.list.mockResolvedValue(studioProjectListing());

    const result = await CloneService.cloneProject(
      ` lore://studio.example.lan:41337/my-game `,
      DESTINATION
    );

    expect(result).toEqual({ status: "cloned", root: DESTINATION, fileCount: 42 });
    // Trimmed on the way out: the author pastes this, and a trailing space is not an address.
    expect(mocks.vcs.clone).toHaveBeenCalledWith(
      "lore://studio.example.lan:41337/my-game",
      DESTINATION
    );
    expect(mocks.fs.list).toHaveBeenCalledWith(DESTINATION);
  });

  /**
   * The case this whole check exists for: a Lore server holds repositories, and a repository is
   * not necessarily a Studio project. This one transfers perfectly and must still be refused,
   * or the wizard closes and hands the launcher a folder that fails to open somewhere that
   * knows nothing about where it came from.
   */
  it("refuses a clone that is a repository but not a Studio project", async () => {
    mocks.vcs.clone.mockResolvedValue(cloneSucceeded());
    mocks.fs.list.mockResolvedValue(bareRepositoryListing());

    const result = await CloneService.cloneProject(
      "lore://studio.example.lan:41337/notes",
      DESTINATION
    );

    expect(result).toEqual({ status: "notAProject", root: DESTINATION });
  });

  it("refuses a clone whose result cannot be read back", async () => {
    mocks.vcs.clone.mockResolvedValue(cloneSucceeded());
    mocks.fs.list.mockResolvedValue({ success: false, error: "File system access is not allowed" });

    const result = await CloneService.cloneProject(
      "lore://studio.example.lan:41337/my-game",
      DESTINATION
    );

    expect(result).toEqual({ status: "notAProject", root: DESTINATION });
  });

  it("passes the backend's own refusal through", async () => {
    mocks.vcs.clone.mockResolvedValue({
      success: false,
      error: "D:/Projects/my-game is not empty"
    });

    const result = await CloneService.cloneProject(
      "lore://studio.example.lan:41337/my-game",
      DESTINATION
    );

    expect(result).toEqual({ status: "failed", error: "D:/Projects/my-game is not empty" });
    expect(mocks.fs.list).not.toHaveBeenCalled();
  });

  it("survives a thrown transport error", async () => {
    mocks.vcs.clone.mockRejectedValue(new Error("connection refused"));

    const result = await CloneService.cloneProject(
      "lore://studio.example.lan:41337/my-game",
      DESTINATION
    );

    expect(result).toEqual({ status: "failed", error: "connection refused" });
  });
});
