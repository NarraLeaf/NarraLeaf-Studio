import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentSource } from "@shared/documents/documentSource";
import { getProjectWriteFreeze, thawProjectWrites } from "@/lib/app/writeFreeze";
import { clearProjectDocumentSource, getProjectDocumentSource } from "@/lib/app/documentSource";
import { BaseFileSystemService } from "./FileSystem";
import type { WorkspaceReloadResult } from "./WorkspaceReloadService";
import { WorkspaceFreezeService } from "./WorkspaceFreezeService";
import { Services, type WorkspaceContext } from "../services";

/**
 * The service and the boundary it arms, together.
 *
 * The assertions are deliberately made through the REAL `BaseFileSystemService` and the real
 * privileged facade rather than against the latch's predicate: the milestone's claim is that a write
 * cannot reach the disk while frozen, and a test that only asked the predicate would keep passing if
 * somebody added a write path that never consulted it. What is checked is that the host is never
 * called at all.
 */

const PROJECT = "D:/projects/my-game";

const privilegedFs = vi.hoisted(() => ({
  requestWrite: vi.fn(),
  requestWriteRaw: vi.fn(),
  requestRead: vi.fn(),
  copyFile: vi.fn(),
  deleteFile: vi.fn(),
  createDir: vi.fn(),
  ensureRegularFile: vi.fn()
}));

/** The freeze report main consults before it starts a build or a preview of its own. */
const reportWriteFreeze = vi.hoisted(() => vi.fn());

vi.mock("@/lib/app/bridge", () => ({
  getInterface: () => ({ workspace: { reportWriteFreeze } }),
  getPrivilegedInterface: () => ({ fs: privilegedFs })
}));

const flushAll = vi.fn(async () => undefined);
const reload = vi.fn(async (): Promise<WorkspaceReloadResult> => ({
  cause: "thaw",
  origin: { kind: "working-tree" },
  reloaded: [],
  failures: []
}));
const fetchMock = vi.fn(async () => ({ ok: true, statusText: "OK", text: async () => "on-disk" }));

/** The bytes the working tree would answer with, so a redirected read is visibly different. */
const WORKING_TREE_TEXT = "on-disk";
const STORY_INDEX = "editor/story/index.json";

/**
 * A revision source that records every read and what the freeze latch said at the time.
 *
 * The recording is the point of the ordering test: asking the service afterwards whether it froze
 * proves only that it eventually did, and the failure being guarded against is a read that happened
 * first.
 */
function createRevisionSource(revision: string, documents: Record<string, string>) {
  const reads: { path: string; frozen: boolean }[] = [];
  let prewarms = 0;
  const source: DocumentSource = {
    origin: { kind: "revision", revision },
    read: async (path) => {
      reads.push({ path, frozen: getProjectWriteFreeze() !== null });
      return documents[path] ?? null;
    },
    prewarm: async () => {
      prewarms += 1;
    }
  };
  return { source, reads, prewarmCount: () => prewarms };
}

function createContext(): WorkspaceContext {
  return {
    project: { getConfig: () => ({ projectPath: PROJECT }) },
    services: {
      get: (id: string) => (id === Services.WorkspaceReload ? { reload } : { flushAll })
    }
  } as unknown as WorkspaceContext;
}

async function createService(): Promise<WorkspaceFreezeService> {
  const service = new WorkspaceFreezeService();
  await service.initialize(createContext(), async () => undefined);
  return service;
}

beforeEach(() => {
  for (const fn of Object.values(privilegedFs)) {
    fn.mockReset();
    fn.mockResolvedValue({ success: true, data: { ok: true, data: "hash" } });
  }
  flushAll.mockClear();
  reload.mockClear();
  reportWriteFreeze.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  thawProjectWrites();
  clearProjectDocumentSource();
  vi.unstubAllGlobals();
});

