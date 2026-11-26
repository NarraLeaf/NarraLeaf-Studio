import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { UI_SWITCH_ELEMENT_TYPE } from "@shared/types/ui-editor/switch";
import { isStrictDescendantOf } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";

/**
 * When true, the next canvas `dblclick` handler should not run widget actions (inline text edit, image crop, …)
 * because the gesture was consumed by container drill selection on pointerdown.
 */
let suppressNextCanvasWidgetDoubleClick = false;
let suppressNextCanvasWidgetDoubleClickClearTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSuppressNextCanvasWidgetDoubleClickClear(delayMs: number): void {
    if (suppressNextCanvasWidgetDoubleClickClearTimer) {
        clearTimeout(suppressNextCanvasWidgetDoubleClickClearTimer);
    }
    suppressNextCanvasWidgetDoubleClickClearTimer = setTimeout(() => {
        suppressNextCanvasWidgetDoubleClick = false;
        suppressNextCanvasWidgetDoubleClickClearTimer = null;
    }, delayMs);
}

export function markSuppressNextCanvasWidgetDoubleClick(): void {
    suppressNextCanvasWidgetDoubleClick = true;
    scheduleSuppressNextCanvasWidgetDoubleClickClear(750);
}

export function hasSuppressNextCanvasWidgetDoubleClick(): boolean {
    return suppressNextCanvasWidgetDoubleClick;
}

