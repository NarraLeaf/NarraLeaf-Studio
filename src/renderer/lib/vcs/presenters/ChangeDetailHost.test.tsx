// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentChange, DocumentDiffEntry, DocumentDiffTier } from "@shared/documents/diff";
import { ChangeDetailHost } from "./ChangeDetailHost";
import { listChangePresenters, registerChangePresenter } from "./registry";

/**
 * **One presenter is mounted, and one only.**
 *
 * The surface this replaced was every changed document's list stacked in one scroller. The way back
 * to it is not a redesign, it is one `map` in the detail pane - so what is pinned here is the count
 * of mounted presenters, before and after the selection moves, and with a second presenter installed
 * to make sure a choice is being made rather than everything being drawn.
 *
 * Keys rather than prose: which words are on screen is the catalogue's business, and these
 * assertions are about how many things are.
 */

vi.mock("@/lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({
    // The key, plus whatever was interpolated into it, so an assertion can tell one row from
    // another without depending on a single English word.
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}(${Object.values(params).join(",")})` : key,
    has: () => false,
    tn: (key: string) => key
  })
}));

afterEach(cleanup);

function change(name: string): DocumentChange {
  return {
    path: [name],
    kind: "changed",
    label: { key: "documentDiff.structural.property", params: { name } }
  };
}

function entry(path: string, tier: DocumentDiffTier = "semantic", changes = 3): DocumentDiffEntry {
  const list = Array.from({ length: changes }, (_, index) => change(`field${index}`));
  return {
    path,
    kind: "changed",
    diff: { changes: list, complete: true, total: list.length, tier }
  };
}

const presenters = (container: HTMLElement): NodeListOf<Element> =>
  container.querySelectorAll("[data-change-presenter]");

describe("ChangeDetailHost", () => {
  it("mounts exactly one presenter", () => {
    const { container } = render(<ChangeDetailHost entry={entry("editor/brand.json")} />);

    expect(presenters(container)).toHaveLength(1);
    expect(presenters(container)[0].getAttribute("data-change-presenter")).toBe("generic");
  });

  it("still mounts exactly one when the selection moves", () => {
    const { container, rerender } = render(<ChangeDetailHost entry={entry("editor/brand.json")} />);
    rerender(<ChangeDetailHost entry={entry("editor/story/index.json")} />);

    expect(presenters(container)).toHaveLength(1);
  });

  it("mounts the one that claims the document, and not the generic one as well", () => {
    registerChangePresenter({
      id: "test-detail-host",
      matches: (item) => item.path === "editor/ui/uidoc.json",
      Detail: () => <p>claimed</p>
    });

    const { container } = render(<ChangeDetailHost entry={entry("editor/ui/uidoc.json")} />);

    expect(presenters(container)).toHaveLength(1);
    expect(presenters(container)[0].getAttribute("data-change-presenter")).toBe("test-detail-host");
    expect(container.textContent).toContain("claimed");
  });

  it("never lets two installed presenters claim one document", () => {
    // `presenterFor` answers with one whatever happens, so an overlap would not show up as a
    // second pane - it would show up as the wrong presenter, on whichever import order a
    // bundler settled on. Importing this module is what installs all of them, which is why
    // the check lives here.
    const documents: DocumentDiffEntry[] = [
      { ...entry("assets/content/99/55/3d15abb54213bad7203798a1adc4"), contentClass: "bitmap" },
      { ...entry("assets/content/99/55/1a2b3c4d5e6f7a8b9c0d1e2f3a4b"), contentClass: "audio" },
      { ...entry("assets/content/99/55/2b3c4d5e6f7a8b9c0d1e2f3a4b5c"), contentClass: "font" },
      { ...entry("editor/brand.json"), documentKind: "brand" }
    ];

    for (const document of documents) {
      const claiming = listChangePresenters().filter((candidate) => candidate.matches(document));
      // Non-vacuous: exactly one, so a presenter that quietly stopped claiming its own
      // format fails this as loudly as one that claims two.
      expect(claiming.map((candidate) => candidate.id)).toHaveLength(1);
    }
  });

  it("states the tier once for the whole detail, not once per change", () => {
    // The caveat rule from the other side: a structural list of JSON paths reads exactly like a
    // semantic list of authored changes, so the caption saying which one it is has to be there -
    // once. Three changes with three captions is the noise the group summary exists to avoid.
    const { container } = render(
      <ChangeDetailHost entry={entry("editor/brand.json", "structural", 3)} />
    );

    const captions = [...container.querySelectorAll("p")].filter(
      (node) => node.textContent === "documentDiff.tier.structural"
    );
    expect(captions).toHaveLength(1);
  });

  it("says nothing about a tier for a file that appeared, went away or moved", () => {
    // Three whole-file facts, and `opaque`'s caption ("Not read. Too large, not text, or
    // unreadable") was drawn over all three in the real app. The move is the worst of them:
    // that file's bytes were read on both sides, in full, precisely to prove it was a move.
    for (const kind of ["added", "removed", "moved"] as const) {
      const moved: DocumentDiffEntry = {
        path: "notes-archive/note-01.txt",
        kind,
        diff: {
          changes: [
            {
              path: [],
              kind,
              label: { key: "documentDiff.content.moved", params: { from: "notes/note-01.txt" } }
            }
          ],
          complete: true,
          total: 1,
          tier: "opaque"
        }
      };

      const { container } = render(<ChangeDetailHost entry={moved} />);

      expect(container.textContent, kind).not.toContain("documentDiff.tier.opaque");
      // Non-vacuous: the row itself is still there, so this is not an empty pane passing.
      expect(container.textContent, kind).toContain("documentDiff.content.moved");
      cleanup();
    }
  });

  it("still says it for the same file compared change by change", () => {
    // The caption is suppressed for the WHOLE document only. A changed file at the same tier
    // keeps it, which is what makes the suppression a statement rather than a hole.
    const { container } = render(
      <ChangeDetailHost entry={entry("notes/note-01.txt", "opaque", 1)} />
    );

    expect(container.textContent).toContain("documentDiff.tier.opaque");
  });

  it("scopes the detail to one change when one is selected", () => {
    const document = entry("editor/brand.json", "semantic", 4);

    const { container } = render(
      <ChangeDetailHost entry={document} change={document.diff.changes[1]} />
    );

    expect(presenters(container)).toHaveLength(1);
    expect(container.textContent).toContain("field1");
    expect(container.textContent).not.toContain("field2");
  });
});
