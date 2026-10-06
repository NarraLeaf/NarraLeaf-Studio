import type { UIDocument, UIElement, UIElementId, UILayout } from "@shared/types/ui-editor/document";
import { isUIFlowLayoutParentElement, uiElementTypeAcceptsUserChildren } from "@shared/types/ui-editor/document";
import { isComponentEditorVirtualRootId } from "@/lib/ui-editor/componentEditorRoot";
import { getElementSurfaceTopLeft, surfaceRectToParentLocalLayout } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { collectSubtreeElementIds } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";

export type InsertTargetResolutionSource = "hit" | "primary" | "effective_root";

export type InsertTargetResolution = {
    parentId: UIElementId;
    source: InsertTargetResolutionSource;
};

/**
 * Whether an author's new elements can be put in `element`.
 *
 * A component editor's made-up root answers for the definition's root, because that is where the
 * editor stores what is put in it (`ComponentDocumentServiceAdapter.mapParentId`). A definition made
 * from a single text input has a text input for a root, so its editor has nowhere to put anything;
 * the made-up root itself, an `nl.root`, would otherwise say yes to every insert and the definition
 * would refuse each one.
 */
export function isValidUIInsertParent(document: UIDocument, element: UIElement | undefined): boolean {
    if (element == null) {
        return false;
    }
    if (isComponentEditorVirtualRootId(element.id)) {
        const definitionRootId = element.childrenIds.length === 1 ? element.childrenIds[0] : undefined;
        const definitionRoot = definitionRootId ? document.elements[definitionRootId] : undefined;
        return definitionRoot != null && uiElementTypeAcceptsUserChildren(definitionRoot.type);
    }
    return uiElementTypeAcceptsUserChildren(element.type);
}

/**
 * The element that refuses new elements on this surface, or null when the surface takes them.
 *
 * Only a component editor's surface can refuse: a page's root always takes children. What refuses is
 * the definition's own root - the element the author sees as the component's frame - so its type is
 * what a greyed-out insert names.
 */
export function resolveSurfaceInsertRefusal(document: UIDocument, surfaceId: string): UIElement | null {
    const rootId = resolveSurfaceRootElementId(document, surfaceId);
    const root = rootId ? document.elements[rootId] : undefined;
    if (!root || isValidUIInsertParent(document, root)) {
        return null;
    }
    const definitionRootId = isComponentEditorVirtualRootId(root.id) ? root.childrenIds[0] : undefined;
    return (definitionRootId ? document.elements[definitionRootId] : undefined) ?? root;
}

/**
 * From a canvas/outline hit, find the nearest ancestor (including start) that may receive new children.
 */
export function resolveNearestInsertParentInSurface(
    document: UIDocument,
    surfaceId: string,
    startElementId: string | null | undefined,
): UIElementId | null {
    const effectiveRootId = resolveSurfaceRootElementId(document, surfaceId);
    if (!effectiveRootId) {
        return null;
    }
    const allowed = collectSubtreeElementIds(document, effectiveRootId);
    let cur: string | null | undefined = startElementId ?? effectiveRootId;
    while (cur) {
        if (!allowed.has(cur)) {
            return null;
        }
        const el: UIElement | undefined = document.elements[cur];
        if (isValidUIInsertParent(document, el)) {
            return cur;
        }
        cur = el?.parentId ?? null;
    }
    return null;
}

/**
 * Shared target-parent policy: deepest valid insert parent from hit (when provided), else walk up from
 * primary selection, else effective surface root (linked-aware). New-widget creation passes `hitElementId: null`
 * so the parent is never inferred from the pointer stack (avoids dropping into an unintended group).
 */
export function resolveInsertTargetParent(
    document: UIDocument,
    surfaceId: string,
    input: {
        hitElementId?: string | null;
        primaryElementId?: string | null;
    },
): InsertTargetResolution | null {
    const effectiveRootId = resolveSurfaceRootElementId(document, surfaceId);
    if (!effectiveRootId) {
        return null;
    }
    const allowed = collectSubtreeElementIds(document, effectiveRootId);

    const tryHit = (startId: string | null | undefined): UIElementId | null => {
        let cur: string | null | undefined = startId;
        while (cur) {
            if (!allowed.has(cur)) {
                return null;
            }
            const el: UIElement | undefined = document.elements[cur];
            if (isValidUIInsertParent(document, el)) {
                return cur;
            }
            cur = el?.parentId ?? null;
        }
        return null;
    };

    const fromHit = tryHit(input.hitElementId ?? null);
    if (fromHit) {
        return { parentId: fromHit, source: "hit" };
    }

    const primary = input.primaryElementId;
    if (primary && allowed.has(primary)) {
        // Walk up from primary (same as hit) so a leaf/list item resolves to its container/root,
        // not only when primary itself is already nl.root | nl.container | nl.list.
        const fromPrimary = tryHit(primary);
        if (fromPrimary) {
            return { parentId: fromPrimary, source: "primary" };
        }
    }

    return { parentId: effectiveRootId, source: "effective_root" };
}

const MIN_INSERT_SIZE = 10;

/** Layout for insert-tool drag rect (surface-space bounds). */
export function buildLayoutPatchForNewElementFromSurfaceRect(
    document: UIDocument,
    parentId: UIElementId,
    bounds: { x: number; y: number; width: number; height: number },
): Partial<UILayout> {
    const parent = document.elements[parentId];
    if (!parent) {
        return {};
    }
    const w = Math.max(MIN_INSERT_SIZE, bounds.width);
    const h = Math.max(MIN_INSERT_SIZE, bounds.height);
    if (isUIFlowLayoutParentElement(parent)) {
        return { x: 0, y: 0, width: w, height: h };
    }
    const local = surfaceRectToParentLocalLayout(document, parentId, { ...bounds, width: w, height: h });
    return { x: local.x, y: local.y, width: local.width, height: local.height };
}

/** Layout for a context-menu / click placement at one surface point (size from widget defaults). */
export function buildLayoutPatchForPointInSurface(
    document: UIDocument,
    parentId: UIElementId,
    surfacePoint: { x: number; y: number },
): Partial<UILayout> {
    const parent = document.elements[parentId];
    if (!parent) {
        return {};
    }
    if (isUIFlowLayoutParentElement(parent)) {
        return { x: 0, y: 0 };
    }
    const o = getElementSurfaceTopLeft(document, parentId);
    return {
        x: Math.max(0, surfacePoint.x - o.x),
        y: Math.max(0, surfacePoint.y - o.y),
    };
}

/** Default placement when inserting from outline (no pointer position). */
export function defaultLayoutPatchForOutlineInsert(document: UIDocument, parentId: UIElementId): Partial<UILayout> {
    const parent = document.elements[parentId];
    if (!parent) {
        return {};
    }
    if (isUIFlowLayoutParentElement(parent)) {
        return { x: 0, y: 0 };
    }
    return { x: 32, y: 32 };
}
