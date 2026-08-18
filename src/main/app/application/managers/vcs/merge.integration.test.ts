import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { mergeDecisionKey } from "@shared/documents/mergeApply";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported } from "@shared/types/vcs";
import {
  branchMergeResolveMine,
  branchMergeStart,
  closeStore,
  commit,
  createBranch,
  createRepository,
  flushRepository,
  openStore,
  releaseRepository,
  repositoryStatus,
  stage,
  switchBranch,
  type LoreGlobals,
  type StoreHandle
} from "./lore";
import {
  abortMerge,
  readMergeState,
  resolveConflicts,
  restartConflicts,
  unresolveConflicts
} from "./merge";
import { readRevisionKind } from "./repository";
import { blobAt } from "./revisionReader";
import { cloneInto, publishToRemote, pushToRemote, syncFromRemote, writeRemote } from "./remote";
import type { BaseApp } from "../../baseApp";
import { VcsManager } from "./VcsManager";

/**
 * The merge surface, held against the behaviour that was measured before it was written.
 *
 * **These are specifications, not probes.** `mergeSpike*.integration.test.ts` are the
 * measurement experiments: they print what the backend does and assert nothing, which is right for
 * finding something out and useless for keeping it true. Every expectation below is one of
 * the findings recorded in docs/version-control.md §4.23-§4.30, written so that a backend
 * upgrade which changes it fails the build rather than silently changing what Studio shows
 * an author mid-merge.
 *
 * Three of them are load-bearing enough to name here:
 *
 *  - **a conflicted sync NAMES its conflicting paths.** It used to answer `["*"]` for every
 *    conflict, because the filter ran over per-file events whose conflict fields the decoder
 *    hard-codes to `false` (§4.24). If this regresses, the resolve UI has nothing to draw;
 *  - **`revisionMerged` alone does not mean "a merge is open"** - it is still set after the
 *    merge is committed. Only paired with `revisionStaged` does it mean it;
 *  - **abandoning a merge is a complete rollback** (§4.27). Without that, "cancel" cannot be
 *    offered at all.
 *
 * The local block needs no server. The remote block needs one, and is skipped without it:
 *
 * ```bash
 * # loreserver 0.8.5 - the version Studio pins.
 * LORE_TEST_REMOTE="lore://127.0.0.1:41337" \
 *   npx vitest run src/main/app/application/managers/vcs/merge.integration.test.ts
 * ```
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);
const SERVER = (process.env.LORE_TEST_REMOTE ?? "").trim();
const remoteEnabled = supported && SERVER !== "";

const DOCUMENT = "doc.json";
/** A second conflicted file, so "one side per PATH" can be told from "one side for the merge". */
const OTHER = "other.json";
const BASE_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue", version: 7 }, null, 2)}\n`;
const MINE_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue (mine)", version: 7 }, null, 2)}\n`;
const THEIRS_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue (theirs)", version: 7 }, null, 2)}\n`;
const OTHER_MINE_TEXT = `${JSON.stringify({ id: "other", note: "mine" }, null, 2)}\n`;
const OTHER_THEIRS_TEXT = `${JSON.stringify({ id: "other", note: "theirs" }, null, 2)}\n`;
/** An answer NEITHER side wrote, which is the only thing `working-tree` can express. */
const THIRD_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue (agreed)", version: 7 }, null, 2)}\n`;

/**
 * A real document format for the per-change tier, and it has to be a real one.
 *
 * `doc.json` above is deliberately format-less - tier one never looks inside a file - but tier two
 * is only reachable through a registered spec's `merge3`, so it needs a path the registry claims.
 * A translation library is the case that comes first: translators do not
 * partition a file, they take the keys they can do, so almost every unit is touched by exactly one
 * side and the handful both touched is the whole question.
 */
const LOCALE_DOCUMENT = "editor/localization/ja.json";
const localeUnit = (target: string) => ({ target, sourceHash: "h", status: "translated" });
function localeText(units: Record<string, ReturnType<typeof localeUnit>>): string {
  return `${JSON.stringify({ schemaVersion: 1, locale: "ja", units }, null, 2)}\n`;
}
/** One unit both sides retranslated, and one unit each that only one side has. */
const LOCALE_BASE = localeText({ greeting: localeUnit("base") });
const LOCALE_MINE = localeText({ greeting: localeUnit("mine"), fromMine: localeUnit("only mine") });
const LOCALE_THEIRS = localeText({
  greeting: localeUnit("theirs"),
  fromTheirs: localeUnit("only theirs")
});

const roots: string[] = [];
const held: LoreGlobals[] = [];

function tmp(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}

/**
 * `storeKeepAlive` left unset deliberately: with it on, every flush waits out the
 * keep-alive window (§4.22), and this file flushes after every write verb.
 */