export function consumeSuppressNextCanvasWidgetDoubleClick(): boolean {
    if (!suppressNextCanvasWidgetDoubleClick) {
        return false;
    }
    scheduleSuppressNextCanvasWidgetDoubleClickClear(0);
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
 * True when a deep hit should be promoted to the direct child of the surface root.
 *
 * Promotion happens when:
 * - Selection is empty/absent, OR
 * - The hit element and the current selection live under different top-level frames
 *   (i.e. the user switched to a completely different subtree)
 */
export function shouldPromoteToSurfaceRootChild(
    document: UIDocument,
    selection: UIElementSelection | null | undefined,
    surfaceId: string,
    hitElementId: string,
): boolean {
    if (isEmptyOrAbsentUiSelection(selection, surfaceId)) {
        return true;
    }
    const hitFrame = promoteHitToDirectChildOfSurfaceRoot(document, surfaceId, hitElementId);
    for (const selectedId of selection!.elementIds) {
        const selectedFrame = promoteHitToDirectChildOfSurfaceRoot(document, surfaceId, selectedId);
        if (selectedFrame === hitFrame) {
            return false;
        }
    }
    return true;
}

/**
 * What a Shift press adds to (or takes from) the selection: the element on the press's ancestor chain
 * that sits beside the selection's primary element - a sibling of it, or the element itself.
 *
 * A plain press picks the outermost frame and a press inside the selected container drills one level,
 * so the selection is always at one level of the tree; Shift keeps adding at that same level. Adding
 * the deepest hit instead turned "panel selected, Shift-click a button inside it" into a parent and its
 * own child, and the child then silently dropped out of every move. A press nowhere near that level -
 * another frame altogether - adds that frame, as a plain press there would have picked it.
 * Cmd/Ctrl is what reaches past the level (`deep`).
 */
export function resolveSelectionLevelHit(
    document: UIDocument,
    surfaceId: string,
    selection: UIElementSelection,
    hitElementId: string,
): string {
    const anchorId = selection.primaryId ?? selection.elementIds[selection.elementIds.length - 1];
    const anchorParentId = anchorId ? document.elements[anchorId]?.parentId ?? null : null;
    if (anchorParentId) {
        let cur: string | null = hitElementId;
        for (let guard = 0; cur && guard < 256; guard++) {
            const element: UIDocument["elements"][string] | undefined = document.elements[cur];
            if (!element) {
                break;
            }
            if (element.parentId === anchorParentId) {
                return cur;
            }
            cur = element.parentId ?? null;
        }
    }
    return promoteHitToDirectChildOfSurfaceRoot(document, surfaceId, hitElementId);
}

/**
 * The parent whose children a marquee picks from: the level the selection is at, or the page's root
 * when nothing on this surface is selected. Picking every element the rectangle touches, at every
 * depth, put a container and all of its own children into one selection.
 */
export function resolveMarqueeLevelParent(
    document: UIDocument,
    surfaceId: string,
    selection: UIElementSelection | null | undefined,
): string | null {
    const rootId = resolveSurfaceRootElementId(document, surfaceId);
    if (isEmptyOrAbsentUiSelection(selection, surfaceId)) {
        return rootId;
    }
    const anchorId = selection!.primaryId ?? selection!.elementIds[selection!.elementIds.length - 1];
    return (anchorId ? document.elements[anchorId]?.parentId : null) ?? rootId;
}

/**
 * The elements a marquee selects out of everything it touched (`hitIds`, any depth): those at
 * `levelParentId`. When none of them is at that level - the rectangle was drawn somewhere else on the
 * page entirely - it falls back to the outermost frames it touched, as a press there would.
 */
export function filterMarqueeHitsToLevel(
    document: UIDocument,
    surfaceId: string,
    levelParentId: string | null,
    hitIds: readonly string[],
): string[] {
    const atLevel = hitIds.filter(id => document.elements[id]?.parentId === levelParentId);
    if (atLevel.length > 0) {
        return atLevel;
    }
    const promoted: string[] = [];
    for (const id of hitIds) {
        const frame = promoteHitToDirectChildOfSurfaceRoot(document, surfaceId, id);
        if (!promoted.includes(frame)) {
            promoted.push(frame);
        }
    }
    return promoted;
}

/**
 * True when `hitElementId` is a strict descendant of the single selected drillable structural widget.
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
    const drillable =
        selectedEl?.type === "nl.container" ||
        selectedEl?.type === "nl.slider" ||
        selectedEl?.type === UI_SWITCH_ELEMENT_TYPE;
    if (!selectedEl || !drillable || (selectedEl.childrenIds?.length ?? 0) === 0) {
        return false;
    }
    return isStrictDescendantOf(document, hitElementId, selectedId);
}

/**
 * Resolve the next element to select when drilling into the currently selected structural parent.
 * A deep hit advances one hierarchy level instead of jumping straight to the deepest leaf.
 */
export function resolveUiContainerDrillTarget(
    document: UIDocument,
    surfaceId: string,
    selection: UIElementSelection | null,
    hitElementId: string,
): string | null {
    if (!isUiContainerDrillLockHit(document, surfaceId, selection, hitElementId) || !selection) {
        return null;
    }
    const selectedId = selection.elementIds[0];
    let currentId = hitElementId;
    for (let guard = 0; guard < 256; guard++) {
        const element = document.elements[currentId];
        if (!element?.parentId) {
            return null;
        }
        if (element.parentId === selectedId) {
            return currentId;
        }
        currentId = element.parentId;
    }
    return null;
}

/**
 * What a plain press on `hitElementId` selects, without pressing: the same rule
 * `useSurfaceInteractionEvents` applies on pointerdown, for whatever has to agree with it - the hover
 * frame that shows what a click would pick, and the right-click that selects before its menu opens.
 *
 * - Inside the selected container, a single press keeps the container (drilling takes a double one).
 * - Under another top-level frame than the selection, or with nothing selected, the frame.
 * - Otherwise the element hit.
 */
export function resolvePlainPressTarget(
    document: UIDocument,
    surfaceId: string,
    selection: UIElementSelection | null,
    hitElementId: string,
): string {
    if (selection && isUiContainerDrillLockHit(document, surfaceId, selection, hitElementId)) {
        return selection.elementIds[0];
    }
    return shouldPromoteToSurfaceRootChild(document, selection, surfaceId, hitElementId)
        ? promoteHitToDirectChildOfSurfaceRoot(document, surfaceId, hitElementId)
        : hitElementId;
}
