// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import React, { useEffect, useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "../elements/Modal";
import { resetWindowOverlayHostForTests, windowRootProps } from "./windowOverlayHost";

afterEach(() => {
  cleanup();
  resetWindowOverlayHostForTests();
});

/**
 * A dialog is opened from wherever its caller sits, and callers sit inside panels. `z-50` is only a
 * rank within the nearest stacking context, so a panel with a z-index of its own used to seal the
 * dialog under that panel's rank — and the shell chrome that outranks panel content, the dock seams
 * at 15, then painted across the dialog. The fix is where the layer is MOUNTED, so that is what
 * these assert: never under the caller, always under the window root (so the title bar still wins).
 */
describe("window overlay host", () => {
  it("mounts a dialog outside the panel that opened it", () => {
    const { getByText } = render(
      <div {...windowRootProps}>
        <div data-testid="panel" className="z-10">
          <Modal isOpen onClose={() => undefined} title="Install">
            <p>terms</p>
          </Modal>
        </div>
      </div>
    );

    const panel = document.querySelector('[data-testid="panel"]')!;
    expect(panel.contains(getByText("terms"))).toBe(false);
  });

  it("mounts it inside the window root, where the title bar still outranks it", () => {
    render(
      <div {...windowRootProps} data-testid="root">
        <div className="z-10">
          <Modal isOpen onClose={() => undefined} title="Install">
            <p>terms</p>
          </Modal>
        </div>
      </div>
    );

    const root = document.querySelector('[data-testid="root"]')!;
    const layer = document.querySelector(".nl-window-content-layer")!;
    expect(root.contains(layer)).toBe(true);
    expect(layer.closest("[data-nl-window-overlay-host]")).not.toBeNull();
  });

  it("shares one host across dialogs rather than adding one per dialog", () => {
    render(
      <div {...windowRootProps}>
        <Modal isOpen onClose={() => undefined} title="One">
          <p>one</p>
        </Modal>
        <Modal isOpen onClose={() => undefined} title="Two">
          <p>two</p>
        </Modal>
      </div>
    );

    expect(document.querySelectorAll("[data-nl-window-overlay-host]")).toHaveLength(1);
  });

  /**
   * The regression that made this a hook rather than a deferred lookup: a dialog opened in the
   * same render pass as the shell around it still has to be able to take focus on mount. The paste
   * wizard does exactly that, and `focus()` on a node that is not in the document does nothing —
   * which would leave Escape reaching the row underneath and committing it.
   */
  it("has the dialog in the document by the time its mount effects run", () => {
    let focusedOnMount: Element | null = null;

    function FocusOnMount() {
      const ref = useRef<HTMLButtonElement | null>(null);
      useEffect(() => {
        ref.current?.focus();
        focusedOnMount = document.activeElement;
      }, []);
      return (
        <button ref={ref} type="button">
          inside
        </button>
      );
    }

    render(
      <div {...windowRootProps}>
        <Modal isOpen onClose={() => undefined} title="Install">
          <FocusOnMount />
        </Modal>
      </div>
    );

    expect((focusedOnMount as HTMLElement | null)?.textContent).toBe("inside");
  });

  it("falls back to the document body when the shell carries no marker", () => {
    const { getByText } = render(
      <div data-testid="unmarked">
        <Modal isOpen onClose={() => undefined} title="Install">
          <p>terms</p>
        </Modal>
      </div>
    );

    const unmarked = document.querySelector('[data-testid="unmarked"]')!;
    expect(unmarked.contains(getByText("terms"))).toBe(false);
    expect(document.querySelector("[data-nl-window-overlay-host]")!.parentElement).toBe(
      document.body
    );
  });
});