function offline(root: string): LoreGlobals {
  const globals: LoreGlobals = {
    repositoryPath: root,
    offline: true,
    identity: "spec@narraleaf",
    cache: true
  };
  held.push(globals);
  return globals;
}

function online(root: string): LoreGlobals {
  return { ...offline(root), offline: false };
}

function write(root: string, relative: string, contents: string): void {
  fs.writeFileSync(path.join(root, relative), contents, "utf-8");
}

/** `write`, for a path with directories in it - the document specs all live under one. */
function writeDeep(root: string, relative: string, contents: string): void {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  write(root, relative, contents);
}

function read(root: string, relative: string): string {
  return fs.readFileSync(path.join(root, relative), "utf-8");
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function commitAll(globals: LoreGlobals, root: string, message: string): Promise<string> {
  await stage(globals, [root]);
  const revision = await commit(globals, message);
  await flushRepository(globals);
  return revision.revision;
}

/**
 * One store, used and given straight back.
 *
 * The repository lock is exclusive and blocking WITHIN one process as well as across
 * processes (§4.28): a second `openStore` on a repository this process already holds never
 * returns. So nothing here keeps a handle across a step.
 */
async function withStore<T>(
  globals: LoreGlobals,
  root: string,
  use: (store: StoreHandle) => Promise<T>
): Promise<T> {
  const store = await openStore(globals, root);
  try {
    return await use(store);
  } finally {
    await flushRepository(globals).catch(() => undefined);
    await closeStore(globals, store).catch(() => undefined);
    await releaseRepository(globals).catch(() => undefined);
  }
}

interface Fixture {
  root: string;
  globals: LoreGlobals;
  repositoryId: string;
  /** Tip of `main`, the branch the merge runs from. */
  mine: string;
  /** Tip of `feature`, the branch merged in. */
  theirs: string;
}

/** Two branches that changed the same key of the same document: a guaranteed conflict. */
async function twoSided(prefix: string): Promise<Fixture> {
  const root = tmp(prefix);
  const globals = offline(root);
  const created = await createRepository(globals, {
    repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
    description: "merge spec"
  });
  write(root, DOCUMENT, BASE_TEXT);
  await commitAll(globals, root, "base");

  await createBranch(globals, "feature");
  await switchBranch(globals, { branch: "feature" });
  write(root, DOCUMENT, THEIRS_TEXT);
  const theirs = await commitAll(globals, root, "theirs");

  await switchBranch(globals, { branch: "main" });
  write(root, DOCUMENT, MINE_TEXT);
  const mine = await commitAll(globals, root, "mine");
  return { root, globals, repositoryId: created.repository, mine, theirs };
}

/**
 * The same two branches, with TWO documents in conflict rather than one.
 *
 * Needed because "take one side, whole" is per PATH: with a single file, taking mine and taking
 * "everything from my side" are the same call and a pipeline that quietly did the latter would
 * pass. Kept apart from {@link twoSided} so the specs above keep the smallest fixture that proves
 * what they are about.
 */
async function twoSidedPair(prefix: string): Promise<Fixture> {
  const root = tmp(prefix);
  const globals = offline(root);
  const created = await createRepository(globals, {
    repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
    description: "merge spec"
  });
  write(root, DOCUMENT, BASE_TEXT);
  write(root, OTHER, BASE_TEXT);
  await commitAll(globals, root, "base");

  await createBranch(globals, "feature");
  await switchBranch(globals, { branch: "feature" });
  write(root, DOCUMENT, THEIRS_TEXT);
  write(root, OTHER, OTHER_THEIRS_TEXT);
  const theirs = await commitAll(globals, root, "theirs");

  await switchBranch(globals, { branch: "main" });
  write(root, DOCUMENT, MINE_TEXT);
  write(root, OTHER, OTHER_MINE_TEXT);
  const mine = await commitAll(globals, root, "mine");
  return { root, globals, repositoryId: created.repository, mine, theirs };
}

/**
 * Enough of a `BaseApp` for {@link VcsManager}: a logger and an empty settings store.
 *
 * The manager is exercised directly rather than through the IPC handler because the properties
 * under test are its own - which globals the commit runs on, and that settling and recording are
 * one queued act.
 */
function fakeApp(): BaseApp {
  const noop = () => undefined;
  return {
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    getGlobalState: () => ({ get: () => undefined })
  } as unknown as BaseApp;
}

afterAll(async () => {
  for (const globals of held) await releaseRepository(globals).catch(() => undefined);
  for (const root of roots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // A held repository can outlive the test; a leftover temp directory is not a failure.
    }
  }
}, 180_000);

