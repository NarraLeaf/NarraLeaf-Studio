import type { UIDocument, UIElement, UIElementId, UILayout } from "@shared/types/ui-editor/document";
import { isUIFlowLayoutParentElement, uiElementTypeAcceptsChildren } from "@shared/types/ui-editor/document";
import { getElementSurfaceTopLeft, surfaceRectToParentLocalLayout } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { collectSubtreeElementIds } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";

export type InsertTargetResolutionSource = "hit" | "primary" | "effective_root";

export type InsertTargetResolution = {
    parentId: UIElementId;
    source: InsertTargetResolutionSource;
};

export function isValidUIInsertParent(element: UIElement | undefined): boolean {
    return element != null && uiElementTypeAcceptsChildren(element.type);
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
        if (isValidUIInsertParent(el)) {
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
            if (isValidUIInsertParent(el)) {
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
