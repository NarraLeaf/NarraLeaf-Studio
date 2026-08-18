import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProjectWriteFreeze, thawProjectWrites } from "./writeFreeze";
import {
  clearMergeConflictReads,
  hasMergeConflictReads,
  mergeConflictReadPath,
  setMergeConflictReads
} from "./mergeConflictReads";
import { BaseFileSystemService } from "../workspace/services/core/FileSystem";
import { ensureWorkspaceProjectCanStart } from "../workspace/startup/workspaceProjectPreflight";

/**
 * Opening a project that is in the middle of a merge.
 *
 * **This is a regression test for a total failure, not a refinement.** The backend writes diff3
 * markers into every file it could not settle (docs/version-control.md §4.23), `editor/story/
 * index.json` is one of the documents parsed while the workspace starts, and so a project mid-merge
 * stopped at `Failed to parse JSON from .../editor/story/index.json` and never opened. The failure
 * screen offers Retry, the launcher and another project - none of which lead to the merge - so the
 * resolve surface was unreachable in the one situation it exists for.
 *
 * The two halves are tested through the REAL `BaseFileSystemService` rather than against the
 * predicate, for the reason the freeze test gives: the claim is about what reaches the host, and a
 * test that only asked the latch would keep passing if a read path stopped consulting it.
 */

const PROJECT = "D:/projects/my-game";
const STORY_INDEX = `${PROJECT}/editor/story/index.json`;
/** What the merge left in the file: real diff3 output, so `JSON.parse` fails exactly as it does live. */
const CONFLICTED_TEXT = `<<<<<<< ours\n{"version":1,"stories":["mine"]}\n||||||| original\n{"version":1}\n=======\n{"version":1,"stories":["theirs"]}\n>>>>>>> theirs\n`;
const MINE_TEXT = `{"version":1,"stories":["mine"]}\n`;

const privilegedFs = vi.hoisted(() => ({
  requestRead: vi.fn(),
  list: vi.fn()
}));
const vcs = vi.hoisted(() => ({
  getAvailability: vi.fn(),
  getMergeState: vi.fn()
}));

vi.mock("@/lib/app/bridge", () => ({
  getInterface: () => ({ vcs, workspace: { reportWriteFreeze: vi.fn() } }),
  getPrivilegedInterface: () => ({ fs: privilegedFs })
}));
vi.mock("@/lib/app/privilegedFacade", () => ({
  appPrivilegedFacade: { fs: privilegedFs }
}));

/** The bytes on disk, by path, so a redirected read is visibly a different document. */
const disk: Record<string, string> = {
  [STORY_INDEX]: CONFLICTED_TEXT,
  [`${STORY_INDEX}~mine`]: MINE_TEXT
};

beforeEach(() => {
  privilegedFs.requestRead.mockReset();
  privilegedFs.requestRead.mockImplementation(async (path: string) => ({
    success: true,
    data: { ok: true, data: path }
  }));
  privilegedFs.list.mockResolvedValue({
    success: true,
    data: { ok: true, data: [{ name: "game", ext: ".nlproj", type: "file" }] }
  });
  vcs.getAvailability.mockResolvedValue({ success: true, data: { available: true } });
  vcs.getMergeState.mockResolvedValue({
    success: true,
    data: { inProgress: true, conflicts: ["editor/story/index.json"] }
  });
  // The URL carries the path the host was asked for, so the fetch can answer per file.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      // `constructUrl` puts the host's answer in the path, and the mock above answers with the
      // path it was asked for - so this reads back exactly which file the boundary requested.
      const path = String(url).replace(/^.*?:\/\/[^/]+\//, "");
      return { ok: true, statusText: "OK", text: async () => disk[path] ?? "" };
    })
  );
});

afterEach(() => {
  clearMergeConflictReads();
  thawProjectWrites();
  vi.unstubAllGlobals();
});

