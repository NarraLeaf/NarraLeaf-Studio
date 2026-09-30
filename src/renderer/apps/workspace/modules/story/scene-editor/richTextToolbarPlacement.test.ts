import { describe, expect, it } from "vitest";
import { richTextToolbarPlacement } from "./RichTextToolbar";

/**
 * Where the rich-text strip is allowed to sit.
 *
 * The guarantee, in one sentence, and every case below is a way of checking it:
 *
 * > The strip is placed against the edge of the row it belongs to - above it, or beneath it when
 * > the pane has no room above - beginning at the first character of that row's line, and always
 * > wholly inside the pane.
 *
 * Three things follow from it, and they are what the author actually gets:
 *
 * 1. **Nothing of the edited row is covered**, at either edge, in either form of the strip. The
 *    line the caret is in stays completely legible while its tools are on screen.
 * 2. **The tools are at the words.** Horizontally the strip starts where the line starts;
 *    vertically it touches the row's own box. The distance from the caret to the nearest control
 *    is the height of one row plus however far along the line the caret has got - never the width
 *    of the column, which is what a placement in the row's trailing space costs.
 * 3. **No row's height depends on any of this.** The strip is a floating box; the placement is a
 *    function of rects it reads and never of anything a row is asked to reserve. That is not
 *    something a pure function can assert on its own, so it is asserted in the component and in the
 *    real app - but it is the reason this function is given rows rather than being allowed to
 *    change them.
 *
 * What it costs is the row above, whose opening words the expanded strip covers. That is the
 * accepted trade: the strip is bounded away from that row's own controls (it never passes the text
 * column's right edge) and it is shorter than a row (so it reaches one row, never two), and the
 * form a row opens with is the chip.
 *
 * Coordinates are viewport pixels. The numbers are the shape a real row has, measured on a scene of
 * dialogue at the default density: a 36px row whose text column runs from 505 to 1175, inside a
 * pane some hundreds of pixels tall.
 */

/** The expanded strip, as it renders: 334.6 x 29.6, the larger of the two forms. */
const STRIP = { width: 334.6, height: 29.6 };
/** The collapsed chip, which is what a row opens with. */
const CHIP = { width: 41.6, height: 24 };
const PANE = { paneTop: 120, paneBottom: 880, paneLeft: 370 };
/** A row in the middle of that pane, with its text column running 505..1175. */
const ROW = { rowTop: 400, rowBottom: 436, textLeft: 505, columnRight: 1175 };

