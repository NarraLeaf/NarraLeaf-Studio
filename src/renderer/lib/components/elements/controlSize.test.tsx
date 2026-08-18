// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button, IconButton } from "./Button";
import { Input } from "./Input";
import { Select } from "./Select";
import { ToolbarButton } from "./ToolbarButton";
import { CONTROL_SIZE_CLASS, CONTROL_SQUARE_CLASS, type ControlSize } from "./controlSize";

/**
 * A button, a field and a dropdown asking for the same `size` must come out the
 * same height.
 *
 * This is pinned in a test rather than left to review because the way it breaks
 * is invisible in a diff: every component derived its own height from padding
 * plus a font size, so `Button` (no border) stood 2px shorter than `Input` (one
 * border) at the same `size`, and `Select` shorter still because its border
 * width was never declared at all. Nobody writes that on purpose - it falls out
 * of one component's class list changing - and it only shows up as a row of
 * controls that will not line up, at which point call sites start nailing
 * heights on by hand. Asserting the rendered class list is the cheapest place to
 * catch it; jsdom computes no layout, so measuring is not an option.
 */

const SIZES: ControlSize[] = ["sm", "md", "lg"];
/** The `min-h-*` each size is supposed to carry. Spelled out, not derived. */
const EXPECTED_FLOOR: Record<ControlSize, string> = {
  sm: "min-h-7",
  md: "min-h-9",
  lg: "min-h-10"
};

afterEach(cleanup);

function classesOf(el: Element | null): string[] {
  return (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

describe("control size scale", () => {
  it.each(SIZES)("%s states one height floor, and it is the documented one", (size) => {
    expect(CONTROL_SIZE_CLASS[size].split(" ")).toContain(EXPECTED_FLOOR[size]);
  });

  it.each(SIZES)("button, input and select agree at %s", (size) => {
    const { unmount: unmountButton } = render(<Button size={size}>label</Button>);
    const buttonClasses = classesOf(screen.getByRole("button"));
    unmountButton();

    const { unmount: unmountInput } = render(<Input size={size} aria-label="field" />);
    const inputClasses = classesOf(screen.getByLabelText("field"));
    unmountInput();

    render(
      <Select size={size} ariaLabel="picker" options={[{ value: "a", label: "a" }]} value="a" />
    );
    const selectClasses = classesOf(screen.getByLabelText("picker"));

    const floor = EXPECTED_FLOOR[size];
    expect(buttonClasses).toContain(floor);
    expect(inputClasses).toContain(floor);
    expect(selectClasses).toContain(floor);
  });

  it("the select trigger draws the border its variant colours assume", () => {
    // `border-edge-strong` sets a colour; without a width utility preflight leaves the border at
    // 0 and the trigger renders as a flat fill - which is exactly how it shipped.
    render(<Select ariaLabel="picker" options={[{ value: "a", label: "a" }]} value="a" />);
    const classes = classesOf(screen.getByLabelText("picker"));
    expect(classes).toContain("border");
    expect(classes).toContain("border-edge-strong");
  });

  it("the square controls use the same scale as the text-height ones", () => {
    for (const size of SIZES) {
      const height = EXPECTED_FLOOR[size].replace("min-h-", "h-");
      expect(CONTROL_SQUARE_CLASS[size].split(" ")).toContain(height);
    }
  });

  it.each(SIZES)("icon and toolbar buttons are square at %s", (size) => {
    const { unmount } = render(<IconButton size={size} aria-label="icon" />);
    const iconClasses = classesOf(screen.getByLabelText("icon"));
    unmount();

    render(<ToolbarButton size={size} aria-label="tool" />);
    const toolClasses = classesOf(screen.getByLabelText("tool"));

    for (const cls of CONTROL_SQUARE_CLASS[size].split(" ")) {
      expect(iconClasses).toContain(cls);
      expect(toolClasses).toContain(cls);
    }
  });
});
