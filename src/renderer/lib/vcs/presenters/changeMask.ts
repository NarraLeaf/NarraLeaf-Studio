import type { DocumentChange } from "@shared/documents/diff";
import type { TranslationKey } from "@shared/i18n";

/**
 * How a change is coloured when it is drawn ON the thing that changed rather than listed beside it.
 *
 * Two canvases share this vocabulary - a Surface and a blueprint graph - and they have to agree,
 * because an author reads one mask and then the other in the same minute. It is also why the tones
 * are named after what happened rather than after a colour: swapping the palette is a change to
 * {@link CHANGE_MASK_CLASS} and to nothing else.
 *
 * **A removal is `danger` on both the canvas and the index row, and an addition is not.** The list's
 * `CHANGE_KIND_TINT` marks an addition `text-success`; here it is `primary`. That divergence is
 * deliberate and was decided by looking at the two together: a mask sits ON the author's artwork,
 * where green competes with the art itself and where red beside green is the one pairing a
 * colour-blind reader cannot separate. A glyph in a text list has neither problem. The cost is real
 * and accepted - the same addition is a green `+` in the index and a blue wash on the canvas - and
 * it is confined to this map, so reverting is one line.
 *
 * **A mask is a wash, not a lid.** Every one of them is a translucent fill under a solid border,
 * because the question an author brings here is what the marked thing LOOKS like now - a colour
 * that hid it would answer a question nobody asked.
 */

export type ChangeMaskTone = "added" | "removed" | "changed" | "moved";

/**
 * The one place the four colours are decided.
 *
 * `moved` is deliberately the weakest of the four and deliberately not a hue: a node dragged across
 * the canvas or an element re-ordered under its parent changes nothing about what the game does, and
 * a coloured mark for it would compete for attention with the parameter edit two nodes over that
 * decides which scene runs next. It reads as "something happened here" and stops there.
 */
export const CHANGE_MASK_CLASS: Record<ChangeMaskTone, string> = {
    added: "border-primary bg-primary/20",
    removed: "border-danger bg-danger/20",
    changed: "border-warning bg-warning/20",
    moved: "border-edge-strong bg-fill-subtle",
};

/**
 * The same four as a stroke, for a wire on a graph, which has no area to fill.
 *
 * `moved` uses a text token rather than the border token its filled counterpart does: `edge` is for
 * `border-*` and `fill` for `bg-*` (design-system.md §1), and a stroke is neither of those roles.
 */
export const CHANGE_MASK_STROKE: Record<ChangeMaskTone, string> = {
    added: "stroke-primary",
    removed: "stroke-danger",
    changed: "stroke-warning",
    moved: "stroke-fg-subtle",
};

/** What each tone is called, for the legend above a pair of canvases. */
export const CHANGE_MASK_LABEL: Record<ChangeMaskTone, TranslationKey> = {
    added: "documentDiff.canvas.legend.added",
    removed: "documentDiff.canvas.legend.removed",
    changed: "documentDiff.canvas.legend.changed",
    moved: "documentDiff.canvas.legend.moved",
};

/** Legend order: the three that alter the game first, the one that does not last. */
export const CHANGE_MASK_TONES: readonly ChangeMaskTone[] = ["added", "removed", "changed", "moved"];

/**
 * Which mask one change wears.
 *
 * The kind decides it, except for the one case the kind cannot: a group is `changed` whether its
 * children are five parameter edits or one drag. Both diff specs mark a pure relocation with
 * `kind: "moved"` on the leaf for exactly this reason (`uiGraphsDiff.ts`, "Moving a node is not
 * editing it"), so a group every one of whose leaves is a relocation is a relocation.
 *
 * **A truncated group is never downgraded.** Its dropped children are unknown, and "every child I
 * can see is a move" is not "every child is a move" - reading it as one would draw the weakest mark
 * over a node whose parameters changed, which is the one mistake this whole scheme is against.
 */
export function changeMaskTone(change: DocumentChange): ChangeMaskTone {
    if (change.kind !== "changed") {
        return change.kind;
    }
    const children = change.children ?? [];
    if (children.length === 0 || (change.truncated ?? 0) > 0) {
        return "changed";
    }
    return children.every(child => child.kind === "moved") ? "moved" : "changed";
}

/**
 * How many changes one row stands for - a group's children, or itself when it has none.
 *
 * The same arithmetic `countDocumentChanges` does over a list, for one row, so that "this mask
 * covers 3 of the 12" adds up to the number the index shows.
 */
export function changeLeafCount(change: DocumentChange): number {
    return (change.children?.length ?? 1) + (change.truncated ?? 0);
}

/** Which of the two columns a change belongs in. A removal was never in the new one. */
export function maskColumns(kind: DocumentChange["kind"]): { onBase: boolean; onHead: boolean } {
    switch (kind) {
        case "added":
            return { onBase: false, onHead: true };
        case "removed":
            return { onBase: true, onHead: false };
        default:
            return { onBase: true, onHead: true };
    }
}
