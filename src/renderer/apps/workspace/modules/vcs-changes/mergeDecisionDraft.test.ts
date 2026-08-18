import { describe, expect, it, vi } from "vitest";
import type { VcsMergeState } from "@shared/types/vcs";
import type { ServiceAssetsService } from "@/lib/workspace/services/core/ServiceAssetsService";
import {
  clearMergeDecisionDraft,
  mergeFingerprint,
  readMergeDecisionDraft,
  writeMergeDecisionDraft,
  type MergeDecisionDraft
} from "./mergeDecisionDraft";

/**
 * A draft of merge decisions is the one thing in this feature that can pre-select a side on the
 * author's behalf, so every rule about when it is REFUSED is asserted rather than the happy path
 * being asserted twice.
 *
 * The failure this guards against does not look like a failure: a draft restored onto the wrong
 * merge shows a panel with forty files already decided, which is indistinguishable from a panel the
 * author filled in - right up to the moment Finish takes a colleague's side over their work.
 */

const merge = (overrides: Partial<VcsMergeState> = {}): VcsMergeState => ({
  inProgress: true,
  incoming: "aaa111",
  conflicts: ["editor/story/index.json", "editor/characters.json"],
  ...overrides
});

function assets(stored: unknown, ok = true) {
  const writeStore = vi.fn(async (_namespace: string, _data: MergeDecisionDraft) => ({
    ok: true as const,
    data: { path: "x" }
  }));
  const readStore = vi.fn(async (_namespace: string) =>
    ok
      ? { ok: true as const, data: stored as never }
      : { ok: false as const, error: new Error("unreadable") }
  );
  return { readStore, writeStore } as unknown as ServiceAssetsService & {
    readStore: typeof readStore;
    writeStore: typeof writeStore;
  };
}

const draft = (overrides: Partial<MergeDecisionDraft> = {}): MergeDecisionDraft => ({
  version: 1,
  fingerprint: mergeFingerprint(merge()),
  decisions: { "editor/characters.json": "mine" },
  perChange: {},
  changeChoices: {},
  ...overrides
});

describe("mergeFingerprint", () => {
  it("is stable for the same merge", () => {
    expect(mergeFingerprint(merge())).toBe(mergeFingerprint(merge()));
  });

  it("changes when a different set of files is in conflict", () => {
    // Two merges of the same pair of branches genuinely can conflict on different files, so the
    // incoming revision alone would not tell them apart.
    expect(mergeFingerprint(merge({ conflicts: ["editor/story/index.json"] }))).not.toBe(
      mergeFingerprint(merge())
    );
  });

  it("changes when the incoming revision does", () => {
    expect(mergeFingerprint(merge({ incoming: "bbb222" }))).not.toBe(mergeFingerprint(merge()));
  });

  it("has an answer for a merge the backend named no incoming revision for", () => {
    // Absent is ordinary rather than exceptional, and a fingerprint that threw here would take
    // the draft away from exactly the merges that arrive from another client.
    expect(mergeFingerprint(merge({ incoming: undefined }))).toBe(
      mergeFingerprint(merge({ incoming: undefined }))
    );
  });
});

describe("readMergeDecisionDraft", () => {
  it("restores a draft written for this merge", async () => {
    const service = assets(draft());
    await expect(readMergeDecisionDraft(service, mergeFingerprint(merge()))).resolves.toMatchObject(
      { decisions: { "editor/characters.json": "mine" } }
    );
  });

  it("refuses a draft belonging to a different merge", async () => {
    const service = assets(draft({ fingerprint: "some other merge" }));
    await expect(readMergeDecisionDraft(service, mergeFingerprint(merge()))).resolves.toBeNull();
  });

  it("refuses a draft from a future shape rather than reading half of it", async () => {
    const service = assets(draft({ version: 99 }));
    await expect(readMergeDecisionDraft(service, mergeFingerprint(merge()))).resolves.toBeNull();
  });

  it.each([
    ["decisions", draft({ decisions: null as never })],
    ["perChange", draft({ perChange: [] as never })],
    ["changeChoices", draft({ changeChoices: "yes" as never })]
  ])("refuses a draft whose %s is not a record", async (_field, stored) => {
    // The file is on the author's disk. A truncated or hand-edited one must not reach
    // `completeMerge`, which takes sides on their behalf.
    const service = assets(stored);
    await expect(readMergeDecisionDraft(service, mergeFingerprint(merge()))).resolves.toBeNull();
  });

  it("answers null when the store cannot be read at all", async () => {
    // Which is the same as having no draft, and is what the panel did before drafts existed -
    // so there is nothing to tell the author and nothing they could do about it.
    const service = assets(null, false);
    await expect(readMergeDecisionDraft(service, mergeFingerprint(merge()))).resolves.toBeNull();
  });
});

describe("writing", () => {
  it("stamps the version, so the reader above can refuse a shape it does not know", async () => {
    const service = assets(null);
    await writeMergeDecisionDraft(service, {
      fingerprint: "f",
      decisions: {},
      perChange: {},
      changeChoices: {}
    });
    expect(service.writeStore).toHaveBeenCalledWith(
      "merge_decisions",
      expect.objectContaining({ version: 1, fingerprint: "f" })
    );
  });

  it("clears to a draft that carries no choices", async () => {
    // Written empty rather than deleted, because the store layer has no delete. Correctness does
    // not rest on the fingerprint being unmatchable - it rests on there being nothing in it, so
    // that even a merge which somehow fingerprinted the same way would restore no decisions.
    const service = assets(null);
    await clearMergeDecisionDraft(service);
    const written = service.writeStore.mock.calls[0][1];
    expect(written.decisions).toEqual({});
    expect(written.perChange).toEqual({});
    expect(written.changeChoices).toEqual({});
  });
});
