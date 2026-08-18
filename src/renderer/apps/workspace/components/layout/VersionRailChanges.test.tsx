// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VcsFileChange } from "@shared/types/vcs";
import { ChangesSection } from "./VersionRail";
import type { VersionSurface } from "../../hooks/useVersionSurface";

/**
 * The rail lists files and nothing that happened inside one.
 *
 * A row used to expand into that file's comparison, drawn in place in a 320px column, and the read
 * behind it was a working-tree scan - which is never free (docs §4.17). Both are gone: the two-pane
 * comparison tab has the width for an index and a detail, and this column keeps the half it can hold
 * honestly. The three ways that regresses are all pinned below, because each of them looks like an
 * improvement while it is being written: a change label creeping back onto a row, a row becoming
 * expandable again, and the comparison hook being mounted "just to show a count".
 */

vi.mock("@/lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}(${Object.values(params).join(",")})` : key,
    has: () => false,
    tn: (key: string, count: number) => `${key}(${count})`,
    locale: "en"
  })
}));

const workspace = vi.hoisted(() => ({ context: {} as never }));
vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => workspace }));

const openTab = vi.hoisted(() => vi.fn());
vi.mock("@/apps/workspace/modules/vcs-changes/openVcsChangesTab", () => ({
  openVcsChangesTab: openTab,
  createVcsChangesTab: () => undefined
}));

/**
 * Mocked so that mounting it at all is a test failure rather than a slow render.
 *
 * The rail must run NO document comparison: the hook scans, and the reason a row used to be the
 * trigger was to keep an author who never opened one from paying for it. Nothing here should reach
 * this factory.
 */
const documentDiff = vi.hoisted(() =>
  vi.fn(() => ({ loading: false, error: null, result: null, reload: () => undefined }))
);
vi.mock("@/lib/vcs/useDocumentDiff", () => ({
  useDocumentDiff: documentDiff,
  findDocumentDiffEntry: () => null
}));

afterEach(() => {
  cleanup();
  openTab.mockClear();
  documentDiff.mockClear();
});

function change(path: string, partial: Partial<VcsFileChange> = {}): VcsFileChange {
  return {
    path,
    kind: "modified",
    directory: false,
    size: 10,
    staged: false,
    dirty: true,
    conflicted: false,
    conflictUnresolved: false,
    ...partial
  };
}

function section(files: readonly VcsFileChange[], state: VersionSurface["state"] = HEAD_36) {
  const surface = {
    state,
    status: { files },
    refreshChanges: () => undefined
  } as unknown as VersionSurface;
  return render(<ChangesSection surface={surface} />);
}

/** The ordinary state: a working tree sitting on a numbered head. */
const HEAD_36: VersionSurface["state"] = { kind: "current", head: "a91f3c8d2e4b6", number: 36 };

const rows = (container: HTMLElement) => container.querySelectorAll("[data-vcs-change-row]");

describe("the rail's change section", () => {
  it("draws one row per changed file and nothing that changed inside one", () => {
    const { container } = section([
      change("editor/story/stories/a/storydoc.json"),
      change("editor/brand.json", { kind: "added" }),
      change("nl.config.json")
    ]);

    expect(rows(container)).toHaveLength(3);
    // Every string a change list draws is under `documentDiff.`, so one of them appearing as
    // text is the whole of the regression this section was rebuilt to prevent. The comparison
    // entry names itself with the same namespace and does it in an attribute, not in text.
    expect(container.textContent).not.toContain("documentDiff.");
  });

  it("draws no row that can be opened, because nothing in the rail opens", () => {
    const { container } = section([change("editor/brand.json")]);

    expect(container.querySelectorAll("[aria-expanded]")).toHaveLength(0);
  });

  it("runs no document comparison", () => {
    section([change("editor/brand.json"), change("editor/story/index.json")]);

    expect(documentDiff).not.toHaveBeenCalled();
  });

  it("offers one way to the comparison, and it is the tab", () => {
    const { container } = section([change("editor/brand.json")]);

    const entry = container.querySelector<HTMLButtonElement>(
      "[aria-label='documentDiff.rail.compareWithPrevious']"
    )!;
    expect(entry).not.toBeNull();
    fireEvent.click(entry);
    // The label travels with it: the tab's heading has to name the head the same way this panel
    // does, and left to itself it named it by hash.
    expect(openTab).toHaveBeenCalledWith(workspace.context, {
      mode: "working-tree",
      headLabel: "#36"
    });
  });

  it("passes no label when the head has no number yet, rather than inventing one", () => {
    // `getInfo` has not answered. The tab then names the version by its hash, which is honest -
    // a number made up here would be a version that does not exist.
    const { container } = section([change("editor/brand.json")], {
      kind: "current",
      head: "a91f3c8d2e4b6",
      number: null
    });

    fireEvent.click(
      container.querySelector<HTMLButtonElement>(
        "[aria-label='documentDiff.rail.compareWithPrevious']"
      )!
    );
    expect(openTab).toHaveBeenCalledWith(workspace.context, {
      mode: "working-tree",
      headLabel: undefined
    });
  });

  /** Directories are changes in their own right and name nothing the author wrote. */
  it("leaves directories out of the list", () => {
    const { container } = section([
      change("editor/story/stories/new-chapter", { directory: true }),
      change("editor/story/stories/new-chapter/storydoc.json", { kind: "added" })
    ]);

    expect(rows(container)).toHaveLength(1);
    expect(rows(container)[0].getAttribute("data-vcs-change-row")).toBe(
      "editor/story/stories/new-chapter/storydoc.json"
    );
  });
});
