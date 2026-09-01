import type { UISurface, UISurfaceKind } from "@shared/types/ui-editor/document";

/** Which half of a card the pointer is in. */
export type SurfaceDropHalf = "top" | "bottom";

/**
 * Where a dragged card would land, as an index into the gaps between cards.
 *
 * `n` cards have `n + 1` gaps, and the bottom half of card `i` is the same gap as the top half of
 * card `i + 1` - so the pointer has one answer at the seam rather than two a few pixels apart, and
 * the list draws one line for it. The story outline states the same model one panel along.
 */
export type SurfaceDropGap = number;

export function surfaceHalfFromPointer(clientY: number, rect: { top: number; height: number }): SurfaceDropHalf {
    return clientY < rect.top + rect.height / 2 ? "top" : "bottom";
}

/** The gap a pointer in this half of this card is aiming at. */
export function surfaceGapForCard(cardIndex: number, half: SurfaceDropHalf): SurfaceDropGap {
    return half === "top" ? cardIndex : cardIndex + 1;
}

/**
 * The card the one indicator hangs on, and which edge of it.
 *
 * A gap is drawn as the top edge of the card below it, and never also as the bottom edge of the card
 * above, so one gap is one line in one place.
 */
export function surfaceGapAnchor(
    cardCount: number,
    gap: SurfaceDropGap,
): { cardIndex: number; edge: "before" | "after" } | null {
    if (cardCount === 0 || gap < 0 || gap > cardCount) {
        return null;
    }
    return gap < cardCount
        ? { cardIndex: gap, edge: "before" }
        : { cardIndex: cardCount - 1, edge: "after" };
}

/**
 * The visible cards' order after a drop, or null when the drop would change nothing.
 *
 * Null is what the list draws its answer from as well as what the write is gated on: the two gaps
 * either side of a card are the position it already has, and a line that lit up there and then wrote
 * nothing would be the worse of the two answers.
 *
 * The anchor is read off the list **with the dragged card taken out**, because that is the list it
 * is inserted into - read off the list as drawn, a card moving down would land one place too far.
 */
export function moveSurfaceIdToGap(
    visibleIds: readonly string[],
    draggedId: string,
    gap: SurfaceDropGap,
): string[] | null {
    const fromIndex = visibleIds.indexOf(draggedId);
    if (fromIndex === -1 || gap < 0 || gap > visibleIds.length) {
        return null;
    }
    const remaining = visibleIds.filter(id => id !== draggedId);
    const anchorId = gap < visibleIds.length ? visibleIds[gap] : null;
    const insertAt = anchorId === null ? remaining.length : remaining.indexOf(anchorId);
    if (insertAt === -1 || insertAt === fromIndex) {
        return null;
    }
    remaining.splice(insertAt, 0, draggedId);
    return remaining;
}

/**
 * The order the whole document should hold after a card is dropped, or null when nothing moves.
 *
 * **The panel shows one kind at a time and the document holds one array.** So the move is worked out
 * within the visible kind, and the result is written back into the positions that kind already
 * occupies - a Page dropped last among the Pages stays wherever the Pages are, rather than jumping
 * behind every Game UI. The other kind's cards do not move at all.
 */
export function reorderSurfacesForDrop(
    surfaces: readonly UISurface[],
    kind: UISurfaceKind,
    draggedId: string,
    gap: SurfaceDropGap,
): string[] | null {
    const visible = surfaces.filter(surface => surface.kind === kind).map(surface => surface.id);
    const moved = moveSurfaceIdToGap(visible, draggedId, gap);
    if (!moved) {
        return null;
    }
    let next = 0;
    return surfaces.map(surface => (surface.kind === kind ? moved[next++] : surface.id));
}
