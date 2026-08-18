import type {
  UIDocument,
  UIElement,
  UIElementId,
  UILayout
} from "@shared/types/ui-editor/document";
import {
  isLinkedUIComponentElement,
  isUIElementFlowLayoutChild,
  isUIStructuralWidgetPart,
  uiElementTypeAcceptsUserChildren
} from "@shared/types/ui-editor/document";
import { isListLikeWidgetType } from "@shared/types/ui-editor/list";
import {
  getElementSurfaceTopLeftEx,
  surfaceRectToParentLocalLayout
} from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import { roundUILayoutGeometryFields } from "@/lib/ui-editor/layout/roundLayoutGeometry";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";

export type MoveRejectReason =
  | "invalid_surface"
  | "invalid_target"
  | "invalid_movers"
  | "cycle"
  | "root_locked";

export type MoveUiElementsResult = { ok: true } | { ok: false; reason: MoveRejectReason };

export type PlannedMove = {
  movers: UIElementId[];
  targetParentId: UIElementId;
  beforeChildId: UIElementId | null;
};

/** Internal planning outcome (includes payload when successful). */
export type PlanMoveElementsOutcome =
  | { ok: false; reason: MoveRejectReason }
  | { ok: true; plan: PlannedMove };

const ROOT_WIDGET_TYPE = "nl.root";
/** The one type "group" means: what grouping creates, and so the only thing ungrouping dissolves. */
export const GROUP_WIDGET_TYPE = "nl.container";

