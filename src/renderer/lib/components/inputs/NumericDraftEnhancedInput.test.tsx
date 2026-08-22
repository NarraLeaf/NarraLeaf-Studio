// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NumericDraftEnhancedInput } from "./NumericDraftEnhancedInput";

/**
 * When a typed number becomes an edit.
 *
 * `120` is one decision and three keystrokes, and this field used to hand over all three. Every call
 * site paid for that in undo entries; the weather parameters paid for it in encoders, since each
 * prefix describes a different clip to go and make. So the timing is now the caller's to choose, and
 * these are the two answers.
 *
 * jsdom measures every element as zero-width, so the field collapses to its popover trigger unless
 * `popoverWhenNarrow` is off - which is what both real call sites pass anyway.
 */
function renderField(props: Partial<Parameters<typeof NumericDraftEnhancedInput>[0]> = {}) {
    const commit = vi.fn();
    const draft = vi.fn();
    const empty = vi.fn();
    render(
        <NumericDraftEnhancedInput
            committedDisplay="160"
            onFiniteNumber={commit}
            onDraftNumber={draft}
            onEmpty={empty}
            popoverWhenNarrow={false}
            aria-label="Density"
            {...props}
        />,
    );
    const field = () => screen.getByRole("textbox") as HTMLInputElement;
    return { commit, draft, empty, field, type: (text: string) => fireEvent.change(field(), { target: { value: text } }) };
}

describe("NumericDraftEnhancedInput", () => {
    afterEach(() => {
        cleanup();
    });

    it("hands over every keystroke by default, which is what a live preview is wired to", () => {
        // The eight call sites that say nothing about timing must keep behaving exactly as they did.
        const { commit, type } = renderField();

        type("1");
        type("12");
        type("120");

        expect(commit.mock.calls.map(call => call[0])).toEqual([1, 12, 120]);
    });

    it("waits for the field to be left when the caller asks it to", () => {
        const { commit, field, type } = renderField({ commitOn: "blur" });

        type("1");
        type("12");
        type("120");
        expect(commit).not.toHaveBeenCalled();
        // The digits are still on screen while they are being typed.
        expect(field().value).toBe("120");

        fireEvent.blur(field());
        expect(commit.mock.calls.map(call => call[0])).toEqual([120]);
    });

    it("commits on Enter without giving up the caret", () => {
        const { commit, field, type } = renderField({ commitOn: "blur" });

        type("40");
        fireEvent.keyDown(field(), { key: "Enter" });
        expect(commit.mock.calls.map(call => call[0])).toEqual([40]);

        // Still the same field, and a second figure is a second edit rather than a correction.
        type("41");
        fireEvent.blur(field());
        expect(commit.mock.calls.map(call => call[0])).toEqual([40, 41]);
    });

    it("says nothing when the field is left untouched", () => {
        // Tabbing through a row must not rewrite the value it passed over.
        const { commit, empty, field } = renderField({ commitOn: "blur" });

        fireEvent.focus(field());
        fireEvent.blur(field());

        expect(commit).not.toHaveBeenCalled();
        expect(empty).not.toHaveBeenCalled();
    });

    it("reports what is being typed so a control beside it can follow", () => {
        // The slider shares this figure. Without it the thumb would stand at the committed number
        // while the box printed another one, which is the state the shared draft exists to prevent.
        const { commit, draft, type } = renderField({ commitOn: "blur" });

        type("1");
        type("18");

        expect(draft.mock.calls.map(call => call[0])).toEqual([1, 18]);
        expect(commit).not.toHaveBeenCalled();
    });

    it("reports an emptied field once, at the end", () => {
        const { commit, empty, field, type } = renderField({ commitOn: "blur" });

        type("");
        expect(empty).not.toHaveBeenCalled();

        fireEvent.blur(field());
        expect(empty).toHaveBeenCalledTimes(1);
        expect(commit).not.toHaveBeenCalled();
    });
});
