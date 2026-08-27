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

/**
 * One height both halves reserve, and which of them has something to put in it.
 *
 * Deliberately says nothing about WHAT is drawn there. A half draws change rows for most documents
 * and a script for a story, and the arithmetic that keeps the two halves level is the same either
 * way - so it is stated once, over slots that are only a key, a presence and whether the navigation
 * stops there.
 */
export interface SplitSlot {
    /** The handle both halves address this slot by in the DOM. Unique within one list. */
    readonly key: string;
    readonly onBase: boolean;
    readonly onHead: boolean;
    /**
     * Whether previous and next stop here.
     *
     * Every slot of a change list is a change, so every one of them is a stop. A script is mostly
     * lines that did not change, and stopping on those would make "next change" mean "next line" -
     * so the two are separated here rather than by counting rows at the surface.
     */
    readonly stop: boolean;
}

/** A slot that draws one change row - what every document but a story is made of. */
export interface SplitChangeSlot extends SplitSlot {
    readonly row: DocumentChangeRow;
}

/**
 * One row per slot, in the order the change list draws them.
 *
 * The two halves render the SAME list of slots, and each of them draws a row or a gap - which is
 * what makes "the thing facing this thing is its counterpart" true rather than approximately true.
 */
export function buildSplitSlots(rows: readonly DocumentChangeRow[]): readonly SplitChangeSlot[] {
    return rows.map(row => {
        const columns = maskColumns(row.change.kind);
        return { key: row.key, row, onBase: columns.onBase, onHead: columns.onHead, stop: true };
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
