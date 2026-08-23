// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCROLLBAR_AUTO_HIDE_TIMING, installScrollbarAutoHide } from "./scrollbarAutoHide";

const { attribute, steps, holdMs, stepMs } = SCROLLBAR_AUTO_HIDE_TIMING;
const [FULL, DIM, FAINT] = steps;

function makeScroller(): HTMLElement {
    const element = document.createElement("div");
    document.body.appendChild(element);
    return element;
}

/** What a scroller actually does — `scroll` does not bubble, but it does capture. */
function scroll(element: HTMLElement): void {
    element.dispatchEvent(new Event("scroll"));
}

/** The attribute as CSS sees it: absent, or one of the fade steps. */
function state(element: HTMLElement): string | null {
    return element.getAttribute(attribute);
}

describe("scrollbarAutoHide", () => {
    beforeEach(() => {
        // `performance` explicitly: the hold is measured with performance.now(), so a clock that
        // only faked timers would step the fade forward without ever letting the hold expire.
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
        installScrollbarAutoHide();
    });

    afterEach(() => {
        // Let every fade run to the end before the clock goes back to real time, so no scroller is
        // left marked - and nothing is left in the module's own bookkeeping - for the next test.
        vi.advanceTimersByTime(holdMs + steps.length * stepMs);
        vi.useRealTimers();
        document.body.innerHTML = "";
    });

    it("shows nothing until something scrolls", () => {
        const element = makeScroller();
        expect(state(element)).toBeNull();
    });

    it("marks the scroller at full strength, then fades it away", () => {
        const element = makeScroller();

        scroll(element);
        expect(state(element)).toBe(FULL);

        vi.advanceTimersByTime(holdMs);
        expect(state(element)).toBe(DIM);

        vi.advanceTimersByTime(stepMs);
        expect(state(element)).toBe(FAINT);

        vi.advanceTimersByTime(stepMs);
        expect(state(element)).toBeNull();
    });

    it("holds at full strength while the scrolling continues", () => {
        const element = makeScroller();

        scroll(element);
        vi.advanceTimersByTime(holdMs - 100);
        scroll(element);

        // The first timer comes due here and must find the hold pushed forward rather than fade.
        vi.advanceTimersByTime(100);
        expect(state(element)).toBe(FULL);

        vi.advanceTimersByTime(holdMs - 100);
        expect(state(element)).toBe(DIM);
    });

    it("returns to full strength when scrolling resumes mid-fade", () => {
        const element = makeScroller();

        scroll(element);
        vi.advanceTimersByTime(holdMs + stepMs);
        expect(state(element)).toBe(FAINT);

        scroll(element);
        expect(state(element)).toBe(FULL);

        // And the fade restarts from the top rather than finishing the one it interrupted.
        vi.advanceTimersByTime(holdMs);
        expect(state(element)).toBe(DIM);
    });

    it("tracks each scroller separately", () => {
        const first = makeScroller();
        const second = makeScroller();

        scroll(first);
        vi.advanceTimersByTime(holdMs);
        scroll(second);

        expect(state(first)).toBe(DIM);
        expect(state(second)).toBe(FULL);
    });

    it("marks the root scroller when the document itself scrolls", () => {
        // The document reports itself, not an element, as the target. jsdom leaves
        // `scrollingElement` unimplemented; in a browser it is the root element.
        Object.defineProperty(document, "scrollingElement", {
            configurable: true,
            value: document.documentElement,
        });

        document.dispatchEvent(new Event("scroll"));
        expect(state(document.documentElement)).toBe(FULL);
    });
});