describe.skipIf(!supported)("merge state", () => {
  /**
   * The headline of the whole milestone: after a conflicted merge, Studio can say that
   * there is one and name the file - without having kept anything in memory.
   *
   * Everything else in this file depends on that being answerable from the repository
   * alone, because the author is allowed to close the window on an unfinished merge.
   */
  it("reports an open merge and names the conflicted path", async () => {
    const fixture = await twoSided("nl-merge-state-");
    expect((await readMergeState(fixture.globals, fixture.root)).inProgress).toBe(false);

    const started = await branchMergeStart(fixture.globals, { branch: "feature" });
    expect(started.conflicts).toEqual([DOCUMENT]);

    const state = await readMergeState(fixture.globals, fixture.root);
    expect(state.inProgress).toBe(true);
    expect(state.conflicts).toEqual([DOCUMENT]);
    // The incoming side, not this one - the merge is `feature` coming into `main`.
    expect(state.incoming).toBe(fixture.theirs);
  }, 120_000);

  /**
   * The state survives letting go of the repository and reading it again on fresh globals.
   *
   * As close to "the author restarted Studio" as one process can get, and it is the case
   * this whole design is for: a merge is repository state, and a Studio that could only
   * answer while it still held the operation's result would strand anyone who closed the
   * window on a conflicted sync.
   */
  it("still reports the merge after the repository has been released and reopened", async () => {
    const fixture = await twoSided("nl-merge-reopen-");
    await branchMergeStart(fixture.globals, { branch: "feature" });
    await flushRepository(fixture.globals);
    await releaseRepository(fixture.globals);

    const reopened = offline(fixture.root);
    const state = await readMergeState(reopened, fixture.root);
    expect(state.inProgress).toBe(true);
    expect(state.conflicts).toEqual([DOCUMENT]);
  }, 120_000);

  /**
   * Why the signal is a CONJUNCTION, and not the obvious single field.
   *
   * `revisionMerged` keeps its value after the merge is committed - so a check on it alone
   * would report every project that has ever merged as permanently mid-merge. Pairing it
   * with `revisionStaged`, which the commit clears, is what makes it mean something. This
   * pins both halves: the raw field is still set, and the answer built from it is not.
   */
  it("does not read a finished merge as an open one, though the backend still names the merged revision", async () => {
    const fixture = await twoSided("nl-merge-finished-");
    await branchMergeStart(fixture.globals, { branch: "feature" });
    await resolveConflicts(fixture.globals, fixture.root, [DOCUMENT], "mine");
    const merged = await commit(fixture.globals, "merged");
    await flushRepository(fixture.globals);

    // Two parents: a merge revision really is one, which is what a history rail draws.
    expect(merged.parents).toHaveLength(2);

    const header = await repositoryStatus(fixture.globals, { scan: false, revisionOnly: true });
    expect(header.revision?.revisionMerged).toBeTruthy();
    expect(header.revision?.revisionStaged).toBeUndefined();

    const state = await readMergeState(fixture.globals, fixture.root);
    expect(state.inProgress).toBe(false);
    expect(state.conflicts).toEqual([]);
    expect(state.incoming).toBeUndefined();
  }, 120_000);

  /**
   * The reason the conflicted paths are rebuilt from disk instead of read out of status.
   *
   * All four forms of the status call report an EMPTY file list during a conflicted merge:
   * the merge has already recorded its own result as the staged revision, so by the
   * backend's reckoning nothing is pending. Anything that looked for conflicts there -
   * including the three conflict flags on a file change - finds nothing, forever.
   */
  it("is invisible to every form of the status call", async () => {
    const fixture = await twoSided("nl-merge-status-");
    await branchMergeStart(fixture.globals, { branch: "feature" });

    const absolute = path.join(fixture.root, DOCUMENT);
    for (const options of [
      { scan: true },
      { scan: true, checkDirty: true },
      { scan: false },
      { scan: true, checkDirty: true, paths: [absolute] }
    ]) {
      expect((await repositoryStatus(fixture.globals, options)).files).toEqual([]);
    }

    // And the conflicted document itself is not parseable, which is why the sidecars
    // matter: the merge writes diff3 markers straight into the JSON (§4.23).
    expect(() => JSON.parse(read(fixture.root, DOCUMENT))).toThrow();
  }, 120_000);
});

