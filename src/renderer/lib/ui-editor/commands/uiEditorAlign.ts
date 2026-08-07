import type { UIDocument, UIElement, UILayout } from "@shared/types/ui-editor/document";
import { isUIElementFlowLayoutChild } from "@shared/types/ui-editor/document";
import { getUISliderChildSlot } from "@shared/types/ui-editor/slider";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { getElementSurfaceTopLeft } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";
import { filterSelectionToTopLevelMovers } from "./uiEditorSelection";

const ROOT_WIDGET_TYPE = "nl.root";
const SLIDER_WIDGET_TYPE = "nl.slider";

/** The document persists geometry at 2 decimals (`roundUILayoutGeometryFields`). */
const GEOMETRY_ROUND_FACTOR = 100;

export type UiEditorAlignOp =
    | "left"
    | "horizontalCenter"
    | "right"
    | "top"
    | "verticalCenter"
    | "bottom"
    | "distributeHorizontal"
    | "distributeVertical";

export type UiEditorAlignAvailability = { [K in UiEditorAlignOp]: boolean };

export const UI_EDITOR_ALIGN_OPS: readonly UiEditorAlignOp[] = [
    "left",
    "horizontalCenter",
    "right",
    "top",
    "verticalCenter",
    "bottom",
    "distributeHorizontal",
    "distributeVertical",
];

/** An element's layout box in surface (root) space, always with positive extents. */
export type UiEditorAlignRect = {
    id: string;
    left: number;
    top: number;
    width: number;
    height: number;
};

export type UiEditorAlignBox = {
    left: number;
    top: number;
    width: number;
    height: number;
};

function isHorizontalOp(op: UiEditorAlignOp): boolean {
    return op === "left" || op === "horizontalCenter" || op === "right" || op === "distributeHorizontal";
}

function isDistributeOp(op: UiEditorAlignOp): boolean {
    return op === "distributeHorizontal" || op === "distributeVertical";
}

function roundsToSameGeometry(next: number, current: number): boolean {
    return Math.round(next * GEOMETRY_ROUND_FACTOR) === Math.round(current * GEOMETRY_ROUND_FACTOR);
}

/**
 * Elements this can actually move.
 *
 * Beyond the roots that arrange also refuses, three kinds are dropped because writing `x`/`y` on
 * them is a lie: flow-layout children (a stack/scroll container's or a list's direct children) have
 * their offsets zeroed on every write by `normalizeFlowChildLayout`, and a slider's track and handle
 * are laid out from the slider's value at render time.
 */
function getAlignMovers(document: UIDocument, selection: UIElementSelection): string[] {
    return filterSelectionToTopLevelMovers(document, selection).filter(id => {
        const element = document.elements[id];
        if (!element || element.parentId == null) {
            return false;
        }
        if (element.type === ROOT_WIDGET_TYPE || isComponentEditorRootElement(element)) {
            return false;
        }
        if (isUIElementFlowLayoutChild(document, element)) {
            return false;
        }
        const parent = document.elements[element.parentId];
        if (parent?.type === SLIDER_WIDGET_TYPE && getUISliderChildSlot(element.extra) != null) {
            return false;
        }
        return true;
    });
}

/**
 * The element's box in surface space.
 *
 * Negative `width`/`height` are legal and mean the box extends left/up from `(x, y)`, so the visual
 * left edge is `x + min(0, width)` - which is what {@link getElementSurfaceTopLeft} already walks -
 * and the extent is the absolute value. Rotation is deliberately ignored: the editor's own snapping
 * and the inspector both work on the unrotated layout box.
 */
export function getElementSurfaceAlignRect(document: UIDocument, elementId: string): UiEditorAlignRect | null {
    const element = document.elements[elementId];
    if (!element) {
        return null;
    }
    const origin = getElementSurfaceTopLeft(document, elementId);
    return {
        id: elementId,
        left: origin.x,
        top: origin.y,
        width: Math.abs(element.layout.width),
        height: Math.abs(element.layout.height),
    };
}

