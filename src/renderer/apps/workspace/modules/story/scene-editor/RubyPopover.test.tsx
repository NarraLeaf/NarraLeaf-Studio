// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RubyPopover } from "./RubyPopover";

afterEach(cleanup);

const ANCHOR = { top: 100, left: 100, bottom: 120 };

/**
 * The popover as the toolbar mounts it: a trigger button, and the popover pointed back at it.
 * The trigger has to be a real element in the document, because what is under test is which
 * pointerdowns count as "outside".
 */
function renderPopover(overrides: Partial<React.ComponentProps<typeof RubyPopover>> = {}) {
  const onCommit = vi.fn<(ruby: string | null) => void>();
  const onRemove = vi.fn();
  const onClose = vi.fn();

  function Harness() {
    const anchorRef = useRef<HTMLButtonElement | null>(null);
    return (
      <>
        <button type="button" ref={anchorRef} data-testid="trigger">
          ruby
        </button>
        <button type="button" data-testid="elsewhere">
          elsewhere
        </button>
        <RubyPopover
          anchor={ANCHOR}
          anchorRef={anchorRef}
          onCommit={onCommit}
          onRemove={onRemove}
          onClose={onClose}
          {...overrides}
        />
      </>
    );
  }

  const view = render(<Harness />);
  return { view, onCommit, onRemove, onClose };
}

function field(): HTMLInputElement {
  return screen.getByRole("textbox") as HTMLInputElement;
}

describe("RubyPopover", () => {
  it("stays open when the pointer goes down on the button that opened it", () => {
    // The trigger closes the popover through its own handler. If light dismiss closed it first,
    // that handler would find the popover already gone and open a second one.
    const { onClose } = renderPopover();
    fireEvent.mouseDown(screen.getByTestId("trigger"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the pointer goes down anywhere else", () => {
    const { onClose } = renderPopover();
    fireEvent.mouseDown(screen.getByTestId("elsewhere"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("carries the draft out when it is taken down without settling", () => {
    const { view, onCommit } = renderPopover();
    fireEvent.change(field(), { target: { value: "  かんじ  " } });
    view.unmount();
    expect(onCommit).toHaveBeenCalledWith("かんじ");
  });

  it("reports an emptied field as a removal rather than an empty reading", () => {
    const { view, onCommit } = renderPopover({ value: "かんじ" });
    fireEvent.change(field(), { target: { value: "   " } });
    view.unmount();
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("writes nothing after Escape - that exit has already decided the outcome", () => {
    const { view, onCommit, onClose } = renderPopover();
    fireEvent.change(field(), { target: { value: "かんじ" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("writes nothing after Remove, which has written its own outcome", () => {
    const { view, onCommit, onRemove } = renderPopover({ value: "かんじ" });
    fireEvent.click(screen.getByRole("button", { name: /remove ruby/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("offers Remove only when there is a reading to remove", () => {
    renderPopover();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });
});
