import { describe, expect, it } from "vitest";
import type { DocumentMergeDecision } from "@shared/documents/diff";
import { mergeDecisionKey } from "@shared/documents/mergeApply";
import type { TranslationKey } from "@shared/i18n";
import {
  buildConflictRows,
  countUndecidedChanges,
  countUndecidedFiles,
  describeMergeSide,
  effectiveMergeSide,
  MERGE_VALUE_FIELD_LIMIT,
  MERGE_VALUE_TEXT_LIMIT,
  mergeDocumentBlockedKey,
  resolveMergeDecisionLabel,
  type MergeChoiceState
} from "./mergeDecisionView";
import type { LabelTranslator } from "./documentChangeView";

/**
 * What the resolve panel would draw, without drawing it.
 *
 * The rule under every case here is the same one: an `auto-*` row has an answer and a `conflict`
 * row has none, and nothing may quietly turn the second into the first. A default of "mine" would
 * be one press away from discarding a collaborator's work with nothing on screen saying so.
 */

const translator: LabelTranslator = {
  t: ((key: TranslationKey, params?: Record<string, unknown>) =>
    params && Object.keys(params).length > 0
      ? `${key}(${Object.keys(params).sort().join(",")})`
      : String(key)) as LabelTranslator["t"],
  has: () => true
};

function decision(
  outcome: DocumentMergeDecision["outcome"],
  extra: Partial<DocumentMergeDecision> = {}
): DocumentMergeDecision {
  return {
    path: ["units", "greeting"],
    outcome,
    mine: { present: true, value: { target: "mine" } },
    theirs: { present: true, value: { target: "theirs" } },
    ...extra
  };
}

describe("effectiveMergeSide", () => {
  it("answers with the side an automatic outcome already took", () => {
    expect(effectiveMergeSide(decision("auto-mine"), {})).toBe("mine");
    expect(effectiveMergeSide(decision("auto-theirs"), {})).toBe("theirs");
  });

  /** The one that must never acquire a default. */
  it("answers with nothing for an unanswered conflict", () => {
    expect(effectiveMergeSide(decision("conflict"), {})).toBeUndefined();
  });

  it("lets a recorded choice override an automatic outcome", () => {
    const key = mergeDecisionKey(["units", "greeting"]);
    expect(effectiveMergeSide(decision("auto-mine"), { [key]: "theirs" })).toBe("theirs");
    expect(effectiveMergeSide(decision("conflict"), { [key]: "mine" })).toBe("mine");
  });
});

describe("countUndecidedChanges", () => {
  it("counts only the conflicts nobody answered", () => {
    const other: DocumentMergeDecision = { ...decision("conflict"), path: ["units", "farewell"] };
    expect(countUndecidedChanges([decision("auto-mine"), decision("conflict"), other], {})).toBe(2);
    expect(
      countUndecidedChanges([decision("auto-mine"), decision("conflict"), other], {
        [mergeDecisionKey(["units", "greeting"])]: "theirs"
      })
    ).toBe(1);
  });

  /** A file whose every change merged on its own still has to be finishable. */
  it("is zero for a document with no conflicts at all", () => {
    expect(countUndecidedChanges([decision("auto-mine"), decision("auto-theirs")], {})).toBe(0);
  });
});

describe("resolveMergeDecisionLabel", () => {
  it("translates a label and puts the author's own word first when there is one", () => {
    expect(
      resolveMergeDecisionLabel(
        decision("conflict", {
          label: { key: "documentDiff.assets.changed" },
          subject: "Sunset"
        }),
        translator
      )
    ).toEqual({
      primary: "Sunset",
      detail: "documentDiff.assets.changed",
      untranslated: false
    });
  });

  /**
   * A format whose merge lands before its semantic diff has no vocabulary yet, and the fallback
   * has to LOOK untranslated: inventing a sentence would put a translated-seeming label on a row
   * nobody has words for, and nothing would ever report it.
   */
  it("falls back to the path and says so when there is no label", () => {
    expect(resolveMergeDecisionLabel(decision("conflict"), translator)).toEqual({
      primary: "units / greeting",
      untranslated: true
    });
  });
});

describe("describeMergeSide", () => {
  /** "The other side does not have this entry" is a real answer, not an empty one. */
  it("marks a side that does not hold the entry", () => {
    expect(describeMergeSide({ present: false })).toEqual({ absent: true, lines: [], hidden: 0 });
  });

  /**
   * Fields rather than JSON: the question a translation conflict asks is which of two sentences
   * to keep, and braces and quotes put the answer inside punctuation.
   */
  it("draws a record one field per line", () => {
    expect(
      describeMergeSide({
        present: true,
        value: { target: "こんにちは", status: "translated" }
      })
    ).toEqual({
      absent: false,
      lines: [
        { name: "target", text: "こんにちは" },
        { name: "status", text: "translated" }
      ],
      hidden: 0
    });
  });

  it("says how many fields it left out", () => {
    const value = Object.fromEntries(
      Array.from({ length: MERGE_VALUE_FIELD_LIMIT + 3 }, (_, index) => [`f${index}`, index])
    );
    const view = describeMergeSide({ present: true, value });
    expect(view.lines).toHaveLength(MERGE_VALUE_FIELD_LIMIT);
    expect(view.hidden).toBe(3);
  });

  it("cuts a very long value rather than letting it push the other side off screen", () => {
    const view = describeMergeSide({
      present: true,
      value: "x".repeat(MERGE_VALUE_TEXT_LIMIT * 2)
    });
    expect(view.lines[0].text).toHaveLength(MERGE_VALUE_TEXT_LIMIT);
    expect(view.lines[0].text.endsWith("…")).toBe(true);
  });

  it("draws a scalar as itself", () => {
    expect(describeMergeSide({ present: true, value: "plain" }).lines).toEqual([{ text: "plain" }]);
    expect(describeMergeSide({ present: true, value: 7 }).lines).toEqual([{ text: "7" }]);
    expect(describeMergeSide({ present: true, value: null }).lines).toEqual([{ text: "null" }]);
  });
});

