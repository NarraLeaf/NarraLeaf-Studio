import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryRichRun } from "@shared/types/story";
import type { SpellcheckRange } from "@shared/types/spellcheck";
import { SpellcheckRunner, type SpellMark } from "./storySpellcheck";

/**
 * The half of spellchecking that is about time rather than about text.
 *
 * A check is debounced and answered over IPC, so there is always a window in which the author is
 * typing and an answer about older text is on its way back. Everything that can go wrong in that
 * window looks identical on screen - a squiggle under a word nobody checked - and none of it is
 * reachable by rendering the field and waiting.
 */

const DEBOUNCE = 400;

type Harness = {
  runner: SpellcheckRunner;
  /** What the field currently holds. Change it the way an author would. */
  setRuns: (runs: StoryRichRun[]) => void;
  /** Answer the oldest outstanding check. */
  answer: (ranges: SpellcheckRange[]) => Promise<void>;
  /** Every set of marks the runner has published, in order. */
  published: SpellMark[][];
  pending: number;
};

function harness(options: { known?: string[] } = {}): Harness {
  let runs: StoryRichRun[] = [];
  const waiting: Array<(ranges: SpellcheckRange[] | null) => void> = [];
  const published: SpellMark[][] = [];
  const known = new Set(options.known ?? []);

  const runner = new SpellcheckRunner({
    check: () => new Promise((resolve) => waiting.push(resolve)),
    readRuns: () => runs,
    isKnownWord: (word) => known.has(word),
    onMarks: (marks) => published.push(marks),
    debounceMs: DEBOUNCE
  });

  return {
    runner,
    published,
    get pending() {
      return waiting.length;
    },
    setRuns: (next) => {
      runs = next;
    },
    answer: async (ranges) => {
      waiting.shift()?.(ranges);
      // Let the runner's own `await` resume before anything is asserted.
      await Promise.resolve();
      await Promise.resolve();
    }
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SpellcheckRunner", () => {
  it("marks what the checker found, once the answer is about the text that was sent", async () => {
    const h = harness();
    h.setRuns([{ text: "teh cat" }]);
    h.runner.setLanguage("en-GB");

    await h.answer([{ start: 0, end: 3, word: "teh" }]);

    expect(h.runner.getMarks()).toEqual([
      { start: 0, end: 3, unitStart: 0, unitEnd: 3, word: "teh" }
    ]);
  });

  it("never paints an answer about text the author has since changed", async () => {
    const h = harness();
    h.setRuns([{ text: "teh cat" }]);
    h.runner.setLanguage("en-GB");
    expect(h.pending).toBe(1);

    // The author fixes the word while the check is in flight. The answer, when it lands, is
    // about a row that no longer exists.
    h.setRuns([{ text: "the cat" }]);
    h.runner.edited([{ text: "the cat" }]);

    await h.answer([{ start: 0, end: 3, word: "teh" }]);

    expect(h.runner.getMarks()).toEqual([]);
    expect(h.published.flat()).toEqual([]);
  });

  it("drops a late answer even when its word is still somewhere in the row", async () => {
    const h = harness();
    h.setRuns([{ text: "teh cat" }]);
    h.runner.setLanguage("en-GB");

    // "teh" survives, but has moved. An answer trusted on its own terms would underline "big".
    h.setRuns([{ text: "big teh cat" }]);
    h.runner.edited([{ text: "big teh cat" }]);

    await h.answer([{ start: 0, end: 3, word: "teh" }]);

    expect(h.runner.getMarks()).toEqual([]);
  });

  it("takes a mark down on the keystroke, not at the end of the next debounce", async () => {
    const h = harness();
    h.setRuns([{ text: "teh cat" }]);
    h.runner.setLanguage("en-GB");
    await h.answer([{ start: 0, end: 3, word: "teh" }]);
    expect(h.runner.getMarks()).toHaveLength(1);

    h.setRuns([{ text: "the cat" }]);
    h.runner.edited([{ text: "the cat" }]);

    // No timer has run and no check has been answered; the underline is already gone.
    expect(h.runner.getMarks()).toEqual([]);
  });

  it("asks once for a burst of typing, when the burst stops", () => {
    const h = harness();
    h.setRuns([{ text: "a" }]);
    h.runner.setLanguage("en-GB");
    // The language change asks straight away; that one is not the burst.
    expect(h.pending).toBe(1);

    for (const text of ["ab", "abc", "abcd"]) {
      h.setRuns([{ text }]);
      h.runner.edited([{ text }]);
      vi.advanceTimersByTime(DEBOUNCE / 2);
    }
    expect(h.pending).toBe(1);

    vi.advanceTimersByTime(DEBOUNCE);
    expect(h.pending).toBe(2);
  });

  it("never marks a word the project spells that way", async () => {
    const h = harness({ known: ["Anyo"] });
    h.setRuns([{ text: "Anyo waits" }]);
    h.runner.setLanguage("en-GB");

    await h.answer([{ start: 0, end: 4, word: "Anyo" }]);

    expect(h.runner.getMarks()).toEqual([]);
  });

  it("clears everything when the language goes away, and asks for nothing", async () => {
    const h = harness();
    h.setRuns([{ text: "teh cat" }]);
    h.runner.setLanguage("en-GB");
    await h.answer([{ start: 0, end: 3, word: "teh" }]);
    expect(h.runner.getMarks()).toHaveLength(1);

    const asked = h.pending;
    h.runner.setLanguage(null);

    expect(h.runner.getMarks()).toEqual([]);
    expect(h.pending).toBe(asked);
  });

  it("ignores an answer that arrives after the field is gone", async () => {
    const h = harness();
    h.setRuns([{ text: "teh cat" }]);
    h.runner.setLanguage("en-GB");
    const before = h.published.length;

    h.runner.dispose();
    await h.answer([{ start: 0, end: 3, word: "teh" }]);

    expect(h.published.length).toBe(before);
  });
});
