// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoryCommandCandidateMenu, type StoryCandidateItem } from "./StoryCommandCandidateMenu";

afterEach(cleanup);

/**
 * The highlight is what Enter takes, so only the author moving the pointer may move it. A wheel over
 * the open list scrolls rows under a pointer that stays put, and the row that slides under it is
 * reported as entered - which used to light it, so the word Enter would write changed while the
 * author was only scrolling to read the list.
 */

const ITEMS: StoryCandidateItem[] = ["fade", "push", "circle", "wipe"].map(word => ({ key: word, value: word, label: word }));

function renderMenu() {
    const onHighlight = vi.fn<(key: string) => void>();
    const view = render(
        <StoryCommandCandidateMenu
            items={ITEMS}
            activeKey={null}
            onHighlight={onHighlight}
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
