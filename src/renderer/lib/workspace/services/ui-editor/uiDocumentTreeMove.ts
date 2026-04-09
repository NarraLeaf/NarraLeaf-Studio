import type { UIDocument, UIElement, UIElementId, UILayout } from "@shared/types/ui-editor/document";
import { isUIElementFlowLayoutChild, uiElementTypeAcceptsChildren } from "@shared/types/ui-editor/document";
import { getElementSurfaceTopLeftEx, surfaceRectToParentLocalLayout } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import { roundUILayoutGeometryFields } from "@/lib/ui-editor/layout/roundLayoutGeometry";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";

export type MoveRejectReason = "invalid_surface" | "invalid_target" | "invalid_movers" | "cycle" | "root_locked";

export type MoveUiElementsResult = { ok: true } | { ok: false; reason: MoveRejectReason };

export type PlannedMove = {
    movers: UIElementId[];
    targetParentId: UIElementId;
    beforeChildId: UIElementId | null;
};

/** Internal planning outcome (includes payload when successful). */
export type PlanMoveElementsOutcome = { ok: false; reason: MoveRejectReason } | { ok: true; plan: PlannedMove };

const ROOT_WIDGET_TYPE = "nl.root";

export function collectSubtreeElementIds(document: UIDocument, rootId: UIElementId): Set<UIElementId> {
    const out = new Set<UIElementId>();
    const walk = (id: UIElementId) => {
        if (out.has(id)) {
            return;
        }
        out.add(id);
        const el = document.elements[id];
        el?.childrenIds.forEach(walk);
    };
    walk(rootId);
    return out;
}

/** Keep top-most selected nodes only (drop descendants when an ancestor is also selected). */
export function filterToTopLevelMovers(document: UIDocument, elementIds: UIElementId[]): UIElementId[] {
    const set = new Set(elementIds);
    return elementIds.filter(id => {
        let cur: UIElement | undefined = document.elements[id];
        while (cur?.parentId) {
            if (set.has(cur.parentId)) {
                return false;
            }
            cur = document.elements[cur.parentId];
        }
        return true;
    });
}

export function sortElementIdsByPreorder(document: UIDocument, treeRootId: UIElementId, ids: UIElementId[]): UIElementId[] {
    const want = new Set(ids);
    const ordered: UIElementId[] = [];
    const walk = (id: UIElementId) => {
        if (want.has(id)) {
            ordered.push(id);
        }
        const el = document.elements[id];
        el?.childrenIds.forEach(walk);
    };
    walk(treeRootId);
    return ordered;
}

/** True if `descendantId` is a strict descendant of `ancestorId` in the element tree. */
export function isStrictDescendantOf(document: UIDocument, descendantId: UIElementId, ancestorId: UIElementId): boolean {
    if (descendantId === ancestorId) {
        return false;
    }
    let cur: UIElement | undefined = document.elements[descendantId];
    while (cur?.parentId) {
        if (cur.parentId === ancestorId) {
            return true;
        }
        cur = document.elements[cur.parentId];
    }
    return false;
}

function isDescendantOf(document: UIDocument, maybeDescendant: UIElementId, ancestor: UIElementId): boolean {
    return isStrictDescendantOf(document, maybeDescendant, ancestor);
}

/**
 * Layout delta when changing `element`'s parent to `newParentId`.
 * Call while `element.parentId` still refers to the **previous** parent (or null).
 * Optional `resolve` merges extra elements (e.g. clipboard payload) for geometry walks.
 */