/** @internal Exported for unit tests */
export function unionUiEditorAlignBox(rects: readonly UiEditorAlignRect[]): UiEditorAlignBox | null {
    if (rects.length === 0) {
        return null;
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const rect of rects) {
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.left + rect.width);
        bottom = Math.max(bottom, rect.top + rect.height);
    }
    return { left, top, width: right - left, height: bottom - top };
}

/**
 * The box a lone element aligns inside: its parent's layout box, in surface space.
 *
 * For a top-level element the parent is the surface root, which has no box of its own on the canvas -
 * the frame the author sees is the surface `designSize` at the origin.
 */
export function getUiEditorAlignParentBox(
    document: UIDocument,
    surfaceId: string,
    parentId: string,
): UiEditorAlignBox | null {
    const parent = document.elements[parentId];
    if (!parent) {
        return null;
    }
    if (parent.type === ROOT_WIDGET_TYPE) {
        const designSize = document.surfaces.find(surface => surface.id === surfaceId)?.designSize;
        if (!designSize) {
            return null;
        }
        return { left: 0, top: 0, width: designSize.width, height: designSize.height };
    }
    const origin = getElementSurfaceTopLeft(document, parentId);
    return {
        left: origin.x,
        top: origin.y,
        width: Math.abs(parent.layout.width),
        height: Math.abs(parent.layout.height),
    };
}

/**
 * New surface-space start (left for horizontal ops, top for vertical ops) per element.
 *
 * @internal Exported for unit tests
 */
export function computeUiEditorAlignedStarts(
    rects: readonly UiEditorAlignRect[],
    box: UiEditorAlignBox,
    op: UiEditorAlignOp,
): Map<string, number> {
    const starts = new Map<string, number>();
    for (const rect of rects) {
        switch (op) {
            case "left":
                starts.set(rect.id, box.left);
                break;
            case "horizontalCenter":
                starts.set(rect.id, box.left + (box.width - rect.width) / 2);
                break;
            case "right":
                starts.set(rect.id, box.left + box.width - rect.width);
                break;
            case "top":
                starts.set(rect.id, box.top);
                break;
            case "verticalCenter":
                starts.set(rect.id, box.top + (box.height - rect.height) / 2);
                break;
            case "bottom":
                starts.set(rect.id, box.top + box.height - rect.height);
                break;
            default:
                break;
        }
    }
    return starts;
}

/**
 * Equal *gaps* between adjacent boxes, the Figma and PowerPoint reading of "distribute" - not equal
 * centre spacing, which spreads unequally sized elements unevenly to the eye.
 *
 * The two elements at the ends of the axis stay where they are and everything between them is
 * re-laid at a constant gap. Ordering is by current position along the axis, so the result does not
 * depend on selection order (which the canvas rewrites in DOM hit order) or on document order.
 *
 * @internal Exported for unit tests
 */
