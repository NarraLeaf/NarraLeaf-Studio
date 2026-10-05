import type { UIDocument, UILayout } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { getElementSurfaceTopLeft } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import { nearestGridValue } from "@/lib/ui-editor/snapping/gridSnap";
import { getElementSurfaceAlignRect, getUiEditorPositionMovers } from "./uiEditorAlign";

/** The document persists geometry at 2 decimals (`roundUILayoutGeometryFields`). */
const GEOMETRY_ROUND_FACTOR = 100;

function roundsToSameGeometry(next: number, current: number): boolean {
    return Math.round(next * GEOMETRY_ROUND_FACTOR) === Math.round(current * GEOMETRY_ROUND_FACTOR);
}

/**
 * The layout patches one snap-to-grid press writes: each movable selected element's top-left
 * corner moved to the nearest grid point.
 *
 * Each element snaps on its own - it is the key for tidying up things that were placed by hand, so
 * every one of them ends up on the grid, rather than the selection moving as a block. The corner is
 * the element's layout box in surface space with rotation ignored (`getElementSurfaceAlignRect`),
 * and the grid's origin is the surface's top-left, so a child of an offset container lands on the
 * screen's grid points too. Its stored `x`/`y` is written back against its parent's surface
 * top-left - not through `surfaceRectToParentLocalLayout`, which would clamp a negative local
 * position to 0 - and against its own anchor, which sits `min(0, extent)` off the visual edge.
 *
 * What counts as movable is the align commands' rule (`getUiEditorPositionMovers`). An element
 * already on the grid gets no patch, so `{}` means the press would change nothing.
 */
export function computeUiEditorSnapToGridPatches(
    document: UIDocument,
    surfaceId: string,
    selection: UIElementSelection | null,
    spacing: number,
): Record<string, Partial<UILayout>> {
    const patches: Record<string, Partial<UILayout>> = {};
    if (!selection || selection.surfaceId !== surfaceId || selection.elementIds.length === 0 || !(spacing > 0)) {
        return patches;
    }
    for (const elementId of getUiEditorPositionMovers(document, selection)) {
        const element = document.elements[elementId];
        const rect = getElementSurfaceAlignRect(document, elementId);
        if (!element || element.parentId == null || !rect) {
            continue;
        }
        const parentOrigin = getElementSurfaceTopLeft(document, element.parentId);
        const nextX = nearestGridValue(rect.left, spacing) - parentOrigin.x - Math.min(0, element.layout.width);
        const nextY = nearestGridValue(rect.top, spacing) - parentOrigin.y - Math.min(0, element.layout.height);
        const patch: Partial<UILayout> = {};
        if (!roundsToSameGeometry(nextX, element.layout.x)) {
            patch.x = nextX;
        }
        if (!roundsToSameGeometry(nextY, element.layout.y)) {
            patch.y = nextY;
        }
        if (patch.x !== undefined || patch.y !== undefined) {
            patches[elementId] = patch;
        }
    }
    return patches;
}

/**
 * Moves each movable selected element's top-left corner to the nearest grid point, in one document
 * mutation - one `documentChanged`, one undo step, however many elements moved.
 *
 * Returns false and writes nothing when nothing would move: the selection is a stack or list child,
 * a page root, or already on the grid. So a press that does nothing leaves no undo step behind.
 */
export function uiEditorSnapSelectionToGrid(
    documentService: UIDocumentService,
    surfaceId: string,
    selection: UIElementSelection | null,
    spacing: number,
): boolean {
    if (!selection || selection.surfaceId !== surfaceId) {
        return false;
    }
    const patches = computeUiEditorSnapToGridPatches(documentService.getDocument(), surfaceId, selection, spacing);
    if (Object.keys(patches).length === 0) {
        return false;
    }
    documentService.updateElementLayouts(patches);
    return true;
}
