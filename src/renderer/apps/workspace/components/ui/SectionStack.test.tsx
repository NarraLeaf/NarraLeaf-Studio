// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SectionStack, StackSection, type SectionStackSizes } from "./SectionStack";

const SECTIONS = [
    { id: "list", minSize: 100, defaultSize: 300 },
    { id: "library", minSize: 50, defaultSize: 100 },
    { id: "actions", minSize: 50, defaultSize: 100 },
];

/** The panel's height; jsdom lays nothing out, so the stack's root reports this one. */
const PANEL_HEIGHT = 700;

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const height = this.hasAttribute("data-section-stack") ? PANEL_HEIGHT : 0;
        return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: height, width: 0, height, toJSON: () => ({}) } as DOMRect;
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function Panel({
    initialOpen = { list: true, library: true, actions: true },
    initialSizes = {},
    onSizes,
}: {
    initialOpen?: Record<string, boolean>;
    initialSizes?: SectionStackSizes;
    onSizes?: (sizes: SectionStackSizes) => void;
}) {
    const [open, setOpen] = useState(initialOpen);
    const [sizes, setSizes] = useState<SectionStackSizes>(initialSizes);
    return (
        <SectionStack
            sections={SECTIONS}
            fillId="list"
            open={open}
            onOpenChange={(id, next) => setOpen(current => ({ ...current, [id]: next }))}
            sizes={sizes}
            onSizesChange={next => {
                setSizes(next);
                onSizes?.(next);
            }}
        >
            <StackSection sectionId="list" title="Interfaces">
                <div>pages</div>
            </StackSection>
            <StackSection sectionId="library" title="Library" count={4} actions={<button type="button">add</button>}>
                <div>components</div>
            </StackSection>
            <StackSection sectionId="actions" title="Actions" count={5}>
                <div>actions</div>
            </StackSection>
        </SectionStack>
    );
}

const bodyHeight = (container: HTMLElement, id: string) =>
    (container.querySelector(`[data-section-body="${id}"]`) as HTMLElement | null)?.style.height ?? null;
const bodyTransition = (container: HTMLElement, id: string) =>
    (container.querySelector(`[data-section-body="${id}"]`) as HTMLElement | null)?.style.transition ?? null;
const toggle = (container: HTMLElement, title: string) =>
    [...container.querySelectorAll("button[aria-expanded]")].find(button => button.textContent?.startsWith(title))!;
/** Lets the frame a section holds still for go by: the bodies set off on the one after it. */
const nextFrame = () =>
    act(() => {
        vi.advanceTimersByTime(20);
    });
const sashes = (container: HTMLElement) => [...container.querySelectorAll('[role="separator"]')] as HTMLElement[];

