// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryRichRun } from "@shared/types/story";
import { RichTextInput, type RichTextInputHandle } from "./RichTextInput";

/**
 * Accepting a spelling suggestion, as an edit of the row.
 *
 * The correction has to arrive through the same door every other structural edit uses, or it is not
 * really an edit of the document: it would not be undoable, and it would not keep the styling of the
 * word it replaced. Both are asserted here, because both are invisible until somebody presses
 * `Mod+Z` on a bold, coloured word and gets a plain one back - or nothing back at all.
 *
 * Nothing is checked in this test. The field is given no language, so no request is ever made; what
 * is under test is the write, not the checker.
 */

vi.mock("@/lib/app/bridge", () => ({
  getInterface: () => ({
    app: { spellcheck: { check: async () => ({ success: false as const }) } }
  }),
  getPrivilegedInterface: () => ({})
}));

afterEach(cleanup);

function renderField(initialRuns: StoryRichRun[]) {
  const ref = createRef<RichTextInputHandle>();
  const onChange = vi.fn<(value: string, runs: StoryRichRun[]) => void>();
  const view = render(
    <RichTextInput
      ref={ref}
      initialRuns={initialRuns}
      onChange={onChange}
      onShiftEnter={() => {}}
      onEnter={() => {}}
      onExit={() => {}}
      onBlur={() => {}}
    />
  );
  const field = view.container.querySelector<HTMLElement>("[role='textbox']")!;
  const lastRuns = () => onChange.mock.calls.at(-1)?.[1];
  const lastValue = () => onChange.mock.calls.at(-1)?.[0];
  return { ref, onChange, field, lastRuns, lastValue };
}

describe("replaceSpelling", () => {
  it("writes the replacement over the word and leaves the rest of the line alone", () => {
    const field = renderField([{ text: "teh cat sat" }]);

    act(() => field.ref.current!.replaceSpelling(0, 3, "the"));

    expect(field.lastValue()).toBe("the cat sat");
  });

  it("leaves one undoable edit, so Mod+Z gives the author their own spelling back", () => {
    const field = renderField([{ text: "teh cat sat" }]);

    act(() => field.ref.current!.replaceSpelling(0, 3, "the"));
    expect(field.lastValue()).toBe("the cat sat");

    // The row takes Mod+Z itself - Chromium's native stack is destroyed by every rich-text
    // re-render - so the correction only survives as an undo entry if it went through the row's
    // own history, which is the thing being asserted.
    act(() => {
      fireEvent.keyDown(field.field, { key: "z", ctrlKey: true });
    });

    expect(field.lastValue()).toBe("teh cat sat");
  });

  it("keeps the marks the misspelled word carried", () => {
    const field = renderField([
      { text: "the " },
      { text: "wrold", marks: { bold: true, color: "#ff0000" } },
      { text: " turns" }
    ]);

    act(() => field.ref.current!.replaceSpelling(4, 9, "world"));

    expect(field.lastValue()).toBe("the world turns");
    const corrected = field.lastRuns()?.find((run) => "text" in run && run.text === "world");
    // A bare splice would leave the one word the author fixed as a hole in the sentence.
    expect(corrected).toMatchObject({ marks: { bold: true } });
    // The colour survives too, in the form the field reads it back in: `domToRuns` takes it off
    // the rendered span, and a span reports `rgb(...)` whatever it was written with.
    expect((corrected as { marks?: { color?: string } } | undefined)?.marks?.color).toBe(
      "rgb(255, 0, 0)"
    );
  });

  it("refuses an empty replacement and an inverted range rather than eating the row", () => {
    const field = renderField([{ text: "teh cat" }]);

    act(() => field.ref.current!.replaceSpelling(0, 3, ""));
    act(() => field.ref.current!.replaceSpelling(3, 0, "the"));

    expect(field.onChange).not.toHaveBeenCalled();
  });
});
