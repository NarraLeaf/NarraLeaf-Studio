// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState, type MouseEvent } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { StoryBlock, StoryBlockId } from "@shared/types/story";
import { clickSelectsRow, isPlainRowPress, nextRowSelection, pressSelectsRow } from "./storyRowSelectionGesture";
import { selectRange } from "./storySceneBlockUtils";
import type { VisibleStoryRow } from "./storySceneEditorTypes";

/**
 * Row multi-select, driven the way a press actually arrives: `mousedown`, then `click`.
 *
 * This is the shape the bug lived in and the reason no unit test caught it. `nextRowSelection` on its
 * own has always been right — Ctrl toggles, Shift ranges — and stayed right while Ctrl+click did
 * nothing at all in the real editor, because the row ran the whole selection twice per press and a
 * toggle applied twice is a no-op. Anything that asserts one call cannot see that.
 *
 * So the harness below is a row list with the same two handlers the real row div carries
 * (`StorySceneEditorRows`: `onClick={on.onSelect}` and `onMouseDown={on.onMouseDown}`), routed through
 * the same predicates the controller routes them through, plus the row-range drag the press arms — the
 * second half of the same bug, because a drag replaces the selection with a range and every real hand
 * jitters a pixel between pressing and releasing.
 */

afterEach(cleanup);

function rows(count: number): VisibleStoryRow[] {
    return Array.from({ length: count }, (_, index) => ({
        block: { id: `r${index + 1}`, kind: "text" } as unknown as StoryBlock,
        depth: 0,
        lineNumber: index + 1,
    }));
}

const ROWS = rows(5);

/**
 * The editor's selection surface, reduced to what a press touches.
 *
 * `selectRow` is the controller's: bump nothing, move the active row, hand the set to
 * `nextRowSelection`. The press/click split and the drag arming are the controller's too — only the
 * pointer hit-test is stubbed, since jsdom has no layout for `elementFromPoint` to read.
 */
function RowList() {
    const [selected, setSelected] = useState<ReadonlySet<StoryBlockId>>(new Set());
    const [active, setActive] = useState<StoryBlockId | null>(null);
    const activeRef = useRef<StoryBlockId | null>(null);
    const dragFromRef = useRef<StoryBlockId | null>(null);
    /** Which row the pointer is over, as `extendDragSelectionAtPoint` would resolve it. */
    const overRef = useRef<StoryBlockId | null>(null);

    const selectRow = (blockId: StoryBlockId, event: MouseEvent) => {
        const rangeFrom = activeRef.current;
        activeRef.current = blockId;
        setActive(blockId);
        setSelected(previous => nextRowSelection({ previous, rows: ROWS, activeBlockId: rangeFrom, blockId, event }));
    };

    const press = (blockId: StoryBlockId, event: MouseEvent) => {
        if (!pressSelectsRow(event)) {
            return;
        }
        selectRow(blockId, event);
        if (!isPlainRowPress(event)) {
            return;
        }
        dragFromRef.current = blockId;
    };

    const click = (blockId: StoryBlockId, event: MouseEvent) => {
        if (!clickSelectsRow(event)) {
            return;
        }
        selectRow(blockId, event);
    };

    return (
        <div
            data-testid="rows"
            onMouseMove={() => {
                const from = dragFromRef.current;
                if (!from) {
                    return;
                }
                setSelected(selectRange(ROWS, from, overRef.current ?? from));
            }}
            onMouseUp={() => {
                dragFromRef.current = null;
            }}
        >
            {ROWS.map(row => (
                <div
                    key={row.block.id}
                    data-testid={row.block.id}
                    onMouseEnter={() => {
                        overRef.current = row.block.id;
                    }}
                    onMouseDown={event => press(row.block.id, event)}
                    onClick={event => click(row.block.id, event)}
                >
                    <span data-testid={`${row.block.id}-text`}>{row.block.id}</span>
                    <input data-testid={`${row.block.id}-field`} readOnly value="" />
                </div>
            ))}
            <output data-testid="selection">{[...selected].sort().join(",")}</output>
            <output data-testid="active">{active ?? ""}</output>
        </div>
    );
}

/** One press: down and up on the same element, which is what produces a `click` on the row. */
function pressRow(testId: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {}) {
    const target = screen.getByTestId(testId);
    fireEvent.mouseDown(target, { button: 0, ...modifiers });
    fireEvent.mouseUp(target, { button: 0, ...modifiers });
    fireEvent.click(target, { button: 0, ...modifiers });
}

function selection(): string {
    return screen.getByTestId("selection").textContent ?? "";
}

