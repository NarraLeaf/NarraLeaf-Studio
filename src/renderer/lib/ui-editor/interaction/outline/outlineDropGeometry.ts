import { isUIFlowLayoutParentElement, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import type { MoveUiElementsResult } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";

/**
 * A parent's children in the order the outline lists them.
 *
 * A parent that lays its children out in flow - a stack or scroll container, a list - lists them in
 * that order, first child on top, because that is the order they appear in on screen and the order
 * an author reorders them by. Anywhere else children overlap freely and the order that matters is
 * which one is in front: `childrenIds` paints back to front, so the outline shows it reversed, the
 * front-most layer on top.
 */
export function getOutlineVisualChildren(parent: UIElement): string[] {
    return isUIFlowLayoutParentElement(parent) ? [...parent.childrenIds] : [...parent.childrenIds].reverse();
}

/**
 * The child a drop on one of the outline's gaps goes in front of, in document order (`null` for the
 * end), or `undefined` when there is no such parent.
 *
 * `visualInsertIndex` counts gaps over every row the parent lists, the dragged ones included: gap
 * `i` sits above the `i`-th row. The moved rows leave their places first, so the rows above the gap
 * that are being moved do not count towards where it lands - without that, every drag downwards in
 * the parent it started in landed one row too low.
 */
export function resolveBeforeChildIdForOutlineGap(
    document: UIDocument,
    targetParentId: string,
    movers: string[],
    visualInsertIndex: number,
): string | null | undefined {
    const targetParent = document.elements[targetParentId];
    if (!targetParent) {
        return undefined;
    }

    const moverSet = new Set(movers);
    const visualChildren = getOutlineVisualChildren(targetParent);
    const visualWithoutMovers = visualChildren.filter(id => !moverSet.has(id));
    const clampedGap = Math.max(0, Math.min(visualInsertIndex, visualChildren.length));
    const insertAt = visualChildren.slice(0, clampedGap).filter(id => !moverSet.has(id)).length;

    if (isUIFlowLayoutParentElement(targetParent)) {
        // Listed in document order: the row under the gap is the child to go in front of.
        return visualWithoutMovers[insertAt] ?? null;
    }
    // Listed front to back: the row above the gap is in front of the moved layers, so they go just
    // behind it in `childrenIds`; at the very top they become the front-most layer, the end.
    return insertAt === 0 ? null : visualWithoutMovers[insertAt - 1] ?? null;
}

export function moveLogReason(result: MoveUiElementsResult): void {
    if (!result.ok) {
        console.warn("[UILayersPanel] moveElementsInSurface rejected:", result.reason);
    }
}
