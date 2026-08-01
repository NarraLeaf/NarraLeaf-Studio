// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Accordion, AccordionItem } from "./Accordion";

type ResizeCallback = () => void;

let resizeCallbacks: ResizeCallback[] = [];

class FakeResizeObserver {
    constructor(private readonly callback: ResizeCallback) {
        resizeCallbacks.push(callback);
    }
    observe() { /* the fake reports through fireResize() instead */ }
    disconnect() {
        resizeCallbacks = resizeCallbacks.filter(cb => cb !== this.callback);
    }
    unobserve() { /* unused */ }
}

beforeEach(() => {
    resizeCallbacks = [];
    (globalThis as any).ResizeObserver = FakeResizeObserver;
});

afterEach(() => {
    cleanup();
    delete (globalThis as any).ResizeObserver;
});

/** The element whose inline `height` says whether the section is showing its body. */
function heightBoxOf(id: string): HTMLElement {
    const child = screen.getByTestId(`body-${id}`);
    const measured = child.parentElement!;
    return measured.parentElement!;
}

/** jsdom lays nothing out, so the section's body has to be told how tall it is. */
function setMeasuredHeight(id: string, height: number): void {
    const measured = screen.getByTestId(`body-${id}`).parentElement!;
    Object.defineProperty(measured, "scrollHeight", { configurable: true, value: height });
}

/** Every live observer reports — what a scrollbar appearing, or an async load landing, does. */
function fireResize(): void {
    act(() => {
        resizeCallbacks.slice().forEach(cb => cb());
    });
}

function Sections({ initialOpen }: { initialOpen: string[] }) {
    const [openItems, setOpenItems] = useState<string[]>(initialOpen);
    return (
        <Accordion openItems={openItems} onOpenChange={setOpenItems} multiple>
            {["a", "b", "c"].map(id => (
                <AccordionItem key={id} id={id} title={id}>
                    <div data-testid={`body-${id}`}>{id} body</div>
                </AccordionItem>
            ))}
        </Accordion>
    );
}

/**
 * The section's body height is a rendering of `openItems` and nothing else.
 *
 * It stopped being that: the item measures itself whenever its content resizes, and applied the
 * measurement whether or not it was open — so a collapsed section that grew (assets finishing their
 * load, a scrollbar coming or going) ended up displaying its full body while `openItems` still said
 * it was shut. The panel then read as "this header does nothing" (clicking a section that only
 * looked open opens it, which changes nothing on screen) and "clicking one section collapses
 * others" (the first re-render after the click puts every genuinely-closed section back to zero).
 */
describe("AccordionItem height", () => {
    it("keeps a closed section at zero when its content is measured", () => {
        render(<Sections initialOpen={["a"]} />);

        setMeasuredHeight("b", 120);
        setMeasuredHeight("c", 80);
        fireResize();

        expect(heightBoxOf("b").style.height).toBe("0px");
        expect(heightBoxOf("c").style.height).toBe("0px");
    });

    it("leaves the other sections' heights untouched when one is toggled after a resize", () => {
        render(<Sections initialOpen={["a"]} />);

        setMeasuredHeight("a", 200);
        setMeasuredHeight("b", 120);
        setMeasuredHeight("c", 80);
        fireResize();

        const before = { a: heightBoxOf("a").style.height, c: heightBoxOf("c").style.height };

        act(() => {
            fireEvent.click(screen.getAllByRole("button")[1]);
        });

        expect(heightBoxOf("a").style.height).toBe(before.a);
        expect(heightBoxOf("c").style.height).toBe(before.c);
    });
});
