// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { StoryRichRun } from "@shared/types/story";
import { createUnitRange, renderRunsToElement } from "./richText";
import {
  buildSpellcheckText,
  markAtUnit,
  markFromRange,
  marksFromRanges,
  pruneStaleMarks,
  underlineBoxes,
  type RectLike
} from "./storySpellcheck";

/**
 * The mapping between what the checker reads and what the editor draws.
 *
 * Every test here is about one of the two places this feature can be wrong without looking wrong:
 * an offset that lands a word to the left of itself, and a mark that survives an edit it should not
 * have. Rects are not something jsdom can produce, so the geometry is exercised as the pure
 * transform it is, and the DOM half asserts what the built range actually covers - which is the part
 * that decides where the rects come from in the first place.
 */

const TITLES = {
  pauseClick: "pause",
  pauseSeconds: (seconds: number) => `pause ${seconds}`,
  insertedValue: (name: string) => `value ${name}`,
  valueFallback: "value",
  expressionEvent: "expression",
  soundEvent: "sound"
};

function mount(runs: StoryRichRun[]): HTMLElement {
  const host = globalThis.document.createElement("div");
  globalThis.document.body.appendChild(host);
  renderRunsToElement(host, runs, { titles: TITLES });
  return host;
}

describe("buildSpellcheckText", () => {
  it("keeps the plain text and the unit of every character", () => {
    const { text, unitAt } = buildSpellcheckText([{ text: "hi" }]);
    expect(text).toBe("hi");
    // One entry per character, plus the total, so an exclusive end needs no special case.
    expect(unitAt).toEqual([0, 1, 2]);
  });

  it("spends one character and one unit on an inline value, so a chip separates words", () => {
    const runs: StoryRichRun[] = [
      { text: "Hello" },
      { interpolation: { kind: "variable", target: { scope: "scene", variableId: "name" } } },
      { text: "world" }
    ];
    const { text, unitAt } = buildSpellcheckText(runs);
    // Not "Helloworld": the checker would call that one word and invent a misspelling the
    // script does not contain.
    expect(text).toBe("Hello world");
    // One character per unit all the way along, chip included. This is the invariant the whole
    // mapping rests on, and a chip that spent nothing (or two) would break it here first.
    expect(unitAt).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe("markFromRange", () => {
  const runs: StoryRichRun[] = [
    { text: "the " },
    { text: "wrold", marks: { bold: true } },
    { text: " turns" }
  ];

  it("places a word that spans a run boundary", () => {
    const { text, unitAt } = buildSpellcheckText(runs);
    const mark = markFromRange(unitAt, text, { start: 4, end: 9, word: "wrold" });
    expect(mark).toEqual({ start: 4, end: 9, unitStart: 4, unitEnd: 9, word: "wrold" });
  });

  it("refuses a range whose word is not the text at those offsets", () => {
    const { text, unitAt } = buildSpellcheckText(runs);
    // What a late answer looks like: the offsets are in range, the word is not there any more.
    expect(markFromRange(unitAt, text, { start: 4, end: 9, word: "wrold!" })).toBeNull();
    expect(markFromRange(unitAt, text, { start: 0, end: 5, word: "wrold" })).toBeNull();
  });

  it("refuses a range that runs past the end of the text", () => {
    const { text, unitAt } = buildSpellcheckText(runs);
    expect(markFromRange(unitAt, text, { start: 12, end: 40, word: "turns" })).toBeNull();
  });
});

describe("the DOM range a mark builds", () => {
  it("covers exactly the word when it crosses a run boundary", () => {
    // "wro" is plain and "ld" is bold, so the word is two text nodes in two elements.
    const runs: StoryRichRun[] = [
      { text: "the wro" },
      { text: "ld", marks: { bold: true } },
      { text: " turns" }
    ];
    const host = mount(runs);
    const { text, unitAt } = buildSpellcheckText(runs);
    const mark = markFromRange(unitAt, text, { start: 4, end: 9, word: "wrold" });
    expect(mark).not.toBeNull();

    const range = createUnitRange(host, mark!.unitStart, mark!.unitEnd);
    expect(range.toString()).toBe("wrold");
  });

  it("covers exactly the word when an inline value chip sits before it", () => {
    const runs: StoryRichRun[] = [
      { text: "Hello " },
      { interpolation: { kind: "variable", target: { scope: "scene", variableId: "name" } } },
      { text: " teh end" }
    ];
    const host = mount(runs);
    const { text, unitAt } = buildSpellcheckText(runs);
    // The checked string is "Hello   teh end": the chip contributes one space of its own.
    const start = text.indexOf("teh");
    const mark = markFromRange(unitAt, text, { start, end: start + 3, word: "teh" });
    expect(mark).not.toBeNull();

    // The chip carries a visible label of its own, so a range that started one unit early would
    // pick that label up - which is the failure this is here to catch.
    const range = createUnitRange(host, mark!.unitStart, mark!.unitEnd);
    expect(range.toString()).toBe("teh");
  });
});

describe("pruneStaleMarks", () => {
  const runs: StoryRichRun[] = [{ text: "teh cat sat" }];

  it("keeps a mark whose word is still at its offsets", () => {
    const { text, unitAt } = buildSpellcheckText(runs);
    const marks = marksFromRanges(unitAt, text, [{ start: 0, end: 3, word: "teh" }]);
    expect(pruneStaleMarks(marks, text, unitAt)).toEqual(marks);
  });

  it("drops a mark the moment its word has been typed over", () => {
    const { text, unitAt } = buildSpellcheckText(runs);
    const marks = marksFromRanges(unitAt, text, [{ start: 0, end: 3, word: "teh" }]);
    const fixed = buildSpellcheckText([{ text: "the cat sat" }]);
    expect(pruneStaleMarks(marks, fixed.text, fixed.unitAt)).toEqual([]);
  });

  it("drops a mark whose word has slid along under an insertion", () => {
    const { text, unitAt } = buildSpellcheckText(runs);
    const marks = marksFromRanges(unitAt, text, [{ start: 4, end: 7, word: "cat" }]);
    const shifted = buildSpellcheckText([{ text: "teh big cat sat" }]);
    // The word is still in the row, but not where the answer said it was, and an underline left
    // at the old offsets would sit under "big".
    expect(pruneStaleMarks(marks, shifted.text, shifted.unitAt)).toEqual([]);
  });

  it("keeps a word a chip has replaced its neighbour with, and re-reads its units", () => {
    const { text, unitAt } = buildSpellcheckText([{ text: "teh cat" }]);
    const marks = marksFromRanges(unitAt, text, [{ start: 4, end: 7, word: "cat" }]);

    // The space between the words became a chip. It spends exactly one character, so the string
    // reads the same and "cat" is still at 4 - which is the whole point of the placeholder.
    const withChip = buildSpellcheckText([{ text: "teh" }, { pause: 300 }, { text: "cat" }]);
    expect(withChip.text).toBe("teh cat");
    const kept = pruneStaleMarks(marks, withChip.text, withChip.unitAt);
    expect(kept).toHaveLength(1);
    expect(kept[0].unitStart).toBe(4);
    expect(kept[0].unitEnd).toBe(7);
  });
});

describe("markAtUnit", () => {
  it("answers for a pointer inside the word and at either edge", () => {
    const { text, unitAt } = buildSpellcheckText([{ text: "teh cat" }]);
    const marks = marksFromRanges(unitAt, text, [{ start: 0, end: 3, word: "teh" }]);
    expect(markAtUnit(marks, 0)?.word).toBe("teh");
    expect(markAtUnit(marks, 2)?.word).toBe("teh");
    expect(markAtUnit(marks, 3)?.word).toBe("teh");
    expect(markAtUnit(marks, 5)).toBeNull();
  });
});

describe("underlineBoxes", () => {
  const rect = (left: number, top: number, width: number, height: number): RectLike => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height
  });

  it("moves a viewport rect into the overlay's coordinate space", () => {
    const boxes = underlineBoxes(
      [rect(140, 220, 40, 16)],
      { left: 100, top: 200 },
      { left: 0, top: 0 }
    );
    expect(boxes).toEqual([{ left: 40, top: 35, width: 40 }]);
  });

  it("adds the scroll of the containing block, so the boxes sit in content coordinates", () => {
    const boxes = underlineBoxes(
      [rect(140, 220, 40, 16)],
      { left: 100, top: 200 },
      { left: 5, top: 60 }
    );
    expect(boxes).toEqual([{ left: 45, top: 95, width: 40 }]);
  });

  it("draws one piece per visual line for a word that wrapped", () => {
    const boxes = underlineBoxes(
      [rect(300, 220, 20, 16), rect(100, 240, 18, 16)],
      { left: 100, top: 200 },
      { left: 0, top: 0 }
    );
    expect(boxes).toHaveLength(2);
    expect(boxes[0].left).toBe(200);
    expect(boxes[1].left).toBe(0);
  });

  it("drops the zero-width rect Chromium emits at a run boundary", () => {
    const boxes = underlineBoxes(
      [rect(140, 220, 40, 16), rect(180, 220, 0, 16)],
      { left: 100, top: 200 },
      { left: 0, top: 0 }
    );
    expect(boxes).toHaveLength(1);
  });
});
