// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCandidateTree, StoryCommandCandidateMenu, type StoryCandidateItem } from "./StoryCommandCandidateMenu";

afterEach(cleanup);

/**
 * The highlight is what Enter takes, so only the author moving the pointer may move it. A wheel over
 * the open list scrolls rows under a pointer that stays put, and the row that slides under it is
 * reported as entered - which used to light it, so the word Enter would write changed while the
 * author was only scrolling to read the list.
 */

const ITEMS: StoryCandidateItem[] = ["fade", "push", "circle", "wipe"].map(word => ({ key: word, value: word, label: word }));

function renderMenu(items: StoryCandidateItem[] = ITEMS) {
    const onHighlight = vi.fn<(key: string) => void>();
    const view = render(
        <StoryCommandCandidateMenu
            columns={[buildCandidateTree(items, false)]}
            trail={[]}
            onHighlight={(_column, key) => onHighlight(key)}
            onEnterFolder={() => {}}
            onChoose={() => {}}
            onCancel={() => {}}
            frame={{ placement: "below", style: {} }}
            characters={[]}
        />,
    );
    const row = (key: string) => document.body.querySelector(`[data-candidate-key="${key}"]`)!;
    return { ...view, row, onHighlight };
}

describe("hovering the slot's candidate menu", () => {
    it("lights the row the pointer moves over", () => {
        const { row, onHighlight } = renderMenu();
        fireEvent.mouseMove(row("push"), { clientX: 40, clientY: 30 });
        fireEvent.mouseMove(row("push"), { clientX: 42, clientY: 31 });
        expect(onHighlight).toHaveBeenLastCalledWith("push");
    });

    it("does not light a row that scrolls under a pointer at rest", () => {
        const { row, onHighlight } = renderMenu();
        fireEvent.mouseMove(row("fade"), { clientX: 40, clientY: 30 });
        fireEvent.mouseMove(row("fade"), { clientX: 40, clientY: 32 });
        onHighlight.mockClear();
        // The wheel: the rows move, the pointer does not.
        fireEvent.mouseEnter(row("circle"), { clientX: 40, clientY: 32 });
        fireEvent.mouseOver(row("circle"), { clientX: 40, clientY: 32 });
        fireEvent.mouseMove(row("circle"), { clientX: 40, clientY: 32 });
        expect(onHighlight).not.toHaveBeenCalled();
    });

    it("lights nothing when the menu opens under a resting pointer", () => {
        const { row, onHighlight } = renderMenu();
        fireEvent.mouseEnter(row("wipe"), { clientX: 10, clientY: 10 });
        fireEvent.mouseMove(row("wipe"), { clientX: 10, clientY: 10 });
        expect(onHighlight).not.toHaveBeenCalled();
    });
});

/**
 * The hover tint is CSS `:hover`, which goes to whatever row is under the pointer. After a wheel that
 * is the row that slid under it, while the highlighted row has scrolled out of view - and the grey
 * read as the highlight. So rows carry their hover tint only while the pointer is what last moved.
 */
describe("the hover tint on the slot's candidate menu", () => {
    const tinted = (element: Element) => element.className.split(" ").includes("hover:bg-fill");

    it("is off when the menu opens under a resting pointer", () => {
        const { row } = renderMenu();
        fireEvent.mouseOver(row("wipe"), { clientX: 10, clientY: 10 });
        fireEvent.mouseMove(row("wipe"), { clientX: 10, clientY: 10 });
        expect(tinted(row("wipe"))).toBe(false);
    });

    it("comes on once the pointer moves", () => {
        const { row } = renderMenu();
        fireEvent.mouseMove(row("push"), { clientX: 40, clientY: 30 });
        fireEvent.mouseMove(row("push"), { clientX: 42, clientY: 31 });
        expect(tinted(row("push"))).toBe(true);
    });

    it("goes off when a wheel scrolls rows under the pointer, and back on when the pointer moves", () => {
        const { row, getByRole } = renderMenu();
        fireEvent.mouseMove(row("fade"), { clientX: 40, clientY: 30 });
        fireEvent.mouseMove(row("fade"), { clientX: 40, clientY: 32 });
        fireEvent.scroll(getByRole("listbox"));
        fireEvent.mouseOver(row("circle"), { clientX: 40, clientY: 32 });
        fireEvent.mouseMove(row("circle"), { clientX: 40, clientY: 32 });
        expect(tinted(row("circle"))).toBe(false);
        fireEvent.mouseMove(row("circle"), { clientX: 41, clientY: 33 });
        expect(tinted(row("circle"))).toBe(true);
    });

    it("goes off when a row arrives under a pointer that has not moved", () => {
        const { row } = renderMenu();
        fireEvent.mouseMove(row("fade"), { clientX: 40, clientY: 30 });
        fireEvent.mouseMove(row("fade"), { clientX: 40, clientY: 32 });
        // The list re-filtered as the author typed, and another row now sits under the pointer.
        fireEvent.mouseOver(row("wipe"), { clientX: 40, clientY: 32 });
        expect(tinted(row("wipe"))).toBe(false);
    });

    it("stays on while the pointer moves from row to row", () => {
        const { row } = renderMenu();
        fireEvent.mouseMove(row("fade"), { clientX: 40, clientY: 30 });
        fireEvent.mouseMove(row("fade"), { clientX: 40, clientY: 32 });
        fireEvent.mouseOver(row("push"), { clientX: 40, clientY: 44 });
        fireEvent.mouseMove(row("push"), { clientX: 40, clientY: 44 });
        expect(tinted(row("push"))).toBe(true);
    });

    it("follows the same rule on the line saying nothing matches", () => {
        const { getByRole } = renderMenu([]);
        const line = getByRole("button");
        fireEvent.mouseOver(line, { clientX: 10, clientY: 10 });
        fireEvent.mouseMove(line, { clientX: 10, clientY: 10 });
        expect(tinted(line)).toBe(false);
        fireEvent.mouseMove(line, { clientX: 12, clientY: 11 });
        expect(tinted(line)).toBe(true);
    });
});
