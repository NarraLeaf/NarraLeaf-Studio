import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported } from "@shared/types/vcs";
import {
  closeStore,
  commit,
  createRepository,
  flushRepository,
  history,
  openStore,
  releaseRepository,
  repositoryStatus,
  resetLoreLibraryForRetry,
  stage,
  syncRevision,
  type LoreGlobals,
  type StoreHandle
} from "./lore";
import { blobAt, listFilesAt } from "./revisionReader";
import { cloneInto, publishToRemote, pushToRemote, writeRemote } from "./remote";

/**
 * Measurement follow-up, round three: is the sync poisoning (§4.29) curable inside one process?
 *
 * `mergeSpike2`'s R2 established the defect and `mergeSpike3`'s R3 established that it is
 * the PROCESS that is poisoned, not the repository - a second process reads the same
 * bytes fine. What neither could answer is the question Studio actually needs answered,
 * because `VcsManager`'s session lives in the main process for as long as the project is
 * open: after a sync, can that process heal itself, or does the author have to restart
 * Studio before history, diffs and V4 restore work again?
 *
 * Everything cheap has been tried and recorded as useless in §4.29 (`repositoryFlush`,
 * `closeStore`+`openStore`, waiting 45 s, `offline` both ways, a store opened with the
 * real remote, both read routes). The one lever left is
 * {@link resetLoreLibraryForRetry} - dropping the loaded {@link LoreLibrary} so the next
 * call re-runs `koffi.load`. Note what that does NOT reset, because it bounds what a
 * positive result would mean: koffi's process-global type registry is deliberately kept
 * (re-registering throws), the DLL is never `unload`ed, and Lore's own process-global
 * state lives inside that DLL. On Windows a second `LoadLibraryW` of an already-loaded
 * module returns the same HMODULE, so "reload" here means new JS function bindings over
 * the same native image, not a fresh Lore.
 *
 * Order is the experiment, not a detail: variant 1 resets AFTER the repository is
 * released, variant 2 resets while it is still held, and both are measured rather than
 * one being assumed to subsume the other.
 *
 * This is a probe. Nothing about Lore's behaviour is asserted; observations are printed.
 *
 * **Read R6 before believing any framing above.** R5 tried to answer "does one project's
 * sync blind another" and its control failed twice: repositories that had never synced
 * were unreadable too. R6 attributes that, and the answer moves the whole defect: a
 * revision committed through globals with `offline: false` cannot be read back by the
 * process that wrote it, and nothing else is affected. Every earlier fixture - R2's,
 * R4's, R5's first two runs - committed `mine` online, so what §4.29 recorded as "the
 * sync poisons the process" was largely that. The fixtures here now commit the way
 * `VcsManager` does (offline globals), and R4 reads the author's own commit and the
 * revision the sync received separately, because only the second one is written online.
 *
 * ```bash
 * LORE_TEST_REMOTE="lore://127.0.0.1:41337" npx vitest run \
 *   src/main/app/application/managers/vcs/mergeSpike4.integration.test.ts
 * ```
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);
const SERVER = (process.env.LORE_TEST_REMOTE ?? "").trim();
const remoteEnabled = supported && SERVER !== "";

const DOCUMENT = "doc.json";
const RUN = Date.now().toString(36);

const BASE_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue", version: 7 }, null, 2)}\n`;
const MINE_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue (main)", version: 7 }, null, 2)}\n`;
const THEIRS_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue (feature)", version: 7 }, null, 2)}\n`;
const HAND_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue (third)", version: 7 }, null, 2)}\n`;

// -- plumbing ---------------------------------------------------------------

function report(name: string, observations: unknown): void {
  console.log(`\n### ${name}\n${JSON.stringify(observations, null, 2)}`);
}

interface Failure {
  error: string;
}

async function observe<T>(run: () => Promise<T>): Promise<T | Failure> {
  try {
    return await run();
  } catch (error) {
    const call = error as Error & { errorCode?: number };
    return {
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}${call.errorCode === undefined ? "" : ` code=${call.errorCode}`}`
          : String(error)
    };
  }
}

function failed<T>(result: T | Failure): result is Failure {
  return Boolean(result) && typeof result === "object" && "error" in (result as object);
}

/**
 * Same as {@link observe}, but a call that never settles becomes an observation instead
 * of a hung run.
 *
 * Needed here specifically: §4.28 says a second `openStore` on a repository whose lock is
 * still held blocks FOREVER, and variant 2 deliberately resets the library binding before
 * the release, which is exactly the shape that could leave the lock held. The native
 * thread stays stuck either way - this only keeps the remaining experiments reachable.
 */