export function collectSubtreeElementIds(
  document: UIDocument,
  rootId: UIElementId
): Set<UIElementId> {
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
export function filterToTopLevelMovers(
  document: UIDocument,
  elementIds: UIElementId[]
): UIElementId[] {
  const set = new Set(elementIds);
  return elementIds.filter((id) => {
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

export function sortElementIdsByPreorder(
  document: UIDocument,
  treeRootId: UIElementId,
  ids: UIElementId[]
): UIElementId[] {
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
export function isStrictDescendantOf(
  document: UIDocument,
  descendantId: UIElementId,
  ancestorId: UIElementId
): boolean {
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

function isDescendantOf(
  document: UIDocument,
  maybeDescendant: UIElementId,
  ancestor: UIElementId
): boolean {
  return isStrictDescendantOf(document, maybeDescendant, ancestor);
}

/**
 * Flow-layout children are positioned by their parent flex stack/list, so serialized x/y must stay neutral.
 * Width, height, rotation, visibility, etc. remain authored on the child.
 */
export function normalizeFlowChildLayout(document: UIDocument, element: UIElement): boolean {
  if (!isUIElementFlowLayoutChild(document, element)) {
    return false;
  }
  if (element.layout.x === 0 && element.layout.y === 0) {
    return false;
  }
  element.layout = roundUILayoutGeometryFields({
    ...element.layout,
    x: 0,
    y: 0
  });
  return true;
}

export function normalizeFlowChildLayouts(
  document: UIDocument,
  elementIds?: Iterable<UIElementId>
): boolean {
  let changed = false;
  const ids = elementIds ?? Object.keys(document.elements);
  for (const id of ids) {
    const element = document.elements[id];
    if (element) {
      changed = normalizeFlowChildLayout(document, element) || changed;
    }
  }
  return changed;
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
  resolve?: (id: string) => UIElement | undefined
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
    height: Math.abs(element.layout.height)
  });
  return { x: local.x, y: local.y };
}

export function planMoveElementsInSurface(
  document: UIDocument,
  surfaceId: string,
  rawElementIds: UIElementId[],
  targetParentId: UIElementId,
  beforeChildId: UIElementId | null
): PlanMoveElementsOutcome {
  const effectiveRootId = resolveSurfaceRootElementId(document, surfaceId);
  if (!effectiveRootId) {
    return { ok: false, reason: "invalid_surface" };
  }
  const allowed = collectSubtreeElementIds(document, effectiveRootId);
  const target = document.elements[targetParentId];
  if (!target || !allowed.has(targetParentId) || !uiElementTypeAcceptsUserChildren(target.type)) {
    return { ok: false, reason: "invalid_target" };
  }
  if (beforeChildId != null) {
    const beforeEl = document.elements[beforeChildId];
    if (!beforeEl || beforeEl.parentId !== targetParentId) {
      return { ok: false, reason: "invalid_target" };
    }
  }

  const topLevel = filterToTopLevelMovers(document, rawElementIds);
  const movers = sortElementIdsByPreorder(document, effectiveRootId, topLevel).filter((id) => {
    const el = document.elements[id];
    if (!el || !allowed.has(id)) {
      return false;
    }
    if (el.type === ROOT_WIDGET_TYPE) {
      return false;
    }
    // A widget's own part cannot leave it. The move is one-way - the target check above refuses
    // to put anything back into a widget that takes no user children - so a track dropped on the
    // canvas is gone for good: the widget falls back to placeholder chrome while an orphan with
    // a dead slot marker sits somewhere else. For a switch the part carries the `on` appearance
    // variant too, so the authored travel and its transition leave with it and the only symptom
    // the author sees is that the switch stopped animating.
    //
    // Dropped from the selection rather than failing the whole move, matching how `nl.root` is
    // handled just above: dragging four elements one of which is a track should move the other
    // three.
    if (isUIStructuralWidgetPart(document, el)) {
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
      beforeChildId
    }
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
        parent.childrenIds = parent.childrenIds.filter((cid) => cid !== id);
      }
    }
  }

  const parent = document.elements[targetParentId];
  if (!parent) {
    return;
  }
  let children = [...parent.childrenIds];
  children = children.filter((cid) => !moverSet.has(cid));

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
      normalizeFlowChildLayout(document, el);
    }
  }
}

/**
 * A list places its children by slot, so a plain element moved under one becomes its item template.
 * Elements that already carry a slot - the template itself, the scrollbar parts - keep the one they have.
 */
export function normalizeListSlotsForMovedChildren(
  document: UIDocument,
  targetParentId: UIElementId,
  movedIds: Iterable<UIElementId>
): void {
  if (!isListLikeWidgetType(document.elements[targetParentId]?.type)) {
    return;
  }
  for (const id of movedIds) {
    const moved = document.elements[id];
    const slot = moved?.extra?.listSlot;
    if (
      moved &&
      slot !== "itemTemplate" &&
      slot !== "scrollbarTrack" &&
      slot !== "scrollbarThumb"
    ) {
      moved.extra = {
        ...(moved.extra ?? {}),
        listSlot: "itemTemplate"
      };
    }
  }
}

/**
 * True when `containerId` is a group that can be dissolved back into its parent.
 *
 * The exclusions are the places where a container is structure rather than a user's group: a
 * surface root (nothing to lift into), a component editor's stand-in root, and anything inside a
 * linked component instance, whose shape belongs to the component definition. A parent that does
 * not take user children - a slider's track, say - can only hold the parts it was built with, so a
 * group nested there stays put unless it is empty.
 */
export function canUngroupContainer(
  document: UIDocument,
  surfaceId: string,
  containerId: UIElementId
): boolean {
  const effectiveRootId = resolveSurfaceRootElementId(document, surfaceId);
  if (!effectiveRootId || !isStrictDescendantOf(document, containerId, effectiveRootId)) {
    return false;
  }
  const container = document.elements[containerId];
  if (!container || container.type !== GROUP_WIDGET_TYPE) {
    return false;
  }
  if (isComponentEditorRootElement(container) || isLinkedUIComponentElement(container)) {
    return false;
  }
  if (document.surfaces.some((surface) => surface.rootElementId === containerId)) {
    return false;
  }
  const parent = container.parentId != null ? document.elements[container.parentId] : undefined;
  if (!parent || isLinkedUIComponentElement(parent)) {
    return false;
  }
  return container.childrenIds.length === 0 || uiElementTypeAcceptsUserChildren(parent.type);
}

/**
 * Dissolve a group: its children take its place among its siblings, then it is removed.
 *
 * The inverse of grouping, and deliberately not "delete, keep the children" - the children are
 * spliced in at the index the container held, so z-order survives, and `applyPlannedMove` rewrites
 * each child's layout for its new parent, so nothing appears to move on the canvas.
 *
 * Returns the lifted child ids (empty for an empty group, which just disappears), or `null` when
 * `containerId` is not a dissolvable group - in which case the document is left untouched.
 */
export function applyUngroupContainer(
  document: UIDocument,
  surfaceId: string,
  containerId: UIElementId
): UIElementId[] | null {
  if (!canUngroupContainer(document, surfaceId, containerId)) {
    return null;
  }
  const container = document.elements[containerId];
  const parentId = container.parentId as UIElementId;
  const children = [...container.childrenIds];

  if (children.length > 0) {
    const planned = planMoveElementsInSurface(document, surfaceId, children, parentId, containerId);
    if (!planned.ok) {
      return null;
    }
    applyPlannedMove(document, planned.plan);
    normalizeListSlotsForMovedChildren(document, parentId, planned.plan.movers);
  }

  const parent = document.elements[parentId];
  if (parent) {
    parent.childrenIds = parent.childrenIds.filter((id) => id !== containerId);
  }
  delete document.elements[containerId];
  return children;
}