describe.skipIf(!supported)("settling a merge", () => {
  /**
   * Taking one side wholesale: the working tree is overwritten, and the merge stays OPEN.
   *
   * The second half is the contract the UI is built on - settling is not committing, so an
   * author can decide one file, look at it, and decide the next. A resolve that committed
   * would make "decide one file" impossible.
   */
  it("takes theirs into the working tree without recording anything", async () => {
    const fixture = await twoSided("nl-merge-theirs-");
    await branchMergeStart(fixture.globals, { branch: "feature" });

    const result = await resolveConflicts(fixture.globals, fixture.root, [DOCUMENT], "theirs");
    expect(read(fixture.root, DOCUMENT)).toBe(THEIRS_TEXT);
    // Still open, and the path is STILL LISTED - settling leaves no readable mark, so
    // the list means "the merge left these to a human" and not "these are undecided".
    // The proof that it really was settled is the commit below, which is refused while
    // anything is not.
    expect(result.state.inProgress).toBe(true);
    expect(result.state.conflicts).toEqual([DOCUMENT]);

    await commit(fixture.globals, "took theirs");
    await flushRepository(fixture.globals);
    const closed = await readMergeState(fixture.globals, fixture.root);
    expect(closed.inProgress).toBe(false);
    expect(closed.conflicts).toEqual([]);
  }, 120_000);

  /**
   * The only observation that separates a settled path from an unsettled one - and the
   * reason `conflicts` cannot claim to be a to-do list.
   *
   * It is a WRITE, so nothing may run it to answer a question. What it buys is that the
   * commit cannot silently record a half-settled merge: the refusal names the path, so an
   * author who missed a file is told which one.
   */
  it("refuses to commit while a path is unsettled, and names it", async () => {
    const fixture = await twoSided("nl-merge-refuse-");
    await branchMergeStart(fixture.globals, { branch: "feature" });
    await expect(commit(fixture.globals, "unresolved")).rejects.toThrow(
      new RegExp(`${DOCUMENT}.*conflict`, "i")
    );
  }, 120_000);

  /**
   * `working-tree` settles an answer NEITHER side wrote, byte for byte.
   *
   * This is the mechanism the whole per-change resolve rests on: the backend has no
   * in-memory write API, so the only way to record a merged document is to write it into
   * the working tree and say it is settled. If the bytes that come out of the revision were
   * ever anything but the bytes written in, per-change merging would be impossible and the
   * feature would have to stop at "take one side".
   */
  it("commits exactly the bytes written into the working tree", async () => {
    const fixture = await twoSided("nl-merge-working-");
    await branchMergeStart(fixture.globals, { branch: "feature" });

    write(fixture.root, DOCUMENT, THIRD_TEXT);
    const result = await resolveConflicts(
      fixture.globals,
      fixture.root,
      [DOCUMENT],
      "working-tree"
    );
    // Unlike `mine`/`theirs`, this verb names what it settled (§4.25).
    expect(result.files).toEqual([DOCUMENT]);
    expect(read(fixture.root, DOCUMENT)).toBe(THIRD_TEXT);

    // No merge-staging step: a plain commit closes it (§4.25).
    const merged = await commit(fixture.globals, "agreed");
    await flushRepository(fixture.globals);

    const committed = await withStore(fixture.globals, fixture.root, (store) =>
      blobAt(fixture.globals, store, fixture.repositoryId, merged.revision, DOCUMENT)
    );
    expect(sha256(committed)).toBe(sha256(Buffer.from(THIRD_TEXT, "utf-8")));
  }, 120_000);

  /**
   * Undoing a choice really does undo it.
   *
   * Asserted through the commit refusal rather than through the state, because the state
   * cannot see it: `conflicts` lists the path both before and after. The commit is the
   * only thing that distinguishes them, and here it is used as an oracle - the merge is
   * abandoned rather than completed, so nothing is recorded either way.
   */
  it("unresolves a settled path", async () => {
    const fixture = await twoSided("nl-merge-unresolve-");
    await branchMergeStart(fixture.globals, { branch: "feature" });
    await resolveConflicts(fixture.globals, fixture.root, [DOCUMENT], "mine");

    const undone = await unresolveConflicts(fixture.globals, fixture.root, [DOCUMENT]);
    expect(undone.state.inProgress).toBe(true);
    expect(undone.state.conflicts).toEqual([DOCUMENT]);
    await expect(commit(fixture.globals, "should be refused")).rejects.toThrow(
      new RegExp(`${DOCUMENT}.*conflict`, "i")
    );
  }, 120_000);

  /**
   * Restarting throws the working-tree bytes away and merges the path again.
   *
   * The difference from unresolving, and the only way back from a merge result the author
   * edited into something they no longer want: the markers come back.
   */
  it("re-merges a path, discarding what was in the working tree", async () => {
    const fixture = await twoSided("nl-merge-restart-");
    await branchMergeStart(fixture.globals, { branch: "feature" });
    write(fixture.root, DOCUMENT, THIRD_TEXT);

    const state = await restartConflicts(fixture.globals, fixture.root, [DOCUMENT]);
    expect(state.inProgress).toBe(true);
    expect(read(fixture.root, DOCUMENT)).not.toBe(THIRD_TEXT);
    expect(read(fixture.root, DOCUMENT)).toContain("<<<<<<<");
  }, 120_000);

  /**
   * Abandoning is a COMPLETE rollback - the measurement that lets "cancel" exist at all.
   *
   * Not just the conflicted file: the whole working tree goes back to what it was, the
   * merge's own leftovers are removed, and the repository stops reporting a merge.
   */
  it("abandons a merge and leaves the working tree as it was", async () => {
    const fixture = await twoSided("nl-merge-abort-");
    const before = read(fixture.root, DOCUMENT);
    expect(before).toBe(MINE_TEXT);

    await branchMergeStart(fixture.globals, { branch: "feature" });
    expect((await readMergeState(fixture.globals, fixture.root)).inProgress).toBe(true);

    const state = await abortMerge(fixture.globals, fixture.root);
    expect(state.inProgress).toBe(false);
    expect(state.conflicts).toEqual([]);
    expect(read(fixture.root, DOCUMENT)).toBe(before);
    // The three sides the merge dropped next to the file are gone too.
    expect(fs.readdirSync(fixture.root).filter((name) => name.includes("~"))).toEqual([]);
  }, 120_000);
});

