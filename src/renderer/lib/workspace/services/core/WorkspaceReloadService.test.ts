import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import type { DocumentSource } from "@shared/documents/documentSource";
import { join } from "@shared/utils/path";
import { isProjectWriteReloadHeld, thawProjectWrites } from "@/lib/app/writeFreeze";
import { clearProjectDocumentSource, getProjectDocumentSource } from "@/lib/app/documentSource";
import { Services, type WorkspaceContext } from "../services";
import { DebouncedSaver } from "../autosave/DebouncedSaver";
import { SaveStatusService } from "../autosave/SaveStatusService";
import { VariableRegistryService } from "../variables/VariableRegistryService";
import { BaseFileSystemService } from "./FileSystem";
import { WorkspaceReloadService } from "./WorkspaceReloadService";

/**
 * The signal that says "the working tree is no longer what the editors are showing".
 *
 * The oracle these tests encode is the one measured in the running app: freeze, create something,
 * thaw, cause a save - and the thing created while frozen must never appear on disk. It used to,
 * because a refused write is a no-op and the service that tried it kept the value.
 *
 * `VariableRegistryService` stands in for the document services on purpose rather than being stubbed:
 * it is the smallest real one, it owns a real corrupt latch, and a stub that "re-reads" a fake disk
 * would prove nothing about whether anybody re-reads at all. The fake filesystem below refuses writes
 * exactly the way the freeze latch does - silently, answering success - so the defect can be staged.
 */

const ROOT = join("D:/projects", "my-game");
const VARIABLES = join(ROOT, "editor", "variables.json");
const STORY_INDEX = join(ROOT, "editor", "story", "index.json");

const privilegedFs = vi.hoisted(() => ({
  requestWrite: vi.fn(),
  requestWriteRaw: vi.fn(),
  copyFile: vi.fn(),
  deleteFile: vi.fn(),
  createDir: vi.fn(),
  ensureRegularFile: vi.fn()
}));

vi.mock("@/lib/app/bridge", () => ({
  getInterface: () => ({}),
  getPrivilegedInterface: () => ({ fs: privilegedFs })
}));

type Harness = {
  reload: WorkspaceReloadService;
  variables: VariableRegistryService;
  saveStatus: SaveStatusService;
  files: Map<string, string>;
  /** Set while the fake disk should refuse project-data writes, the way the freeze latch does. */
  setFrozen: (frozen: boolean) => void;
  /** Runs inside the story participant's re-read, so a test can act mid-reload. */
  duringStoryReload: { current: (() => Promise<void>) | null };
  stubs: {
    projectReload: ReturnType<typeof vi.fn>;
    assetsReload: ReturnType<typeof vi.fn>;
    charactersReload: ReturnType<typeof vi.fn>;
    storyReload: ReturnType<typeof vi.fn>;
    uiDocumentLoad: ReturnType<typeof vi.fn>;
    uiGraphLoad: ReturnType<typeof vi.fn>;
    audioTracksLoad: ReturnType<typeof vi.fn>;
    appTagsLoad: ReturnType<typeof vi.fn>;
    localizationReload: ReturnType<typeof vi.fn>;
    voiceReload: ReturnType<typeof vi.fn>;
    dictionaryLoad: ReturnType<typeof vi.fn>;
    historyClearAll: ReturnType<typeof vi.fn>;
    showSticky: ReturnType<typeof vi.fn>;
  };
};

