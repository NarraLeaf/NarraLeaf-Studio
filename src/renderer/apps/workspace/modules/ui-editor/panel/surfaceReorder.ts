import type { UISurface, UISurfaceKind } from "@shared/types/ui-editor/document";

/** Which half of a card the pointer is in. */
export type SurfaceDropEdge = "before" | "after";

export function surfaceEdgeFromPointer(clientY: number, rect: { top: number; height: number }): SurfaceDropEdge {
    return clientY < rect.top + rect.height / 2 ? "before" : "after";
}

/**
 * The visible cards' order after a drop, or null when the drop would change nothing.
 *
 * Null is what the list draws its answer from as well as what the write is gated on: dropping a card
 * back on its own edge is the position it already has, and a row that lit up and then wrote nothing
 * would be the worse of the two answers.
 *
 * The anchor is read off the list **with the dragged card taken out**, because that is the list it
 * is inserted into - read off the list as drawn, "after the card above me" would be one position too
 * far whenever a card moves down.
 */
export function moveSurfaceIdWithinKind(
    visibleIds: readonly string[],
    draggedId: string,
    anchorId: string,
    edge: SurfaceDropEdge,
): string[] | null {
    if (draggedId === anchorId) {
        return null;
    }
    const fromIndex = visibleIds.indexOf(draggedId);
    if (fromIndex === -1) {
        return null;
    }
    const remaining = visibleIds.filter(id => id !== draggedId);
    const anchorIndex = remaining.indexOf(anchorId);
    if (anchorIndex === -1) {
        return null;
    }
    const insertAt = edge === "before" ? anchorIndex : anchorIndex + 1;
    if (insertAt === fromIndex) {
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
    anchorId: string,
    edge: SurfaceDropEdge,
): string[] | null {
    const visible = surfaces.filter(surface => surface.kind === kind).map(surface => surface.id);
    const moved = moveSurfaceIdWithinKind(visible, draggedId, anchorId, edge);
    if (!moved) {
        return null;
    }
    let next = 0;
    return surfaces.map(surface => (surface.kind === kind ? moved[next++] : surface.id));
}
