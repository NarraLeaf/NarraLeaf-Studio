// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostWindowProvider, useFloatingLayer } from "@/lib/components/layout";
import { Modal } from "./Modal";

/**
 * A press on a dialog's backdrop while a picker is open above the dialog is the press that closes
 * the picker. Its click closed the dialog as well: New Character, with its name typed and a colour
 * being chosen, was cancelled by the gesture that only meant to put the colour picker away.
 */

afterEach(cleanup);

/** A picker as `ColorPickerField` is one: a floating layer that closes on any press outside it. */
function Picker(props: { onClose: () => void }) {
    const panelRef = useRef<HTMLDivElement | null>(null);
    useFloatingLayer({ open: true, onClose: props.onClose, panelRef });
    useEffect(() => {
        const outside = (event: MouseEvent) => {
            if (!panelRef.current?.contains(event.target as Node)) {
                props.onClose();
            }
        };
        document.addEventListener("mousedown", outside, true);
        return () => document.removeEventListener("mousedown", outside, true);
    }, [props]);
    return createPortal(<div ref={panelRef} tabIndex={-1}>picker</div>, document.body);
}

function Dialog(props: { onClose: () => void }) {
    const [picker, setPicker] = useState(false);
    return (
        <Modal isOpen onClose={props.onClose} title="New character">
            <input aria-label="name" />
            <button type="button" onClick={() => setPicker(true)}>colour</button>
            {picker ? <Picker onClose={() => setPicker(false)} /> : null}
        </Modal>
    );
}

function pressBackdrop(): void {
    const backdrop = document.querySelector<HTMLElement>(".bg-black\\/60")!;
    act(() => {
        fireEvent.pointerDown(backdrop);
        fireEvent.mouseDown(backdrop);
        fireEvent.mouseUp(backdrop);
        fireEvent.click(backdrop);
    });
}

describe("a dialog's backdrop", () => {
    it("closes the picker above the dialog, and not the dialog", () => {
        const onClose = vi.fn();
        const view = render(<Dialog onClose={onClose} />);
        // Opened from inside the dialog, as the colour swatch opens its picker.
        fireEvent.click(view.getByText("colour"));
        expect(document.body.textContent).toContain("picker");
        pressBackdrop();
        expect(onClose).not.toHaveBeenCalled();
        expect(document.body.textContent).not.toContain("picker");
        // The next press, with nothing above the dialog, closes it.
        pressBackdrop();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes the dialog when nothing is open above it", () => {
        const onClose = vi.fn();
        render(<Dialog onClose={onClose} />);
        pressBackdrop();
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe("modal scroll locking", () => {
    it("keeps the background locked until the last open dialog closes", () => {
        document.body.style.overflow = "auto";
        const dialogs = (outer: boolean, inner: boolean) => (
            <>
                <Modal isOpen={outer} onClose={() => undefined} title="Parent">parent</Modal>
                <Modal isOpen={inner} onClose={() => undefined} title="Child">child</Modal>
            </>
        );
        const view = render(dialogs(true, false));
        expect(document.body.style.overflow).toBe("hidden");

        view.rerender(dialogs(true, true));
        view.rerender(dialogs(true, false));
        expect(document.body.style.overflow).toBe("hidden");

        view.rerender(dialogs(false, false));
        expect(document.body.style.overflow).toBe("auto");
        view.unmount();
        document.body.style.overflow = "";
    });

    it("does not unlock another dialog when a closed dialog unmounts", () => {
        const view = render(
            <>
                <Modal isOpen onClose={() => undefined}>open</Modal>
                <Modal isOpen={false} onClose={() => undefined}>closed</Modal>
            </>,
        );
        view.rerender(<Modal isOpen onClose={() => undefined}>open</Modal>);
        expect(document.body.style.overflow).toBe("hidden");
    });

    it("keeps scroll locks independent between windows", () => {
        const frame = document.createElement("iframe");
        document.body.appendChild(frame);
        const hostWindow = frame.contentWindow!;
        const doc = hostWindow.document;
        document.body.style.overflow = "auto";
        doc.body.style.overflow = "scroll";
        const dialogs = (mainOpen: boolean, detachedOpen: boolean) => (
            <>
                <Modal isOpen={mainOpen} onClose={() => undefined}>main</Modal>
                {createPortal(
                    <HostWindowProvider window={hostWindow} windowKey="detached">
                        <Modal isOpen={detachedOpen} onClose={() => undefined}>detached</Modal>
                    </HostWindowProvider>,
                    doc.body,
                )}
            </>
        );
        const view = render(dialogs(true, true));
        expect(document.body.style.overflow).toBe("hidden");
        expect(doc.body.style.overflow).toBe("hidden");

        view.rerender(dialogs(false, true));
        expect(document.body.style.overflow).toBe("auto");
        expect(doc.body.style.overflow).toBe("hidden");
        view.rerender(dialogs(false, false));
        expect(doc.body.style.overflow).toBe("scroll");

        view.unmount();
        frame.remove();
        document.body.style.overflow = "";
    });
});