async function createHarness(seed?: string): Promise<Harness> {
  const files = new Map<string, string>();
  if (seed !== undefined) {
    files.set(VARIABLES, seed);
  }
  let frozen = false;
  let nextId = 0;
  const duringStoryReload: Harness["duringStoryReload"] = { current: null };

  const ok = <T>(data: T): FsRequestResult<T> => ({ ok: true, data });

  const stubs = {
    projectReload: vi.fn(async () => ({})),
    assetsReload: vi.fn(async () => undefined),
    charactersReload: vi.fn(async () => undefined),
    storyReload: vi.fn(async () => {
      await duringStoryReload.current?.();
    }),
    uiDocumentLoad: vi.fn(async () => undefined),
    uiGraphLoad: vi.fn(async () => undefined),
    audioTracksLoad: vi.fn(async () => undefined),
    appTagsLoad: vi.fn(async () => undefined),
    localizationReload: vi.fn(async () => undefined),
    voiceReload: vi.fn(async () => undefined),
    dictionaryLoad: vi.fn(async () => []),
    historyClearAll: vi.fn(),
    showSticky: vi.fn(() => "toast-1")
  };

  const variables = new VariableRegistryService();
  const saveStatus = new SaveStatusService();
  const reload = new WorkspaceReloadService();

  const registry: Record<string, unknown> = {
    [Services.FileSystem]: {
      read: async (path: string) => {
        const value = files.get(path);
        return value === undefined
          ? { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }
          : ok(value);
      },
      // A refused write answers success without moving a byte. That is not test convenience, it
      // is what the freeze latch does (`FROZEN_NO_OP`), and it is the reason the value stayed in
      // memory in the first place.
      write: async (path: string, data: string) => {
        if (!frozen) {
          files.set(path, data);
        }
        return ok(undefined);
      },
      createDir: async () => ok(undefined),
      copyFile: async (src: string, dest: string) => {
        files.set(dest, files.get(src) ?? "");
        return ok(undefined);
      },
      observeWrites: () => () => undefined
    },
    [Services.Project]: { reloadProjectConfig: stubs.projectReload },
    [Services.Uuid]: { generate: () => `var-${++nextId}` },
    [Services.Assets]: { reloadFromDisk: stubs.assetsReload },
    [Services.Character]: { reloadFromDisk: stubs.charactersReload },
    [Services.Story]: { reloadFromDisk: stubs.storyReload },
    [Services.UIDocument]: { load: stubs.uiDocumentLoad },
    [Services.UIGraph]: { load: stubs.uiGraphLoad, consumeLegacyPersistentVariables: () => null },
    [Services.AudioTracks]: { load: stubs.audioTracksLoad },
    [Services.AppTags]: { load: stubs.appTagsLoad },
    [Services.Localization]: { reloadFromDisk: stubs.localizationReload },
    [Services.Voice]: { reloadFromDisk: stubs.voiceReload },
    [Services.Dictionary]: { load: stubs.dictionaryLoad },
    [Services.History]: { clearAll: stubs.historyClearAll },
    [Services.VariableRegistry]: variables,
    [Services.SaveStatus]: saveStatus,
    [Services.UI]: { notifications: { showSticky: stubs.showSticky, close: vi.fn() } },
    [Services.Console]: { log: vi.fn() }
  };

  const ctx = {
    project: { getConfig: () => ({ projectPath: ROOT }) },
    services: {
      get: (id: string) => {
        const stub = registry[id];
        if (!stub) {
          throw new Error(`Service ${id} not found`);
        }
        return stub;
      }
    }
  } as unknown as WorkspaceContext;

  await saveStatus.initialize(ctx, async () => undefined);
  await variables.initialize(ctx, async () => undefined);
  await reload.initialize(ctx, async () => undefined);

  return {
    reload,
    variables,
    saveStatus,
    files,
    setFrozen: (next) => {
      frozen = next;
    },
    duringStoryReload,
    stubs
  };
}

const fetchMock = vi.fn(async () => ({ ok: true, statusText: "OK" }));

beforeEach(() => {
  for (const fn of Object.values(privilegedFs)) {
    fn.mockReset();
    fn.mockResolvedValue({ success: true, data: { ok: true, data: undefined } });
  }
  fetchMock.mockClear();
  // `BaseFileSystemService` finishes a write over the app protocol; the assertions here are about
  // whether it got that far at all.
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  thawProjectWrites();
  clearProjectDocumentSource();
  vi.unstubAllGlobals();
});

/** A revision source that records what it was asked for. */
function fakeRevisionSource(revision: string, documents: Record<string, string> = {}) {
  const reads: string[] = [];
  const prewarms: (readonly string[] | undefined)[] = [];
  const source: DocumentSource = {
    origin: { kind: "revision", revision },
    read: async (path) => {
      reads.push(path);
      return documents[path] ?? null;
    },
    prewarm: async (paths) => {
      prewarms.push(paths);
    }
  };
  return { source, reads, prewarms };
}

