import type { UIDocument, UILayout } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { getUiEditorPositionMovers } from "./uiEditorAlign";

/** Design pixels one arrow press moves the selection. */
export const UI_EDITOR_NUDGE_STEP = 1;
/** Design pixels one Shift+arrow press moves the selection. */
export const UI_EDITOR_NUDGE_LARGE_STEP = 10;

/**
 * The merge key for a nudge of these elements.
 *
 * Keyed by the elements and not by the direction, so pressing Right, Right, Down on one selection is
 * a single undo step - the author moved one thing into place - while nudging something else, or the
 * same elements after the merge window has passed, starts a new one. Sorted because the canvas
 * rewrites `elementIds` in DOM hit order.
 */
export function uiEditorNudgeMergeKey(surfaceId: string, elementIds: readonly string[]): string {
    return `nudge:${surfaceId}:${[...elementIds].sort().join(",")}`;
}

/**
 * The layout patches one nudge writes: `dx`/`dy` added to each movable element's stored `x`/`y`.
 *
 * A pure delta in the element's own coordinates - no snapping and no rounding to whole pixels, so an
 * element at 10.5 moves to 11.5. The stored coordinate is the box's anchor whichever way its extent
 * points, so a negative width or height needs nothing special: the whole box moves by the delta.
 * What counts as movable is the align commands' rule (`getUiEditorPositionMovers`).
 */
export function computeUiEditorNudgePatches(
    document: UIDocument,
    surfaceId: string,
    selection: UIElementSelection | null,
    dx: number,
    dy: number,
): Record<string, Partial<UILayout>> {
    const patches: Record<string, Partial<UILayout>> = {};
    if (!selection || selection.surfaceId !== surfaceId || selection.elementIds.length === 0) {
        return patches;
    }
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
        return patches;
    }
    for (const elementId of getUiEditorPositionMovers(document, selection)) {
        const layout = document.elements[elementId]?.layout;
        if (!layout) {
            continue;
        }
        const patch: Partial<UILayout> = {};
        if (dx !== 0) {
            patch.x = layout.x + dx;
        }
        if (dy !== 0) {
            patch.y = layout.y + dy;
        }
        patches[elementId] = patch;
    }
    return patches;
}

/**
 * Moves the selection by `dx`/`dy` design pixels, in one document mutation.
 *
 * Returns false and writes nothing when nothing selected can move, so a press on a stack child or a
 * page's root leaves no undo step behind. Consecutive presses on the same elements within the
 * history merge window fold into one undo step (see {@link uiEditorNudgeMergeKey}), which is also
 * what keeps a held key's auto-repeat to a single step.
 */
export function uiEditorNudge(
    documentService: UIDocumentService,
    surfaceId: string,
    selection: UIElementSelection | null,
    dx: number,
    dy: number,
): boolean {
    if (!selection || selection.surfaceId !== surfaceId) {
        return false;
    }
    const patches = computeUiEditorNudgePatches(documentService.getDocument(), surfaceId, selection, dx, dy);
    const movedIds = Object.keys(patches);
    if (movedIds.length === 0) {
        return false;
    }
    documentService.updateElementLayouts(patches, { mergeKey: uiEditorNudgeMergeKey(surfaceId, movedIds) });
    return true;
}
