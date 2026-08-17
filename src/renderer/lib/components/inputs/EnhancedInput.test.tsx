// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EnhancedInput } from "./EnhancedInput";

const noop = (): void => undefined;

/**
 * jsdom reports every element as zero-width, so a component allowed to collapse below
 * `popoverThreshold` collapses on its first measurement — which is the state under test.
 * Each case therefore renders the trigger, never the input, unless it opens the popover.
 */
describe("EnhancedInput collapsed trigger", () => {
    afterEach(() => {
        cleanup();
    });

    /**
     * The name has to be on the trigger itself. A test that opened the popover first would
     * find the inner input's name and prove nothing about the button left in the layout.
     */
    it("is reachable by its accessible name before the popover is opened", () => {
        render(
            <EnhancedInput value="42" onChange={noop} popoverWhenNarrow aria-label="Position X" />
        );

        expect(screen.queryByRole("textbox")).toBeNull();
        expect(screen.getByRole("button", { name: "Position X" })).toBeTruthy();
    });

    /**
     * A value-bearing field must answer to the same name as an empty one; naming the trigger
     * after its own contents would lose the control the moment the value changed.
     */
    it("falls back to the placeholder when the caller gave no label", () => {
        render(<EnhancedInput value="42" onChange={noop} popoverWhenNarrow placeholder="Scale" />);

        expect(screen.getByRole("button", { name: "Scale" })).toBeTruthy();
    });

    it("carries the label through to the input once the popover is open", () => {
        render(
            <EnhancedInput value="42" onChange={noop} popoverWhenNarrow aria-label="Position X" />
        );
        fireEvent.click(screen.getByRole("button", { name: "Position X" }));

        expect(screen.getByRole("textbox", { name: "Position X" })).toBeTruthy();
    });

    it("adds no label attribute of its own when there is neither", () => {
        render(<EnhancedInput value="" onChange={noop} popoverWhenNarrow />);

        const trigger = screen.getByRole("button");
        expect(trigger.hasAttribute("aria-label")).toBe(false);
        expect(trigger.hasAttribute("aria-labelledby")).toBe(false);
    });
});
