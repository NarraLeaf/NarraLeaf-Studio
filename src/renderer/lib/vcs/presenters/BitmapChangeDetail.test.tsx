// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { ChangeDetailHost } from "./ChangeDetailHost";
import type { ComparisonSides, SideBytes } from "./comparisonSide";

/**
 * What the image comparison must never do: claim a file it cannot draw, offer a comparison the two
 * pictures do not support, draw an empty frame beside a file that only exists on one side, or go
 * blank when nothing could be read.
 *
 * The reading is mocked out - `comparisonSide.test.tsx` owns that - and so is image decoding,
 * which jsdom does not do: a stubbed `Image` answers with whatever size the test says the bytes
 * are, which is the same thing the browser reports from a real one.
 */

vi.mock("@/lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}(${Object.values(params).join(",")})` : key,
    has: () => false,
    tn: (key: string) => key,
    locale: "en"
  })
}));

const sideStates = vi.hoisted(() => new Map<string, unknown>());
const ABSENT = { status: "absent", url: null, size: 0, error: null };
vi.mock("./comparisonSide", () => ({
  useSideObjectUrl: (side: { at: string } | null) => {
    if (!side) return ABSENT;
    return sideStates.get(side.at === "revision" ? "before" : "after") ?? ABSENT;
  },
  comparisonSideKey: () => "mocked"
}));

/** Sizes the stubbed decoder answers with, by URL. Absent means the bytes are not an image. */
const decoded = new Map<string, { width: number; height: number }>();

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;

  set src(value: string) {
    const size = decoded.get(value);
    queueMicrotask(() => {
      if (!size) {
        this.onerror?.();
        return;
      }
      this.naturalWidth = size.width;
      this.naturalHeight = size.height;
      this.onload?.();
    });
  }
}

const SIDES: ComparisonSides = {
  before: { at: "revision", revision: "r1" },
  after: { at: "working-tree" }
};

function ready(url: string, size = 1024): SideBytes {
  return { status: "ready", url, size, error: null };
}

function entry(over: Partial<DocumentDiffEntry> = {}): DocumentDiffEntry {
  return {
    path: "assets/content/99/55/3d15abb54213bad7203798a1adc4",
    kind: "changed",
    contentClass: "bitmap",
    diff: {
      changes: [{ path: [], kind: "changed", label: { key: "documentDiff.content.changed" } }],
      complete: true,
      total: 1,
      tier: "content"
    },
    ...over
  };
}

function draw(over: Partial<DocumentDiffEntry> = {}) {
  return render(<ChangeDetailHost entry={entry(over)} sides={SIDES} />);
}

const modeButtons = (container: HTMLElement): string[] =>
  [...container.querySelectorAll("[role=group] button")].map((button) => button.textContent ?? "");

beforeEach(() => {
  vi.stubGlobal("Image", FakeImage);
  decoded.clear();
  sideStates.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("which presenter draws an image", () => {
  it("hands a bitmap to the image presenter rather than to the list of rows", () => {
    const { container } = draw();

    expect(
      container.querySelector("[data-change-presenter]")?.getAttribute("data-change-presenter")
    ).toBe("bitmap");
  });

  it("leaves everything else to the generic one", () => {
    const { container } = render(
      <ChangeDetailHost
        entry={entry({ path: "editor/story/index.json", contentClass: "text" })}
        sides={SIDES}
      />
    );

    expect(
      container.querySelector("[data-change-presenter]")?.getAttribute("data-change-presenter")
    ).toBe("generic");
  });
});

describe("comparing two versions of one image", () => {
  it("offers all three comparisons when the two are the same size", async () => {
    decoded.set("blob:a", { width: 1024, height: 1024 });
    decoded.set("blob:b", { width: 1024, height: 1024 });
    sideStates.set("before", ready("blob:a"));
    sideStates.set("after", ready("blob:b"));

    const { container } = draw();

    await waitFor(() => expect(modeButtons(container)).toHaveLength(3));
    expect(modeButtons(container)).toEqual([
      "documentDiff.presenter.image.sideBySide",
      "documentDiff.presenter.image.swipe",
      "documentDiff.presenter.image.difference"
    ]);
    expect(container.textContent).not.toContain("documentDiff.presenter.image.sizeDiffers");
    // Both drawn, and against one box: same size, so both fill it.
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });

  it("withholds the difference comparison when the sizes changed, and says why", async () => {
    decoded.set("blob:a", { width: 1088, height: 1984 });
    decoded.set("blob:b", { width: 1024, height: 1024 });
    sideStates.set("before", ready("blob:a"));
    sideStates.set("after", ready("blob:b"));

    const { container } = draw();

    await waitFor(() => expect(modeButtons(container)).toHaveLength(2));
    expect(modeButtons(container)).not.toContain("documentDiff.presenter.image.difference");
    // The reason, not just the absence: a control that is simply missing reads as one nobody
    // has written yet.
    expect(container.textContent).toContain("documentDiff.presenter.image.sizeDiffers");
  });

  it("states the two sizes when they differ, once, and at the top", async () => {
    decoded.set("blob:a", { width: 1088, height: 1984 });
    decoded.set("blob:b", { width: 1024, height: 1024 });
    sideStates.set("before", ready("blob:a"));
    sideStates.set("after", ready("blob:b"));

    const { container } = draw();

    await waitFor(() => expect(container.textContent).toContain("1088 × 1984 → 1024 × 1024"));
    expect(container.textContent?.match(/1088 × 1984/g)).toHaveLength(1);
  });

  it("draws one image over the other for the difference comparison", async () => {
    decoded.set("blob:a", { width: 64, height: 64 });
    decoded.set("blob:b", { width: 64, height: 64 });
    sideStates.set("before", ready("blob:a"));
    sideStates.set("after", ready("blob:b"));

    const { container, getByText } = draw();
    await waitFor(() => expect(modeButtons(container)).toHaveLength(3));
    fireEvent.click(getByText("documentDiff.presenter.image.difference"));

    const images = [...container.querySelectorAll("img")];
    expect(images).toHaveLength(2);
    expect(images[1].style.mixBlendMode).toBe("difference");
  });

  it("scales the smaller version smaller instead of fitting each to its own frame", async () => {
    decoded.set("blob:a", { width: 1024, height: 1024 });
    decoded.set("blob:b", { width: 512, height: 512 });
    sideStates.set("before", ready("blob:a"));
    sideStates.set("after", ready("blob:b"));

    const { container } = draw();

    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2));
    const images = [...container.querySelectorAll("img")];
    expect(images[0].style.width).toBe("100%");
    expect(images[1].style.width).toBe("50%");
  });
});

