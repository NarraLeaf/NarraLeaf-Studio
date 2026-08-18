// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEscapeToClose } from "./Modal";

afterEach(cleanup);

function Dialog(props: { active: boolean; onClose: () => void; children?: React.ReactNode }) {
  useEscapeToClose(props.active, props.onClose);
  return <div>{props.children}</div>;
}

function pressEscape(target: EventTarget = document) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

/**
 * The keystroke every dialog is expected to answer, and which the asset picker and the thumbnail
 * cropper did not - they position against a trigger instead of centring, so neither is a `Modal`,
 * and neither inherited any of a `Modal`'s keyboard behaviour. This is the definition both now share
 * with `Modal` itself.
 */
describe("useEscapeToClose", () => {
  it("closes on Escape while the dialog is open", () => {
    const onClose = vi.fn();
    render(<Dialog active onClose={onClose} />);

    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const onClose = vi.fn();
    render(<Dialog active onClose={onClose} />);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Esc", bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("listens only while open, and lets go on unmount", () => {
    const onClose = vi.fn();
    const view = render(<Dialog active={false} onClose={onClose} />);

    pressEscape();
    expect(onClose).not.toHaveBeenCalled();

    view.rerender(<Dialog active onClose={onClose} />);
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);

    view.unmount();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * The carve-out that keeps this from swallowing a nested surface's own Escape: the listener sits
   * on the bubble phase, so anything inside that means to answer the key first - a menu that would
   * otherwise be left open above a closed dialog - keeps precedence by stopping propagation.
   */
  it("yields to a nested handler that consumes the key", () => {
    const onClose = vi.fn();
    const view = render(
      <Dialog active onClose={onClose}>
        <button data-testid="nested" onKeyDown={(event) => event.stopPropagation()} />
      </Dialog>
    );

    pressEscape(view.getByTestId("nested"));

    expect(onClose).not.toHaveBeenCalled();
  });
});