describe("richTextToolbarPlacement", () => {
    it("sits immediately above the row, covering none of it", () => {
        for (const box of [STRIP, CHIP]) {
            const at = richTextToolbarPlacement({ ...ROW, ...PANE, ...box })!;
            expect(at.top + box.height).toBe(ROW.rowTop);
        }
    });

    it("begins where the line begins", () => {
        // Left-aligned with the text column, so the tools start at the first character of the words
        // they act on. This is the whole reason for the placement: a strip in the row's trailing
        // space is (1175 - 505 - 334.6) = 335px further from the caret on a line that starts here.
        for (const box of [STRIP, CHIP]) {
            expect(richTextToolbarPlacement({ ...ROW, ...PANE, ...box })!.left).toBe(ROW.textLeft);
        }
    });

    it("holds both of those wherever the row is in the pane", () => {
        for (const rowTop of [150, 300, 500, 700, 814, 844]) {
            const row = { ...ROW, rowTop, rowBottom: rowTop + 36 };
            for (const box of [STRIP, CHIP]) {
                const at = richTextToolbarPlacement({ ...row, ...PANE, ...box });
                if (at === null) {
                    continue;
                }
                // Against one of the row's two edges, never over the row itself.
                expect(at.top + box.height <= row.rowTop || at.top >= row.rowBottom).toBe(true);
                // And wholly inside the pane, at every one of those positions.
                expect(at.top).toBeGreaterThanOrEqual(PANE.paneTop);
                expect(at.top + box.height).toBeLessThanOrEqual(PANE.paneBottom);
                expect(at.left).toBe(ROW.textLeft);
            }
        }
    });

    it("goes beneath the row when the pane has no room above", () => {
        // The pane's top row, and a row scrolled up against that edge. Beneath is the same distance
        // and the same alignment, on the other side; escaping the pane to stay above it would draw
        // the strip over the tab strip, and dropping it would leave the row without its tools.
        const first = richTextToolbarPlacement({ ...ROW, rowTop: 120, rowBottom: 156, ...PANE, ...STRIP })!;
        expect(first.top).toBe(156);
        expect(first.left).toBe(ROW.textLeft);
        // 29.5px of clearance is not enough for a 29.6px strip; one pixel more is.
        expect(richTextToolbarPlacement({ ...ROW, rowTop: 149.5, rowBottom: 185.5, ...PANE, ...STRIP })!.top).toBe(185.5);
        expect(richTextToolbarPlacement({ ...ROW, rowTop: 150.5, rowBottom: 186.5, ...PANE, ...STRIP })!.top).toBeCloseTo(120.9, 5);
    });

    it("still covers none of a row whose words have wrapped to a paragraph", () => {
        // A three-line row: the strip is above the FIRST line, which is the line the row's number,
        // its speaker mark and its diagnostics all align to. Under the row (the top-row case) it
        // clears all three lines rather than landing inside the paragraph.
        const tall = { ...ROW, rowTop: 400, rowBottom: 508 };
        expect(richTextToolbarPlacement({ ...tall, ...PANE, ...STRIP })!.top).toBeCloseTo(370.4, 5);
        expect(richTextToolbarPlacement({ ...tall, rowTop: 120, rowBottom: 228, ...PANE, ...STRIP })!.top).toBe(228);
    });

    it("stops short of the row's own controls", () => {
        // The row's voice indicator, its insert and delete buttons and its play control live in the
        // 168px past the text column, and they have to stay clickable on the row the strip is drawn
        // over. A column too narrow to hold the strip at its left edge gives up the alignment.
        const at = richTextToolbarPlacement({ ...ROW, textLeft: 505, columnRight: 800, ...PANE, ...STRIP })!;
        expect(at.left).toBeCloseTo(465.4, 5);
        expect(at.left + STRIP.width).toBe(800);
    });

    it("gives up the alignment rather than the pane", () => {
        // The narrowest editor the workspace will render (EDITOR_FLOOR.width is 480) leaves the
        // column ending inside the strip's own width. Every control stays on screen, because a
        // control the author cannot reach is worse than one that is not flush with the words.
        const at = richTextToolbarPlacement({ ...ROW, textLeft: 505, columnRight: 682, ...PANE, ...STRIP })!;
        expect(at.left).toBe(PANE.paneLeft);
        // The chip fits at that width, so it keeps the alignment the strip has to give up.
        expect(richTextToolbarPlacement({ ...ROW, textLeft: 505, columnRight: 682, ...PANE, ...CHIP })!.left).toBe(505);
    });

    it("never passes the text column's right edge while there is room for it not to", () => {
        // Both clamps only ever move the strip left, so the only column it can overhang is one too
        // narrow to hold it inside the pane at all - the case above, where it starts at the pane.
        for (const columnRight of [682, 800, 900, 1175, 1400]) {
            for (const box of [STRIP, CHIP]) {
                const at = richTextToolbarPlacement({ ...ROW, columnRight, ...PANE, ...box })!;
                if (columnRight - box.width < PANE.paneLeft) {
                    expect(at.left).toBe(PANE.paneLeft);
                    continue;
                }
                expect(at.left + box.width).toBeLessThanOrEqual(columnRight);
            }
        }
    });

    it("does not draw at all for a row scrolled out of the pane", () => {
        // Less of the row left in the pane than the strip is tall. A strip hanging beside a line the
        // author cannot see still takes the clicks meant for whatever is really in that spot.
        expect(richTextToolbarPlacement({ ...ROW, rowTop: 100, rowBottom: 136, ...PANE, ...STRIP })).toBeNull();
        expect(richTextToolbarPlacement({ ...ROW, rowTop: 860, rowBottom: 896, ...PANE, ...STRIP })).toBeNull();
        // Fully out, either way.
        expect(richTextToolbarPlacement({ ...ROW, rowTop: 40, rowBottom: 76, ...PANE, ...STRIP })).toBeNull();
        expect(richTextToolbarPlacement({ ...ROW, rowTop: 900, rowBottom: 936, ...PANE, ...STRIP })).toBeNull();
    });

    it("shows the chip for a row the strip no longer fits beside", () => {
        // The chip is 5.6px shorter, so the two forms give up at different points rather than at one.
        // A row with 26px of itself still showing past the pane's top edge keeps its chip, beneath.
        const sliver = { ...ROW, rowTop: 110, rowBottom: 146 };
        expect(richTextToolbarPlacement({ ...sliver, ...PANE, ...STRIP })).toBeNull();
        const at = richTextToolbarPlacement({ ...sliver, ...PANE, ...CHIP })!;
        expect(at.top).toBe(146);
        expect(at.left).toBe(ROW.textLeft);
    });

    it("is a pure function of rects, and asks no row for space", () => {
        // The placement's whole input is measurements it is handed; there is no path by which it can
        // report a height for a row to reserve. This is the rule that outranks every other one here:
        // a row that grew when the caret arrived would move every line beneath it twice per edit.
        // The check is that the same row, in both forms of the strip, describes the same box.
        const expanded = richTextToolbarPlacement({ ...ROW, ...PANE, ...STRIP })!;
        const collapsed = richTextToolbarPlacement({ ...ROW, ...PANE, ...CHIP })!;
        expect(expanded.top + STRIP.height).toBe(collapsed.top + CHIP.height);
        expect(expanded.left).toBe(collapsed.left);
    });
});