export function layoutPatchForReparent(
    document: UIDocument,
    element: UIElement,
    newParentId: UIElementId,
    resolve?: (id: string) => UIElement | undefined,
): Partial<UILayout> {
    const lookup = resolve ?? ((id: string) => document.elements[id]);
    const prevParentId = element.parentId;
    if (prevParentId === newParentId) {
        return {};
    }

    const hypothetical: UIElement = { ...element, parentId: newParentId };
    const willBeFlow = isUIElementFlowLayoutChild(document, hypothetical);
    const wasFlow = prevParentId != null && isUIElementFlowLayoutChild(document, element);

    if (willBeFlow) {
        return { x: 0, y: 0 };
    }
    if (wasFlow && !willBeFlow) {
        return { x: 0, y: 0 };
    }

    const surfaceTL = getElementSurfaceTopLeftEx(lookup, element.id);
    const local = surfaceRectToParentLocalLayout(document, newParentId, {
        x: surfaceTL.x,
        y: surfaceTL.y,
        width: Math.abs(element.layout.width),
        height: Math.abs(element.layout.height),
    });
    return { x: local.x, y: local.y };
}

export function planMoveElementsInSurface(
    document: UIDocument,
    surfaceId: string,
    rawElementIds: UIElementId[],
    targetParentId: UIElementId,
    beforeChildId: UIElementId | null,
): PlanMoveElementsOutcome {
    const effectiveRootId = resolveSurfaceRootElementId(document, surfaceId);
    if (!effectiveRootId) {
        return { ok: false, reason: "invalid_surface" };
    }
    const allowed = collectSubtreeElementIds(document, effectiveRootId);
    const target = document.elements[targetParentId];
    if (!target || !allowed.has(targetParentId) || !uiElementTypeAcceptsChildren(target.type)) {
        return { ok: false, reason: "invalid_target" };
    }
    if (beforeChildId != null) {
        const beforeEl = document.elements[beforeChildId];
        if (!beforeEl || beforeEl.parentId !== targetParentId) {
            return { ok: false, reason: "invalid_target" };
        }
    }

    const topLevel = filterToTopLevelMovers(document, rawElementIds);
    const movers = sortElementIdsByPreorder(document, effectiveRootId, topLevel).filter(id => {
        const el = document.elements[id];
        if (!el || !allowed.has(id)) {
            return false;
        }
        if (el.type === ROOT_WIDGET_TYPE) {
            return false;
        }
        return true;
    });

    if (movers.length === 0) {
        return { ok: false, reason: "invalid_movers" };
    }

    const moverSet = new Set(movers);
    if (moverSet.has(targetParentId)) {
        return { ok: false, reason: "cycle" };
    }
    for (const m of movers) {
        if (isDescendantOf(document, targetParentId, m)) {
            return { ok: false, reason: "cycle" };
        }
    }
    if (beforeChildId != null && moverSet.has(beforeChildId)) {
        return { ok: false, reason: "invalid_target" };
    }

    return {
        ok: true,
        plan: {
            movers,
            targetParentId,
            beforeChildId,
        },
    };
}

export function applyPlannedMove(document: UIDocument, plan: PlannedMove): void {
    const { movers, targetParentId, beforeChildId } = plan;
    const moverSet = new Set(movers);

    for (const id of movers) {
        const el = document.elements[id];
        const pId = el?.parentId;
        if (pId != null) {
            const parent = document.elements[pId];
            if (parent) {
                parent.childrenIds = parent.childrenIds.filter(cid => cid !== id);
            }
        }
    }

    const parent = document.elements[targetParentId];
    if (!parent) {
        return;
    }
    let children = [...parent.childrenIds];
    children = children.filter(cid => !moverSet.has(cid));

    let insertAt = children.length;
    if (beforeChildId != null) {
        const idx = children.indexOf(beforeChildId);
        insertAt = idx === -1 ? children.length : idx;
    }
    children.splice(insertAt, 0, ...movers);
    parent.childrenIds = children;

    for (const id of movers) {
        const el = document.elements[id];
        if (el) {
            const patch = layoutPatchForReparent(document, el, targetParentId);
            el.parentId = targetParentId;
            if (Object.keys(patch).length > 0) {
                el.layout = roundUILayoutGeometryFields({ ...el.layout, ...patch });
            }
        }
    }
}
