import { describe, expect, it } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { pluginStoreNamespace } from "@shared/utils/pluginStorage";
import { join } from "@shared/utils/path";
import { isVersioned } from "@shared/vcs/workingSet";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Porject } from "../../project/project";
import { Services, type WorkspaceContext } from "../services";
import { ServiceAssetsService } from "./ServiceAssetsService";

/**
 * Where a service store lands, and how a project written by an older Studio gets
 * moved without a moment where its data is nowhere.
 *
 * The bytes are somebody else's problem; what is pinned here is the routing (which of
 * the two `services/` directories a namespace resolves to) and the migration's order,
 * including the case that made the order matter: `editor/services/` is versioned, so a
 * frozen workspace answers the delete with a silent no-op success and the file is
 * still there afterwards.
 */

const ROOT = join("D:/projects", "my-game");
const GALLERY_STORE = pluginStoreNamespace("narraleaf.gallery", "narraleaf.gallery.items");

/**
 * Expected paths are built from `ProjectNameConvention`, not spelled out: the
 * convention's directory entries carry a trailing slash, so the real resolver emits a
 * doubled separator that Windows and POSIX both accept but a hand-written literal
 * would not match. Asserting against the convention keeps this about *which* entry a
 * store resolves through.
 */
const project = new Porject({ projectPath: ROOT });
const studioStore = (name: string): string =>
  project.resolve(ProjectNameConvention.StudioServices, `${name}.json`);
const versionedStore = (name: string): string =>
  project.resolve(ProjectNameConvention.EditorServices, `${name}.json`);

const ok = <T>(data: T): FsRequestResult<T> => ({ ok: true, data });
const fail = (code: FsRejectErrorCode): FsRequestResult<never> => ({
  ok: false,
  error: { code, message: code }
});

type Harness = {
  service: ServiceAssetsService;
  files: Map<string, string>;
  calls: string[];
  writeError: FsRejectErrorCode | null;
  /** A frozen workspace: the delete reports success and removes nothing. */
  frozen: boolean;
};

async function createHarness(seed: Record<string, unknown> = {}): Promise<Harness> {
  const files = new Map<string, string>();
  for (const [path, value] of Object.entries(seed)) {
    files.set(path, JSON.stringify(value));
  }
  const directories = new Set<string>([ROOT]);
  const harness = { files, calls: [], writeError: null, frozen: false } as unknown as Harness;

  const filesystem = {
    readJSON: async <T>(path: string): Promise<FsRequestResult<T>> => {
      harness.calls.push(`readJSON ${path}`);
      const raw = files.get(path);
      if (raw === undefined) {
        return fail(FsRejectErrorCode.NOT_FOUND);
      }
      try {
        return ok(JSON.parse(raw) as T);
      } catch {
        return fail(FsRejectErrorCode.INVALID_JSON);
      }
    },
    write: async (path: string, data: string): Promise<FsRequestResult<void>> => {
      harness.calls.push(`write ${path}`);
      if (harness.writeError) {
        return fail(harness.writeError);
      }
      files.set(path, data);
      return ok(undefined);
    },
    createDir: async (path: string): Promise<FsRequestResult<void>> => {
      harness.calls.push(`createDir ${path}`);
      directories.add(path);
      return ok(undefined);
    },
    isDirExists: async (path: string): Promise<FsRequestResult<boolean>> =>
      ok(directories.has(path)),
    isFileExists: async (path: string): Promise<FsRequestResult<boolean>> => {
      harness.calls.push(`isFileExists ${path}`);
      return ok(files.has(path));
    },
    deleteFile: async (path: string): Promise<FsRequestResult<void>> => {
      harness.calls.push(`deleteFile ${path}`);
      if (harness.frozen) {
        // `frozenNoOp` in the privileged facade: refusing a write is reported as
        // success so a debounced saver does not keep it as a debt and replay it.
        return ok(undefined);
      }
      files.delete(path);
      return ok(undefined);
    }
  };

  const services = new Map<Services, unknown>([
    [Services.FileSystem, filesystem],
    [Services.Uuid, { generate: () => "00000000-0000-4000-8000-000000000000" }]
  ]);
  const ctx = {
    project,
    services: { get: (service: Services) => services.get(service) }
  } as unknown as WorkspaceContext;

  harness.service = new ServiceAssetsService();
  await harness.service.initialize(ctx, async () => {});
  harness.calls.length = 0;
  return harness;
}

