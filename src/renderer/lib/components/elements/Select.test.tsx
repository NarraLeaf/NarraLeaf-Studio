// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

afterEach(cleanup);

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" }
];

function openMenu(): void {
  fireEvent.click(screen.getAllByRole("button")[0]!);
}

/**
 * The one behaviour here that cannot be read off the component.
 *
 * A `Select` inside a `<label>` re-opened its menu the moment you picked something: the pick closed
 * the menu, the label's activation behavior then forwarded the same click to its labeled control -
 * the select's own trigger - and the trigger toggled the menu it believed was closed back open. The
 * HTML guard that should have stopped the forward (do nothing for clicks on interactive content
 * inside the label) walks up from the click target looking for the label, and by the time it runs the
 * row it started from has already been unmounted, so the walk never reaches the label.
 *
 * Cancelling the click skips activation behavior outright, which is what makes an ancestor `<label>`
 * harmless. It is asserted here rather than through a rendered `<label>` because jsdom does not model
 * that forwarding at all - a test that mounted one would pass with the fix reverted, which is worse
 * than no test. The cancel IS the fix, so the cancel is what this pins.
 */
describe("Select option activation", () => {
  it("cancels the click, so an ancestor <label> cannot re-open the menu", () => {
    render(<Select options={OPTIONS} value="a" onChange={() => undefined} />);
    openMenu();

    // Attached after the trigger click, so the only event it sees is the pick. The listener sits
    // on `document`, above React's root, which is the same position a `<label>` ancestor would
    // read the canceled flag from.
    const onDocumentClick = vi.fn();
    document.addEventListener("click", onDocumentClick);
    fireEvent.click(screen.getByText("Beta"));
    document.removeEventListener("click", onDocumentClick);

    expect(onDocumentClick).toHaveBeenCalledTimes(1);
    expect(onDocumentClick.mock.calls[0]![0].defaultPrevented).toBe(true);
  });

  it("still reports the pick and closes", () => {
    const onChange = vi.fn();
    render(<Select options={OPTIONS} value="a" onChange={onChange} />);
    openMenu();
    expect(screen.getAllByText("Beta")).toHaveLength(1);

    fireEvent.click(screen.getByText("Beta"));

    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByText("Beta")).toBeNull();
  });

  it("withholds the pick while read-only, and closes anyway", () => {
    const onChange = vi.fn();
    render(<Select options={OPTIONS} value="a" readOnly onChange={onChange} />);
    openMenu();
    // The menu opens so the options can be READ - that is the whole point of the read-only mode.
    expect(screen.getAllByText("Beta")).toHaveLength(1);

    fireEvent.click(screen.getByText("Beta"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Beta")).toBeNull();
  });
});
