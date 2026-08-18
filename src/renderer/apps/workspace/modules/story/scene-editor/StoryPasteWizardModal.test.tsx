// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React, { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Character } from "@/lib/workspace/services/character/Character";
import type {
  PastePlan,
  SpeakerMappingTarget,
  StoryPasteMemory
} from "@/lib/story/paste/storyPasteTypes";
import { StoryPasteWizardModal } from "./StoryPasteWizardModal";

afterEach(cleanup);

const EMPTY_MEMORY: StoryPasteMemory = { version: 1, speakers: {}, separators: [] };

/** Two speakers, so one can be touched and the other left exactly as the wizard computed it. */
const SCRIPT = ["林：走吧。", "早苗：等一下。", "外面还在下雨。", "林：快点。"].join("\n");

function character(id: string, name: string, nicknames: string[] = []): Character {
  return {
    profile: {
      getId: () => id,
      getName: () => name,
      getNicknames: () => nicknames
    }
  } as unknown as Character;
}

function renderWizard(overrides: Partial<React.ComponentProps<typeof StoryPasteWizardModal>> = {}) {
  const onConfirm =
    vi.fn<(plan: PastePlan, mappings: Record<string, SpeakerMappingTarget>) => void>();
  const onCancel = vi.fn();
  const view = render(
    <StoryPasteWizardModal
      open
      text={SCRIPT}
      inferred={{ kind: "fullwidthColon" }}
      characters={[]}
      memory={EMPTY_MEMORY}
      onSaveSeparator={() => undefined}
      onForgetSeparator={() => undefined}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />
  );
  return { view, onConfirm, onCancel };
}

/**
 * Pick a target for one speaker row, through the same menu the author uses.
 *
 * The option is looked up inside the menu itself: the `Select` menu is portalled onto `<body>` (so it
 * is the last element there), and every trigger already renders the label of whatever it is showing -
 * so "Name only" appears three times on screen and only one of them is a thing to click.
 */
function chooseTarget(label: string, optionText: string): void {
  const row = document.querySelector(`[data-story-paste-speaker="${label}"]`);
  expect(row).not.toBeNull();
  fireEvent.click(within(row as HTMLElement).getAllByRole("button")[0]!);
  const panels = document.body.querySelectorAll(":scope > div");
  fireEvent.click(within(panels[panels.length - 1] as HTMLElement).getByText(optionText));
}

function confirm(): void {
  fireEvent.click(screen.getByText("Paste"));
}

/**
 * What the wizard hands back to be REMEMBERED.
 *
 * Every tally used to be handed over, computed defaults included, and the controller wrote all of them
 * to the per-project memory. Two things followed: a label the author never looked at (including one the
 * inference invented) was recorded forever, and because memory is consulted ahead of the name match, a
 * character created later was permanently shadowed by the "Name only" that had been guessed for it -
 * with no UI anywhere to clear it.
 */
describe("StoryPasteWizardModal mapping memory", () => {
  it("hands back nothing to remember when the author touched nothing", () => {
    const { onConfirm } = renderWizard();

    confirm();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![1]).toEqual({});
  });

  it("hands back only the decision the author actually made", () => {
    const { onConfirm } = renderWizard();

    chooseTarget("早苗", "Not a speaker");
    confirm();

    expect(onConfirm.mock.calls[0]![1]).toEqual({ 早苗: { kind: "notASpeaker" } });
  });

  /**
   * A default is not a decision even when the author opens the menu and picks the same thing back:
   * re-selecting the value already shown says nothing the wizard did not already know.
   */
  it("does not count re-picking the computed default as a decision", () => {
    const { onConfirm } = renderWizard();

    // 早苗 matches no character, so "Name only" is exactly what the row already showed.
    chooseTarget("早苗", "Name only");
    confirm();

    expect(onConfirm.mock.calls[0]![1]).toEqual({});
  });

  /** The plan is unaffected: an untouched label still gets its computed default in the rows. */
  it("still applies the computed default to the rows themselves", () => {
    const { onConfirm } = renderWizard({
      characters: [character("cccccccc-cccc-4ccc-8ccc-ccccccccccc1", "林")]
    });

    confirm();

    const plan = onConfirm.mock.calls[0]![0];
    expect(plan.rows[0]).toEqual({
      kind: "dialogue",
      text: "走吧。",
      characterId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"
    });
    expect(plan.rows[1]).toEqual({ kind: "dialogue", text: "等一下。", speakerName: "早苗" });
  });
});

/**
 * The wizard takes focus, which is what keeps Escape from reaching the surface underneath.
 *
 * `Modal`'s Escape listener is on `document` and bubbles, so whatever holds the caret answers the key
 * first: an insert slot discards its draft, a row being edited *commits* it - a `recordHistory` plus an
 * `updateBlock`, i.e. Escape-to-cancel writing to the document. Moving focus into the dialog is both
 * the a11y-correct behaviour and the fix, and it is scoped to this wizard rather than to `Modal`.
 */
describe("StoryPasteWizardModal focus", () => {
  function Surface(props: { wizard: boolean; onSurfaceKeyDown: () => void; onCancel: () => void }) {
    const caretRef = useRef<HTMLTextAreaElement | null>(null);
    return (
      <div>
        <textarea ref={caretRef} data-testid="caret" onKeyDown={props.onSurfaceKeyDown} />
        {props.wizard ? (
          <StoryPasteWizardModal
            open
            text={SCRIPT}
            inferred={{ kind: "fullwidthColon" }}
            characters={[]}
            memory={EMPTY_MEMORY}
            onSaveSeparator={() => undefined}
            onForgetSeparator={() => undefined}
            onCancel={props.onCancel}
            onConfirm={() => undefined}
          />
        ) : null}
      </div>
    );
  }

  it("takes the caret off the surface underneath, so Escape never reaches it", () => {
    const onSurfaceKeyDown = vi.fn();
    const onCancel = vi.fn();
    const view = render(
      <Surface wizard={false} onSurfaceKeyDown={onSurfaceKeyDown} onCancel={onCancel} />
    );
    const caret = view.getByTestId("caret");
    caret.focus();
    expect(document.activeElement).toBe(caret);

    view.rerender(<Surface wizard onSurfaceKeyDown={onSurfaceKeyDown} onCancel={onCancel} />);

    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(caret);
    expect(
      screen.getByText("Paste as Rows").closest("div[class*='bg-surface-raised']")?.contains(active)
    ).toBe(true);

    fireEvent.keyDown(active, { key: "Escape" });

    expect(onSurfaceKeyDown).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