describe("SectionStack", () => {
    it("lays the open bodies out in the panel's height, the fill section taking the rest", () => {
        const { container } = render(<Panel />);
        // 700 less three 36px headers and two seams.
        expect(bodyHeight(container, "list")).toBe("390px");
        expect(bodyHeight(container, "library")).toBe("100px");
        expect(bodyHeight(container, "actions")).toBe("100px");
    });

    it("folds a section to its header, and the space goes back to the fill section", () => {
        vi.useFakeTimers();
        const { container, getByText } = render(<Panel />);
        fireEvent.click(toggle(container, "Library"));
        expect(toggle(container, "Library").getAttribute("aria-expanded")).toBe("false");
        expect(getByText("4")).toBeTruthy();
        expect(container.textContent).not.toContain("add");
        nextFrame();
        expect(bodyHeight(container, "list")).toBe(`${700 - 108 - 1 - 100}px`);
        // The body shrinks away rather than vanishing, and is gone once it has.
        expect(bodyHeight(container, "library")).toBe("0px");
        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(bodyHeight(container, "library")).toBeNull();
    });

    it("animates every body while a section opens or folds, and at no other time", () => {
        vi.useFakeTimers();
        const { container } = render(<Panel initialOpen={{ list: true, library: false, actions: true }} />);
        expect(bodyTransition(container, "list")).toBe("");

        const listBefore = bodyHeight(container, "list");
        fireEvent.click(toggle(container, "Library"));
        // One frame where everything is still where it was, the opening body at nothing...
        expect(bodyHeight(container, "library")).toBe("0px");
        expect(bodyHeight(container, "list")).toBe(listBefore);
        nextFrame();
        // ...and then the one opening and the ones making room for it move together, so the
        // headers between them slide rather than jump.
        expect(bodyHeight(container, "library")).toBe("100px");
        expect(bodyHeight(container, "list")).not.toBe(listBefore);
        expect(bodyTransition(container, "library")).toContain("height");
        expect(bodyTransition(container, "list")).toContain("height");
        expect(bodyTransition(container, "actions")).toContain("height");

        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(bodyTransition(container, "list")).toBe("");
        expect(bodyTransition(container, "library")).toBe("");
    });

    it("never animates a body under a seam being dragged", () => {
        vi.useFakeTimers();
        const { container } = render(<Panel initialOpen={{ list: true, library: false, actions: true }} />);
        fireEvent.click(toggle(container, "Library"));
        nextFrame();
        const [, between] = sashes(container);
        fireEvent.mouseDown(between!, { clientY: 400 });
        act(() => {
            document.dispatchEvent(new MouseEvent("mousemove", { clientY: 420 }));
        });
        expect(bodyTransition(container, "library")).toBe("");
        expect(bodyTransition(container, "actions")).toBe("");
    });

    it("keeps a folding body out of reach", () => {
        vi.useFakeTimers();
        const { container } = render(<Panel />);
        fireEvent.click(toggle(container, "Actions"));
        const body = container.querySelector('[data-section-body="actions"]') as HTMLElement;
        expect(body.hasAttribute("inert")).toBe(true);
    });

    it("draws a seam that resizes only between open bodies", () => {
        const { container } = render(<Panel initialOpen={{ list: true, library: false, actions: false }} />);
        expect(sashes(container)).toHaveLength(0);
        fireEvent.click(toggle(container, "Actions"));
        // Under the open list, pairing it with the actions past the closed library's header.
        expect(sashes(container)).toHaveLength(1);
    });

    it("moves a seam with the arrow keys and reports every open body's size once", () => {
        const onSizes = vi.fn();
        const { container } = render(<Panel onSizes={onSizes} />);
        const [, between] = sashes(container);
        fireEvent.keyDown(between!, { key: "ArrowDown" });
        expect(onSizes).toHaveBeenCalledTimes(1);
        expect(onSizes).toHaveBeenLastCalledWith({ list: 390, library: 124, actions: 76 });
        expect(bodyHeight(container, "library")).toBe("124px");
        expect(bodyHeight(container, "actions")).toBe("76px");
    });

    it("follows a drag and reports it once, on release, stopping at the lower body's minimum", () => {
        const onSizes = vi.fn();
        const { container } = render(<Panel onSizes={onSizes} />);
        const [, between] = sashes(container);
        fireEvent.mouseDown(between!, { clientY: 400 });
        act(() => {
            document.dispatchEvent(new MouseEvent("mousemove", { clientY: 440 }));
        });
        expect(bodyHeight(container, "library")).toBe("140px");
        expect(onSizes).not.toHaveBeenCalled();
        act(() => {
            document.dispatchEvent(new MouseEvent("mousemove", { clientY: 600 }));
        });
        act(() => {
            document.dispatchEvent(new MouseEvent("mouseup", { clientY: 600 }));
        });
        expect(onSizes).toHaveBeenCalledTimes(1);
        expect(onSizes).toHaveBeenLastCalledWith({ list: 390, library: 150, actions: 50 });
    });

    it("puts the two bodies beside a seam back to their defaults on a double-click", () => {
        const onSizes = vi.fn();
        const { container } = render(<Panel initialSizes={{ list: 390, library: 150, actions: 50 }} onSizes={onSizes} />);
        expect(bodyHeight(container, "library")).toBe("150px");
        const [, between] = sashes(container);
        fireEvent.doubleClick(between!);
        expect(onSizes).toHaveBeenLastCalledWith({ list: 390 });
        expect(bodyHeight(container, "library")).toBe("100px");
        expect(bodyHeight(container, "actions")).toBe("100px");
    });

    it("reports nothing for a press that does not move the seam", () => {
        const onSizes = vi.fn();
        const { container } = render(<Panel onSizes={onSizes} />);
        const [first] = sashes(container);
        fireEvent.mouseDown(first!, { clientY: 300 });
        act(() => {
            document.dispatchEvent(new MouseEvent("mouseup", { clientY: 300 }));
        });
        expect(onSizes).not.toHaveBeenCalled();
    });
});