describe("selecting rows with the mouse", () => {
    it("replaces the selection on a plain press", () => {
        render(<RowList />);
        pressRow("r2");
        expect(selection()).toBe("r2");
        pressRow("r4");
        expect(selection()).toBe("r4");
        expect(screen.getByTestId("active").textContent).toBe("r4");
    });

    it("adds a row to the selection on Ctrl+click", () => {
        render(<RowList />);
        pressRow("r2");
        pressRow("r4", { ctrlKey: true });
        expect(selection()).toBe("r2,r4");
    });

    it("takes a selected row back out on Ctrl+click", () => {
        render(<RowList />);
        pressRow("r2");
        pressRow("r4", { ctrlKey: true });
        pressRow("r2", { ctrlKey: true });
        expect(selection()).toBe("r4");
    });

    it("keeps the additive answer when the hand shakes during the press", () => {
        render(<RowList />);
        pressRow("r2");
        const target = screen.getByTestId("r4");
        fireEvent.mouseEnter(target);
        fireEvent.mouseDown(target, { button: 0, ctrlKey: true });
        // Every real press carries one of these. A row-range drag armed here would replace the whole
        // selection with the range under the pointer - i.e. with r4 alone.
        fireEvent.mouseMove(target, { ctrlKey: true });
        fireEvent.mouseUp(target, { button: 0, ctrlKey: true });
        fireEvent.click(target, { button: 0, ctrlKey: true });
        expect(selection()).toBe("r2,r4");
    });

    it("selects the range on Shift+click", () => {
        render(<RowList />);
        pressRow("r2");
        pressRow("r5", { shiftKey: true });
        expect(selection()).toBe("r2,r3,r4,r5");
    });

    it("keeps the range when the hand shakes during a Shift press", () => {
        render(<RowList />);
        pressRow("r2");
        const target = screen.getByTestId("r5");
        fireEvent.mouseEnter(target);
        fireEvent.mouseDown(target, { button: 0, shiftKey: true });
        fireEvent.mouseMove(target, { shiftKey: true });
        fireEvent.mouseUp(target, { button: 0, shiftKey: true });
        fireEvent.click(target, { button: 0, shiftKey: true });
        expect(selection()).toBe("r2,r3,r4,r5");
    });

    it("re-anchors the range on the last plainly selected row", () => {
        render(<RowList />);
        pressRow("r4");
        pressRow("r2", { shiftKey: true });
        expect(selection()).toBe("r2,r3,r4");
        pressRow("r5", { shiftKey: true });
        // The Shift press moved the active row to r2, so the next range runs from there.
        expect(selection()).toBe("r2,r3,r4,r5");
    });

    it("still selects the row when the press lands on a field inside it", () => {
        render(<RowList />);
        // The press declines here (the field answers for itself) - the click is the only handler left
        // that can select the row, and it has to.
        pressRow("r3-field");
        expect(selection()).toBe("r3");
        pressRow("r5-field", { ctrlKey: true });
        expect(selection()).toBe("r3,r5");
    });

    it("selects on the press, not on the click, when the press claims the row", () => {
        render(<RowList />);
        // A drag that ends outside the row it started in produces no click at all. The row is still
        // selected, because the press did it.
        fireEvent.mouseDown(screen.getByTestId("r3-text"), { button: 0 });
        expect(selection()).toBe("r3");
    });

    it("leaves the row to the context menu on a non-primary press", () => {
        render(<RowList />);
        pressRow("r1");
        fireEvent.mouseDown(screen.getByTestId("r3-text"), { button: 2 });
        expect(selection()).toBe("r1");
    });
});

describe("the two halves of one press", () => {
    const plainTarget = { button: 0, target: document.createElement("span") };

    it("never both select and never both decline", () => {
        const field = document.createElement("input");
        for (const event of [plainTarget, { button: 0, target: field }, { button: 2, target: plainTarget.target }]) {
            expect(pressSelectsRow(event)).toBe(!clickSelectsRow(event));
        }
    });

    it("arms a row-range drag only for an unmodified press", () => {
        expect(isPlainRowPress(plainTarget)).toBe(true);
        expect(isPlainRowPress({ ...plainTarget, ctrlKey: true })).toBe(false);
        expect(isPlainRowPress({ ...plainTarget, shiftKey: true })).toBe(false);
        expect(isPlainRowPress({ ...plainTarget, metaKey: true })).toBe(false);
        expect(isPlainRowPress({ ...plainTarget, altKey: true })).toBe(false);
    });
});
