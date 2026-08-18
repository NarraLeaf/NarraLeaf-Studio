import { describe, expect, it } from "vitest";
import { countDocumentChanges, DocumentChange } from "./diff";
import { diffJsonStructural, STRUCTURAL_VALUE_PREVIEW_CHARS } from "./jsonStructuralDiff";

const LIMIT = { limit: 200 };

/** Flatten a diff to `path=kind` strings, which is what these tests are really asserting about. */
function rows(changes: readonly DocumentChange[]): string[] {
  const out: string[] = [];
  for (const change of changes) {
    if (change.children) {
      out.push(...rows(change.children));
    } else {
      out.push(`${change.path.join(".")}=${change.kind}`);
    }
  }
  return out;
}

describe("generic JSON structural diff", () => {
  it("finds nothing between two equal documents", () => {
    const document = { a: 1, b: { c: [1, 2, 3] }, d: null };
    const diff = diffJsonStructural(document, structuredClone(document), LIMIT);

    expect(diff.changes).toEqual([]);
    expect(diff.total).toBe(0);
    expect(diff.complete).toBe(true);
  });

  it("always reports the structural tier, never a higher one", () => {
    expect(diffJsonStructural({ a: 1 }, { a: 2 }, LIMIT).tier).toBe("structural");
  });

  it("names added, removed and changed properties", () => {
    const diff = diffJsonStructural(
      { kept: 1, gone: 2, edited: "before" },
      { kept: 1, edited: "after", fresh: 3 },
      LIMIT
    );

    expect(rows(diff.changes)).toEqual(["edited=changed", "fresh=added", "gone=removed"]);
    expect(diff.total).toBe(3);
    expect(diff.complete).toBe(true);
  });

  it("carries the property name as the subject and the values as label parameters", () => {
    const [change] = diffJsonStructural({ volume: 0.8 }, { volume: 0.9 }, LIMIT).changes;

    expect(change.label.key).toBe("documentDiff.structural.property");
    expect(change.label.params).toEqual({ name: "volume", from: "0.8", to: "0.9" });
    expect(change.subject).toBe("volume");
  });

  it("does not descend into an added subtree", () => {
    const diff = diffJsonStructural({}, { scene: { blocks: [1, 2, 3], title: "Prologue" } }, LIMIT);

    // One change, not four: the author added a scene, they did not write four fields.
    expect(rows(diff.changes)).toEqual(["scene=added"]);
  });

  it("tells an absent property from one holding null", () => {
    expect(rows(diffJsonStructural({ a: null }, {}, LIMIT).changes)).toEqual(["a=removed"]);
    expect(rows(diffJsonStructural({ a: null }, { a: 0 }, LIMIT).changes)).toEqual(["a=changed"]);
  });

  it("reports an array element rather than the whole array", () => {
    const diff = diffJsonStructural(
      { tracks: [{ gain: 1 }, { gain: 1 }, { gain: 1 }] },
      { tracks: [{ gain: 1 }, { gain: 0.5 }, { gain: 1 }] },
      LIMIT
    );

    expect(rows(diff.changes)).toEqual(["tracks.1.gain=changed"]);
  });

  it("reports appended and truncated array elements as elements", () => {
    expect(rows(diffJsonStructural({ a: [1] }, { a: [1, 2] }, LIMIT).changes)).toEqual([
      "a.1=added"
    ]);
    expect(rows(diffJsonStructural({ a: [1, 2] }, { a: [1] }, LIMIT).changes)).toEqual([
      "a.1=removed"
    ]);
  });

  it("compares arrays positionally, which an insertion at the front makes obvious", () => {
    // Not a defect: aligning two sequences needs to know what identifies an element, and
    // that is format knowledge only a `spec.diff` has. The test pins the honest answer so
    // nobody later mistakes it for a bug and adds a guessed alignment.
    const diff = diffJsonStructural({ a: ["x", "y"] }, { a: ["new", "x", "y"] }, LIMIT);

    expect(rows(diff.changes)).toEqual(["a.0=changed", "a.1=changed", "a.2=added"]);
  });

  it("labels an array element with its index and no subject", () => {
    const [group] = diffJsonStructural({ a: [1] }, { a: [2] }, LIMIT).changes;
    const [child] = group.children ?? [group];

    expect(child.label.key).toBe("documentDiff.structural.element");
    expect(child.label.params).toEqual({ index: 0, from: "1", to: "2" });
    expect(child.subject).toBeUndefined();
  });

  it("reports a change at the root when the two sides are not the same kind of value", () => {
    const diff = diffJsonStructural([1, 2], { a: 1 }, LIMIT);

    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].path).toEqual([]);
    expect(diff.changes[0].label.key).toBe("documentDiff.structural.root");
  });

  it("groups everything under one top-level key into one row, one level deep", () => {
    const diff = diffJsonStructural(
      { scenes: { a: { title: "one" }, b: { title: "two" } } },
      { scenes: { a: { title: "ONE" }, b: { title: "TWO" } } },
      LIMIT
    );

    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].path).toEqual(["scenes"]);
    expect(diff.changes[0].children).toHaveLength(2);
    // The one-level rule: a child of a child is flattened into the group, keeping its path.
    expect(diff.changes[0].children?.every((child) => child.children === undefined)).toBe(true);
    expect(rows(diff.changes)).toEqual(["scenes.a.title=changed", "scenes.b.title=changed"]);
  });

  it("is deterministic whatever order the keys were built in", () => {
    const head = { zulu: 1, alpha: 2, mike: 3 };
    const reordered = { mike: 3, zulu: 1, alpha: 2 };
    const base = { zulu: 0, alpha: 0, mike: 0 };

    const first = diffJsonStructural(base, head, LIMIT);
    const second = diffJsonStructural(base, reordered, LIMIT);

    expect(rows(second.changes)).toEqual(rows(first.changes));
    expect(rows(first.changes)).toEqual(["alpha=changed", "mike=changed", "zulu=changed"]);
  });

  it("sorts before it truncates: the rows kept are the first in the final order", () => {
    const base: Record<string, number> = {};
    const head: Record<string, number> = {};
    // Built in descending order on purpose, so a walk that kept what it found first
    // rather than what sorts first would keep `k9`, `k8`, `k7`.
    for (let index = 9; index >= 0; index -= 1) {
      base[`k${index}`] = 0;
      head[`k${index}`] = 1;
    }

    const diff = diffJsonStructural(base, head, { limit: 3 });

    expect(rows(diff.changes)).toEqual(["k0=changed", "k1=changed", "k2=changed"]);
    expect(diff.total).toBe(10);
    expect(diff.complete).toBe(false);
  });

  it("reports how much of a group it dropped", () => {
    const base = { group: { a: 0, b: 0, c: 0, d: 0 } };
    const head = { group: { a: 1, b: 1, c: 1, d: 1 } };

    const diff = diffJsonStructural(base, head, { limit: 2 });

    expect(diff.changes[0].children).toHaveLength(2);
    expect(diff.changes[0].truncated).toBe(2);
    expect(diff.total).toBe(4);
    expect(countDocumentChanges(diff.changes)).toBe(4);
    expect(diff.complete).toBe(false);
  });

  it("counts changes it never built, so the surface can say how many are missing", () => {
    const base: Record<string, number> = {};
    const head: Record<string, number> = {};
    for (let index = 0; index < 50; index += 1) {
      base[`key${index}`] = 0;
      head[`key${index}`] = 1;
    }

    const diff = diffJsonStructural(base, head, { limit: 5 });

    expect(diff.changes).toHaveLength(5);
    expect(diff.total).toBe(50);
    expect(diff.complete).toBe(false);
  });

  it("produces nothing at all with a limit of zero, and still counts", () => {
    const diff = diffJsonStructural({ a: 1 }, { a: 2 }, { limit: 0 });

    expect(diff.changes).toEqual([]);
    expect(diff.total).toBe(1);
    expect(diff.complete).toBe(false);
  });

  it("caps a value preview rather than carrying a paragraph into a label", () => {
    const long = "x".repeat(500);
    const [change] = diffJsonStructural({ text: "" }, { text: long }, LIMIT).changes;

    const to = String(change.label.params?.to);
    expect(to).toHaveLength(STRUCTURAL_VALUE_PREVIEW_CHARS + 1);
    expect(to.endsWith("…")).toBe(true);
  });

  it("omits a preview for a container, rather than inventing a sentence about it", () => {
    const [change] = diffJsonStructural({ a: 1 }, { a: { b: 2 } }, LIMIT).changes;

    expect(change.label.params).toEqual({ name: "a", from: "1" });
  });

  it("sees a sign change the canonical encoder preserves", () => {
    // `canonicalJson` writes -0 as "-0", so the two documents are different files;
    // `===` would call them equal and the change would vanish.
    expect(rows(diffJsonStructural({ a: -0 }, { a: 0 }, LIMIT).changes)).toEqual(["a=changed"]);
  });

  it("runs the same twice over the same pair", () => {
    const base = { a: [1, { b: "x" }], c: { d: 1 } };
    const head = { a: [2, { b: "y" }], c: { d: 2 }, e: 3 };

    expect(diffJsonStructural(base, head, LIMIT)).toEqual(diffJsonStructural(base, head, LIMIT));
  });
});
