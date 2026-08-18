import { describe, expect, it } from "vitest";
import { dedupSearchEntries } from "./searchSource";
import type { SearchIndexEntry } from "./searchIndexModel";

function entry(id: string, text: string, detail?: string): SearchIndexEntry {
  return {
    id,
    group: "blueprintNode",
    text,
    detail,
    target: { kind: "localizationKey", keyName: "x" }
  };
}

const byTitleAndDetail = (e: SearchIndexEntry) => `${e.text}\u0000${e.detail}`;

describe("dedupSearchEntries", () => {
  it("collapses duplicates into one row carrying the count", () => {
    const out = dedupSearchEntries(
      [
        entry("1", "Image", "Layer 1"),
        entry("2", "Image", "Layer 1"),
        entry("3", "Image", "Layer 1")
      ],
      byTitleAndDetail
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "1", count: 3 });
  });

  it("leaves a row that stands for itself alone without a count", () => {
    const out = dedupSearchEntries(
      [entry("1", "Image", "Layer 1"), entry("2", "Image", "Layer 2")],
      byTitleAndDetail
    );
    expect(out.map((e) => e.id)).toEqual(["1", "2"]);
    expect(out.every((e) => e.count === undefined)).toBe(true);
  });

  it("keeps the FIRST entry's id and target - the jump goes to the first of them", () => {
    const first = entry("first", "Image", "Layer 1");
    const out = dedupSearchEntries([first, entry("second", "Image", "Layer 1")], byTitleAndDetail);
    expect(out[0].id).toBe("first");
    expect(out[0].target).toBe(first.target);
  });

  it("preserves order, collapsing in place at the first occurrence", () => {
    const out = dedupSearchEntries(
      [entry("1", "A"), entry("2", "B"), entry("3", "A"), entry("4", "C"), entry("5", "B")],
      byTitleAndDetail
    );
    expect(out.map((e) => e.text)).toEqual(["A", "B", "C"]);
    expect(out.map((e) => e.count)).toEqual([2, 2, undefined]);
  });

  it("never collapses an entry whose key is null", () => {
    const out = dedupSearchEntries(
      [entry("1", "Image", "Layer 1"), entry("2", "Image", "Layer 1")],
      () => null
    );
    expect(out.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("does not write through to the extractor's own entries", () => {
    const original = entry("1", "Image", "Layer 1");
    dedupSearchEntries([original, entry("2", "Image", "Layer 1")], byTitleAndDetail);
    expect(original.count).toBeUndefined();
  });

  it("does not collide two entries whose fields only concatenate the same", () => {
    // "AB" + "" vs "A" + "B": a separator is the whole reason the key is not `text + detail`.
    const out = dedupSearchEntries([entry("1", "AB", ""), entry("2", "A", "B")], byTitleAndDetail);
    expect(out).toHaveLength(2);
  });
});
