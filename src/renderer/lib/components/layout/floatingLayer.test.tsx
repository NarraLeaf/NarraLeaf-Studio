// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLOATING_OWN_KEYS_ATTRIBUTE, openFloatingLayerCount, useFloatingLayer, type FloatingFocusScope } from "./floatingLayer";

/**
 * The contract every floating layer keeps (see `useFloatingLayer`): focus moves in on open, Escape
 * closes the topmost layer and nothing under it - including a React ancestor the layer was portalled
 * out of - focus comes back on close, and focus leaving a popover closes it.
 */

afterEach(cleanup);

function Popover(props: {
    scope?: FloatingFocusScope;
    onClose?: () => void;
    initiallyOpen?: boolean;
    children?: React.ReactNode;
    portal?: boolean;
}) {
    const [open, setOpen] = useState(props.initiallyOpen ?? false);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const close = () => {
        props.onClose?.();
        setOpen(false);
    };
    useFloatingLayer({
        open,
        onClose: close,
        panelRef,
        ownerRefs: [triggerRef],
        scope: props.scope,
        itemSelector: "[data-item]",
    });
    const panel = open ? (
        <div ref={panelRef} data-testid="panel">
            {props.children ?? (
                <>
                    <button data-item="" data-testid="a">A</button>
                    <button data-item="" data-testid="b" aria-selected="true">B</button>
                    <button data-item="" data-testid="c" onClick={close}>C</button>
                </>
            )}
        </div>
    ) : null;
    return (
        <>
            <button ref={triggerRef} data-testid="trigger" onClick={() => setOpen(value => !value)}>open</button>
            <button data-testid="after">after</button>
            {panel && (props.portal === false ? panel : createPortal(panel, document.body))}
        </>
    );
}

function press(key: string, init: KeyboardEventInit = {}) {
    const target = document.activeElement ?? document.body;
    fireEvent.keyDown(target, { key, ...init });
}

function openFromTrigger(view: ReturnType<typeof render>) {
    const trigger = view.getByTestId("trigger");
    trigger.focus();
    fireEvent.click(trigger);
}