describe("ServiceAssetsService store routing", () => {
  it("keeps a Studio-state store out of the versioned tree", async () => {
    const harness = await createHarness();

    const written = await harness.service.writeStore("panel_state", { version: 1, panels: {} });

    expect(written.ok && written.data.path).toBe(studioStore("panel_state"));
    expect(harness.files.has(versionedStore("panel_state"))).toBe(false);
    expect(await harness.service.readStore("panel_state")).toEqual(ok({ version: 1, panels: {} }));
  });

  it("leaves project content where the repository can see it", async () => {
    const harness = await createHarness();

    const written = await harness.service.writeStore("character", { version: 3, characters: [] });

    expect(written.ok && written.data.path).toBe(versionedStore("character"));
    // A plugin store is the same answer by default: game-capability content.
    const gallery = await harness.service.writeStore(GALLERY_STORE, { items: [] });
    expect(gallery.ok && gallery.data.path).toBe(versionedStore(GALLERY_STORE));

    // No migration machinery runs for content: nothing looks for, or removes, an
    // older copy of a file that never moved.
    harness.calls.length = 0;
    await harness.service.readStore("character");
    expect(harness.calls).toEqual([`readJSON ${versionedStore("character")}`]);
  });

  it("routes each store to the side of the working set its classification names", async () => {
    const harness = await createHarness();

    const studio = await harness.service.writeStore("recent_colors", {
      version: 1,
      colors: ["#fff"]
    });
    const project = await harness.service.writeStore("character", { characters: [] });

    expect(isVersioned(relative(studio))).toBe(false);
    expect(isVersioned(relative(project))).toBe(true);
  });
});

describe("ServiceAssetsService store migration", () => {
  const LEGACY = versionedStore("panel_state");
  const MIGRATED = studioStore("panel_state");
  const LAYOUT = { version: 1, panels: { explorer: { width: 240 } } };

  it("carries the versioned copy over, then removes it", async () => {
    const harness = await createHarness({ [LEGACY]: LAYOUT });

    expect(await harness.service.readStore("panel_state")).toEqual(ok(LAYOUT));

    expect(harness.files.get(MIGRATED)).toBe(JSON.stringify(LAYOUT));
    expect(harness.files.has(LEGACY)).toBe(false);
    // Written and confirmed before the old file is touched: a crash in between
    // leaves the layout on disk twice, never nowhere.
    expect(harness.calls.indexOf(`write ${MIGRATED}`)).toBeLessThan(
      harness.calls.indexOf(`deleteFile ${LEGACY}`)
    );
  });

  it("keeps the only copy when the new one cannot be written", async () => {
    const harness = await createHarness({ [LEGACY]: LAYOUT });
    harness.writeError = FsRejectErrorCode.PERMISSION_DENIED;

    expect(await harness.service.readStore("panel_state")).toEqual(ok(LAYOUT));

    expect(harness.files.has(MIGRATED)).toBe(false);
    expect(harness.files.get(LEGACY)).toBe(JSON.stringify(LAYOUT));
    expect(harness.calls).not.toContain(`deleteFile ${LEGACY}`);
  });

  it("tidies the leftover on the next launch when a frozen workspace no-ops the removal", async () => {
    const harness = await createHarness({ [LEGACY]: LAYOUT });
    harness.frozen = true;

    // The author still gets their layout, and the copy that matters is in place.
    expect(await harness.service.readStore("panel_state")).toEqual(ok(LAYOUT));
    expect(harness.files.get(MIGRATED)).toBe(JSON.stringify(LAYOUT));
    // The delete reported success and did nothing.
    expect(harness.calls).toContain(`deleteFile ${LEGACY}`);
    expect(harness.files.has(LEGACY)).toBe(true);

    harness.frozen = false;
    harness.calls.length = 0;

    // Next launch. The new path answers, so nothing is copied - and the leftover is
    // still removed, because "the old file exists" is its own condition.
    expect(await harness.service.readStore("panel_state")).toEqual(ok(LAYOUT));
    expect(harness.files.has(LEGACY)).toBe(false);
    expect(harness.calls).not.toContain(`write ${MIGRATED}`);
  });

  it("leaves an unreadable legacy file alone rather than guess it is junk", async () => {
    const harness = await createHarness();
    harness.files.set(LEGACY, "{ not json");

    const read = await harness.service.readStore("panel_state");

    // The new path's NOT_FOUND, which every caller already reads as "start empty".
    expect(read.ok).toBe(false);
    // An unreadable read is also what a transient IPC failure looks like; deleting on
    // that is the one way this migration could destroy something.
    expect(harness.files.has(LEGACY)).toBe(true);
  });
});

/** Repository-relative form of a written store, for {@link isVersioned}. */
function relative(written: FsRequestResult<{ path: string }>): string {
  if (!written.ok) {
    throw new Error("expected the store write to succeed");
  }
  return written.data.path.slice(ROOT.length + 1);
}