describe.skipIf(!supported)("closing a merge", () => {
  /**
   * Tier one, end to end: a side per PATH, then one revision that closes the merge.
   *
   * Two files taking OPPOSITE sides, because with one file "take mine" and "take my whole side"
   * are the same call - a pipeline that ignored the per-path choice would pass a one-file test.
   *
   * The three things asserted after the commit are each a rule from docs/version-control.md that
   * nothing else in the build would catch:
   *
   *  - **the bytes are readable back IN THIS PROCESS** (§4.29). The commit runs on the session's
   *    offline globals, and it has to: on a server-registered repository an online commit
   *    produces a revision whose new content the writing process cannot read. Locally this
   *    passes either way - the online guard is the remote spec below - and it is asserted here
   *    too because this is the path every merge takes;
   *  - **the revision is labelled `commit`** (§4.21). The metadata verb writes the STAGED
   *    revision, so a label set after the commit lands on the NEXT one; a merge that read back
   *    as a checkpoint would be collapsed out of the author's history;
   *  - **the merge's three sides are gone from disk**, so the commit carried none of them into
   *    the author's history (§4.23) and `readMergeState` no longer reports a merge.
   */
  it("takes a side per path, records one revision, and reads the result back", async () => {
    const fixture = await twoSidedPair("nl-merge-complete-");
    await branchMergeStart(fixture.globals, { branch: "feature" });
    await flushRepository(fixture.globals);
    // The repository lock blocks WITHIN one process (§4.28), so the fixture lets go before the
    // manager opens a store of its own.
    await releaseRepository(fixture.globals);

    const manager = new VcsManager(fakeApp());
    try {
      const done = await manager.completeMerge(
        fixture.root,
        [
          { path: DOCUMENT, choice: "mine" },
          { path: OTHER, choice: "theirs" }
        ],
        { message: "merged" }
      );

      expect(read(fixture.root, DOCUMENT)).toBe(MINE_TEXT);
      expect(read(fixture.root, OTHER)).toBe(OTHER_THEIRS_TEXT);
      expect(done.state.inProgress).toBe(false);
      expect(done.state.conflicts).toEqual([]);
      expect(fs.readdirSync(fixture.root).filter((name) => name.includes("~"))).toEqual([]);

      for (const [path, text] of [
        [DOCUMENT, MINE_TEXT],
        [OTHER, OTHER_THEIRS_TEXT]
      ] as const) {
        const bytes = await manager.readBlob({
          projectPath: fixture.root,
          revision: done.revision.revision,
          path
        });
        expect(sha256(bytes)).toBe(sha256(Buffer.from(text, "utf-8")));
      }
      expect(done.revision.kind).toBe("commit");

      await manager.closeProject(fixture.root);
      expect(await readRevisionKind(offline(fixture.root), done.revision.revision)).toBe("commit");
    } finally {
      await manager.closeProject(fixture.root);
    }
  }, 180_000);

  /**
   * A path nobody decided stops the whole thing, by name, with nothing recorded.
   *
   * This is the backstop the resolve surface leans on, and the reason it is allowed to keep its
   * own record of decisions without that record being load-bearing: if the panel's bookkeeping
   * were ever wrong, the merge is not silently half-committed - it is refused, the sentence names
   * the file, and the merge is still open for the author to finish.
   */
  it("refuses when a conflicted path was left undecided, and leaves the merge open", async () => {
    const fixture = await twoSidedPair("nl-merge-partial-");
    await branchMergeStart(fixture.globals, { branch: "feature" });
    await flushRepository(fixture.globals);
    await releaseRepository(fixture.globals);

    const manager = new VcsManager(fakeApp());
    try {
      await expect(
        manager.completeMerge(fixture.root, [{ path: DOCUMENT, choice: "mine" }])
      ).rejects.toThrow(new RegExp(`${OTHER}.*conflict`, "i"));

      const state = await manager.getMergeState(fixture.root);
      expect(state.inProgress).toBe(true);
      // **The decided path is settled and its bytes are on disk even though NOTHING was
      // recorded**, and this is the half a caller has to act on: the refusal is not a
      // rollback. Every editor holding the pre-merge bytes of a settled path now holds
      // something the disk does not, so the renderer re-reads on the failure path too.
      expect(read(fixture.root, DOCUMENT)).toBe(MINE_TEXT);
      // And it drops off the list, which is a change from what a plain resolve does: the
      // resolve verbs leave the three sides on disk (measured in D5, above), while the
      // refused commit's staging step removes them for the paths it managed to settle. So
      // the list the surface re-reads afterwards is what is genuinely LEFT - which is the
      // one shape of progress the repository can be honestly asked for.
      expect(state.conflicts).toEqual([OTHER]);
    } finally {
      await manager.closeProject(fixture.root);
    }
  }, 180_000);

  /**
   * **The measurement that decides how a side is taken, kept as a requirement.**
   *
   * Locally, `branch_merge_resolve_mine` and the `~mine` sidecar agree, which is what §4.25
   * records. After a SYNC they do not - the verbs follow the branch pointer, which the sync has
   * already moved to the server's tip, so `_mine` writes the SERVER's content while `~mine`
   * still holds the author's (measured, and asserted the other way round in the remote block
   * below). Studio therefore takes a side from the sidecar rather than from the verb.
   *
   * What this spec pins is the half that has to hold for BOTH origins: `~mine` is the side the
   * conflict markers call `ours`, `~theirs` is the incoming one, and the bytes settled are those
   * bytes exactly. If a Lore upgrade ever swaps that, taking a side silently starts discarding
   * the wrong person's work - and nothing else in this build would notice.
   */
  it("takes a side from the merge's own copy of it, not from the branch pointer", async () => {
    const fixture = await twoSidedPair("nl-merge-sides-");
    await branchMergeStart(fixture.globals, { branch: "feature" });

    const conflicted = read(fixture.root, DOCUMENT);
    expect(conflicted).toContain("<<<<<<< ours");
    // `ours` is what `~mine` holds - the side of the branch the merge was started FROM.
    expect(read(fixture.root, `${DOCUMENT}~mine`)).toBe(MINE_TEXT);
    expect(read(fixture.root, `${DOCUMENT}~theirs`)).toBe(THEIRS_TEXT);
    expect(read(fixture.root, `${DOCUMENT}~base`)).toBe(BASE_TEXT);

    await resolveConflicts(fixture.globals, fixture.root, [DOCUMENT], "mine");
    expect(read(fixture.root, DOCUMENT)).toBe(MINE_TEXT);
    await resolveConflicts(fixture.globals, fixture.root, [OTHER], "theirs");
    expect(read(fixture.root, OTHER)).toBe(OTHER_THEIRS_TEXT);
  }, 180_000);
});