async function guarded<T>(label: string, ms: number, run: () => Promise<T>): Promise<T | Failure> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms} ms`)), ms);
      })
    ]);
  } catch (error) {
    const call = error as Error & { errorCode?: number };
    return {
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}${call.errorCode === undefined ? "" : ` code=${call.errorCode}`}`
          : String(error)
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface Session {
  root: string;
  globals: LoreGlobals;
  store?: StoreHandle;
}

const roots: string[] = [];
const sessions: Session[] = [];

function tmp(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}

/** `storeKeepAlive` left unset: with it on every flush waits out the window (§4.22). */
function offline(root: string): LoreGlobals {
  return { repositoryPath: root, offline: true, identity: "spike@narraleaf", cache: true };
}

function online(root: string): LoreGlobals {
  return { ...offline(root), offline: false };
}

function track(session: Session): Session {
  sessions.push(session);
  return session;
}

afterAll(async () => {
  for (const session of sessions) {
    await flushRepository(session.globals).catch(() => undefined);
    if (session.store) await closeStore(session.globals, session.store).catch(() => undefined);
    await releaseRepository(session.globals).catch(() => undefined);
  }
  for (const root of roots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // A leftover temp directory is not an experimental result.
    }
  }
}, 240_000);

function write(root: string, relative: string, contents: string): string {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents, "utf-8");
  return absolute;
}

async function commitAll(globals: LoreGlobals, root: string, message: string): Promise<string> {
  await stage(globals, [root]);
  const revision = await commit(globals, message);
  await flushRepository(globals);
  return revision.revision;
}

/** Open, use, release - never two stores on one repository at once (§4.28). */
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

// -- the fixture ------------------------------------------------------------

interface Poisoned {
  name: string;
  root: string;
  offlineGlobals: LoreGlobals;
  onlineGlobals: LoreGlobals;
  repositoryId: string;
  /**
   * The author's own commit, made BEFORE the sync - and made through OFFLINE globals,
   * which is what `VcsManager` does (`globalsFor` sets `offline: !options.online`, and
   * only the network verbs get `offline: false` spread in). R6 is why that detail is
   * spelled out here: a revision committed through online globals cannot be read back by
   * the process that wrote it, so a fixture that commits online measures that instead of
   * whatever it meant to measure.
   */
  revision: string;
  /** What the sync pulled from the server: written by an online call, by construction. */
  receivedRevision?: string;
  url: string;
  cloneRoot: string;
  cloneGlobals: LoreGlobals;
  conflicts?: number;
  automerges?: number;
  setupError?: string;
}

/**
 * A repository on the server with one local commit on top, and NOTHING fetched.
 *
 * Split out of {@link preparedFixture} after R5's first run: with the clone included,
 * both repositories were already unreadable BEFORE either of them synced, so the
 * experiment proved nothing. This is the shape R2 measured as reading fine (its step c),
 * and it is the only shape that can serve as a control.
 */
