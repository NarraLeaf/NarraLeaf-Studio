import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported, VCS_REVISION_KIND_KEY } from "@shared/types/vcs";
import type { BaseApp } from "../../baseApp";
import type { LoreGlobals } from "./lore/call";
import { flushRepository, listRevisionMetadata, releaseRepository, stage } from "./lore/verbs";
import { initRepository, NothingToCommitError, readRevisionKind } from "./repository";
import { UNCONFIGURED_IDENTITY, VcsManager } from "./VcsManager";

/**
 * The commit pipeline against the real library and a real repository.
 *
 * Driven through {@link VcsManager} rather than through `commitWorkingTree` directly,
 * because the step that is easiest to get wrong is not inside the backend: the
 * renderer's pending auto-saves have to be flushed BEFORE anything is staged, and only
 * the manager knows how to ask. The fake flush below writes a file when it is called,
 * so "the flush ran first" is proved by that file being in the commit rather than by
 * asserting on a call order that would still pass if the pipeline staged first.
 *
 * Only runs where Epic ships a native build (no Intel Mac, no Windows ARM64 - see
 * docs/version-control.md §7).
 *
 * Teardown is not optional. Lore's repository lock is EXCLUSIVE and blocking, so a
 * session left open makes the next run of this file wait instead of fail, and on
 * Windows the temp directory cannot be removed at all. flush -> close -> release, in
 * that order (§4.15, §4.19).
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);

const STORY = "editor/story/stories/prologue/storydoc.json";
const CONFIG = "project.json";
/** Written by the fake pending-save flush, never by the test body. */
const DEBT = "editor/story/stories/prologue/typed-but-not-saved.json";
/** Excluded by the working-set policy; a write here must not become a revision. */
const THUMBNAIL = "editor/cache/thumbnail/ab/cd/y.png";

let root: string;
let globals: LoreGlobals;
let manager: VcsManager;
let settings: Record<string, unknown>;
/** Set by a test to make the fake flush write something, the way an autosaver would. */
let pendingSaveDebt: (() => void) | null;
let flushCalls: number;

function write(relative: string, bytes: string): void {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, bytes);
}

/** Who Lore recorded as the committer of one revision. */
async function authorOf(revision: string): Promise<string | undefined> {
  const entries = await listRevisionMetadata(globals, revision);
  return entries.find((entry) => entry.key === "committed-by")?.text;
}

/**
 * Just enough of the app for the manager: a logger and global state.
 *
 * Deliberately not a mock of VcsManager's own methods - the point of this file is that
 * the real ones run against the real library.
 */
function fakeApp(): BaseApp {
  const noop = () => undefined;
  return {
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    getGlobalState: () => ({ get: (key: string) => settings[key] })
  } as unknown as BaseApp;
}

beforeAll(async () => {
  if (!supported) return;

  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-commit-")));
  globals = { repositoryPath: root, offline: true, cache: true };

  write(CONFIG, JSON.stringify({ name: "prologue" }));
  write(STORY, JSON.stringify({ version: 9, scenes: [] }));
  await initRepository(globals, { identity: "author@narraleaf" });

  settings = {};
  pendingSaveDebt = null;
  flushCalls = 0;
  manager = new VcsManager(fakeApp(), async () => {
    flushCalls++;
    pendingSaveDebt?.();
    pendingSaveDebt = null;
  });
}, 180_000);

afterAll(async () => {
  if (!supported) return;
  // The manager's own teardown is flush -> close -> release; releasing again after it
  // is harmless and covers the case where no session was ever opened.
  await manager?.dispose().catch(() => undefined);
  await flushRepository(globals).catch(() => undefined);
  await releaseRepository(globals).catch(() => undefined);
  if (root) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
  // Generous, and not the default 10s: `repositoryFlush` alone waits on Lore's lazy
  // mutable-store flush, and giving up here would strand the exclusive repository lock
  // for whoever runs this file next.
}, 120_000);