describe.skipIf(!remoteEnabled)("a conflicted sync", () => {
  /** Unique per run: the server keeps repositories by name, so a fixed one collides. */
  function serverUrl(name: string): string {
    return `${SERVER}/${name}-${Date.now().toString(36)}`;
  }

  /**
   * Two machines that edited the same document, with the author's push already refused.
   *
   * Everything up to the sync, shared by the specs below because building it costs a
   * publish, a clone and three pushes against a real server. Each spec gets its own
   * repository: a divergence can only be synced once, and reusing one would make the
   * second spec depend on what the first did with it.
   *
   * The fixture commits through OFFLINE globals, exactly as `VcsManager` does. Committing
   * online here would be the §4.29 trap: the process that writes such a revision cannot
   * read its new content back, and the failure would look like a defect in this feature.
   */
  interface DivergedSides {
    /** Repository-relative, forward slashes. Created with its directories. */
    readonly file: string;
    readonly base: string;
    readonly mine: string;
    readonly theirs: string;
  }

  async function divergedProject(
    name: string,
    sides: DivergedSides = { file: DOCUMENT, base: BASE_TEXT, mine: MINE_TEXT, theirs: THEIRS_TEXT }
  ): Promise<{ root: string; globals: LoreGlobals }> {
    const authorRoot = tmp(`nl-merge-${name}-author-`);
    const authorGlobals = offline(authorRoot);
    const created = await createRepository(authorGlobals, {
      repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
      description: "merge spec"
    });
    writeDeep(authorRoot, sides.file, sides.base);
    await commitAll(authorGlobals, authorRoot, "base");

    const url = serverUrl(name);
    await writeRemote(authorRoot, url);
    await publishToRemote(online(authorRoot), { url, repositoryId: created.repository });
    await pushToRemote(online(authorRoot));
    await releaseRepository(online(authorRoot));

    // A second machine edits the same document and pushes.
    const cloneRoot = path.join(tmp(`nl-merge-${name}-clone-`), "project");
    await cloneInto(online(cloneRoot), { repositoryUrl: url });
    writeDeep(cloneRoot, sides.file, sides.theirs);
    await commitAll(offline(cloneRoot), cloneRoot, "theirs");
    await pushToRemote(online(cloneRoot));
    await releaseRepository(online(cloneRoot));

    // The author edits the SAME document without syncing first, so the two diverge on
    // the one file. Their push is refused with the sentence that names the remedy.
    writeDeep(authorRoot, sides.file, sides.mine);
    await commitAll(authorGlobals, authorRoot, "mine");
    await expect(pushToRemote(online(authorRoot))).rejects.toThrow(/diverged/i);
    return { root: authorRoot, globals: authorGlobals };
  }

  /**
   * The defect D5 was written to fix, stated as a requirement.
   *
   * A sync whose automerge could not settle a file must NAME that file. The old code
   * filtered the per-file sync events on conflict flags that the decoder writes as `false`
   * unconditionally - those events have no such fields - so the filter could never match
   * and every conflicted sync degraded to the `["*"]` placeholder. An author cannot resolve
   * `*`, and no UI can draw it.
   */
  it("names the conflicting paths instead of answering with a placeholder", async () => {
    const { root: authorRoot, globals: authorGlobals } = await divergedProject("conflict");

    const synced = await syncFromRemote(online(authorRoot));
    expect(synced.conflicts).toEqual([DOCUMENT]);
    expect(synced.conflicts).not.toContain("*");

    // And the sync leaves the same open merge a local one does - one mechanism, not two.
    const state = await readMergeState(authorGlobals, authorRoot);
    expect(state.inProgress).toBe(true);
    expect(state.conflicts).toEqual([DOCUMENT]);

    await releaseRepository(authorGlobals);
  }, 300_000);

  /**
   * **The inversion, stated as a fact about the backend rather than as a Studio rule.**
   *
   * After a sync the branch pointer has already been moved to the server's tip, and the two
   * verbs named after the sides follow the pointer while the merge's own copies follow the
   * merge. So `branch_merge_resolve_mine` writes the SERVER's content on a repository whose
   * `~mine` file holds the AUTHOR's, and whose conflict markers label the author's side `ours`.
   * Locally they agree, which is why this can only be caught with a server.
   *
   * The consequence if this is ever "fixed" upstream without anyone noticing: nothing breaks,
   * because Studio reads the sidecars and never calls those verbs. The consequence of NOT
   * pinning it is worse than it sounds - it is the measurement that justifies not calling them,
   * and without it someone simplifies `resolveConflicts` back to the obvious two verbs and every
   * "keep mine" starts throwing the author's own work away.
   */
  it("has resolve_mine and the ~mine sidecar disagree about which side is the author's", async () => {
    const fixture = await divergedProject("orientation");
    await syncFromRemote(online(fixture.root));

    // The merge's own copies, and the markers, are author-oriented.
    expect(read(fixture.root, `${DOCUMENT}~mine`)).toBe(MINE_TEXT);
    expect(read(fixture.root, `${DOCUMENT}~theirs`)).toBe(THEIRS_TEXT);
    expect(read(fixture.root, DOCUMENT)).toContain("<<<<<<< ours");

    // The verb is not. This is the assertion that looks wrong and is the point.
    await branchMergeResolveMine(fixture.globals, [path.join(fixture.root, DOCUMENT)]);
    expect(read(fixture.root, DOCUMENT)).toBe(THEIRS_TEXT);

    // While Studio's own path, on the same merge, takes what the author asked for.
    await resolveConflicts(fixture.globals, fixture.root, [DOCUMENT], "mine");
    expect(read(fixture.root, DOCUMENT)).toBe(MINE_TEXT);

    await releaseRepository(fixture.globals);
  }, 300_000);

  /**
   * **The §4.29 regression guard, and the whole reason the merge commit runs offline.**
   *
   * Measured, and the only measurement in this file that cannot be reproduced without a server:
   * on a repository REGISTERED with one, a revision committed under `offline: false` cannot have
   * its new content read back by the process that wrote it - `storageGet: 1/1 get items failed`,
   * for that revision's new fragments only, with the tree and the history perfectly readable
   * around it. Nothing recovers it: not a flush, not reopening the store, not waiting.
   *
   * What that would look like to an author is the failure worth naming: they resolve a conflict,
   * Studio reports the merge recorded, and every attempt to read the file they just settled fails
   * until they restart. So the whole thing runs through `VcsManager` here - the sync online, the
   * commit on the session's own offline globals - and the last line reads the resolved bytes back
   * through that same session. If someone ever spreads `offline: false` over the commit, this is
   * the test that fails.
   */
  it("reads the resolved bytes back in the same process that committed them", async () => {
    const fixture = await divergedProject("readback");
    // The manager opens a store of its own, and the lock blocks within one process (§4.28).
    await releaseRepository(fixture.globals);

    const manager = new VcsManager(fakeApp());
    try {
      const synced = await manager.sync(fixture.root);
      expect(synced.conflicts).toEqual([DOCUMENT]);

      const done = await manager.completeMerge(fixture.root, [{ path: DOCUMENT, choice: "mine" }], {
        message: "kept mine"
      });
      expect(done.state.inProgress).toBe(false);
      expect(read(fixture.root, DOCUMENT)).toBe(MINE_TEXT);

      const bytes = await manager.readBlob({
        projectPath: fixture.root,
        revision: done.revision.revision,
        path: DOCUMENT
      });
      expect(sha256(bytes)).toBe(sha256(Buffer.from(MINE_TEXT, "utf-8")));
    } finally {
      await manager.closeProject(fixture.root);
    }
  }, 300_000);

  /**
   * **Tier two end to end: a document neither side wrote, recorded and read back.**
   *
   * This is the whole of what per-change resolution has to prove, and it is only provable against
   * a real server: Studio's merges are all syncs, and a sync is the origin where the side-named
   * verbs are INVERTED (§4.31). The composed document keeps both people's new translations and
   * takes the incoming side for the one unit they both retranslated - an answer that is in neither
   * `~mine` nor `~theirs`, which is exactly what tier one cannot express.
   *
   * Four rules are asserted, and nothing else in the build would catch any of them:
   *
   *  - **the three copies drive the merge**, so the decision list is built without a revision
   *    graph and without `getMergeBase`'s single-branch blind spot (§4.30);
   *  - **the working tree holds the composed document**, settled with the PLAIN resolve verb,
   *    which commits the working tree byte for byte (§4.25);
   *  - **the bytes are readable back IN THIS PROCESS** - the §4.29 guard. The merge is an online
   *    act and the commit that closes it is not; if anyone ever spreads `offline: false` over that
   *    commit, the author's freshly composed file becomes unreadable in the very session that
   *    wrote it, and this is the line that fails;
   *  - **the merge is over**, with the three copies gone, so nothing reports one afterwards.
   */
  it("settles one document change by change and reads the result back", async () => {
    const fixture = await divergedProject("perchange", {
      file: LOCALE_DOCUMENT,
      base: LOCALE_BASE,
      mine: LOCALE_MINE,
      theirs: LOCALE_THEIRS
    });
    await releaseRepository(fixture.globals);

    const manager = new VcsManager(fakeApp());
    try {
      const synced = await manager.sync(fixture.root);
      expect(synced.conflicts).toEqual([LOCALE_DOCUMENT]);

      const document = await manager.getMergeDocument(fixture.root, LOCALE_DOCUMENT);
      expect(document.blocked).toBeUndefined();
      expect(document.documentKind).toBe("localization");
      // One real question, and two changes that had a right answer and got it. Taking the file
      // whole from either side would discard one of the two people's new translation.
      expect(document.conflicts).toBe(1);
      expect(document.decisions.map((entry) => [entry.path.join("/"), entry.outcome])).toEqual([
        ["units/greeting", "conflict"],
        ["units/fromMine", "auto-mine"],
        ["units/fromTheirs", "auto-theirs"]
      ]);

      const done = await manager.completeMerge(
        fixture.root,
        [
          {
            path: LOCALE_DOCUMENT,
            choice: "per-change",
            // Only the answered conflict travels. The two automatic rows are recomputed in the
            // main process from the same three files, which is what keeps a window from being
            // able to settle a path with a value the repository never held.
            changes: { [mergeDecisionKey(["units", "greeting"])]: "theirs" }
          }
        ],
        { message: "merged the translations" }
      );

      const written = JSON.parse(read(fixture.root, LOCALE_DOCUMENT));
      expect(written.units.greeting.target).toBe("theirs");
      expect(written.units.fromMine.target).toBe("only mine");
      expect(written.units.fromTheirs.target).toBe("only theirs");
      expect(done.state.inProgress).toBe(false);
      expect(done.state.conflicts).toEqual([]);
      expect(fs.readdirSync(path.join(fixture.root, "editor", "localization"))).toEqual([
        "ja.json"
      ]);

      const bytes = await manager.readBlob({
        projectPath: fixture.root,
        revision: done.revision.revision,
        path: LOCALE_DOCUMENT
      });
      expect(sha256(bytes)).toBe(sha256(Buffer.from(read(fixture.root, LOCALE_DOCUMENT), "utf-8")));
      expect(JSON.parse(bytes.toString("utf-8")).units.greeting.target).toBe("theirs");
    } finally {
      await manager.closeProject(fixture.root);
    }
  }, 300_000);
});