describe("WorkspaceReloadService", () => {
  /**
   * The acceptance oracle, in miniature. Everything else in this file guards one of its steps.
   */
  it("does not let a value that only ever existed in memory survive the reload", async () => {
    const harness = await createHarness();

    harness.setFrozen(true);
    harness.variables.createEntry("persistent", { name: "ghost" });
    await harness.variables.flushPendingChanges();

    // The defect, staged: refused, so nothing reached the disk - and kept, so the next successful
    // save would have put it there.
    expect(harness.files.get(VARIABLES)).not.toContain("ghost");
    expect(harness.variables.listEntries().some((entry) => entry.name === "ghost")).toBe(true);

    harness.setFrozen(false);
    await harness.reload.reload("thaw");

    expect(harness.variables.listEntries().some((entry) => entry.name === "ghost")).toBe(false);

    // "Cause any save", the last step of the oracle.
    await harness.variables.save(harness.variables.getRegistry());
    expect(harness.files.get(VARIABLES)).not.toContain("ghost");
  });

  it("re-reads from disk, so a change made behind the workspace's back is picked up", async () => {
    const harness = await createHarness();
    const onDisk =
      JSON.stringify(
        {
          entries: {
            "var-external": {
              id: "var-external",
              storageKey: "var-external",
              name: "written_by_somebody_else",
              valueType: "number"
            }
          },
          meta: { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
        },
        null,
        2
      ) + "\n";
    harness.files.set(VARIABLES, onDisk);

    await harness.reload.reload("external");

    expect(harness.variables.listEntries().map((entry) => entry.name)).toEqual([
      "written_by_somebody_else"
    ]);
  });

  /** Every participant, named by the one table that says who takes part. */
  it("re-reads every participant and reports them", async () => {
    const harness = await createHarness();

    const result = await harness.reload.reload("restore");

    expect(result.failures).toEqual([]);
    expect(result.reloaded).toEqual([
      "project",
      "assets",
      "characters",
      "story",
      "uiDocument",
      "uiGraph",
      "variables",
      "audioTracks",
      "appTags",
      "localization",
      "voice",
      "dictionary"
    ]);
    expect(harness.stubs.assetsReload).toHaveBeenCalledTimes(1);
    expect(harness.stubs.voiceReload).toHaveBeenCalledTimes(1);
  });

  /**
   * The project dictionary is a document like any other, and it was missing from the table above.
   *
   * Worth its own case rather than only the list assertion, because what breaks when it is absent
   * is not the dictionary but the spellchecker: `load()` is the only thing that re-publishes the
   * project's words and its source locale, so a restored working tree left the checker marking
   * against the version that was replaced - and the author sees a wrong underline, not a missing
   * document.
   */
  it("re-reads the project dictionary, and does it after localization", async () => {
    const harness = await createHarness();
    const order: string[] = [];
    harness.stubs.localizationReload.mockImplementation(async () => {
      order.push("localization");
    });
    harness.stubs.dictionaryLoad.mockImplementation(async () => {
      order.push("dictionary");
      return [];
    });

    await harness.reload.reload("restore");

    expect(harness.stubs.dictionaryLoad).toHaveBeenCalledTimes(1);
    // The publish states the source locale, so it has to be the one localization just read.
    expect(order).toEqual(["localization", "dictionary"]);
  });

  /**
   * The window this closes is the one between "the freeze is gone" and "memory has been replaced".
   * Asserted through the real write boundary rather than against the predicate: a test that only
   * asked the latch would keep passing if a write path stopped consulting it.
   */
  it("writes nothing while it runs, and is writable again the moment it ends", async () => {
    const harness = await createHarness();
    const refusedDuring: FsRequestResult<void>[] = [];
    harness.duringStoryReload.current = async () => {
      expect(isProjectWriteReloadHeld()).toBe(true);
      refusedDuring.push(await BaseFileSystemService.write(STORY_INDEX, "{}", "utf-8"));
    };

    await harness.reload.reload("thaw");

    // A refusal, not an error: the caller is a load path, and failing it would turn a reload into
    // a broken project open.
    expect(refusedDuring.map((result) => result.ok)).toEqual([true]);
    expect(privilegedFs.requestWrite).not.toHaveBeenCalled();
    expect(isProjectWriteReloadHeld()).toBe(false);

    await BaseFileSystemService.write(STORY_INDEX, "{}", "utf-8");
    expect(privilegedFs.requestWrite).toHaveBeenCalledTimes(1);
  });

  it("leaves editor state writable while it runs - the reload is not a freeze", async () => {
    const harness = await createHarness();
    harness.duringStoryReload.current = async () => {
      await BaseFileSystemService.write(join(ROOT, ".nlstudio", "editor.json"), "{}", "utf-8");
    };

    await harness.reload.reload("thaw");

    expect(privilegedFs.requestWrite).toHaveBeenCalledTimes(1);
  });

  /**
   * A pending save is owed on memory the reload throws away. Flushing it instead of dropping it
   * would be the defect this mechanism exists to fix, one function earlier.
   */
  it("drops a debounced save owed from before, so it cannot write afterwards", async () => {
    const harness = await createHarness();
    const written: string[] = [];
    const saver = new DebouncedSaver({
      delayMs: 10,
      maxWaitMs: 20,
      save: async () => {
        written.push("pre-reload memory");
      }
    });
    harness.saveStatus.register("probe", "workspace.shell.save.stores.story", saver);
    saver.schedule();
    expect(saver.isPending()).toBe(true);

    await harness.reload.reload("thaw");

    expect(saver.isPending()).toBe(false);
    // Well past both the quiet period and the ceiling: the debt is gone, not deferred.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(written).toEqual([]);
    expect(saver.getState()).toBe("clean");
  });

  it("drops the undo stacks, whose snapshots are pre-reload documents", async () => {
    const harness = await createHarness();

    await harness.reload.reload("restore");

    expect(harness.stubs.historyClearAll).toHaveBeenCalledTimes(1);
  });

  /**
   * H2b's convention, through the reload: a document that is corrupt when it is re-read has to land
   * in the same "not loaded, refuses to save" state as at project open. Throwing would take the rest
   * of the reload down with it, and writing would turn "unreadable" into "gone".
   */
  it("puts a corrupt document into the refuses-to-save state instead of throwing", async () => {
    const harness = await createHarness();
    const corrupt = "{ this is not json";
    harness.files.set(VARIABLES, corrupt);

    const result = await harness.reload.reload("restore");

    expect(result.failures).toEqual([]);
    expect(result.reloaded).toContain("variables");
    await expect(harness.variables.save(harness.variables.getRegistry())).rejects.toThrow(
      /could not be read/
    );
    // Untouched, and the following participants still ran.
    expect(harness.files.get(VARIABLES)).toBe(corrupt);
    expect(harness.stubs.voiceReload).toHaveBeenCalledTimes(1);
  });

  it("keeps a participant that failed on what it had, and names it to the author", async () => {
    const harness = await createHarness();
    harness.stubs.storyReload.mockRejectedValueOnce(
      new Error("index.json is on a disconnected volume")
    );

    const result = await harness.reload.reload("thaw");

    expect(result.failures.map((failure) => failure.id)).toEqual(["story"]);
    // Not short-circuited: the story failing must not leave the other eight stale as well.
    expect(result.reloaded).toContain("voice");
    expect(harness.stubs.showSticky).toHaveBeenCalledTimes(1);
  });

  it("coalesces overlapping causes into one pass", async () => {
    const harness = await createHarness();
    const gate: { release: (() => void) | null } = { release: null };
    harness.duringStoryReload.current = () =>
      new Promise<void>((resolve) => {
        gate.release = resolve;
      });

    const first = harness.reload.reload("thaw");
    // Wait until the first pass is parked inside the story participant, so the second call
    // genuinely arrives mid-reload rather than before it started.
    for (let attempt = 0; attempt < 100 && !gate.release; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(gate.release).not.toBeNull();
    const second = harness.reload.reload("restore");
    gate.release?.();
    const [a, b] = await Promise.all([first, second]);

    expect(a).toBe(b);
    expect(harness.stubs.storyReload).toHaveBeenCalledTimes(1);
    expect(harness.reload.getGeneration()).toBe(1);
  });

  /**
   * "Every participant reads from the source", proved where it is actually decided.
   *
   * The participants read through `BaseFileSystemService`, and the source is installed there for the
   * whole pass - so what has to hold is that the latch is up while EVERY ONE of the nine runs. A
   * participant that ran before it was installed, or after it was released, would be the one reading
   * today's bytes into a view labelled as a past revision.
   */
  it("has the revision installed while every participant runs", async () => {
    const harness = await createHarness("{}");
    const revision = fakeRevisionSource("rev-1");
    const seen: (string | null)[] = [];
    const note = () => seen.push(getProjectDocumentSource()?.origin.kind ?? null);
    for (const stub of [
      harness.stubs.projectReload,
      harness.stubs.assetsReload,
      harness.stubs.charactersReload,
      harness.stubs.storyReload,
      harness.stubs.uiDocumentLoad,
      harness.stubs.uiGraphLoad,
      harness.stubs.localizationReload,
      harness.stubs.voiceReload
    ]) {
      stub.mockImplementation(async () => {
        note();
      });
    }
    vi.spyOn(harness.variables, "load").mockImplementation(async () => {
      note();
      return harness.variables.getRegistry();
    });

    const result = await harness.reload.reload("revision", revision.source);

    // Nine, in the participant table's order, every one of them with the revision installed.
    expect(seen).toEqual(Array.from({ length: 9 }, () => "revision"));
    expect(result.origin).toEqual({ kind: "revision", revision: "rev-1" });
    // And put away afterwards, so a working-tree reload cannot inherit it.
    expect(getProjectDocumentSource()).toBeNull();
  });

  /**
   * The first read of a revision on a project with a remote goes to the network (docs §6). Batched
   * before the pass rather than per document service, and awaited - nine services asking one path at
   * a time would pay that latency nine times over with the workspace sitting empty.
   */
  it("prewarms the source before the first participant reads", async () => {
    const harness = await createHarness("{}");
    const revision = fakeRevisionSource("rev-1");
    const order: string[] = [];
    revision.source.prewarm = async () => {
      order.push("prewarm");
    };
    harness.stubs.projectReload.mockImplementation(async () => {
      order.push("project");
      return {};
    });

    await harness.reload.reload("revision", revision.source);

    expect(order).toEqual(["prewarm", "project"]);
  });

  /**
   * Today's callers keep meaning the working tree, and the working tree is read off the disk - not
   * through a source. That is not tidiness: the working tree's own implementation of "read this path"
   * IS the filesystem service that consults the latch, so installing it would recurse until the stack
   * ran out.
   */
  it("installs nothing when nobody names a source, and reports the working tree", async () => {
    const harness = await createHarness("{}");
    let insideThePass: DocumentSource | null = null;
    harness.duringStoryReload.current = async () => {
      insideThePass = getProjectDocumentSource();
    };

    const result = await harness.reload.reload("thaw");

    expect(insideThePass).toBeNull();
    expect(result.origin).toEqual({ kind: "working-tree" });
  });

  /**
   * Coalescing two passes that read DIFFERENT versions would hand the second caller the first one's
   * answer. The pair that makes it fatal is "leave the revision while entering it is still reading":
   * the thaw would be given the pass filling memory with the revision, and would unfreeze on top of
   * it - a writable workspace holding a past version.
   */
  it("queues a pass for another version instead of coalescing it", async () => {
    const harness = await createHarness("{}");
    const revision = fakeRevisionSource("rev-1");
    const gate: { release: (() => void) | null } = { release: null };
    harness.duringStoryReload.current = () =>
      new Promise<void>((resolve) => {
        gate.release = resolve;
      });

    const entering = harness.reload.reload("revision", revision.source);
    for (let attempt = 0; attempt < 100 && !gate.release; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(gate.release).not.toBeNull();
    harness.duringStoryReload.current = null;
    const leaving = harness.reload.reload("thaw");
    gate.release?.();
    const [first, second] = await Promise.all([entering, leaving]);

    expect(first).not.toBe(second);
    expect(first.origin).toEqual({ kind: "revision", revision: "rev-1" });
    expect(second.origin).toEqual({ kind: "working-tree" });
    expect(harness.stubs.storyReload).toHaveBeenCalledTimes(2);
    expect(harness.reload.getGeneration()).toBe(2);
  });

  it("still coalesces two passes that read the same version", async () => {
    const harness = await createHarness("{}");
    const revision = fakeRevisionSource("rev-1");
    const gate: { release: (() => void) | null } = { release: null };
    harness.duringStoryReload.current = () =>
      new Promise<void>((resolve) => {
        gate.release = resolve;
      });

    const first = harness.reload.reload("revision", revision.source);
    for (let attempt = 0; attempt < 100 && !gate.release; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    // A source rebuilt for the same revision means the same thing, so identity is not the test.
    const second = harness.reload.reload("revision", fakeRevisionSource("rev-1").source);
    gate.release?.();

    expect(await first).toBe(await second);
    expect(harness.stubs.storyReload).toHaveBeenCalledTimes(1);
  });

  it("announces itself once per pass, after writes are writable again", async () => {
    const harness = await createHarness();
    const seen: { generation: number; held: boolean }[] = [];
    const stop = harness.reload.onReloaded(() => {
      seen.push({ generation: harness.reload.getGeneration(), held: isProjectWriteReloadHeld() });
    });

    await harness.reload.reload("thaw");
    await harness.reload.reload("restore");

    expect(seen).toEqual([
      { generation: 1, held: false },
      { generation: 2, held: false }
    ]);
    stop();
  });
});
