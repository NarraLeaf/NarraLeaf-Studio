import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { MoveUiElementsResult } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";

export function getOutlineVisualChildren(parent: UIElement): string[] {
    // Paint order is back -> front in `childrenIds`, but the outline should show front-most layers first.
    return [...parent.childrenIds].reverse();
}

export function resolveBeforeChildIdForOutlineDrop(
    document: UIDocument,
    targetParentId: string,
    movers: string[],
    overId: string,
): string | null | undefined {
    const targetParent = document.elements[targetParentId];
    if (!targetParent) {
        return undefined;
    }
    const moverSet = new Set(movers);
    if (moverSet.has(overId)) {
        return undefined;
    }

    const visualChildren = getOutlineVisualChildren(targetParent);
    const overFullIndex = visualChildren.indexOf(overId);
    if (overFullIndex === -1) {
        return undefined;
    }

    const visualWithoutMovers = visualChildren.filter(id => !moverSet.has(id));
    const overFilteredIndex = visualWithoutMovers.indexOf(overId);
    if (overFilteredIndex === -1) {
        return undefined;
    }

    let minMoverVisualIndex = Number.POSITIVE_INFINITY;
    visualChildren.forEach((childId, index) => {
        if (moverSet.has(childId)) {
            minMoverVisualIndex = Math.min(minMoverVisualIndex, index);
        }
    });

    // DnD Kit reports the visual row under the pointer. When movers come from the same parent and start
    // above that row, removing them first shifts the eventual insertion point one slot later.
    const insertVisualIndex =
        minMoverVisualIndex < overFullIndex ? overFilteredIndex + 1 : overFilteredIndex;

    return insertVisualIndex <= 0 ? null : visualWithoutMovers[insertVisualIndex - 1] ?? null;
}

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
    const visualWithoutMovers = getOutlineVisualChildren(targetParent).filter(id => !moverSet.has(id));
    const clampedVisualIndex = Math.max(0, Math.min(visualInsertIndex, visualWithoutMovers.length));

    // `childrenIds` is back -> front, while the outline is front -> back.
    const documentChildren = [...visualWithoutMovers].reverse();
    const documentInsertIndex = visualWithoutMovers.length - clampedVisualIndex;
    return documentInsertIndex >= documentChildren.length ? null : documentChildren[documentInsertIndex] ?? null;
}

export function moveLogReason(result: MoveUiElementsResult): void {
    if (!result.ok) {
        console.warn("[UILayersPanel] moveElementsInSurface rejected:", result.reason);
    }
}
