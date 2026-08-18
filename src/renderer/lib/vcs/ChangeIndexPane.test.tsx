// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentChange, DocumentDiffEntry, DocumentDiffTier } from "@shared/documents/diff";
import { ChangeIndexPane } from "./ChangeIndexPane";
import { buildChangeIndex, type ChangeIndexGroup } from "./changeIndex";

/**
 * What the model promises, on screen.
 *
 * `changeIndex.test.ts` pins the shape; this pins that the shape is what gets drawn. The two failures
 * it is for both pass a model test: a row that renders its file's changes underneath itself, and a
 * closed heading that draws its contents anyway with `hidden` on them.
 */

vi.mock("@/lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}(${Object.values(params).join(",")})` : key,
    has: () => false,
    tn: (key: string, count: number) => `${key}(${count})`
  })
}));

afterEach(cleanup);

function entry(
  path: string,
  changes: number,
  tier: DocumentDiffTier = "semantic"
): DocumentDiffEntry {
  const list: DocumentChange[] = Array.from({ length: changes }, (_, index) => ({
    path: [`field${index}`],
    kind: "changed",
    label: { key: "documentDiff.structural.property", params: { name: `field${index}` } }
  }));
  return {
    path,
    kind: "changed",
    diff: { changes: list, complete: true, total: list.length, tier }
  };
}

function pane(entries: readonly DocumentDiffEntry[], open: (group: ChangeIndexGroup) => boolean) {
  const index = buildChangeIndex(entries, { rowBudget: 1000 });
  return render(
    <ChangeIndexPane
      index={index}
      isOpen={open}
      onToggle={() => undefined}
      selectedPath={null}
      onSelect={() => undefined}
    />
  );
}

const rows = (container: HTMLElement) => container.querySelectorAll("[data-change-index-row]");

describe("ChangeIndexPane", () => {
  it("draws one row per file however many changes the file has", () => {
    const { container } = pane(
      [
        entry("editor/story/stories/a/storydoc.json", 1),
        entry("editor/story/stories/b/storydoc.json", 200),
        entry("editor/story/stories/c/storydoc.json", 40, "structural")
      ],
      () => true
    );

    expect(rows(container)).toHaveLength(3);
    // Nothing from inside a file reaches the index: a change's own label would be the first sign
    // that a row has started growing with what it stands for.
    expect(container.textContent).not.toContain("documentDiff.structural.property");
  });

  it("draws a closed heading as one line and nothing else", () => {
    const many = Array.from({ length: 200 }, (_, index) =>
      entry(`assets/content/ab/cd/f${index}`, 5)
    );

    const { container } = pane(many, (group) => !group.collapsed);

    expect(rows(container)).toHaveLength(0);
    expect(container.querySelectorAll("[aria-expanded]")).toHaveLength(1);
    expect(container.querySelector("[aria-expanded]")!.getAttribute("aria-expanded")).toBe("false");
    // The heading still carries the number, so the group is not merely hidden - it says what
    // opening it will cost.
    expect(container.textContent).toContain("200");
  });

  it("states a group's caveat once, not once per row", () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      entry(`assets/content/ab/cd/f${index}`, 2, "structural")
    );

    const { container } = pane(many, () => true);

    expect(rows(container)).toHaveLength(5);
    expect(container.querySelectorAll("[data-testid='group-caveat']")).toHaveLength(1);
    expect(container.querySelector("[data-testid='group-caveat']")!.textContent).toBe(
      "documentDiff.shell.partial(5)"
    );
  });

  it("says nothing about a group whose files were all read in full", () => {
    const { container } = pane([entry("editor/brand.json", 2)], () => true);

    expect(container.querySelectorAll("[data-testid='group-caveat']")).toHaveLength(0);
  });

  it("draws a heading per category, in the model's order", () => {
    const { container } = pane(
      [entry("assets/assets.metadata.image.json", 1), entry("editor/story/index.json", 1)],
      () => true
    );

    const headings = [...container.querySelectorAll("[aria-expanded]")].map(
      (node) => node.textContent
    );
    expect(headings).toEqual(["documentDiff.category.story1", "documentDiff.category.assets1"]);
  });
});