describe("an image that exists on one side", () => {
  it("draws the one side, with no empty frame beside it", async () => {
    decoded.set("blob:b", { width: 800, height: 600 });
    sideStates.set("after", ready("blob:b"));

    const { container } = draw({ kind: "added" });

    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(1));
    expect(modeButtons(container)).toEqual([]);
    expect(container.textContent).toContain("documentDiff.shell.fileAdded");
    expect(container.textContent).toContain("800 × 600");
  });

  it("draws the version that went away for a removal", async () => {
    decoded.set("blob:a", { width: 128, height: 128 });
    sideStates.set("before", ready("blob:a"));

    const { container } = draw({ kind: "removed" });

    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(1));
    expect(container.textContent).toContain("documentDiff.shell.fileRemoved");
  });
});

describe("when an image cannot be shown", () => {
  it("says which limit was met and falls back to the rows, not to a blank pane", async () => {
    sideStates.set("before", { status: "tooLarge", url: null, size: 0, error: null });
    sideStates.set("after", { status: "tooLarge", url: null, size: 0, error: null });

    const { container } = draw();

    await waitFor(() =>
      expect(container.textContent).toContain("documentDiff.presenter.image.tooLarge")
    );
    // The generic list is still under it: a file nobody can draw is still a file something can
    // describe.
    expect(container.textContent).toContain("documentDiff.content.changed");
  });

  it("tells a format it cannot draw apart from bytes that are not the picture they claim", async () => {
    sideStates.set("before", { status: "unsupported", url: null, size: 12, error: null });
    sideStates.set("after", { status: "unsupported", url: null, size: 14, error: null });

    const { container } = draw();

    await waitFor(() =>
      expect(container.textContent).toContain("documentDiff.presenter.image.unsupported")
    );
  });

  it("keeps the side that could be drawn, and states the reason on the side that could not", async () => {
    decoded.set("blob:a", { width: 64, height: 64 });
    sideStates.set("before", ready("blob:a"));
    sideStates.set("after", { status: "tooLarge", url: null, size: 0, error: null });

    const { container } = draw();

    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(1));
    // Both frames are there: dropping the one with no picture in it would leave the reason
    // nowhere on screen.
    expect(container.textContent).toContain("documentDiff.presenter.image.tooLarge");
    expect(container.textContent).toContain("64 × 64");
  });

  it("reports bytes a decoder rejected, even though the read itself succeeded", async () => {
    // Nothing was registered for this URL, so the stubbed decoder refuses it - the same thing
    // an `<img>` does with a truncated PNG.
    sideStates.set("before", ready("blob:corrupt"));
    sideStates.set("after", ready("blob:corrupt"));

    const { container } = draw();

    await waitFor(() =>
      expect(container.textContent).toContain("documentDiff.presenter.image.unreadable")
    );
  });
});
