// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { MouseEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { useMultiSelection } from "./useMultiSelection";

/** A section holding a folder and three loose files, the way a view would publish it. */
const DRAWN = ["group:g-backdrops", "asset:room", "asset:street", "asset:sky"];

function mouse(modifiers: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {}): MouseEvent {
    return { ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers } as MouseEvent;
}

function panel(onSelectionChange?: (selection: Set<string>) => void) {
    const hook = renderHook(() => useMultiSelection({ ...(onSelectionChange ? { onSelectionChange } : {}) }));
    act(() => hook.result.current.publishRowOrder(DRAWN));
    return hook;
}

function selectionOf(result: { current: { selectedItems: Set<string> } }): string[] {
    return Array.from(result.current.selectedItems);
}

describe("useMultiSelection", () => {
    it("marks one row on a plain click", () => {
        const { result } = panel();

        act(() => result.current.handleItemSelect("room", false, mouse()));

        expect(selectionOf(result)).toEqual(["asset:room"]);
    });

    it("covers the rows the view drew between the two clicks", () => {
        const { result } = panel();

        act(() => result.current.handleItemSelect("room", false, mouse()));
        act(() => result.current.handleItemSelect("sky", false, mouse({ shiftKey: true })));

        expect(selectionOf(result)).toEqual(["asset:room", "asset:street", "asset:sky"]);
    });

    it("ranges backwards from the row the range started at", () => {
        const { result } = panel();

        act(() => result.current.handleItemSelect("sky", false, mouse()));
        act(() => result.current.handleItemSelect("g-backdrops", true, mouse({ shiftKey: true })));

        expect(selectionOf(result)).toEqual(DRAWN);
    });

    it("keeps the row the range started at, so a range can be widened and narrowed", () => {
        const { result } = panel();

        act(() => result.current.handleItemSelect("room", false, mouse()));
        act(() => result.current.handleItemSelect("sky", false, mouse({ shiftKey: true })));
        act(() => result.current.handleItemSelect("street", false, mouse({ shiftKey: true })));

        expect(selectionOf(result)).toEqual(["asset:room", "asset:street"]);
    });

    it("follows what the view is drawing now, not what it drew before", () => {
        const { result } = panel();

        act(() => result.current.handleItemSelect("room", false, mouse()));
        // The folder between them was collapsed, or a set closed over its members: those rows are
        // gone from the panel, and a range across the gap must not reach them.
        act(() => result.current.publishRowOrder(["group:g-backdrops", "asset:room", "asset:sky"]));
        act(() => result.current.handleItemSelect("sky", false, mouse({ shiftKey: true })));

        expect(selectionOf(result)).toEqual(["asset:room", "asset:sky"]);
    });

    it("marks only the clicked row when the range would start from a row that is gone", () => {
        const { result } = panel();

        act(() => result.current.handleItemSelect("room", false, mouse()));
        act(() => result.current.publishRowOrder(["asset:street", "asset:sky"]));
        act(() => result.current.handleItemSelect("sky", false, mouse({ shiftKey: true })));

        expect(selectionOf(result)).toEqual(["asset:sky"]);

        // And that click is where the next range starts from, rather than leaving the author
        // shift-clicking against a row nothing can reach.
        act(() => result.current.handleItemSelect("street", false, mouse({ shiftKey: true })));
        expect(selectionOf(result)).toEqual(["asset:street", "asset:sky"]);
    });

    it("toggles a single row on ctrl-click and leaves the rest alone", () => {
        const { result } = panel();

        act(() => result.current.handleItemSelect("room", false, mouse()));
        act(() => result.current.handleItemSelect("sky", false, mouse({ ctrlKey: true })));
        expect(selectionOf(result)).toEqual(["asset:room", "asset:sky"]);

        act(() => result.current.handleItemSelect("room", false, mouse({ ctrlKey: true })));
        expect(selectionOf(result)).toEqual(["asset:sky"]);
        expect(result.current.isMultiSelectMode).toBe(false);
    });

    it("starts the next range from the last ctrl-clicked row", () => {
        const { result } = panel();

        act(() => result.current.handleItemSelect("g-backdrops", true, mouse()));
        act(() => result.current.handleItemSelect("street", false, mouse({ ctrlKey: true })));
        act(() => result.current.handleItemSelect("sky", false, mouse({ shiftKey: true })));

        expect(selectionOf(result)).toEqual(["asset:street", "asset:sky"]);
    });

    it("reports every change, including the empty one", () => {
        const onSelectionChange = vi.fn();
        const { result } = panel(onSelectionChange);

        act(() => result.current.handleItemSelect("room", false, mouse()));
        act(() => result.current.handleItemSelect("sky", false, mouse({ shiftKey: true })));
        act(() => result.current.handleClearSelection());

        expect(onSelectionChange.mock.calls.map(([selection]) => Array.from(selection as Set<string>))).toEqual([
            ["asset:room"],
            ["asset:room", "asset:street", "asset:sky"],
            [],
        ]);
    });
});
