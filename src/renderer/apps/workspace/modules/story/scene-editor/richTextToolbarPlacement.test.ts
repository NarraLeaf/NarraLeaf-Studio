import { describe, expect, it } from "vitest";
import { RICH_TEXT_TOOLBAR_BAND_PX, richTextToolbarTop } from "./RichTextToolbar";

/**
 * Where the rich-text strip is allowed to sit.
 *
 * One rule carries the whole thing: the story list draws its rows one line box after another with
 * nothing between them, so any pixel above the edited line's own top belongs to a sentence some
 * other row is showing. The strip used to be placed a row box higher than the line and covered the
 * start of the one above it; these cases are what stops that coming back.
 *
 * Coordinates are viewport pixels, and the numbers below are the shape a real row has: a 36px line
 * box inside a pane some hundreds of pixels tall.
 */

/** A 30px strip, the taller of the two the component renders. */
const HEIGHT = 30;
const PANE = { paneTop: 120, paneBottom: 880 };

describe("richTextToolbarTop", () => {
    it("sits in the band beneath the line", () => {
        // 4px of breathing room under the line, which is where the row's reserved band starts.
        expect(richTextToolbarTop({ anchorTop: 400, anchorBottom: 436, ...PANE, height: HEIGHT })).toBe(440);
    });

    it("stays clear of the line above, whatever the pane does", () => {
        // The defect, stated as an assertion: a strip placed above the anchor would land at 402 and
        // cover the row before it. Every bound below still leaves the top at or under the line's own.
        const cases = [
            { anchorTop: 400, anchorBottom: 436, ...PANE },
            // The pane's bottom edge a few pixels under the line: the band does not fit.
            { anchorTop: 838, anchorBottom: 874, ...PANE },
            // A pane shorter than one row.
            { anchorTop: 400, anchorBottom: 436, paneTop: 400, paneBottom: 420 },
        ];
        for (const box of cases) {
            expect(richTextToolbarTop({ ...box, height: HEIGHT })).toBeGreaterThanOrEqual(box.anchorTop);
        }
    });

    it("gives up the band rather than the pane when the two disagree", () => {
        // 6px of pane beneath the line - less than the band. The strip drops to the pane's floor
        // instead of escaping over the panel below.
        expect(richTextToolbarTop({ anchorTop: 838, anchorBottom: 874, ...PANE, height: HEIGHT })).toBe(850);
    });

    it("does not follow a line scrolled out of the top of its pane", () => {
        // The row is half above the pane; the strip stays where the author can see it.
        expect(richTextToolbarTop({ anchorTop: 100, anchorBottom: 136, ...PANE, height: HEIGHT })).toBe(140);
        expect(richTextToolbarTop({ anchorTop: 60, anchorBottom: 96, ...PANE, height: HEIGHT })).toBe(120);
    });

    it("reserves a band tall enough for the strip it has to hold", () => {
        // The row pads by this and the placement above lives inside it; a band shorter than the
        // strip plus its gap would put the strip back over the next row.
        expect(RICH_TEXT_TOOLBAR_BAND_PX).toBeGreaterThanOrEqual(HEIGHT + 4);
    });
});