async function publishedFixture(name: string): Promise<Poisoned> {
  const root = tmp(`nl-m4-${name}-`);
  const offlineGlobals = offline(root);
  const onlineGlobals = online(root);
  track({ root, globals: onlineGlobals });
  const cloneRoot = path.join(tmp(`nl-m4-${name}-clone-`), "project");
  const cloneGlobals = online(cloneRoot);
  track({ root: cloneRoot, globals: cloneGlobals });

  const fixture: Poisoned = {
    name,
    root,
    offlineGlobals,
    onlineGlobals,
    repositoryId: "",
    revision: "",
    url: `${SERVER}/m4-${name}-${RUN}`,
    cloneRoot,
    cloneGlobals
  };

  try {
    const created = await createRepository(offlineGlobals, {
      repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
      description: "merge spike 4"
    });
    fixture.repositoryId = created.repository;
    write(root, DOCUMENT, BASE_TEXT);
    await commitAll(offlineGlobals, root, "base");
    await writeRemote(root, fixture.url);
    await publishToRemote(onlineGlobals, { url: fixture.url, repositoryId: created.repository });
    await pushToRemote(onlineGlobals);
    await releaseRepository(onlineGlobals);

    write(root, DOCUMENT, MINE_TEXT);
    fixture.revision = await commitAll(offlineGlobals, root, "mine");
    await releaseRepository(offlineGlobals);
  } catch (error) {
    fixture.setupError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  return fixture;
}

/**
 * Give the fixture something to sync: clone it in THIS process and push a change.
 *
 * The clone writes a DIFFERENT file so the sync is clean - §4.29 measured conflicted and
 * clean syncs failing identically, and a clean one has fewer moving parts. `mine` is
 * never pushed, so the clone only ever sees `base` and the two lines diverge.
 */
async function divergeViaClone(fixture: Poisoned) {
  return observe(async () => {
    await cloneInto(fixture.cloneGlobals, { repositoryUrl: fixture.url });
    write(fixture.cloneRoot, "other.json", THEIRS_TEXT);
    const revision = await commitAll(fixture.cloneGlobals, fixture.cloneRoot, "theirs");
    await pushToRemote(fixture.cloneGlobals);
    await releaseRepository(fixture.cloneGlobals);
    return { theirs: revision };
  });
}

/** Everything a sync needs, stopping one call short of it. */
async function preparedFixture(name: string): Promise<Poisoned> {
  const fixture = await publishedFixture(name);
  if (fixture.setupError) return fixture;
  const diverged = await divergeViaClone(fixture);
  if (failed(diverged)) fixture.setupError = diverged.error;
  return fixture;
}

/**
 * The one call under study, with the tail §4.29 already proved insufficient on its own.
 * Every recovery variant below therefore differs from this state by exactly one call.
 */
async function syncFixture(fixture: Poisoned) {
  return observe(async () => {
    const synced = await syncRevision(fixture.onlineGlobals);
    fixture.conflicts = synced.progress?.fileConflict ?? 0;
    fixture.automerges = synced.progress?.fileAutomerge ?? 0;
    fixture.receivedRevision = synced.target?.targetRevision;
    await flushRepository(fixture.onlineGlobals);
    await releaseRepository(fixture.onlineGlobals);
    return {
      conflicts: fixture.conflicts,
      automerges: fixture.automerges,
      target: synced.target?.targetRevision,
      targetIsLocal: synced.target?.local
    };
  });
}

async function poisonedFixture(name: string): Promise<Poisoned> {
  const fixture = await preparedFixture(name);
  if (fixture.setupError) return fixture;
  const synced = await syncFixture(fixture);
  if (failed(synced)) fixture.setupError = synced.error;
  return fixture;
}

/** Tree and bytes, side by side: §4.29's signature is the tree reading while bytes do not. */
async function readRevision(
  fixture: Poisoned,
  revision: string,
  label: string,
  document = DOCUMENT
) {
  return guarded(label, 120_000, () =>
    withStore(fixture.offlineGlobals, fixture.root, async (store) => ({
      tree: await observe(async () =>
        (await listFilesAt(fixture.offlineGlobals, store, fixture.repositoryId, revision))
          .map((entry) => entry.path)
          .sort()
      ),
      bytes: await observe(async () => ({
        byteLength: (
          await blobAt(fixture.offlineGlobals, store, fixture.repositoryId, revision, document)
        ).byteLength
      }))
    }))
  );
}

async function readBack(fixture: Poisoned, label: string) {
  return readRevision(fixture, fixture.revision, label);
}

/**
 * The two reads that mean different things after a sync.
 *
 * `ownOfflineCommit` is content this process wrote locally; `received` is content that
 * only ever existed on the server. The path matters: the clone changes `other.json` and
 * leaves `doc.json` alone, so reading `doc.json` at the received revision would succeed
 * off a fragment that was already local from the base commit and prove nothing.
 */
async function readPair(fixture: Poisoned, label: string) {
  return {
    ownOfflineCommit: await readBack(fixture, `${label}:own`),
    received: fixture.receivedRevision
      ? await readRevision(fixture, fixture.receivedRevision, `${label}:received`, "other.json")
      : { error: "the sync reported no target revision" }
  };
}

function pairReads(pair: unknown) {
  const both = pair as { ownOfflineCommit?: unknown; received?: unknown };
  return { own: bytesRead(both?.ownOfflineCommit), received: bytesRead(both?.received) };
}

function bytesRead(result: unknown): boolean {
  const bytes = (result as { bytes?: unknown } | undefined)?.bytes as
    | { byteLength?: number }
    | undefined;
  return typeof bytes?.byteLength === "number";
}

type Variant = "resetAfterRelease" | "resetBeforeRelease";

/**
 * One recovery attempt, differing from the known-failing tail by where the reset lands.
 *
 * `resetAfterRelease` is the safe reading of §4.29's open question: give every handle
 * back first, then drop the binding. `resetBeforeRelease` drops it while Lore still holds
 * the repository, which is the ordering that could strand the lock - measured rather than
 * reasoned about, since a positive result for only one of them changes what Studio has to
 * do at the call site.
 */
async function recover(fixture: Poisoned, variant: Variant) {
  const steps: Record<string, unknown> = { variant };
  if (variant === "resetBeforeRelease") {
    steps.reset = await observe(async () => {
      resetLoreLibraryForRetry();
      return "called";
    });
    steps.flush = await guarded("flush", 60_000, () =>
      flushRepository(fixture.onlineGlobals).then(() => "ok")
    );
    steps.release = await guarded("release", 60_000, () =>
      releaseRepository(fixture.onlineGlobals).then(() => "ok")
    );
  } else {
    steps.flush = await guarded("flush", 60_000, () =>
      flushRepository(fixture.onlineGlobals).then(() => "ok")
    );
    steps.release = await guarded("release", 60_000, () =>
      releaseRepository(fixture.onlineGlobals).then(() => "ok")
    );
    steps.reset = await observe(async () => {
      resetLoreLibraryForRetry();
      return "called";
    });
  }
  steps.readAfterRecovery = await readPair(fixture, `${fixture.name}:${variant}`);
  steps.reads = pairReads(steps.readAfterRecovery);
  return steps;
}

// ===========================================================================
// R4 - can the process that synced heal itself?
// ===========================================================================

describe.skipIf(!remoteEnabled)("R4 - recovering from the sync poisoning in one process", () => {
  it("measures resetLoreLibraryForRetry, both orderings, and what else the poison touches", async () => {
    const observations: Record<string, unknown> = { run: RUN, server: SERVER };
    try {
      // -- 1. baseline: does the defect still reproduce at all? ---------------
      const a = await poisonedFixture("a");
      observations.fixtureA = {
        setupError: a.setupError,
        revision: a.revision,
        conflicts: a.conflicts,
        automerges: a.automerges
      };
      if (a.setupError) return;

      // Two reads, not one, and the difference is the whole point after R6: the
      // author's own commit went in through OFFLINE globals the way Studio does it,
      // while the revision the sync brought in was written by an online call. If
      // only the second is dark then nothing is "poisoned" - the process simply
      // cannot read what it just received, and Studio's own history is intact.
      const baseline = await readPair(a, "a:baseline");
      observations.step1_baselineAfterSync = baseline;
      observations.step1_reads = pairReads(baseline);

      // Only `storageGet` is supposed to be affected. If the verbs that never touch
      // content still answer, the poison is narrow and Studio could at least keep
      // showing the history LIST after a sync while every document read is dead -
      // which is a different (and worse-looking) product decision than "all dark".
      observations.step1b_nonContentVerbs = {
        status: await guarded("status", 60_000, () =>
          observe(async () => {
            const status = await repositoryStatus(a.offlineGlobals, {
              scan: false,
              revisionOnly: true
            });
            return {
              revision: status.revision?.revision,
              branch: status.revision?.branch,
              revisionMerged: status.revision?.revisionMerged
            };
          })
        ),
        history: await guarded("history", 60_000, () =>
          observe(async () => {
            const graph = await history(a.offlineGlobals, { limit: 20 });
            return {
              repository: graph.header?.repository,
              nodes: [...graph.nodes.values()].map((node) => node.number).sort((x, y) => x - y)
            };
          })
        )
      };
      await observe(() => releaseRepository(a.offlineGlobals));

      if (pairReads(baseline).received) {
        observations.stopped = "the received revision READ - the defect did not reproduce here";
        return;
      }

      // -- 2. reset after everything is given back ---------------------------
      observations.step2_resetAfterRelease = await recover(a, "resetAfterRelease");
      const afterVariant1 = (
        observations.step2_resetAfterRelease as { reads: { received: boolean } }
      ).reads.received;

      // -- 3. the other ordering, on its own repository ----------------------
      const b = await poisonedFixture("b");
      observations.fixtureB = { setupError: b.setupError, revision: b.revision };
      let afterVariant2 = false;
      if (!b.setupError) {
        observations.step3_baselineB = pairReads(await readPair(b, "b:baseline"));
        observations.step3_resetBeforeRelease = await recover(b, "resetBeforeRelease");
        afterVariant2 = (observations.step3_resetBeforeRelease as { reads: { received: boolean } })
          .reads.received;

        // Does B's sync reach into A? R5 asks this properly; here it is nearly
        // free, and it is the same question: A's own commit and A's received
        // revision, read after a DIFFERENT repository synced.
        observations.step3b_readAAfterBSync = pairReads(await readPair(a, "a:afterBSync"));
      }

      // -- 4. stability: two more poison/recover cycles with the winner -------
      const winner: Variant | null = afterVariant1
        ? "resetAfterRelease"
        : afterVariant2
          ? "resetBeforeRelease"
          : null;
      observations.step4_winner = winner;
      if (winner) {
        const repeats: unknown[] = [];
        for (const name of ["c", "d"]) {
          const fixture = await poisonedFixture(name);
          if (fixture.setupError) {
            repeats.push({ name, setupError: fixture.setupError });
            continue;
          }
          const before = pairReads(await readPair(fixture, `${name}:baseline`));
          const recovered = await recover(fixture, winner);
          repeats.push({
            name,
            beforeRecovery: before,
            afterRecovery: (recovered as { reads?: unknown }).reads
          });
        }
        observations.step4_repeats = repeats;
      }

      // -- 5. does a SECOND sync in a poisoned process fail differently? ------
      const e = await poisonedFixture("e");
      observations.step5_secondSync = e.setupError
        ? { setupError: e.setupError }
        : await observe(async () => {
            const firstRead = pairReads(await readPair(e, "e:baseline"));
            write(e.cloneRoot, "third.json", THEIRS_TEXT);
            await commitAll(e.cloneGlobals, e.cloneRoot, "theirs again");
            await pushToRemote(e.cloneGlobals);
            await releaseRepository(e.cloneGlobals);
            const second = await guarded("secondSync", 120_000, async () => {
              const synced = await syncRevision(e.onlineGlobals);
              return {
                conflicts: synced.progress?.fileConflict ?? 0,
                automerges: synced.progress?.fileAutomerge ?? 0,
                target: synced.target?.targetRevision,
                targetIsLocal: synced.target?.local
              };
            });
            await observe(() => flushRepository(e.onlineGlobals));
            await observe(() => releaseRepository(e.onlineGlobals));
            return {
              afterFirstSync: firstRead,
              secondSyncResult: second,
              afterSecondSync: pairReads(await readPair(e, "e:afterSecondSync"))
            };
          });

      // -- 6. is a reset safe while a store handle is open? -------------------
      // Asked on a throwaway local repository and asked LAST, because the honest
      // answer might be "the handle is stranded and the lock is never given back",
      // and that outcome must not be able to take the measurements above with it.
      observations.step6_resetWithStoreHandleOpen = await observe(async () => {
        const root = tmp("nl-m4-f-");
        const globals = offline(root);
        track({ root, globals });
        const created = await createRepository(globals, {
          repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
          description: "merge spike 4 (handle safety)"
        });
        write(root, DOCUMENT, BASE_TEXT);
        const revision = await commitAll(globals, root, "only commit");
        const store = await openStore(globals, root);
        const readBeforeReset = await observe(async () => ({
          byteLength: (await blobAt(globals, store, created.repository, revision, DOCUMENT))
            .byteLength
        }));
        resetLoreLibraryForRetry();
        // The same handle id, through freshly bound function pointers.
        const readAfterResetOnSameHandle = await guarded("sameHandleRead", 60_000, () =>
          observe(async () => ({
            byteLength: (await blobAt(globals, store, created.repository, revision, DOCUMENT))
              .byteLength
          }))
        );
        const closed = await guarded("closeAfterReset", 60_000, () =>
          closeStore(globals, store).then(() => "ok")
        );
        const released = await guarded("releaseAfterReset", 60_000, () =>
          releaseRepository(globals).then(() => "ok")
        );
        const reopened = await guarded("reopenAfterReset", 60_000, () =>
          withStore(globals, root, async (handle) => ({
            byteLength: (await blobAt(globals, handle, created.repository, revision, DOCUMENT))
              .byteLength
          }))
        );
        return { readBeforeReset, readAfterResetOnSameHandle, closed, released, reopened };
      });
    } finally {
      report("R4 RECOVERY AFTER SYNC", observations);
    }
    expect(Object.keys(observations).length).toBeGreaterThan(0);
  }, 1_200_000);
});

// ===========================================================================
// R5 - is the poison scoped to the repository that synced, or to the process?
// ===========================================================================

/**
 * The open item R4 left, and the only thing that decides what Studio can say to the
 * author. `VcsManager` keys its sessions per project and Studio runs several projects in
 * one main process, so if syncing project A also blinds project B then the honest prompt
 * is "restart Studio" and no per-project remedy can be correct.
 *
 * The first attempt at this asked the question directly - two fully prepared repositories,
 * sync one, read the other - and the control failed: BOTH were already unreadable before
 * either had synced. R6 explains why (they committed through online globals) and the
 * fixture now commits offline, so the control can hold. Every stage is still read back on
 * both repositories, because attributing the call is worth more than assuming it:
 *
 *   B published (no fetch)              -> read A, read B      the control
 *   A published (no fetch)              -> read A, read B
 *   A cloned in-process + clone pushes  -> read A, read B      does a CLONE poison?
 *   A syncs                             -> read A, read B      does a SYNC poison?
 *   B syncs (nothing to fetch)          -> read A, read B
 *
 * B never clones, so if B goes dark it is not because of anything B did.
 */
describe.skipIf(!remoteEnabled)("R5 - the blast radius of one project's remote traffic", () => {
  it("attributes the poison to a call, and to a repository or to the process", async () => {
    const observations: Record<string, unknown> = { run: RUN, server: SERVER };
    const stages: Record<string, unknown>[] = [];
    try {
      // B first and never cloned: the control has to exist before anything can
      // invalidate it, and B's readability is the whole question later on.
      const b = await publishedFixture("r5b");
      const a = await publishedFixture("r5a");
      observations.setup = {
        a: { setupError: a.setupError, revision: a.revision, repositoryId: a.repositoryId },
        b: { setupError: b.setupError, revision: b.revision, repositoryId: b.repositoryId }
      };
      if (a.setupError || b.setupError) return;

      const both = async (stage: string, detail?: unknown) => {
        const readA = await readBack(a, `r5a:${stage}`);
        const readB = await readBack(b, `r5b:${stage}`);
        stages.push({
          stage,
          detail,
          aReads: bytesRead(readA),
          bReads: bytesRead(readB),
          a: readA,
          b: readB
        });
      };

      await both("afterPublishOnly");
      await both("afterCloningA", await divergeViaClone(a));
      await both("afterSyncingA", await syncFixture(a));
      // B has nothing to fetch - it was never cloned - so this is the sync path
      // running with no incoming work, which is worth having on the record either way.
      await both("afterSyncingB", await syncFixture(b));
    } finally {
      observations.stages = stages;
      report("R5 POISON SCOPE", observations);
    }
    expect(Object.keys(observations).length).toBeGreaterThan(0);
  }, 900_000);
});

// ===========================================================================
// R6 - which call actually blinds the process?
// ===========================================================================

/**
 * R5's control failed twice: a repository that had only been published and pushed was
 * already unreadable, with no clone and no sync anywhere near it. So §4.29's attribution
 * to `revisionSync` cannot be right, and the scope question cannot be answered until the
 * real trigger is named.
 *
 * What no earlier experiment ever did: read a revision that was committed AFTER the
 * repository was pushed. R2's four reading steps all read a commit made before the push,
 * and they all worked; R4/R5 all read `mine`, committed afterwards, and none did.
 *
 * One repository, one process, and the SAME base revision read after every step - so a
 * previously readable revision going dark (a poisoning) is distinguishable from new
 * commits simply not being where the reader looks (a different defect entirely, and one
 * that would make "restart Studio" the wrong advice).
 *
 * The last two steps commit the same kind of change twice, once through offline globals
 * and once through online ones, because `offline` is the only difference between the
 * session that R2 read successfully and the sessions that cannot read anything.
 */
describe.skipIf(!remoteEnabled)("R6 - attributing the blindness to a call", () => {
  it("reads one base revision after every step of connecting and committing", async () => {
    const observations: Record<string, unknown> = { run: RUN, server: SERVER };
    const stages: Record<string, unknown>[] = [];
    try {
      const root = tmp("nl-m4-r6-");
      const offlineGlobals = offline(root);
      const onlineGlobals = online(root);
      track({ root, globals: onlineGlobals });
      const url = `${SERVER}/m4-r6-${RUN}`;

      const created = await createRepository(offlineGlobals, {
        repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
        description: "merge spike 4 (attribution)"
      });
      const fixture: Poisoned = {
        name: "r6",
        root,
        offlineGlobals,
        onlineGlobals,
        repositoryId: created.repository,
        revision: "",
        url,
        cloneRoot: "",
        cloneGlobals: offlineGlobals
      };

      write(root, DOCUMENT, BASE_TEXT);
      const base = await commitAll(offlineGlobals, root, "base");
      fixture.revision = base;
      await releaseRepository(offlineGlobals);

      const revisions: Record<string, string> = { base };
      const stage = async (name: string, act: () => Promise<unknown>) => {
        const detail = await observe(act);
        // Release before reading: `openStore` on a repository this process still
        // holds never returns (§4.28), and every step above acquires it.
        await observe(() => releaseRepository(onlineGlobals));
        const reads: Record<string, unknown> = {};
        const readable: string[] = [];
        for (const [label, revision] of Object.entries(revisions)) {
          const result = await readRevision(fixture, revision, `r6:${name}:${label}`);
          reads[label] = result;
          if (bytesRead(result)) readable.push(label);
        }
        stages.push({ stage: name, detail, readable, reads });
      };

      await stage("afterLocalCommit", async () => "nothing done");
      await stage("afterWriteRemote", () => writeRemote(root, url).then(() => "ok"));
      await stage("afterPublish", () =>
        publishToRemote(onlineGlobals, { url, repositoryId: created.repository }).then(() => "ok")
      );
      await stage("afterPush", () => pushToRemote(onlineGlobals));
      await stage("afterOfflineCommit", async () => {
        write(root, DOCUMENT, MINE_TEXT);
        revisions.committedOffline = await commitAll(offlineGlobals, root, "mine, offline session");
        return { revision: revisions.committedOffline };
      });
      await stage("afterOnlineCommit", async () => {
        write(root, DOCUMENT, THEIRS_TEXT);
        revisions.committedOnline = await commitAll(onlineGlobals, root, "mine, online session");
        return { revision: revisions.committedOnline };
      });
      // The control for the step above: the two commits differ in their `offline`
      // flag, but they are also first and second. A THIRD commit, offline again,
      // separates "the flag decides" from "everything after the first online commit
      // is lost" - and those two have completely different consequences for Studio.
      await stage("afterSecondOfflineCommit", async () => {
        write(root, DOCUMENT, HAND_TEXT);
        revisions.committedOfflineAgain = await commitAll(offlineGlobals, root, "offline again");
        return { revision: revisions.committedOfflineAgain };
      });
    } finally {
      observations.stages = stages;
      report("R6 ATTRIBUTION", observations);
    }
    expect(Object.keys(observations).length).toBeGreaterThan(0);
  }, 900_000);
});