describe("mergeDocumentBlockedKey", () => {
  /**
   * Every blocker gets its own sentence. A shared one would tell the author "this cannot be
   * merged" without saying whether that is about the format, the file, or a migration that has
   * not landed - and the three have very different answers.
   */
  it("names a distinct key for every reason", () => {
    const keys = (
      ["no-spec", "no-merge3", "read-only", "too-large", "too-many", "unreadable"] as const
    ).map(mergeDocumentBlockedKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => key.startsWith("documentDiff.resolve.change.blocked."))).toBe(true);
  });
});

/**
 * One file's state, which is the answer the finish button is built on.
 *
 * The failure these are for is a merge that can be closed while something is still unanswered: the
 * backend refuses it by name, so nothing is lost, but the author is told at the end of a two hundred
 * file merge rather than while they are making it.
 */
const EMPTY_STATE: MergeChoiceState = {
  decisions: {},
  perChange: {},
  changeChoices: {},
  documents: {}
};

const state = (partial: Partial<MergeChoiceState>): MergeChoiceState => ({
  ...EMPTY_STATE,
  ...partial
});

describe("buildConflictRows", () => {
  it("draws one row per conflicted file, whatever is inside it", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      decision("conflict", { path: ["u", String(index)] })
    );
    const rows = buildConflictRows(
      ["a.json", "b.json"],
      state({
        documents: {
          "b.json": {
            status: "ready",
            document: { path: "b.json", decisions: many, conflicts: 40 }
          }
        }
      })
    );

    expect(rows.map((row) => row.path)).toEqual(["a.json", "b.json"]);
  });

  it("starts every file on neither side, which is the state that blocks the finish", () => {
    const rows = buildConflictRows(["a.json", "b.json"], EMPTY_STATE);

    expect(rows.map((row) => row.decision)).toEqual(["none", "none"]);
    expect(rows.some((row) => row.settled)).toBe(false);
    expect(countUndecidedFiles(rows)).toBe(2);
  });

  it("settles a file the moment a whole side is taken", () => {
    const rows = buildConflictRows(["a.json"], state({ decisions: { "a.json": "theirs" } }));

    expect(rows[0]).toMatchObject({ decision: "theirs", settled: true });
    expect(countUndecidedFiles(rows)).toBe(0);
  });

  /**
   * The per-change control is a property of the DOCUMENT, so it cannot be offered before anyone
   * has looked - a row drawn as mergeable while the read is still out would be a control that
   * disappears when the answer arrives.
   */
  it("offers the per-change choice only for a document that has answered and can be merged", () => {
    const unread = buildConflictRows(["a.json"], EMPTY_STATE);
    const loading = buildConflictRows(
      ["a.json"],
      state({ documents: { "a.json": { status: "loading" } } })
    );
    const blocked = buildConflictRows(
      ["a.json"],
      state({
        documents: {
          "a.json": {
            status: "ready",
            document: { path: "a.json", decisions: [], conflicts: 0, blocked: "no-spec" }
          }
        }
      })
    );
    const ready = buildConflictRows(
      ["a.json"],
      state({
        documents: {
          "a.json": { status: "ready", document: { path: "a.json", decisions: [], conflicts: 0 } }
        }
      })
    );

    expect([unread[0].mergeable, loading[0].mergeable, blocked[0].mergeable]).toEqual([
      false,
      false,
      false
    ]);
    expect(ready[0].mergeable).toBe(true);
  });

  it("counts a file being merged as settled only once every conflict inside it has a side", () => {
    const document = {
      path: "a.json",
      decisions: [decision("auto-mine"), decision("conflict", { path: ["units", "farewell"] })],
      conflicts: 1
    };
    const documents = { "a.json": { status: "ready", document } } as const;

    const open = buildConflictRows(["a.json"], state({ perChange: { "a.json": true }, documents }));
    const answered = buildConflictRows(
      ["a.json"],
      state({
        perChange: { "a.json": true },
        changeChoices: { "a.json": { [mergeDecisionKey(["units", "farewell"])]: "mine" } },
        documents
      })
    );

    expect(open[0]).toMatchObject({ decision: "per-change", settled: false, undecidedChanges: 1 });
    expect(answered[0]).toMatchObject({
      decision: "per-change",
      settled: true,
      undecidedChanges: 0
    });
  });

  /**
   * Tier three is "refuse and say why", not "accept and hope". A blocked document reports its own
   * decision list as empty, and a file marked for per-change merging on the strength of that would
   * be finished with nothing chosen for it at all.
   */
  it("never settles a blocked file through the per-change route", () => {
    const rows = buildConflictRows(
      ["a.json"],
      state({
        perChange: { "a.json": true },
        documents: {
          "a.json": {
            status: "ready",
            document: { path: "a.json", decisions: [], conflicts: 0, blocked: "read-only" }
          }
        }
      })
    );

    expect(rows[0]).toMatchObject({ decision: "per-change", settled: false });
    expect(countUndecidedFiles(rows)).toBe(1);
  });
});
