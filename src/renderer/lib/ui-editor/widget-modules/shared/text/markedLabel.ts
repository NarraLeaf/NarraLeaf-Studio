import type { UIElement } from "@shared/types/ui-editor/document";
import { applyPlainTextToUITextRuns, type UITextRun } from "@shared/types/ui-editor/textRuns";

/**
 * Where a widget keeps a marked label, which is the one thing that differs between the widgets that
 * draw one: a text label calls its string `text`, a button calls it `label`, and both keep the runs
 * beside it in `rich`. Each widget states its answer once, in its own `helpers.ts`, and everything
 * that edits a label - the inspector's box and marks, the label typed on the canvas - reads it from
 * there.
 */
export type MarkedLabelProps = {
    /** The label as it is stored on `element`: the plain string, its runs, and the colour it is set in. */
    read(element: UIElement): { text: string; rich: UITextRun[] | undefined; color: string };
    /** The props patch that writes the string and its runs together. */
    write(text: string, rich: UITextRun[] | undefined): Record<string, unknown>;
};

/**
 * The patch a plain-text edit of a marked label writes: the new string, and the runs carried across
 * it by {@link applyPlainTextToUITextRuns}, so the stretch the edit did not reach keeps its marks.
 *
 * A plain box can only hand back a string. Every plain editor of a label goes through this one -
 * the box in the inspector and the label typed on the canvas alike - because leaving it to each
 * caller is how one of them ends up dropping every reading in a label when one word is corrected.
 */
export function plainTextEditPatch(
    label: MarkedLabelProps,
    element: UIElement,
    nextText: string,
): Record<string, unknown> {
    return label.write(nextText, applyPlainTextToUITextRuns(label.read(element).rich, nextText));
}
