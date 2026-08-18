import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseApp } from "../../baseApp";
import { VcsManager } from "./VcsManager";

/**
 * The one rule about caching a comparison, from both sides.
 *
 * `diffRevisions(from, to)` MAY be cached: both revisions are immutable, so the answer
 * cannot go stale - the same argument the per-revision metadata cache next door rests on
 * (`historyDetailCache.test.ts`), and the same line that keeps the revision GRAPH out of
 * that cache while the details stay in.
 *
 * `diffWorkingTree()` MUST NOT be, ever. The working tree changes under Studio between any
 * two calls - the author is typing, the auto-save is writing, their other tools are running
 * - so a remembered answer is a list of changes shown beside files that no longer match it.
 * It is also what the resolve flow will take decisions on, where a stale row means picking
 * a side on a change that is not there.
 *
 * A fake backend rather than a repository: the question is how many times the manager calls
 * out, and only a fake can answer that exactly.
 */

const lore = vi.hoisted(() => {
  const calls: string[] = [];
  const backend = {
    openStore: async () => ({ handleId: 1 }),
    closeStore: async () => undefined,
    flushRepository: async () => undefined,
    releaseRepository: async () => undefined,
    readRepositoryIdentity: async () => ({ repository: "repo0", branch: "main" }),
    // Read once when a session opens: it is what decides whose name goes on a
    // revision and which account id the online calls carry. Null is "no server".
    readRemote: async () => null,
    changedPaths: async (_globals: unknown, from: string, to: string) => {
      calls.push(`changedPaths:${from}..${to}`);
      return ["editor/audio-tracks.json"];
    },
    // The bytes each revision holds for the one path this fake knows about. Written once so
    // the walk can report a truthful size and the read can hand back the matching buffer.
    bytesAt: (revision: string) =>
      Buffer.from(
        JSON.stringify({ version: 2, tracks: revision === "r1" ? [] : [{ id: "bgm" }] }),
        "utf-8"
      ),
    entriesAt: async (
      _globals: unknown,
      _store: unknown,
      _repository: string,
      revision: string
    ) => {
      calls.push(`entriesAt:${revision}`);
      const bytes = backend.bytesAt(revision);
      return new Map([
        [
          "editor/audio-tracks.json",
          {
            path: "editor/audio-tracks.json",
            size: bytes.length,
            hash: `hash-${revision}`,
            context: `context-${revision}`
          }
        ]
      ]);
    },
    readEntryBytes: async (
      _globals: unknown,
      _store: unknown,
      _repository: string,
      entry: { hash: string }
    ) => {
      const revision = entry.hash.replace("hash-", "");
      calls.push(`readEntryBytes:${revision}`);
      return backend.bytesAt(revision);
    },
    getStatus: async () => {
      calls.push("getStatus");
      return {
        branch: "main",
        head: "r2",
        revisionNumber: 2,
        clean: false,
        files: [
          {
            path: "editor/audio-tracks.json",
            kind: "modified" as const,
            directory: false,
            size: 12,
            staged: false,
            dirty: true,
            conflicted: false,
            conflictUnresolved: false
          }
        ],
        counts: { added: 0, modified: 1, deleted: 0, moved: 0, copied: 0 },
        sync: {
          remoteAvailable: false,
          remoteAuthorized: false,
          remoteBranchExists: false,
          localAhead: false,
          remoteAhead: false
        }
      };
    },
    // The guard `readWorking` goes through: the real one refuses a path outside the
    // repository, and returning the joined path is enough for a test that never reads disk.
    repositoryPath: (root: string, relative: string) => `${root}/${relative}`
  };
  return { backend, calls };
});

vi.mock("./backend", () => ({
  requireVcsBackend: async () => lore.backend,
  getVcsAvailability: async () => ({ available: true })
}));

/** A path, never touched on disk - the working-tree read below is expected to find nothing. */
const PROJECT = "/projects/prologue";

function fakeApp(): BaseApp {
  const noop = () => undefined;
  return {
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    getGlobalState: () => ({ get: () => undefined })
  } as unknown as BaseApp;
}

let manager: VcsManager;

beforeEach(() => {
  lore.calls.length = 0;
  manager = new VcsManager(fakeApp());
});

describe("comparison caching", () => {
  it("asks the backend once for a pair of revisions, however often it is asked", async () => {
    const first = await manager.diffRevisions(PROJECT, "r1", "r2");
    const second = await manager.diffRevisions(PROJECT, "r1", "r2");

    expect(second).toEqual(first);
    // One walk and one read per side, in that order: the walk is what decides whether the
    // read is worth making at all.
    expect(lore.calls).toEqual([
      "changedPaths:r1..r2",
      "entriesAt:r1",
      "entriesAt:r2",
      "readEntryBytes:r1",
      "readEntryBytes:r2"
    ]);
  });

  it("keeps the two directions apart", async () => {
    await manager.diffRevisions(PROJECT, "r1", "r2");
    await manager.diffRevisions(PROJECT, "r2", "r1");

    expect(lore.calls.filter((call) => call.startsWith("changedPaths"))).toEqual([
      "changedPaths:r1..r2",
      "changedPaths:r2..r1"
    ]);
  });

  it("re-reads the working tree every single time", async () => {
    await manager.diffWorkingTree(PROJECT);
    await manager.diffWorkingTree(PROJECT);

    expect(lore.calls.filter((call) => call === "getStatus")).toHaveLength(2);
    expect(lore.calls.filter((call) => call === "entriesAt:r2")).toHaveLength(2);
  });

  it("does not let a working-tree comparison answer a revision one, or the reverse", async () => {
    await manager.diffWorkingTree(PROJECT);
    lore.calls.length = 0;

    await manager.diffRevisions(PROJECT, "r1", "r2");

    expect(lore.calls).toEqual([
      "changedPaths:r1..r2",
      "entriesAt:r1",
      "entriesAt:r2",
      "readEntryBytes:r1",
      "readEntryBytes:r2"
    ]);
  });

  it("walks each revision once even though two ports ask for it", async () => {
    // The memo the two ports share. Without it, `entriesAt` and the read behind `readAt`
    // would each walk the tree - and on a project with a remote the first walk of a revision
    // can go to the network (docs/version-control.md §6), so the second one is not free.
    await manager.diffRevisions(PROJECT, "r1", "r2");

    expect(lore.calls.filter((call) => call === "entriesAt:r1")).toHaveLength(1);
    expect(lore.calls.filter((call) => call === "entriesAt:r2")).toHaveLength(1);
  });

  it("does not remember a comparison whose bytes could not be read", async () => {
    // A read failure is a fact about this PROCESS rather than about the two revisions - the
    // measured case is a process unable to read back what it wrote with an online commit
    // (docs/version-control.md §4.29) - so caching it would make the failure outlive whatever
    // caused it, and the author's only way out would be to reopen the project.
    const readEntryBytes = lore.backend.readEntryBytes;
    lore.backend.readEntryBytes = async () => {
      throw new Error("1/1 get items failed");
    };
    const failed = await manager.diffRevisions(PROJECT, "r3", "r4");
    expect(failed.readFailure).toBe("1/1 get items failed");

    lore.backend.readEntryBytes = readEntryBytes;
    lore.calls.length = 0;
    const retried = await manager.diffRevisions(PROJECT, "r3", "r4");

    expect(retried.readFailure).toBeNull();
    expect(lore.calls).toContain("readEntryBytes:r3");
  });
});