export function computeUiEditorDistributedStarts(
    rects: readonly UiEditorAlignRect[],
    axis: "horizontal" | "vertical",
): Map<string, number> {
    const starts = new Map<string, number>();
    if (rects.length < 3) {
        return starts;
    }
    const start = (rect: UiEditorAlignRect) => (axis === "horizontal" ? rect.left : rect.top);
    const size = (rect: UiEditorAlignRect) => (axis === "horizontal" ? rect.width : rect.height);
    const ordered = [...rects].sort((a, b) => {
        const byStart = start(a) - start(b);
        if (byStart !== 0) {
            return byStart;
        }
        const byCentre = start(a) + size(a) / 2 - (start(b) + size(b) / 2);
        if (byCentre !== 0) {
            return byCentre;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const span = start(last) + size(last) - start(first);
    const occupied = ordered.reduce((total, rect) => total + size(rect), 0);
    const gap = (span - occupied) / (ordered.length - 1);

    let cursor = start(first) + size(first);
    for (let index = 1; index < ordered.length - 1; index++) {
        const next = cursor + gap;
        starts.set(ordered[index].id, next);
        cursor = next + size(ordered[index]);
    }
    return starts;
}

function layoutPatchForSurfaceStart(
    document: UIDocument,
    element: UIElement,
    parentId: string,
    nextStart: number,
    horizontal: boolean,
): Partial<UILayout> | null {
    const parentOrigin = getElementSurfaceTopLeft(document, parentId);
    // The stored coordinate is the box's anchor, not its visual edge: a negative extent puts the
    // visual edge `min(0, extent)` to the left of / above it.
    if (horizontal) {
        const nextX = nextStart - parentOrigin.x - Math.min(0, element.layout.width);
        return roundsToSameGeometry(nextX, element.layout.x) ? null : { x: nextX };
    }
    const nextY = nextStart - parentOrigin.y - Math.min(0, element.layout.height);
    return roundsToSameGeometry(nextY, element.layout.y) ? null : { y: nextY };
}

/**
 * The complete layout patch set one align/distribute press writes, or `{}` when it would change
 * nothing.
 *
 * Everything is computed in surface space, so a selection spanning different containers still lines
 * up on screen rather than per parent.
 */
export function computeUiEditorAlignPatches(
    document: UIDocument,
    surfaceId: string,
    selection: UIElementSelection | null,
    op: UiEditorAlignOp,
): Record<string, Partial<UILayout>> {
    const patches: Record<string, Partial<UILayout>> = {};
    if (!selection || selection.surfaceId !== surfaceId || selection.elementIds.length === 0) {
        return patches;
    }
    const movers = getAlignMovers(document, selection);
    if (movers.length === 0) {
        return patches;
    }
    const rects = movers
        .map(id => getElementSurfaceAlignRect(document, id))
        .filter((rect): rect is UiEditorAlignRect => rect != null);
    if (rects.length === 0) {
        return patches;
    }

    const horizontal = isHorizontalOp(op);
    let starts: Map<string, number>;
    if (isDistributeOp(op)) {
        if (rects.length < 3) {
            return patches;
        }
        starts = computeUiEditorDistributedStarts(rects, horizontal ? "horizontal" : "vertical");
    } else {
        // One mover has no selection box to align against, so it centres inside its own container -
        // the "put this button in the middle of that panel" case.
        const box =
            rects.length >= 2
                ? unionUiEditorAlignBox(rects)
                : getUiEditorAlignParentBox(document, surfaceId, document.elements[rects[0].id]?.parentId ?? "");
        if (!box) {
            return patches;
        }
        starts = computeUiEditorAlignedStarts(rects, box, op);
    }

    for (const [elementId, nextStart] of starts) {
        const element = document.elements[elementId];
        if (!element || element.parentId == null || !Number.isFinite(nextStart)) {
            continue;
        }
        const patch = layoutPatchForSurfaceStart(document, element, element.parentId, nextStart, horizontal);
        if (patch) {
            patches[elementId] = patch;
        }
    }
    return patches;
}

/**
 * Whether each align action would do anything for the current selection (same rules as the command).
 */
export function getUiEditorAlignAvailability(
    document: UIDocument,
    surfaceId: string,
    selection: UIElementSelection | null,
): UiEditorAlignAvailability {
    const availability = {} as UiEditorAlignAvailability;
    for (const op of UI_EDITOR_ALIGN_OPS) {
        availability[op] = Object.keys(computeUiEditorAlignPatches(document, surfaceId, selection, op)).length > 0;
    }
    return availability;
}

/**
 * Aligns or distributes the selection, in one document mutation.
 *
 * The single `updateElementLayouts` call is load-bearing: it is one `documentChanged`, one history
 * snapshot and one undo step regardless of how many elements moved. Looping the singular
 * `updateElementLayout` would give the author eight undos to press for one align.
 */
export function uiEditorAlign(
    documentService: UIDocumentService,
    surfaceId: string,
    selection: UIElementSelection | null,
    op: UiEditorAlignOp,
): boolean {
    if (!selection || selection.surfaceId !== surfaceId) {
        return false;
    }
    const patches = computeUiEditorAlignPatches(documentService.getDocument(), surfaceId, selection, op);
    if (Object.keys(patches).length === 0) {
        return false;
    }
    documentService.updateElementLayouts(patches);
    return true;
}
