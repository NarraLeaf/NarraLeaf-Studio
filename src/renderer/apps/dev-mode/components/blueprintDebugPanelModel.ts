/**
 * Which blueprints a Dev Mode drawer panel lists.
 *
 * One function, two purposes. Interface ▸ Blueprints asks "what can I open in the workspace";
 * Debugger ▸ picker asks "what can I set a breakpoint in". Those are genuinely different sets — a
 * TypeScript blueprint is openable but has no node to stop on, and a graph blueprint owned by
 * another surface can hold a breakpoint but is not part of what this surface is running.
 *
 * They used to be two functions in two files that happened to differ, which is indistinguishable
 * from a bug: a blueprint showing up in one list and not the other reads as one of the lists being
 * wrong. The disagreement is now the single switch in {@link qualifiesForPurpose}, which is the only
 * place either question is answered.
 */

import type { Blueprint, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { isStorySyncValueOwner } from "@shared/types/blueprint/document";
import type { UIDocument, UIElementId, UISurface } from "@shared/types/ui-editor/document";

export type BlueprintDevToolsScope = {
  document: UIDocument;
  activeSurfaceId: string;
};

/** Why a blueprint is being listed — see {@link qualifiesForPurpose} for what each one keeps. */
export type BlueprintListingPurpose = "workspace" | "breakpoints";

export type DebuggableGraphKind = "event" | "function";

export type DebuggableGraph = {
  graphId: string;
  /** Author-given graph name; falls back to the id, which is all that exists for older graphs. */
  name: string;
  kind: DebuggableGraphKind;
  nodeCount: number;
};

export type DebuggableBlueprint = {
  id: string;
  name: string;
  ownerKind: Blueprint["owner"]["kind"];
  /**
   * True for inline value and condition story blueprints. Their graphs run through the
   * synchronous executor, which has no await to suspend on, so breakpoints in them are listed
   * and drawn but can never be hit. Saying so is better than a breakpoint that silently does
   * nothing.
   */
  syncOnly: boolean;
  graphs: DebuggableGraph[];
};

type SurfaceElementScope = {
  surfaceIds: Set<string>;
  elementIdsBySurfaceId: Map<string, Set<string>>;
};

/**
 * The blueprints one drawer panel should list, sorted by name for a stable picker.
 *
 * `workspace` returns the blueprints themselves (the panel shows owner, member counts and an Open
 * button, all of which live on the document object). `breakpoints` returns a projection instead,
 * because a breakpoint target is a *graph*, and the picker needs the graph list and the
 * can-this-ever-stop verdict that the raw blueprint does not carry.
 */
export function listDevModeBlueprints(
  blueprints: Record<string, Blueprint>,
  options: { purpose: "workspace"; scope?: BlueprintDevToolsScope }
): Blueprint[];
export function listDevModeBlueprints(
  blueprints: Record<string, Blueprint>,
  options: { purpose: "breakpoints" }
): DebuggableBlueprint[];
export function listDevModeBlueprints(
  blueprints: Record<string, Blueprint>,
  options: { purpose: BlueprintListingPurpose; scope?: BlueprintDevToolsScope }
): Blueprint[] | DebuggableBlueprint[] {
  if (options.purpose === "breakpoints") {
    const debuggable: DebuggableBlueprint[] = [];
    for (const blueprint of Object.values(blueprints)) {
      if (!qualifiesForPurpose(blueprint, "breakpoints")) {
        continue;
      }
      const graphs = listDebuggableGraphs(blueprint);
      if (graphs.length === 0) {
        continue;
      }
      debuggable.push({
        id: blueprint.id,
        name: blueprint.name,
        ownerKind: blueprint.owner.kind,
        syncOnly: isStorySyncValueOwner(blueprint.owner),
        graphs
      });
    }
    return debuggable.sort(byName);
  }

  const surfaceScope = options.scope
    ? buildBlueprintDevToolsSurfaceScope(options.scope.document, options.scope.activeSurfaceId)
    : null;
  return Object.values(blueprints)
    .filter(
      (bp) =>
        qualifiesForPurpose(bp, "workspace") &&
        (!surfaceScope || isBlueprintInSurfaceScope(bp, surfaceScope))
    )
    .sort(byName);
}

/**
 * The one place the two listings disagree.
 *
 * `workspace` — anything the author could open and read. TypeScript blueprints and script modules
 * are always listed (creating the revision IS the authored state), and a visual blueprint counts
 * once it holds anything at all: a member, a binding, or a graph. Auto-provisioned empties are
 * hidden, because every widget has one and a list of those answers nothing. The caller additionally
 * scopes the result to the surface that is on screen — the panel is about what is running now.
 *
 * `breakpoints` — graph programs only, and never a TypeScript frontend: a breakpoint is a node, and
 * those have none (their code is debuggable in the window's own DevTools). No surface scope, because
 * a breakpoint outlives the surface that happens to be showing when it is set. The caller then drops
 * blueprints whose graphs are all empty — the same "nothing to stop in" rule, applied where the
 * graph list it is about to keep has already been built.
 */
function qualifiesForPurpose(bp: Blueprint, purpose: BlueprintListingPurpose): boolean {
  if (purpose === "breakpoints") {
    return bp.program.kind === "graph" && bp.frontend !== "typescript";
  }
  if (
    bp.owner.kind === "sharedAsset" ||
    bp.frontend === "typescript" ||
    bp.program.kind === "scriptModule"
  ) {
    return true;
  }
  return (
    hasRecordEntries(bp.members?.variables) ||
    hasRecordEntries(bp.members?.fields) ||
    hasRecordEntries(bp.members?.functions) ||
    hasRecordEntries(bp.bindings) ||
    hasRecordEntries(bp.program.graphs.events) ||
    hasRecordEntries(bp.program.graphs.functions) ||
    hasRecordEntries(bp.program.graphs.macros)
  );
}

/** Every graph of a blueprint that has a node to stop on, sorted for a picker. */
function listDebuggableGraphs(blueprint: Blueprint): DebuggableGraph[] {
  if (blueprint.program.kind !== "graph") {
    return [];
  }
  const graphs: DebuggableGraph[] = [];
  const collect = (
    table: Record<string, { id: string; name?: string; graph?: BlueprintGraphIr }> | undefined,
    kind: DebuggableGraphKind
  ) => {
    for (const entry of Object.values(table ?? {})) {
      const nodeCount = Object.keys(entry.graph?.nodes ?? {}).length;
      if (nodeCount === 0) {
        continue;
      }
      graphs.push({ graphId: entry.id, name: entry.name?.trim() || entry.id, kind, nodeCount });
    }
  };
  collect(blueprint.program.graphs.events, "event");
  collect(blueprint.program.graphs.functions, "function");
  return graphs.sort(byName);
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

/**
 * The widget a blueprint is attached to, or `null` when it is attached to none — what Interface ▸
 * Blueprints points at on the stage while a row is hovered.
 *
 * Only the two widget owners answer. A page's own blueprint is the whole surface rather than
 * something in it, a global one is nowhere in particular, and a shared asset is not on this stage at
 * all; drawing a box for any of them would be pointing at the wrong thing rather than at nothing.
 */
export function blueprintWidgetElementId(bp: Blueprint): string | null {
  const owner = bp.owner;
  return owner.kind === "widgetMain" || owner.kind === "widgetValue" ? owner.elementId : null;
}

function isBlueprintInSurfaceScope(bp: Blueprint, scope: SurfaceElementScope): boolean {
  const owner = bp.owner;
  if (owner.kind === "globalMain") {
    return true;
  }
  if (owner.kind === "surfaceMain") {
    return scope.surfaceIds.has(owner.surfaceId);
  }
  if (owner.kind === "widgetMain" || owner.kind === "widgetValue") {
    return scope.elementIdsBySurfaceId.get(owner.surfaceId)?.has(owner.elementId) === true;
  }
  return false;
}

export function buildBlueprintDevToolsSurfaceScope(
  document: UIDocument,
  activeSurfaceId: string
): SurfaceElementScope {
  const activeSurface = document.surfaces.find((surface) => surface.id === activeSurfaceId);
  const surfaceIds = new Set<string>();
  const elementIdsBySurfaceId = new Map<string, Set<string>>();

  const includeSurface = (surface: UISurface) => {
    surfaceIds.add(surface.id);
    addSurfaceOwnElements(document, elementIdsBySurfaceId, surface);
  };

  if (activeSurface) {
    includeSurface(activeSurface);
  }

  return { surfaceIds, elementIdsBySurfaceId };
}

function addSurfaceOwnElements(
  document: UIDocument,
  elementIdsBySurfaceId: Map<string, Set<string>>,
  surface: UISurface
): void {
  addElementSubtree(
    document,
    getOrCreateElementIdSet(elementIdsBySurfaceId, surface.id),
    surface.rootElementId
  );
}

function getOrCreateElementIdSet(map: Map<string, Set<string>>, surfaceId: string): Set<string> {
  let set = map.get(surfaceId);
  if (!set) {
    set = new Set();
    map.set(surfaceId, set);
  }
  return set;
}

function addElementSubtree(
  document: UIDocument,
  out: Set<string>,
  rootElementId: UIElementId
): void {
  const visit = (elementId: UIElementId) => {
    if (out.has(elementId)) {
      return;
    }
    const element = document.elements[elementId];
    if (!element) {
      return;
    }
    out.add(elementId);
    for (const childId of element.childrenIds) {
      visit(childId);
    }
  };
  visit(rootElementId);
}

function hasRecordEntries(value: Record<string, unknown> | undefined): boolean {
  return Boolean(value && Object.keys(value).length > 0);
}
