import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported, VCS_REVISION_KIND_KEY } from "@shared/types/vcs";
import type { BaseApp } from "../../baseApp";
import type { LoreGlobals } from "./lore/call";
import { flushRepository, listRevisionMetadata, releaseRepository } from "./lore/verbs";
import { initRepository, readRevisionDetails } from "./repository";
import { VcsManager } from "./VcsManager";

/**
 * What one revision says about itself - message, time and author - read back off a real
 * repository.
 *
 * A real repository rather than a fake, because the whole risk here is in the backend's
 * own vocabulary and none of it is in Studio's control:
 *
 *  - the KEY NAMES are Lore's (`message`, `timestamp`, `committed-by`, alongside
 *    Studio's namespaced `narraleaf.kind`), and a rename upstream turns every field
 *    silently absent, which is exactly what a mock would keep passing through;
 *  - the TIMESTAMP is the one key Lore does not write as a string. It is its NUMERIC
 *    metadata type in epoch MILLISECONDS, and the unit is asserted against the wall
 *    clock below rather than trusted. Read as seconds it dates every revision to 1970;
 *    a seconds value read as milliseconds lands in the year 56000. Both look like a UI
 *    defect forever, and neither fails anywhere else.
 *
 * Only runs where Epic ships a native build (no Intel Mac, no Windows ARM64 - see
 * docs/version-control.md §7).
 *
 * Teardown is not optional. Lore's repository lock is EXCLUSIVE and blocking, so a
 * session left open makes the next run of this file wait instead of fail, and on Windows
 * the temp directory cannot be removed at all. flush -> close -> release, in that order
 * (§4.15, §4.19).
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);

const STORY = "editor/story/stories/prologue/storydoc.json";
const AUTHOR = "Rin Okabe <rin@narraleaf>";
const MESSAGE = "Rewrote the prologue's opening beat";

let root: string;
let globals: LoreGlobals;
let manager: VcsManager;
let settings: Record<string, unknown>;

/** The revision `initRepository` made, which carries no kind at all. */
let firstRevision: string;
/** A revision committed through the manager with a known message and author. */
let labelled: string;
/** The wall-clock window the labelled commit was made inside. */
let committedAfter: number;
let committedBefore: number;

function write(relative: string, bytes: string): void {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, bytes);
}

function fakeApp(): BaseApp {
  const noop = () => undefined;
  return {
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    getGlobalState: () => ({ get: (key: string) => settings[key] })
  } as unknown as BaseApp;
}

beforeAll(async () => {
  if (!supported) return;

  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-revdetails-")));
  globals = { repositoryPath: root, offline: true, cache: true };
  settings = {};

  write("project.json", JSON.stringify({ name: "prologue" }));
  write(STORY, JSON.stringify({ version: 9, scenes: [] }));
  // No `kind` is written here, and that is the point: this revision is the absent case
  // every history read has to render.
  const initial = await initRepository(globals, { identity: "setup@narraleaf" });
  firstRevision = initial.revision;

  manager = new VcsManager(fakeApp(), async () => undefined);

  settings["versionControl.authorName"] = AUTHOR;
  write(STORY, JSON.stringify({ version: 9, scenes: ["prologue"] }));
  // The window, not a single reading: the timestamp is recorded inside the commit, so
  // the assertion that pins the unit is that it falls between these two.
  committedAfter = Date.now();
  labelled = (await manager.commit(root, { message: MESSAGE })).revision;
  committedBefore = Date.now();
}, 240_000);

afterAll(async () => {
  if (!supported) return;
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
}, 120_000);

describe.skipIf(!supported)("what a revision says about itself", () => {
  it("reads back the message and author it was committed with", async () => {
    const details = await readRevisionDetails(globals, labelled);
    expect(details.message).toBe(MESSAGE);
    expect(details.author).toBe(AUTHOR);
    expect(details.kind).toBe("commit");
  }, 60_000);

  it("records the time in epoch milliseconds", async () => {
    const details = await readRevisionDetails(globals, labelled);

    // The unit, pinned against the clock. A seconds value would be ~1.8e9 and fall
    // below the window by a factor of a thousand; microseconds would overshoot it by
    // the same. Nothing else in the codebase would notice either.
    expect(details.timestamp).toBeGreaterThanOrEqual(committedAfter);
    expect(details.timestamp).toBeLessThanOrEqual(committedBefore);
    expect(new Date(details.timestamp!).getUTCFullYear()).toBe(new Date().getUTCFullYear());
  }, 60_000);

  it("carries all three onto the history entry, on the call the kind already pays for", async () => {
    const entries = await manager.getHistory(root, 0, { includeDetails: true });
    const entry = entries.find((candidate) => candidate.revision === labelled);

    expect(entry).toBeDefined();
    expect(entry!.message).toBe(MESSAGE);
    expect(entry!.author).toBe(AUTHOR);
    expect(entry!.kind).toBe("commit");
    expect(entry!.timestamp).toBeGreaterThanOrEqual(committedAfter);
    expect(entry!.timestamp).toBeLessThanOrEqual(committedBefore);
  }, 120_000);

  it("leaves them out entirely when the caller did not ask for kinds", async () => {
    // The three ride on the metadata call the kind opts into, so a plain read must
    // stay at one round trip in total rather than quietly becoming N+1.
    const plain = await manager.getHistory(root);
    expect(plain.length).toBeGreaterThanOrEqual(2);
    expect(plain.every((entry) => entry.message === undefined)).toBe(true);
    expect(plain.every((entry) => entry.timestamp === undefined)).toBe(true);
    expect(plain.every((entry) => entry.author === undefined)).toBe(true);
    expect(plain.every((entry) => entry.kind === undefined)).toBe(true);
  }, 120_000);
});

describe.skipIf(!supported)("a revision that does not say", () => {
  it("reports an absent kind as absent, not as a default", async () => {
    // `initRepository` predates kinds and writes none. Measured: this revision does
    // carry Lore's own four keys, so "absent" here is about the missing key rather
    // than about a revision with no metadata at all.
    const keys = (await listRevisionMetadata(globals, firstRevision)).map((entry) => entry.key);
    expect(keys).not.toContain(VCS_REVISION_KIND_KEY);

    const details = await readRevisionDetails(globals, firstRevision);
    expect(details.kind).toBeUndefined();
    expect("kind" in details).toBe(false);
    // The keys Lore does write are still there, so an unlabelled revision is not a
    // blank row in the rail.
    expect(details.message).toBe("Enable version control");
    expect(details.author).toBe("setup@narraleaf");
    expect(details.timestamp).toBeGreaterThan(0);
  }, 60_000);

  it("omits a missing field instead of answering an empty string", async () => {
    // An empty string renders as a commit with a blank title or a blank author, which
    // is a different claim from "this revision did not say". The keys are omitted
    // rather than set to undefined because an explicit undefined survives the IPC
    // structured clone as a present key.
    const details = await readRevisionDetails(globals, "0".repeat(64));
    expect(details).toEqual({});
    expect(Object.keys(details)).toHaveLength(0);
  }, 60_000);
});