describe("WorkspaceFreezeService", () => {
  it("starts writable and reports no reason", async () => {
    const service = await createService();

    expect(service.isFrozen()).toBe(false);
    expect(service.getReason()).toBeNull();
  });

  it("blocks a versioned write without reaching the host", async () => {
    const service = await createService();
    await service.freeze({ kind: "revision", revision: "aa", label: "#12" });

    const result = await BaseFileSystemService.write(
      `${PROJECT}/editor/story/index.json`,
      "{}",
      "utf-8"
    );

    expect(result.ok).toBe(true);
    expect(privilegedFs.requestWrite).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.getReason()).toEqual({ kind: "revision", revision: "aa", label: "#12" });
  });

  it("blocks the write paths that skip FileSystemService, which is where asset import lives", async () => {
    const service = await createService();
    await service.freeze({ kind: "manual" });

    const { appPrivilegedFacade } = await import("@/lib/app/privilegedFacade");
    await appPrivilegedFacade.fs.copyFile(
      "C:/downloads/sprite.png",
      `${PROJECT}/assets/content/ab/cd/sprite.png`
    );
    await appPrivilegedFacade.fs.deleteFile(`${PROJECT}/assets/content/ab/cd/sprite.png`);

    expect(privilegedFs.copyFile).not.toHaveBeenCalled();
    expect(privilegedFs.deleteFile).not.toHaveBeenCalled();
    expect(service.isFrozen()).toBe(true);
  });

  /**
   * The half of the rule a later change is most likely to break. Editor state lives inside the
   * project directory too, and freezing it would look to the author like the whole application had
   * stopped working - which is why the boundary is `isVersioned` and not "the project folder".
   */
  it("leaves writes to non-versioned paths completely alone while frozen", async () => {
    const service = await createService();
    await service.freeze({ kind: "manual" });

    const layout = await BaseFileSystemService.write(
      `${PROJECT}/.nlstudio/editor.json`,
      "{}",
      "utf-8"
    );
    const thumbnail = await BaseFileSystemService.writeRaw(
      `${PROJECT}/editor/cache/thumbnail/ab/cd/asset-1.png`,
      new Uint8Array([1])
    );

    expect(layout.ok).toBe(true);
    expect(thumbnail.ok).toBe(true);
    expect(privilegedFs.requestWrite).toHaveBeenCalledTimes(1);
    expect(privilegedFs.requestWriteRaw).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(service.isFrozen()).toBe(true);
  });

  it("restores writes on thaw", async () => {
    const service = await createService();
    await service.freeze({ kind: "manual" });
    await BaseFileSystemService.write(`${PROJECT}/project.json`, "{}", "utf-8");
    expect(privilegedFs.requestWrite).not.toHaveBeenCalled();

    service.thaw();

    await BaseFileSystemService.write(`${PROJECT}/project.json`, "{}", "utf-8");
    expect(privilegedFs.requestWrite).toHaveBeenCalledTimes(1);
    expect(service.isFrozen()).toBe(false);
    expect(service.getReason()).toBeNull();
  });

  /**
   * The other half of the fix. A refused write is a no-op, so whatever tried it kept the value in
   * memory - measured: a scene created while frozen never reached disk, then rode the first save
   * after thawing there. Without this the freeze does not prevent the loss, it postpones it.
   */
  it("re-reads the working tree on thaw, exactly once", async () => {
    const service = await createService();
    await service.freeze({ kind: "revision", revision: "aa" });

    service.thaw();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith("thaw");
  });

  it("does not reload when there was nothing to leave", async () => {
    const service = await createService();

    // A thaw is still a thaw when no freeze was armed, but re-reading the whole project for it
    // would throw away undo history and remount every tab for nothing.
    service.thaw();

    expect(reload).not.toHaveBeenCalled();
  });

  /**
   * The gap a disabled button could not close.
   *
   * A restore rewrites the working tree from the MAIN process, file by file, and the renderer's
   * write latch never sees it. So any other way out of the revision view - the command palette, the
   * project switcher's menu (which reads a DIFFERENT `useVersionSurface` and cannot know a restore
   * is running), a keybinding somebody adds next month - would re-read a tree that is half one
   * version and half another, and the next save would put that hybrid on disk. Held at the service,
   * so correctness does not depend on any control having remembered.
   */
  it("refuses to leave the view while a release is held, and does not do it silently", async () => {
    const service = await createService();
    const revision = createRevisionSource("rev-1", { [STORY_INDEX]: "from-the-revision" });
    await service.showRevision(revision.source);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const release = service.holdRelease();
    service.thaw();

    expect(service.isReleaseHeld()).toBe(true);
    expect(service.isFrozen()).toBe(true);
    // The read side too: a thaw that dropped the source but kept the latch would leave the
    // editors reading a half-written working tree, which is the same loss one step earlier.
    expect(getProjectDocumentSource()).toBe(revision.source);
    // Only the one `showRevision` started. A refused thaw must not have re-read anything.
    expect(reload).toHaveBeenCalledTimes(1);
    // Reaching this line means a control offered a way out it should have hidden - which is worth
    // finding, and is why the refusal is not a bare `return`.
    expect(warn).toHaveBeenCalledTimes(1);

    release();
    warn.mockRestore();
  });

  it("thaws normally once the hold is released", async () => {
    const service = await createService();
    await service.showRevision(createRevisionSource("rev-1", {}).source);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const release = service.holdRelease();
    service.thaw();
    expect(service.isFrozen()).toBe(true);

    release();
    service.thaw();

    expect(service.isReleaseHeld()).toBe(false);
    expect(service.isFrozen()).toBe(false);
    expect(getProjectDocumentSource()).toBeNull();
    expect(reload).toHaveBeenLastCalledWith("thaw");
    warn.mockRestore();
  });

  /**
   * Counted rather than a flag, and this is the case that decides it: with one boolean, the first
   * holder to finish would lift the second one's hold, and the workspace would re-read a tree the
   * second holder is still writing. The count is the same shape `holdProjectWritesForReload` uses,
   * deliberately - two mechanisms for "hold this off" with different nesting rules is how one of
   * them gets used wrongly.
   */
  it("stays held until the last of several holders releases", async () => {
    const service = await createService();
    await service.showRevision(createRevisionSource("rev-1", {}).source);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = service.holdRelease();
    const second = service.holdRelease();

    first();
    service.thaw();

    expect(service.isReleaseHeld()).toBe(true);
    expect(service.isFrozen()).toBe(true);

    second();
    service.thaw();

    expect(service.isReleaseHeld()).toBe(false);
    expect(service.isFrozen()).toBe(false);
    warn.mockRestore();
  });

  /**
   * A release belongs to its holder. Without the idempotence, a caller whose `finally` runs twice -
   * or one that releases and is then torn down - would decrement somebody else's hold, and the
   * remaining holder would find the workspace leaving the view underneath it.
   */
  it("ignores a holder that releases twice, so another holder's hold survives", async () => {
    const service = await createService();
    await service.showRevision(createRevisionSource("rev-1", {}).source);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = service.holdRelease();
    service.holdRelease();

    first();
    first();

    expect(service.isReleaseHeld()).toBe(true);
    service.thaw();
    expect(service.isFrozen()).toBe(true);
    warn.mockRestore();
  });

  it("flushes what is owed before freezing, so a pending save is not silently dropped", async () => {
    const service = await createService();

    await service.freeze({ kind: "manual" });

    // A refused write is a no-op, not an error - anything a saver still owed at the moment of
    // freezing would simply vanish, which is the author's own last edit.
    expect(flushAll).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers on both edges", async () => {
    const service = await createService();
    const seen: (string | null)[] = [];
    const stop = service.onChanged((reason) => seen.push(reason?.kind ?? null));

    await service.freeze({ kind: "manual" });
    service.thaw();

    expect(seen).toEqual(["manual", null]);
    stop();
  });

  /**
   * Main starts the production build and the Preview runtime itself, so a greyed-out control cannot
   * stop them - it refuses both while frozen and has to be told.
   *
   * Told on both edges, and once at startup: this latch is module-level and never persisted, so a
   * window that reloads mid-freeze comes back writable while main would still believe it is frozen
   * and refuse that project's builds for the rest of the session.
   */
  it("tells main the freeze state, on both edges and once at startup", async () => {
    const service = await createService();

    // Startup, and reported even though nothing is frozen: that is the report that clears a
    // record main was left holding by the window this one replaced.
    expect(reportWriteFreeze).toHaveBeenCalledTimes(1);
    expect(reportWriteFreeze).toHaveBeenCalledWith(null);

    // The edges are read off the last call rather than the whole list: every service built by an
    // earlier test in this file is still subscribed to the module-level latch (nothing here tears
    // one down), so they all echo the same value.
    await service.freeze({ kind: "revision", revision: "aa" });
    // The revision travels with the kind because main does not refuse everything while frozen: Dev
    // Mode compiles that revision, and it cannot find one from the kind alone.
    expect(reportWriteFreeze).toHaveBeenLastCalledWith("revision", "aa");

    service.thaw();
    expect(reportWriteFreeze).toHaveBeenLastCalledWith(null);
  });

  /**
   * The window this closes: a service holding a historical document in a workspace that still
   * accepts writes. One auto-save timer landing there and the revision is on disk, over the author's
   * work - the loss the freeze exists to prevent, arriving from the other direction.
   *
   * Read through the real boundary rather than by calling the source: the claim is that the
   * PARTICIPANTS read the revision, and they read through `BaseFileSystemService`.
   */
  it("arms the freeze before a single byte of the revision is read", async () => {
    const service = await createService();
    const revision = createRevisionSource("rev-1", { [STORY_INDEX]: '{"stories":[]}' });
    reload.mockImplementationOnce(async () => {
      await BaseFileSystemService.read(`${PROJECT}/${STORY_INDEX}`, "utf-8");
      return { cause: "revision", origin: { kind: "working-tree" }, reloaded: [], failures: [] };
    });

    await service.showRevision(revision.source, "#3");

    expect(revision.reads).toEqual([{ path: STORY_INDEX, frozen: true }]);
    expect(service.getReason()).toEqual({ kind: "revision", revision: "rev-1", label: "#3" });
    expect(reload).toHaveBeenCalledWith("revision", revision.source);
  });

  it("reads project data out of the revision, and leaves the disk alone", async () => {
    const service = await createService();
    const revision = createRevisionSource("rev-1", { [STORY_INDEX]: "from-the-revision" });

    await service.showRevision(revision.source);

    const shown = await BaseFileSystemService.read(`${PROJECT}/${STORY_INDEX}`, "utf-8");
    expect(shown).toEqual({ ok: true, data: "from-the-revision" });
    // Not one round trip to the host for the file: the answer never came from the disk.
    expect(privilegedFs.requestRead).not.toHaveBeenCalled();
  });

  /**
   * `null` from the source is an ANSWER: a document added after the revision has to reach the
   * service's "missing, use defaults" branch, which is the NOT_FOUND every load path already knows.
   * Reported any other way, the service would report a broken project instead of an empty one.
   */
  it("reports a document the revision does not contain as missing, not as a failure", async () => {
    const service = await createService();
    await service.showRevision(createRevisionSource("rev-1", {}).source);

    const missing = await BaseFileSystemService.read(`${PROJECT}/${STORY_INDEX}`, "utf-8");
    const exists = await BaseFileSystemService.isFileExists(`${PROJECT}/${STORY_INDEX}`);

    expect(missing.ok).toBe(false);
    expect(missing.ok ? null : missing.error.code).toBe("NOT_FOUND");
    expect(exists).toEqual({ ok: true, data: false });
  });

  /**
   * Editor state is not the author's project, and it is not versioned either - so it goes
   * on reading and writing the disk while a revision is shown. A revision view that also showed the
   * panel layout from that revision would look like a broken application.
   */
  it("leaves non-versioned reads on the disk while a revision is shown", async () => {
    const service = await createService();
    const revision = createRevisionSource("rev-1", {});

    await service.showRevision(revision.source);
    const layout = await BaseFileSystemService.read(
      `${PROJECT}/.nlstudio/services/panel_state.json`,
      "utf-8"
    );

    expect(layout).toEqual({ ok: true, data: WORKING_TREE_TEXT });
    expect(revision.reads).toEqual([]);
  });

  it("writes nothing while a revision is shown, including the save a migration would want", async () => {
    const service = await createService();
    await service.showRevision(createRevisionSource("rev-1", { [STORY_INDEX]: "{}" }).source);

    // What a service does after `parse` migrated an older schema on load. It must answer success -
    // failing it would turn "this is an old revision" into "this project will not open" - and it
    // must not reach the host.
    const migrationSave = await BaseFileSystemService.write(
      `${PROJECT}/${STORY_INDEX}`,
      '{"version":9}',
      "utf-8"
    );

    expect(migrationSave.ok).toBe(true);
    expect(privilegedFs.requestWrite).not.toHaveBeenCalled();
  });

  it("returns to the working tree and thaws when the author leaves", async () => {
    const service = await createService();
    const revision = createRevisionSource("rev-1", { [STORY_INDEX]: "from-the-revision" });
    await service.showRevision(revision.source);
    expect(getProjectDocumentSource()).toBe(revision.source);

    service.thaw();

    expect(getProjectDocumentSource()).toBeNull();
    expect(service.isFrozen()).toBe(false);
    await expect(BaseFileSystemService.read(`${PROJECT}/${STORY_INDEX}`, "utf-8")).resolves.toEqual(
      { ok: true, data: WORKING_TREE_TEXT }
    );
    await BaseFileSystemService.write(`${PROJECT}/${STORY_INDEX}`, "{}", "utf-8");
    expect(privilegedFs.requestWrite).toHaveBeenCalledTimes(1);
  });

  /**
   * The window on the way OUT, which is the mirror of the one on the way in: the revision has to
   * stop answering reads BEFORE the latch comes off, or the pass that is supposed to replace
   * historical memory reads the history straight back in and then unfreezes on top of it.
   */
  it("stops the revision answering reads before it lifts the latch", async () => {
    const service = await createService();
    await service.showRevision(
      createRevisionSource("rev-1", { [STORY_INDEX]: "from-the-revision" }).source
    );
    const seen: { source: boolean; frozen: boolean }[] = [];
    reload.mockImplementationOnce(async () => {
      seen.push({
        source: getProjectDocumentSource() !== null,
        frozen: getProjectWriteFreeze() !== null
      });
      return { cause: "thaw", origin: { kind: "working-tree" }, reloaded: [], failures: [] };
    });

    service.thaw();
    await Promise.resolve();

    expect(seen).toEqual([{ source: false, frozen: true }]);
  });

  it("refuses a working-tree source, which would freeze the workspace for no visible reason", async () => {
    const service = await createService();

    await expect(
      service.showRevision({
        origin: { kind: "working-tree" },
        read: async () => null,
        prewarm: async () => undefined
      })
    ).rejects.toThrow(/needs a revision source/);
    expect(service.isFrozen()).toBe(false);
  });

  /**
   * Session-only, and provably so: freezing touches no storage of any kind, and a workspace that
   * comes back up is writable. A freeze that outlived a restart would be a project that refuses to
   * save with nothing on screen to say why.
   */
  it("never persists, and a re-opened workspace is writable", async () => {
    const service = await createService();
    await service.freeze({ kind: "revision", revision: "aa" });

    // Nothing was written to say so.
    expect(privilegedFs.requestWrite).not.toHaveBeenCalled();
    expect(privilegedFs.requestWriteRaw).not.toHaveBeenCalled();
    expect(privilegedFs.ensureRegularFile).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    await service.teardown(service.getContext());
    await service.initialize(createContext(), async () => undefined);

    expect(service.isFrozen()).toBe(false);
    await BaseFileSystemService.write(`${PROJECT}/project.json`, "{}", "utf-8");
    expect(privilegedFs.requestWrite).toHaveBeenCalledTimes(1);
  });
});
