import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported } from "@shared/types/vcs";
import type { BaseApp } from "../../baseApp";
import type { LoreGlobals } from "./lore/call";
import { flushRepository, releaseRepository } from "./lore/verbs";
import { initRepository } from "./repository";
import { VcsManager } from "./VcsManager";

/**
 * One project, one store handle - and the project reopenable afterwards.
 *
 * The workspace asks about version control from three surfaces at once the moment it opens (the
 * rail, the switcher menu and the status-bar cell each read the head for themselves, by design).
 * `sessionFor` recorded its session only after two awaits, so those callers each opened a store of
 * their own; the map kept the last, and the rest were unreachable. `closeProject` then released one
 * and Lore held the repository - exclusively - for the rest of the process's life.
 *
 * The damage is not a leaked handle. Reopening the project blocks on the lock Lore never gave back,
 * and every Lore call is a koffi `async` call, so it blocks a **libuv thread pool** thread. The
 * default pool is four, `fs` uses that same pool, and four blocked opens is what the observed
 * failure looked like: a reopened project where nothing loaded - no assets, no stories, no
 * dashboard - and a window that could not be closed, because the close path waits for a checkpoint.
 *
 * So this test counts handles rather than asserting on behaviour that "looks right": the log line
 * `[Vcs] Opened session` is emitted once per store this manager opens, and `[Vcs] Closed session`
 * once per store it releases. They have to balance.
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);

/** A blocked open never returns, so a bare await would fail as a suite timeout with no message. */
const REOPEN_DEADLINE_MS = 30_000;

let root: string;
let globals: LoreGlobals;
let manager: VcsManager;
let logLines: string[] = [];

function countLines(marker: string): number {
  return logLines.filter((line) => line.includes(marker)).length;
}

function fakeApp(): BaseApp {
  const noop = () => undefined;
  const record = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  return {
    logger: { info: record, warn: record, error: noop, debug: noop },
    getGlobalState: () => ({ get: () => undefined })
  } as unknown as BaseApp;
}

async function withDeadline<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} did not answer within ${REOPEN_DEADLINE_MS}ms`)),
          REOPEN_DEADLINE_MS
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

beforeAll(async () => {
  if (!supported) return;
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-session-")));
  globals = { repositoryPath: root, offline: true, cache: true };
  fs.writeFileSync(path.join(root, "project.json"), JSON.stringify({ name: "session" }));
  await initRepository(globals, { identity: "author@narraleaf" });
  manager = new VcsManager(fakeApp());
}, 180_000);

afterAll(async () => {
  if (!supported) return;
  await manager?.dispose().catch(() => undefined);
  await flushRepository(globals).catch(() => undefined);
  await releaseRepository(globals).catch(() => undefined);
  for (let attempt = 0; attempt < 20 && root; attempt++) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}, 120_000);

describe.skipIf(!supported)("the store handle for one project", () => {
  it("is opened once however many callers arrive together, and released by closing the project", async () => {
    logLines = [];

    // What a workspace opening looks like: four questions, none of them waiting for the others.
    const [isRepository, info, history] = await Promise.all([
      manager.isRepository(root),
      manager.getInfo(root),
      manager.getHistory(root, 0),
      manager.isRepository(root)
    ]);
    expect(isRepository).toBe(true);
    expect(info.repositoryId).toBeTruthy();
    expect(history.length).toBeGreaterThan(0);

    expect(countLines("[Vcs] Opened session")).toBe(1);

    await manager.closeProject(root);
    expect(countLines("[Vcs] Closed session")).toBe(1);
  }, 180_000);

  it("can be opened again in the same process, because the previous one let the repository go", async () => {
    logLines = [];

    // The reopen. Before the fix this never returned: the handles the first open leaked still
    // held the lock, and Lore blocks on it rather than failing.
    const info = await withDeadline(manager.getInfo(root), "getInfo after a reopen");
    expect(info.repositoryId).toBeTruthy();
    expect(countLines("[Vcs] Opened session")).toBe(1);

    await manager.closeProject(root);
    expect(countLines("[Vcs] Closed session")).toBe(1);
  }, 180_000);

  it("releases a session that was still opening when the project closed", async () => {
    logLines = [];

    // No await between them: the close lands while the open is in flight, which is what a
    // window closing during its own first version-control read does.
    const opening = manager.getInfo(root);
    const closing = manager.closeProject(root);
    await Promise.all([opening.catch(() => undefined), closing]);

    expect(countLines("[Vcs] Opened session")).toBe(countLines("[Vcs] Closed session"));

    // And the repository really is free: this would block otherwise.
    const info = await withDeadline(manager.getInfo(root), "getInfo after closing mid-open");
    expect(info.repositoryId).toBeTruthy();
  }, 180_000);
});
