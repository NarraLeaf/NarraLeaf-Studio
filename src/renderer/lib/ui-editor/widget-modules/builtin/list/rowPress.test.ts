// @vitest-environment jsdom
/**
 * A press on a control in a list row that handles the press itself is the control's, not the row's.
 *
 * Before, the row raised Item Click for every press inside it: a backlog's replay button replayed the
 * line and, through the row, also asked whether to go back to it. A control that handles nothing -
 * the hit area over a gallery card - and the row's own root still pass the press to the row.
 */
import { describe, expect, it } from "vitest";
import { pressIsAnsweredInRow } from "./rowPress";

/** row > entry (row root) > [replay button > glyph, line text], as the list draws a row. */
function drawRow() {
    const row = document.createElement("div");
    const entry = element("entry");
    const replay = element("replay");
    const glyph = document.createElement("span");
    const line = element("line");
    replay.appendChild(glyph);
    entry.append(replay, line);
    row.appendChild(entry);
    return { row, entry, replay, glyph, line };
}

function element(id: string): HTMLDivElement {
    const node = document.createElement("div");
    node.setAttribute("data-ui-element-id", id);
    return node;
}

const rowRootIds = new Set(["entry"]);

describe("whose a press inside a list row is", () => {
    it("is the control's when the control handles the press, wherever on it the press lands", () => {
        const { row, replay, glyph } = drawRow();
        const answers = (id: string) => id === "replay";
        expect(pressIsAnsweredInRow({ target: replay, row, rowRootIds, answers })).toBe(true);
        expect(pressIsAnsweredInRow({ target: glyph, row, rowRootIds, answers })).toBe(true);
    });

    it("is the row's beside the control, and on a control that handles nothing", () => {
        const { row, entry, line, replay } = drawRow();
        expect(pressIsAnsweredInRow({ target: line, row, rowRootIds, answers: id => id === "replay" })).toBe(false);
        expect(pressIsAnsweredInRow({ target: entry, row, rowRootIds, answers: id => id === "replay" })).toBe(false);
        expect(pressIsAnsweredInRow({ target: replay, row, rowRootIds, answers: () => false })).toBe(false);
    });

    it("is the row's when only the row's own root handles the press", () => {
        const { row, line } = drawRow();
        expect(pressIsAnsweredInRow({ target: line, row, rowRootIds, answers: id => id === "entry" })).toBe(false);
    });
});
