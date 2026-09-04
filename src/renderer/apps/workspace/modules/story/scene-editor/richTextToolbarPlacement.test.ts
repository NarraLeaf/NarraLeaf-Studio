import { describe, expect, it } from "vitest";
import { richTextToolbarPlacement } from "./RichTextToolbar";

/**
 * Where the rich-text strip is allowed to sit.
 *
 * One rule carries the whole thing, and every case below is a way of stating it:
 *
 * > The strip is drawn inside the vertical band of the row it belongs to, and inside the pane.
 *
 * The story list draws its rows one line box after another with nothing between them, and a row's
 * text box is exactly its row's box - so the rows' words partition the pane, and a strip held inside
 * one row's band cannot reach another row's sentence. What it costs is a few pixels of the author's
 * OWN line, which is the trade this placement makes: the row never changes height, so nothing below
 * the caret moves when the author clicks into a line or leaves it.
 *
 * Coordinates are viewport pixels. The numbers are the shape a real row has, measured on a scene of
 * dialogue at the default density: a 36px row whose text column ends 168px short of the row's right
 * edge, inside a pane some hundreds of pixels tall.
 */

/** The expanded strip, as it renders: 334.6 x 29.6, the larger of the two forms. */
const STRIP = { width: 334.6, height: 29.6 };
/** The collapsed chip, which is what a row opens with. */
const CHIP = { width: 41.6, height: 24 };
const PANE = { paneTop: 120, paneBottom: 880, paneLeft: 370 };
/** A row in the middle of that pane, with its text column ending at 1175. */
const ROW = { rowTop: 400, rowBottom: 436, columnRight: 1175 };

describe("richTextToolbarPlacement", () => {
    it("keeps the strip inside the row it belongs to", () => {
        const at = richTextToolbarPlacement({ ...ROW, ...PANE, ...STRIP })!;
        expect(at.top).toBeGreaterThanOrEqual(ROW.rowTop);
        expect(at.top + STRIP.height).toBeLessThanOrEqual(ROW.rowBottom);
    });

    it("holds that guarantee wherever the row is in the pane", () => {
        // Every position a row can be shown in, including the two edges where a floating placement
        // usually breaks: a floor of 6.4px of slack in a 36px row is all this rule ever has.
        for (const rowTop of [120, 121, 300, 500, 700, 843, 844]) {
            const row = { rowTop, rowBottom: rowTop + 36, columnRight: 1175 };
            for (const box of [STRIP, CHIP]) {
                const at = richTextToolbarPlacement({ ...row, ...PANE, ...box });
                if (at === null) {
                    continue;
                }
                expect(at.top).toBeGreaterThanOrEqual(row.rowTop);
                expect(at.top + box.height).toBeLessThanOrEqual(row.rowBottom);
                expect(at.top).toBeGreaterThanOrEqual(PANE.paneTop);
                expect(at.top + box.height).toBeLessThanOrEqual(PANE.paneBottom);
            }
        }
    });

    it("centres the strip on a single-line row's own line", () => {
        // (36 - 29.6) / 2, which is where the line's glyphs are centred too.
        expect(richTextToolbarPlacement({ ...ROW, ...PANE, ...STRIP })!.top).toBeCloseTo(403.2, 5);
        expect(richTextToolbarPlacement({ ...ROW, ...PANE, ...CHIP })!.top).toBeCloseTo(406, 5);
    });

    it("stays with the first line when the words have wrapped to a paragraph", () => {
        // A three-line row. Centring in it would float the strip into the middle of the paragraph;
        // the first line is the one the row's number and its speaker mark align to, so the strip
        // goes there as well - capped at TOOLBAR_ROW_INSET_MAX below the row's top.
        const at = richTextToolbarPlacement({ rowTop: 400, rowBottom: 508, columnRight: 1175, ...PANE, ...STRIP })!;
        expect(at.top).toBe(408);
    });

    it("ends where the row's text column ends", () => {
        // Right-aligned to the column, so it sits in the row's trailing space - past the last glyph
        // of all but the longest lines - and stops short of the row's own controls, which live in
        // the 168px beyond the column and have to stay clickable.
        const at = richTextToolbarPlacement({ ...ROW, ...PANE, ...STRIP })!;
        expect(at.left + STRIP.width).toBe(ROW.columnRight);
        expect(richTextToolbarPlacement({ ...ROW, ...PANE, ...CHIP })!.left + CHIP.width).toBe(ROW.columnRight);
    });

    it("gives up the right-hand alignment rather than the pane", () => {
        // The narrowest editor the workspace will render (EDITOR_FLOOR.width is 480) leaves the
        // column ending 22px inside the strip's own width. Alignment yields; every control stays on
        // screen, because a control the author cannot reach is worse than one that is not flush.
        const at = richTextToolbarPlacement({ ...ROW, columnRight: 682, ...PANE, ...STRIP })!;
        expect(at.left).toBe(PANE.paneLeft);
    });

    it("does not draw at all for a row scrolled out of the pane", () => {
        // Half above the top and half below the bottom. Pinning the strip to the pane's edge instead
        // would put it over the neighbouring row's words, which is the defect this placement exists
        // to prevent; and a strip for a line the author cannot see is not worth that.
        expect(richTextToolbarPlacement({ rowTop: 100, rowBottom: 136, columnRight: 1175, ...PANE, ...STRIP })).toBeNull();
        expect(richTextToolbarPlacement({ rowTop: 860, rowBottom: 896, columnRight: 1175, ...PANE, ...STRIP })).toBeNull();
        // Fully out, either way.
        expect(richTextToolbarPlacement({ rowTop: 40, rowBottom: 76, columnRight: 1175, ...PANE, ...STRIP })).toBeNull();
        expect(richTextToolbarPlacement({ rowTop: 900, rowBottom: 936, columnRight: 1175, ...PANE, ...STRIP })).toBeNull();
    });

    it("shows the chip for a row the strip no longer fits in", () => {
        // The chip is 5.6px shorter, so the two forms give up at different points rather than at one.
        // A row with 25px of itself still in the pane keeps its chip, sat on the pane's own edge.
        const sliver = { rowTop: 855, rowBottom: 891, columnRight: 1175 };
        expect(richTextToolbarPlacement({ ...sliver, ...PANE, ...STRIP })).toBeNull();
        const at = richTextToolbarPlacement({ ...sliver, ...PANE, ...CHIP })!;
        expect(at.top).toBe(856);
        expect(at.top + CHIP.height).toBe(PANE.paneBottom);
    });
});