describe("reading a project mid-merge", () => {
  it("leaves every read alone when no merge is open - a corrupt document stays corrupt", async () => {
    expect(hasMergeConflictReads()).toBe(false);
    expect(mergeConflictReadPath(STORY_INDEX)).toBeNull();

    const read = await BaseFileSystemService.readJSON(STORY_INDEX);
    expect(privilegedFs.requestRead).toHaveBeenCalledWith(STORY_INDEX, "utf-8");
    // The whole point of scoping the tolerance: with no merge, this is a broken file and it is
    // still reported as one. Nothing here makes an unparseable document quietly acceptable.
    expect(read.ok).toBe(false);
  });

  it("reads a conflicted document as the author's own side, so it parses", async () => {
    setMergeConflictReads(PROJECT, ["editor/story/index.json"]);

    const read = await BaseFileSystemService.readJSON<{ stories: string[] }>(STORY_INDEX);
    expect(privilegedFs.requestRead).toHaveBeenCalledWith(`${STORY_INDEX}~mine`, "utf-8");
    expect(read.ok).toBe(true);
    expect(read.ok && read.data.stories).toEqual(["mine"]);
  });

  it("redirects the named paths and nothing else", () => {
    setMergeConflictReads(PROJECT, ["editor/story/index.json"]);

    expect(mergeConflictReadPath(STORY_INDEX)).toBe(`${STORY_INDEX}~mine`);
    // A different document, the merge's own copy (which would recurse if it were redirected),
    // and a path outside the versioned working set.
    expect(mergeConflictReadPath(`${PROJECT}/editor/story/other.json`)).toBeNull();
    expect(mergeConflictReadPath(`${STORY_INDEX}~mine`)).toBeNull();
    expect(mergeConflictReadPath(`${PROJECT}/.nlstudio/layout.json`)).toBeNull();
    // And another project's file, which is what a stale substitution would reach.
    expect(mergeConflictReadPath("D:/projects/other/editor/story/index.json")).toBeNull();
  });

  it("goes back to the disk when cleared - the ordering the post-merge re-read depends on", async () => {
    setMergeConflictReads(PROJECT, ["editor/story/index.json"]);
    clearMergeConflictReads();

    await BaseFileSystemService.read(STORY_INDEX, "utf-8");
    expect(privilegedFs.requestRead).toHaveBeenCalledWith(STORY_INDEX, "utf-8");
  });
});

describe("workspace startup preflight", () => {
  it("installs the substitution and freezes, so the workspace can open at all", async () => {
    await ensureWorkspaceProjectCanStart(PROJECT);

    expect(hasMergeConflictReads()).toBe(true);
    // Frozen, because what the editors are about to hold is not what is on disk: one auto-save
    // or one migration would write pre-merge content over the merge's own result.
    expect(getProjectWriteFreeze()?.reason.kind).toBe("merge");

    const read = await BaseFileSystemService.readJSON(STORY_INDEX);
    expect(read.ok).toBe(true);
  });

  it("does neither when the merge left nothing to decide", async () => {
    // An automerge that settled everything leaves nothing unparseable, and its result on disk is
    // exactly what the closing commit records - freezing that would take the project away from
    // an author who has nothing to choose.
    vcs.getMergeState.mockResolvedValue({
      success: true,
      data: { inProgress: true, conflicts: [] }
    });
    await ensureWorkspaceProjectCanStart(PROJECT);

    expect(hasMergeConflictReads()).toBe(false);
    expect(getProjectWriteFreeze()).toBeNull();
  });

  it("opens the project anyway when version control cannot answer", async () => {
    // Version control is optional and this runs on every project open, so an absent backend, a
    // directory that is not a repository and a call that threw all mean the same thing.
    vcs.getAvailability.mockResolvedValue({
      success: true,
      data: { available: false, reason: "backend-missing" }
    });
    await expect(ensureWorkspaceProjectCanStart(PROJECT)).resolves.toBeUndefined();
    expect(hasMergeConflictReads()).toBe(false);

    vcs.getAvailability.mockRejectedValue(new Error("no backend"));
    await expect(ensureWorkspaceProjectCanStart(PROJECT)).resolves.toBeUndefined();
    expect(hasMergeConflictReads()).toBe(false);
    expect(getProjectWriteFreeze()).toBeNull();
  });

  it("drops a previous project's substitution before deciding about this one", async () => {
    setMergeConflictReads("D:/projects/somewhere-else", ["editor/story/index.json"]);
    vcs.getMergeState.mockResolvedValue({
      success: true,
      data: { inProgress: false, conflicts: [] }
    });

    await ensureWorkspaceProjectCanStart(PROJECT);
    expect(hasMergeConflictReads()).toBe(false);
  });
});
