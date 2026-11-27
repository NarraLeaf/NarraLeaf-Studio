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

/** Where on a row a drag is held: just above it, just below it, or into it. */
export type OutlineDropZone = "before" | "after" | "inside";

/** A row a drag is held over, and where on it. */
export type OutlineDropTarget = { rowId: string; zone: OutlineDropZone };

/**
 * Which zone of a row a pointer at `pointerY` is in. A row that takes children splits into a top
 * quarter (above), a middle half (into) and a bottom quarter (below); any other row into its two
 * halves. Every pixel of the row is somewhere to drop - the outline used to answer only on 8px
 * strips between rows, which opened up as the drag began and pushed the rows away from the pointer.
 */
export function resolveOutlineDropZone(rowTop: number, rowHeight: number, pointerY: number, canNest: boolean): OutlineDropZone {
    const ratio = rowHeight > 0 ? (pointerY - rowTop) / rowHeight : 0.5;
    if (!canNest) {
        return ratio < 0.5 ? "before" : "after";
    }
    if (ratio < 0.25) {
        return "before";
    }
    if (ratio > 0.75) {
        return "after";
    }
    return "inside";
}

function isWithin(document: UIDocument, elementId: string, ancestorIds: ReadonlySet<string>): boolean {
    let cur: string | null = elementId;
    for (let guard = 0; cur && guard < 256; guard++) {
        if (ancestorIds.has(cur)) {
            return true;
        }
        cur = document.elements[cur]?.parentId ?? null;
    }
    return false;
}

/**
 * The parent and outline position a drop lands at, or `null` where it cannot land: on or inside a
 * layer being dragged (a layer cannot go into itself), into a layer that takes no children, or beside
 * the page's root. `acceptsChildren` answers for a parent (part-slot widgets and a component's frame
 * holder refuse); `null` is what the outline leaves unlit, rather than lighting a line the move then
 * refuses.
 */
export function planOutlineDrop(
    document: UIDocument,
    movers: readonly string[],
    target: OutlineDropTarget,
    acceptsChildren: (parent: UIElement) => boolean,
): { parentId: string; visualIndex: number } | null {
    const row = document.elements[target.rowId];
    if (!row || isWithin(document, row.id, new Set(movers))) {
        return null;
    }
    if (target.zone === "inside") {
        return acceptsChildren(row) ? { parentId: row.id, visualIndex: 0 } : null;
    }
    const parent = row.parentId ? document.elements[row.parentId] : null;
    if (!parent || !acceptsChildren(parent)) {
        return null;
    }
    const index = getOutlineVisualChildren(parent).indexOf(row.id);
    if (index < 0) {
        return null;
    }
    return { parentId: parent.id, visualIndex: target.zone === "before" ? index : index + 1 };
}

/**
 * Every row the outline shows, top to bottom: what Shift-click selects a range of, and what the
 * arrow keys walk. A collapsed branch's rows are not shown and are skipped.
 */
export function listVisibleOutlineRows(
    document: UIDocument,
    rootId: string,
    isCollapsed: (elementId: string) => boolean,
): string[] {
    const rows: string[] = [];
    const walk = (elementId: string) => {
        const element = document.elements[elementId];
        if (!element) {
            return;
        }
        rows.push(elementId);
        if (element.childrenIds.length > 0 && !isCollapsed(elementId)) {
            getOutlineVisualChildren(element).forEach(walk);
        }
    };
    const root = document.elements[rootId];
    if (!root) {
        return rows;
    }
    // The root itself is a row; its children follow.
    walk(rootId);
    return rows;
}