describe.skipIf(!supported)("commit pipeline", () => {
  it("flushes the renderer's pending saves before it stages", async () => {
    // The debt an autosaver is holding when the author presses Commit. If staging
    // happened first, this file would exist on disk and be absent from the revision
    // the author was told described their project.
    pendingSaveDebt = () => write(DEBT, JSON.stringify({ typed: true }));

    const result = await manager.commit(root, { message: "First author commit" });

    expect(flushCalls).toBe(1);
    expect(result.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(result.kind).toBe("commit");
    expect(result.number).toBe(2);

    // Reading the committed tree is the assertion that matters, not the count the
    // pipeline reported about itself.
    const blob = await manager.readBlob({
      projectPath: root,
      revision: result.revision,
      path: DEBT
    });
    expect(JSON.parse(blob.toString("utf-8"))).toEqual({ typed: true });
  }, 120_000);

  it("leaves the working tree clean, so the commit really took everything", async () => {
    const status = await manager.getStatus(root);
    expect(status.clean).toBe(true);
    expect(status.counts).toEqual({ added: 0, modified: 0, deleted: 0, moved: 0, copied: 0 });
  }, 60_000);

  it("refuses to make an empty revision, in words the author can read", async () => {
    // Lore's own answer is "Nothing staged for commit", which describes its staging
    // model rather than the author's situation. Pinned here because the refusal is
    // recognised by that message: a reworded upstream has to fail this test instead
    // of turning a routine "nothing changed" into an opaque error in the UI.
    const failure = await manager.commit(root).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NothingToCommitError);
    expect((failure as Error).message).toContain("Nothing has changed");
  }, 60_000);

  it("records the author name from settings, trimmed", async () => {
    // Read back off the revision rather than asserted about the resolver: Lore keeps
    // the identity in the revision's own metadata (`created-by` / `committed-by`),
    // alongside `branch`, `timestamp` and `message`.
    settings["versionControl.authorName"] = "  Aria  ";
    write(STORY, JSON.stringify({ version: 9, scenes: ["prologue"] }));

    const result = await manager.commit(root);
    await expect(authorOf(result.revision)).resolves.toBe("Aria");
  }, 120_000);

  it("records the tool for a project whose author name is not configured", async () => {
    // Deliberately not the OS account name: an identity written into revisions that
    // travel to collaborators is not something to fill in on the author's behalf.
    settings["versionControl.authorName"] = "";
    settings["versionControl.authorEmail"] = "";
    write(STORY, JSON.stringify({ version: 9, scenes: ["prologue", "unnamed"] }));

    const result = await manager.commit(root);
    await expect(authorOf(result.revision)).resolves.toBe(UNCONFIGURED_IDENTITY);
  }, 120_000);

  it("folds a configured email into the identity the revision actually carries", async () => {
    // The unit test next to `composeVcsIdentity` pins the shape; this pins that the shape
    // survives the trip through Lore, which stores the identity verbatim and is the only
    // thing that can prove the second Sync setting reaches a revision at all.
    settings["versionControl.authorName"] = "Aria";
    settings["versionControl.authorEmail"] = "aria@example.com";
    write(STORY, JSON.stringify({ version: 9, scenes: ["prologue", "with-email"] }));

    const result = await manager.commit(root);
    await expect(authorOf(result.revision)).resolves.toBe("Aria <aria@example.com>");
  }, 120_000);

  it("raises for a path outside the repository instead of quietly skipping it", async () => {
    // Lore answers an outside path with SUCCESS, a PATH_IGNORE event and no work
    // done, and the failure only surfaces later as "Nothing staged for commit" - by
    // which point the author believes an asset is versioned and it is not. The
    // pipeline stages the repository root precisely so this guard stays armed.
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-outside-")));
    fs.writeFileSync(path.join(outside, "stray.json"), "{}");
    try {
      await expect(stage(globals, [outside])).rejects.toThrow(/ignored/i);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  }, 60_000);
});

describe.skipIf(!supported)("checkpoints", () => {
  it("records a checkpoint as an ordinary revision labelled by metadata", async () => {
    write(STORY, JSON.stringify({ version: 9, scenes: ["prologue", "act-1"] }));

    const result = await manager.checkpoint(root, "interval");
    expect(result).not.toBeNull();

    // Read back through the same key the history UI will use. A checkpoint that
    // cannot be told from a commit afterwards is a checkpoint that cannot be folded
    // away, which is the whole reason the metadata exists.
    await expect(readRevisionKind(globals, result!.revision)).resolves.toBe("checkpoint");

    const entries = await listRevisionMetadata(globals, result!.revision);
    expect(entries.map((entry) => entry.key)).toContain(VCS_REVISION_KIND_KEY);
    expect(entries.find((entry) => entry.key === VCS_REVISION_KIND_KEY)?.text).toBe("checkpoint");
  }, 120_000);

  it("stays on the author's branch, because switching one would move their files", async () => {
    const status = await manager.getStatus(root);
    expect(status.branch).toBe("main");
    expect(status.clean).toBe(true);
  }, 60_000);

  it("answers nothing rather than making an empty revision", async () => {
    // The unconditional checkpoints (project close, build, restore) run whether or
    // not anything changed, so this is the case they hit most often. A revision
    // every time would fill the history with entries the author cannot tell apart.
    const before = await manager.getHistory(root);
    await expect(manager.checkpoint(root, "project-close")).resolves.toBeNull();
    await expect(manager.checkpoint(root, "build")).resolves.toBeNull();
    const after = await manager.getHistory(root);
    expect(after.length).toBe(before.length);
  }, 120_000);

  it("tells checkpoints and commits apart in history, and only when asked", async () => {
    const withKinds = await manager.getHistory(root, 0, { includeDetails: true });
    expect(withKinds.length).toBeGreaterThanOrEqual(3);
    expect(withKinds[0].kind).toBe("checkpoint");
    expect(withKinds.some((entry) => entry.kind === "commit")).toBe(true);
    // The repository's first commit predates kinds - `initRepository` does not label
    // one - so "absent" is a real answer the history UI has to render.
    expect(withKinds[withKinds.length - 1].kind).toBeUndefined();

    const plain = await manager.getHistory(root, 0);
    expect(plain.length).toBe(withKinds.length);
    expect(plain.every((entry) => entry.kind === undefined)).toBe(true);
  }, 120_000);

  it("ignores a write to an excluded path, so a cache file is not history", async () => {
    write(THUMBNAIL, "THUMB-BYTES");
    // Nothing to do with the renderer's `isVersioned` predicate: this is the
    // repository's own ignore file, and the two are generated from one table
    // (@shared/vcs/workingSet) so they cannot disagree.
    await expect(manager.checkpoint(root, "interval")).resolves.toBeNull();
  }, 60_000);
});

describe.skipIf(!supported)("durability", () => {
  it("keeps a commit that a fresh session reads back", async () => {
    write(STORY, JSON.stringify({ version: 9, scenes: ["prologue", "act-1", "act-2"] }));
    const result = await manager.commit(root, { message: "Durable" });

    // Drop everything held in memory for this repository, then read the branch tip
    // back off disk. Without the pipeline's final `repositoryFlush` the tip lives
    // only in Lore's mutable store in memory, which is written lazily - a process
    // that commits and exits promptly loses the commit outright, and it is a RACE
    // rather than a stable failure (§4.11). That measurement was made across two
    // processes; what this asserts is the same store re-read after the session that
    // wrote it let go.
    await manager.closeProject(root);

    const history = await manager.getHistory(root);
    expect(history[0].revision).toBe(result.revision);
    expect(history[0].number).toBe(result.number);
    await expect(readRevisionKind(globals, result.revision)).resolves.toBe("commit");
  }, 180_000);
});

describe.skipIf(!supported)("showing a past revision", () => {
  /**
   * The acceptance oracle for "the workspace can show a past revision", at the layer the renderer
   * calls: commit, edit, commit again, and read the earlier revision back. The editor must be handed
   * the OLD text while the file on disk still holds the NEW one.
   *
   * Driven through {@link VcsManager} rather than the reader, because the manager is what adds the
   * two things the renderer depends on: the outside-the-repository guard, and a batch that answers
   * every document in one pass over the tree.
   */
  it("reads the old text out of a revision while the working tree holds the new one", async () => {
    write(STORY, JSON.stringify({ version: 9, scenes: ["as-it-was"] }));
    const before = await manager.commit(root, { message: "Before the edit" });

    write(STORY, JSON.stringify({ version: 9, scenes: ["as-it-is-now"] }));
    const after = await manager.commit(root, { message: "After the edit" });

    const old = await manager.readRevisionDocuments(root, before.revision, { paths: [STORY] });
    expect(JSON.parse(String(old.get(STORY)))).toEqual({ version: 9, scenes: ["as-it-was"] });
    // Byte-exact, not merely equivalent: the editors parse these bytes, and a re-encoded document
    // would round-trip through the author's working tree the moment they left the revision.
    expect(old.get(STORY)).toEqual(
      Buffer.from(JSON.stringify({ version: 9, scenes: ["as-it-was"] }))
    );

    // The disk was not consulted and was not touched.
    expect(JSON.parse(fs.readFileSync(path.join(root, STORY), "utf-8"))).toEqual({
      version: 9,
      scenes: ["as-it-is-now"]
    });
    const current = await manager.readRevisionDocuments(root, after.revision, { paths: [STORY] });
    expect(JSON.parse(String(current.get(STORY)))).toEqual({
      version: 9,
      scenes: ["as-it-is-now"]
    });
  }, 240_000);

  it("answers null for a document that did not exist at that revision", async () => {
    const before = await manager.getHistory(root, 2);
    const added = "editor/story/stories/added-later/storydoc.json";
    write(added, JSON.stringify({ version: 9, scenes: [] }));
    const withIt = await manager.commit(root, { message: "A story added later" });

    // Absent is an answer: the story editor has to land in the same "no such story" state it
    // renders at project open, not report a broken project.
    const earlier = await manager.readRevisionDocuments(root, before[0].revision, {
      paths: [added]
    });
    expect(earlier.get(added)).toBeNull();

    const now = await manager.readRevisionDocuments(root, withIt.revision, { paths: [added] });
    expect(now.get(added)).not.toBeNull();
  }, 240_000);

  it("answers every document at a revision in one pass, and leaves the assets out of it", async () => {
    write("assets/content/ab/cd/sprite.png", "PNG-BYTES-NOT-A-DOCUMENT");
    const revision = await manager.commit(root, { message: "With an asset" });

    const documents = await manager.readRevisionDocuments(root, revision.revision);

    // Nobody named a path, and the project's documents came back anyway - which is what makes
    // prewarming a revision one round trip instead of one per document service.
    expect([...documents.keys()]).toContain(CONFIG);
    expect([...documents.keys()]).toContain(STORY);
    // Selected by name, so the author's art does not cross IPC base64-encoded to answer
    // "what did this scene say?".
    expect([...documents.keys()]).not.toContain("assets/content/ab/cd/sprite.png");
    expect([...documents.values()].every((bytes) => bytes !== null)).toBe(true);
  }, 240_000);
});
