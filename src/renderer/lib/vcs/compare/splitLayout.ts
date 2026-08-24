import type { DocumentChangeRow } from "../documentChangeView";
import { maskColumns } from "../presenters/changeMask";

/**
 * Two versions of one document as two halves of one tab, and the arithmetic that keeps the halves
 * saying the same thing at the same height.
 *
 * No React, so the two rules that make a split comparison honest can be pinned without mounting
 * anything - which is the same reason `documentChangeView.ts` is a module of its own.
 */

/**
 * The width at which the two halves stop being two halves, in px of the TAB BODY.
 *
 * A number rather than a media query, and measured rather than read off the window: this tab sits
 * inside an editor group that can be split and dragged, so the window's width says nothing about how
 * much room the comparison has. The threshold is evaluated continuously and in both directions -
 * dragging the group wider brings the second column back - because a layout that only collapses is
 * a layout an author cannot undo.
 *
 * 900 is two columns of the change list plus the gutter between them. Below it a column is narrower
 * than the values it has to draw, and a truncated value beside another truncated value is two
 * questions where there was one.
 */
export const SPLIT_TWO_COLUMN_MIN_PX = 900;

/**
 * How many columns fit in a body of this width.
 *
 * Zero is "not measured yet", and answers two rather than one: the measurement happens in the ref
 * callback before the first paint, so the unmeasured frame is never drawn - and an even split is
 * what this tab is for.
 */
export function splitColumnCount(width: number): 1 | 2 {
    if (!Number.isFinite(width) || width <= 0) {
        return 2;
    }
    return width >= SPLIT_TWO_COLUMN_MIN_PX ? 2 : 1;
}

/** Which half of the comparison a row is drawn in. A removal was never in the newer version. */
export interface SplitSlot {
    /** The row's own key, and the handle both halves address this slot by in the DOM. */
    readonly key: string;
    readonly row: DocumentChangeRow;
    readonly onBase: boolean;
    readonly onHead: boolean;
}

/**
 * One row per slot, in the order the change list draws them.
 *
 * The two halves render the SAME list of slots, and each of them draws a row or a gap - which is
 * what makes "the thing facing this thing is its counterpart" true rather than approximately true.
 */
export function buildSplitSlots(rows: readonly DocumentChangeRow[]): readonly SplitSlot[] {
    return rows.map(row => {
        const columns = maskColumns(row.change.kind);
        return { key: row.key, row, onBase: columns.onBase, onHead: columns.onHead };
    });
}

/** Where one slot sits, and which half of it is a gap rather than a row. */
export interface SplitSlotLayout {
    readonly key: string;
    /** Reserved by BOTH halves. The taller of the two rows, or the one row there is. */
    readonly height: number;
    /** Distance from the top of the scroller, identical in both halves by construction. */
    readonly offset: number;
    /** True where this half has nothing and the other one does. */
    readonly baseSpacer: boolean;
    readonly headSpacer: boolean;
}

/**
 * Give every slot the same height in both halves, filling the odd one out with a spacer.
 *
 * **A gap is never closed by pulling later content up.** Two halves scrolled together assert that
 * the things facing each other correspond; a half that shifted its remaining rows into the space a
 * removal left would break that assertion for every row after it, and would do so silently - the
 * two columns would still look like a comparison. So a run present on one side only reserves its
 * height on both sides, and everything after it stays level.
 *
 * Heights are measured rather than assumed, because a row's height is its wrapped text: the same
 * change is one line in one half and three in the other as soon as a value is long enough. Nothing
 * is drawn from a guessed height - an unmeasured slot is zero here and the halves are level at zero.
 */
export function layoutSplitSlots(
    slots: readonly SplitSlot[],
    baseHeights: ReadonlyMap<string, number>,
    headHeights: ReadonlyMap<string, number>,
): readonly SplitSlotLayout[] {
    const layout: SplitSlotLayout[] = [];
    let offset = 0;
    for (const slot of slots) {
        const base = slot.onBase ? baseHeights.get(slot.key) ?? 0 : 0;
        const head = slot.onHead ? headHeights.get(slot.key) ?? 0 : 0;
        const height = Math.max(base, head);
        layout.push({
            key: slot.key,
            height,
            offset,
            baseSpacer: !slot.onBase,
            headSpacer: !slot.onHead,
        });
        offset += height;
    }
    return layout;
}