describe("a popover", () => {
    it("moves focus onto the current item when it opens", () => {
        const view = render(<Popover />);
        openFromTrigger(view);
        expect(document.activeElement).toBe(view.getByTestId("b"));
    });

    it("prefers a search field over the items", () => {
        const view = render(
            <Popover>
                <input data-testid="search" />
                <button data-item="">A</button>
            </Popover>,
        );
        openFromTrigger(view);
        expect(document.activeElement).toBe(view.getByTestId("search"));
    });

    it("walks its items with the arrows, and from the search field into the list and back", () => {
        const view = render(
            <Popover>
                <input data-testid="search" />
                <button data-item="" data-testid="a">A</button>
                <button data-item="" data-testid="b">B</button>
            </Popover>,
        );
        openFromTrigger(view);
        press("ArrowDown");
        expect(document.activeElement).toBe(view.getByTestId("a"));
        press("ArrowDown");
        expect(document.activeElement).toBe(view.getByTestId("b"));
        press("ArrowDown");
        expect(document.activeElement).toBe(view.getByTestId("a"));
        press("ArrowUp");
        expect(document.activeElement).toBe(view.getByTestId("search"));
        press("End");
        expect(document.activeElement).toBe(view.getByTestId("search"));
    });

    it("closes on Escape and gives focus back to the trigger", () => {
        const view = render(<Popover />);
        openFromTrigger(view);
        press("Escape");
        expect(view.queryByTestId("panel")).toBeNull();
        expect(document.activeElement).toBe(view.getByTestId("trigger"));
    });

    it("gives focus back to the trigger after a pick unmounts the focused item", () => {
        const view = render(<Popover />);
        openFromTrigger(view);
        const c = view.getByTestId("c");
        c.focus();
        fireEvent.pointerDown(c);
        fireEvent.click(c);
        expect(view.queryByTestId("panel")).toBeNull();
        expect(document.activeElement).toBe(view.getByTestId("trigger"));
    });

    it("keeps Escape from a React ancestor it was portalled out of", () => {
        const ancestor = vi.fn();
        const view = render(
            <div onKeyDown={event => event.key === "Escape" && ancestor()}>
                <Popover />
            </div>,
        );
        openFromTrigger(view);
        press("Escape");
        expect(view.queryByTestId("panel")).toBeNull();
        expect(ancestor).not.toHaveBeenCalled();
    });

    it("lets a control that owns its keys answer Escape first", () => {
        const own = vi.fn((event: React.KeyboardEvent) => {
            if (event.key === "Escape") event.stopPropagation();
        });
        const view = render(
            <Popover>
                <input data-testid="rename" {...{ [FLOATING_OWN_KEYS_ATTRIBUTE]: "" }} onKeyDown={own} />
            </Popover>,
        );
        openFromTrigger(view);
        press("Escape");
        expect(own).toHaveBeenCalledTimes(1);
        expect(view.queryByTestId("panel")).not.toBeNull();
    });

    it("closes when focus moves somewhere else, and does not pull it back", () => {
        const view = render(<Popover />);
        openFromTrigger(view);
        const after = view.getByTestId("after");
        fireEvent.pointerDown(after);
        act(() => after.focus());
        expect(view.queryByTestId("panel")).toBeNull();
        expect(document.activeElement).toBe(after);
    });

    it("stays open when focus goes back to its own trigger", () => {
        const view = render(<Popover />);
        openFromTrigger(view);
        act(() => view.getByTestId("trigger").focus());
        expect(view.queryByTestId("panel")).not.toBeNull();
    });

    it("hands Tab on to the control after its trigger, not to the end of the document", () => {
        const view = render(<Popover />);
        openFromTrigger(view);
        view.getByTestId("c").focus();
        press("Tab");
        expect(view.queryByTestId("panel")).toBeNull();
        expect(document.activeElement).toBe(view.getByTestId("after"));
    });

    it("leaves the stack when it closes", () => {
        const view = render(<Popover />);
        openFromTrigger(view);
        expect(openFloatingLayerCount(document)).toBe(1);
        press("Escape");
        expect(openFloatingLayerCount(document)).toBe(0);
    });
});

describe("stacked layers", () => {
    it("Escape closes only the topmost", () => {
        const outerClose = vi.fn();
        const view = render(
            <Popover scope="trap" initiallyOpen onClose={outerClose}>
                <Popover />
            </Popover>,
        );
        const triggers = view.getAllByTestId("trigger");
        const inner = triggers[1];
        inner.focus();
        fireEvent.click(inner);
        expect(view.getAllByTestId("panel")).toHaveLength(2);

        press("Escape");
        expect(view.getAllByTestId("panel")).toHaveLength(1);
        expect(outerClose).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(inner);

        press("Escape");
        expect(outerClose).toHaveBeenCalledTimes(1);
    });
});

describe("a dialog", () => {
    it("keeps Tab inside itself", () => {
        const view = render(
            <Popover scope="trap">
                <button data-testid="first">first</button>
                <button data-testid="last">last</button>
            </Popover>,
        );
        openFromTrigger(view);
        // A dialog starts on its own box, not on a button Enter would press.
        expect(document.activeElement).toBe(view.getByTestId("panel"));
        view.getByTestId("last").focus();
        press("Tab");
        expect(document.activeElement).toBe(view.getByTestId("first"));
        press("Tab", { shiftKey: true });
        expect(document.activeElement).toBe(view.getByTestId("last"));
    });

    it("does not close when focus is moved behind it", () => {
        const view = render(<Popover scope="trap" />);
        openFromTrigger(view);
        act(() => view.getByTestId("after").focus());
        expect(view.queryByTestId("panel")).not.toBeNull();
    });
});
