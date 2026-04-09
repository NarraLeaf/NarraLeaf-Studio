import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { isStrictDescendantOf } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";

/**
 * When true, the next canvas `dblclick` handler should not run widget actions (inline text edit, image crop, …)
 * because the gesture was consumed by container drill selection on pointerdown.
 */
let suppressNextCanvasWidgetDoubleClick = false;

export function markSuppressNextCanvasWidgetDoubleClick(): void {
    suppressNextCanvasWidgetDoubleClick = true;
}

export function consumeSuppressNextCanvasWidgetDoubleClick(): boolean {
    if (!suppressNextCanvasWidgetDoubleClick) {
        return false;
    }
    suppressNextCanvasWidgetDoubleClick = false;
    return true;
}

/** No UI selection on this surface, or an empty element id list. */
export function isEmptyOrAbsentUiSelection(
    selection: UIElementSelection | null | undefined,
    surfaceId: string,
): boolean {
    if (!selection || selection.surfaceId !== surfaceId) {
        return true;
    }
    return selection.elementIds.length === 0;
}

/**
 * From a deep hit, resolve the element that is the direct child of the surface root on the ancestor chain.
 * Used so an empty selection picks the top frame under root instead of the deepest leaf.
 */
export function promoteHitToDirectChildOfSurfaceRoot(
    document: UIDocument,
    surfaceId: string,
    hitElementId: string,
): string {
    const rootId = resolveSurfaceRootElementId(document, surfaceId);
    if (!rootId) {
        return hitElementId;
    }
    let cur = hitElementId;
    for (let guard = 0; guard < 256; guard++) {
        const el = document.elements[cur];
        const parentId = el?.parentId ?? null;
        if (!parentId || parentId === rootId) {
            return cur;
        }
        cur = parentId;
    }
    return hitElementId;
}

/**
 * True when `hitElementId` is a strict descendant of the single selected `nl.container` that has children.
 * Used to require double-click / selecto double to drill into children instead of a single pointer pick.
 */
export function isUiContainerDrillLockHit(
    document: UIDocument,
    surfaceId: string,
    selection: UIElementSelection | null,
    hitElementId: string,
): boolean {
    if (!selection || selection.surfaceId !== surfaceId || selection.elementIds.length !== 1) {
        return false;
    }
    const selectedId = selection.elementIds[0];
    const selectedEl = document.elements[selectedId];
    if (!selectedEl || selectedEl.type !== "nl.container" || (selectedEl.childrenIds?.length ?? 0) === 0) {
        return false;
    }
    return isStrictDescendantOf(document, hitElementId, selectedId);
}
