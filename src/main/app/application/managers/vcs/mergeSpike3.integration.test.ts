import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported } from "@shared/types/vcs";
import {
  closeStore,
  commit,
  createRepository,
  flushRepository,
  invoke,
  LORE_REMOTE_URL_KEY,
  openStore,
  releaseRepository,
  repositoryConfig,
  stage,
  syncRevision,
  type LoreGlobals
} from "./lore";
import { loreString } from "./lore/values";
import { blobAt, listFilesAt } from "./revisionReader";
import { cloneInto, publishToRemote, pushToRemote, writeRemote } from "./remote";

/**
 * Measurement follow-up, in two processes.
 *
 * `mergeSpike2`'s R2 established that after ANY `revisionSync` - conflicted or not -
 * `storageGet` fails for every content address in that repository, including revisions
 * committed locally before the sync ever happened. The revision tree still reads: paths,
 * sizes and content addresses all come back, only the bytes do not. That breaks history
 * browsing, `readRevisionDocuments`, `getThreeWay`, V4 restore and every diff this work
 * is about, on exactly the projects that have collaborators.
 *
 * What R2 could not say is whether the damage is to the repository or only to the
 * process that synced, because a vitest file is one process. This runs in two:
 *
 * ```bash
 * # phase 1 - build a synced repository at a path that survives the run
 * NLS_SPIKE_PERSIST=D:/Temp/nls-spike-persist LORE_TEST_REMOTE="lore://127.0.0.1:41337" \
 *   npx vitest run src/main/app/application/managers/vcs/mergeSpike3.integration.test.ts
 * # phase 2 - a process that has never synced anything reads it
 * NLS_SPIKE_PERSIST=D:/Temp/nls-spike-persist \
 *   npx vitest run src/main/app/application/managers/vcs/mergeSpike3.integration.test.ts
 * ```
 *
 * Phase is decided by whether the directory already holds a repository, so the same
 * command twice is the whole protocol. Nothing here is deleted on the way out - the
 * point is that the bytes outlive the process.
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);
const PERSIST = (process.env.NLS_SPIKE_PERSIST ?? "").trim();
const SERVER = (process.env.LORE_TEST_REMOTE ?? "").trim();
const DOCUMENT = "doc.json";

const BASE_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue", version: 7 }, null, 2)}\n`;
const MINE_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue (main)", version: 7 }, null, 2)}\n`;
const THEIRS_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue (feature)", version: 7 }, null, 2)}\n`;

function offline(root: string): LoreGlobals {
  return { repositoryPath: root, offline: true, identity: "spike@narraleaf", cache: true };
}

function online(root: string): LoreGlobals {
  return { ...offline(root), offline: false };
}

function report(name: string, observations: unknown): void {
  console.log(`\n### ${name}\n${JSON.stringify(observations, null, 2)}`);
}

async function observe<T>(run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

async function commitAll(globals: LoreGlobals, root: string, message: string): Promise<string> {
  await stage(globals, [root]);
  const revision = await commit(globals, message);
  await flushRepository(globals);
  return revision.revision;
}

describe.skipIf(!supported || PERSIST === "")(
  "R3 - does a fresh process recover after a sync",
  () => {
    it("builds a synced repository, or reads one a previous process left behind", async () => {
      const observations: Record<string, unknown> = { persistRoot: PERSIST };
      const root = path.join(PERSIST, "project");
      const marker = path.join(PERSIST, "revision.txt");
      const built = fs.existsSync(marker);
      observations.phase = built ? "read" : "build";

      try {
        if (!built) {
          if (SERVER === "") {
            observations.skipped = "phase 1 needs LORE_TEST_REMOTE";
            return;
          }
          fs.mkdirSync(root, { recursive: true });
          const globals = offline(root);
          const onlineGlobals = online(root);
          const url = `${SERVER}/m3-${Date.now().toString(36)}`;
          observations.build = await observe(async () => {
            const created = await createRepository(globals, {
              repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
              description: "merge spike 3"
            });
            fs.writeFileSync(path.join(root, DOCUMENT), BASE_TEXT);
            await commitAll(globals, root, "base");
            await writeRemote(root, url);
            await publishToRemote(onlineGlobals, { url, repositoryId: created.repository });
            await pushToRemote(onlineGlobals);
            await releaseRepository(onlineGlobals);

            const cloneRoot = path.join(PERSIST, "clone");
            fs.mkdirSync(cloneRoot, { recursive: true });
            const cloneGlobals = online(cloneRoot);
            await cloneInto(cloneGlobals, { repositoryUrl: url });
            fs.writeFileSync(path.join(cloneRoot, "other.json"), THEIRS_TEXT);
            await commitAll(cloneGlobals, cloneRoot, "theirs");
            await pushToRemote(cloneGlobals);
            await releaseRepository(cloneGlobals);

            fs.writeFileSync(path.join(root, DOCUMENT), MINE_TEXT);
            const mine = await commitAll(onlineGlobals, root, "mine");
            const synced = await syncRevision(onlineGlobals);
            await flushRepository(onlineGlobals);
            await releaseRepository(onlineGlobals);

            // The same read, four times, separated by the two things that could be
            // making it work later when it failed at first: elapsed time and another
            // open/flush/release cycle. A repository that reads fine minutes later is
            // not corrupt, it is not yet durable - and which of the two fixes it
            // decides whether the reader has to wait, flush harder, or retry.
            const readOnce = async () => {
              const store = await openStore(globals, root);
              try {
                return await observe(async () => ({
                  byteLength: (await blobAt(globals, store, created.repository, mine, DOCUMENT))
                    .byteLength
                }));
              } finally {
                await flushRepository(globals).catch(() => undefined);
                await closeStore(globals, store).catch(() => undefined);
                await releaseRepository(globals).catch(() => undefined);
              }
            };
            const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

            const immediately = await readOnce();
            // A second cycle with no delay: if THIS one works, the extra open/flush
            // is what lands the fragments and no amount of waiting would have.
            const secondCycleNoDelay = await readOnce();
            await wait(15_000);
            const afterFifteenSeconds = await readOnce();
            await wait(30_000);
            const afterFortyFiveSeconds = await readOnce();
            const sameProcess = {
              immediately,
              secondCycleNoDelay,
              afterFifteenSeconds,
              afterFortyFiveSeconds
            };

            fs.writeFileSync(marker, `${created.repository}\n${mine}\n`, "utf-8");
            return {
              repositoryId: created.repository,
              revision: mine,
              conflicts: synced.progress?.fileConflict ?? 0,
              readInTheProcessThatSynced: sameProcess
            };
          });
          return;
        }

        const [repositoryId, revision] = fs.readFileSync(marker, "utf-8").trim().split("\n");
        // Offline and online, in that order. If only the online read works, the sync has
        // made locally-committed content remote-only - recoverable, but it means every
        // read path Studio has needs a network and docs §6's "first diff may go online"
        // becomes "every diff after a sync goes online". If neither works, the local
        // content addressing is broken and no read path can recover it.
        const readWith = async (globals: LoreGlobals) =>
          observe(async () => {
            const store = await openStore(globals, root);
            try {
              const entries = await listFilesAt(globals, store, repositoryId, revision);
              return {
                treeStillReads: entries.map((entry) => entry.path),
                bytes: await observe(async () => ({
                  byteLength: (await blobAt(globals, store, repositoryId, revision, DOCUMENT))
                    .byteLength
                }))
              };
            } finally {
              await flushRepository(globals).catch(() => undefined);
              await closeStore(globals, store).catch(() => undefined);
              await releaseRepository(globals).catch(() => undefined);
            }
          });
        // The last untested cell: a store that knows the remote, driven by globals that
        // are allowed to use it. `openStore` hard-codes `hasRemoteConfig: 0`, so if this
        // is the combination that works the fix is a change to that one call rather than
        // a hole in the feature.
        const remoteUrl = await observe(() => repositoryConfig(offline(root), LORE_REMOTE_URL_KEY));
        const readWithRemoteStore = await observe(async () => {
          const globals = online(root);
          const opened = await invoke("storageOpen", globals, {
            repositoryPath: loreString(root),
            inMemory: 0,
            remoteConfig: {
              remoteUrl: loreString(typeof remoteUrl === "string" ? remoteUrl : undefined)
            },
            hasRemoteConfig: 1,
            cacheTargetBytes: 0,
            cacheTargetFragments: 0
          });
          const store = { handleId: opened.one<{ handleId: number }>(191).handleId };
          try {
            return {
              byteLength: (await blobAt(globals, store, repositoryId, revision, DOCUMENT))
                .byteLength
            };
          } finally {
            await flushRepository(globals).catch(() => undefined);
            await closeStore(globals, store).catch(() => undefined);
            await releaseRepository(globals).catch(() => undefined);
          }
        });

        observations.read = {
          repositoryId,
          revision,
          remoteUrl,
          offline: await readWith(offline(root)),
          online: await readWith(online(root)),
          onlineWithRemoteStore: readWithRemoteStore
        };
      } finally {
        report("R3 FRESH PROCESS AFTER SYNC", observations);
      }
      expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 300_000);
  }
);
