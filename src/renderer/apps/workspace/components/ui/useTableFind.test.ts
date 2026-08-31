// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTableFind } from "./useTableFind";

/** A windowed list of four entries with a group header in front of them, as both tables build one. */
const ITEMS: (string | null)[] = [
    null,
    "Alice\nCome in, come in.",
    "Bob\nThe door is open.",
    null,
    "Alice\nCome back tomorrow.",
    "Bob\nGoodbye.",
];

/** Everything the table holds before its filter: the four on the page plus two it is holding back. */
const UNFILTERED = [
    "Alice\nCome in, come in.",
    "Bob\nThe door is open.",
    "Alice\nCome back tomorrow.",
    "Bob\nGoodbye.",
    "Alice\nCome along.",
    "Bob\nCome here.",
];

function mount(options: { items?: (string | null)[]; unfiltered?: string[] } = {}) {
    const items = options.items ?? ITEMS;
    const unfiltered = options.unfiltered ?? UNFILTERED;
    const getItemText = vi.fn((index: number) => items[index] ?? null);
    const view = renderHook(() => useTableFind({
        itemCount: items.length,
        getItemText,
        getUnfilteredTexts: () => unfiltered,
    }));
    return { ...view, getItemText };
}

describe("useTableFind", () => {
    it("reads nothing while it is closed", () => {
        const { result, getItemText } = mount();

        act(() => result.current.setQuery("Come"));

        // The tables reach tens of thousands of rows and this hook is mounted in both of them for
        // as long as the tab is open, so a closed find that still swept would charge every table a
        // pass over every row for a query nobody can see.
        expect(getItemText).not.toHaveBeenCalled();
        expect(result.current.matchCount).toBe(0);
    });

    it("counts one hit per entry, however often the entry says it", () => {
        const { result } = mount();

        act(() => result.current.openFind());
        act(() => result.current.setQuery("come"));

        // "Come in, come in." says it twice and is still one place to navigate to.
        expect(result.current.matchCount).toBe(2);
        expect(result.current.activeMatch).toBe(1);
        expect(result.current.activeIndex).toBe(1);
    });

    it("steps through the hits and wraps at both ends", () => {
        const { result } = mount();

        act(() => result.current.openFind());
        act(() => result.current.setQuery("come"));

        act(() => result.current.step(1));
        expect(result.current.activeIndex).toBe(4);
        act(() => result.current.step(1));
        expect(result.current.activeIndex).toBe(1);
        act(() => result.current.step(-1));
        expect(result.current.activeIndex).toBe(4);
    });

    it("says how many hits the filter is holding off the page", () => {
        const { result } = mount();

        act(() => result.current.openFind());
        act(() => result.current.setQuery("come"));

        // Four in the table, two of them on the page. Without this the overlay would answer "2" for
        // a term the author knows appears twice as often, and blame nothing for the difference.
        expect(result.current.hiddenCount).toBe(2);
    });

    it("reads an unfinished pattern as no results rather than throwing", () => {
        const { result } = mount();

        act(() => result.current.openFind());
        act(() => result.current.toggleRegex());
        act(() => result.current.setQuery("Come ("));

        expect(result.current.invalidPattern).toBe(true);
        expect(result.current.matchCount).toBe(0);
        expect(result.current.hiddenCount).toBe(0);
    });

    it("matches whole words the way the rest of the app does", () => {
        const { result } = mount();

        act(() => result.current.openFind());
        act(() => result.current.toggleWholeWord());
        act(() => result.current.setQuery("come"));

        // "come" whole-word still matches both lines; "com" no longer matches anything.
        expect(result.current.matchCount).toBe(2);
        act(() => result.current.setQuery("com"));
        expect(result.current.matchCount).toBe(0);
    });

    it("does not leave the cursor past the end when the result set shrinks", () => {
        const { result } = mount();

        act(() => result.current.openFind());
        act(() => result.current.setQuery("come"));
        act(() => result.current.step(1));
        expect(result.current.activeMatch).toBe(2);

        // Narrowing to one hit while the cursor is on the second must land on the survivor, not on
        // an index that no longer exists.
        act(() => result.current.setQuery("come back"));
        expect(result.current.matchCount).toBe(1);
        expect(result.current.activeMatch).toBe(1);
        expect(result.current.activeIndex).toBe(4);
    });
});
