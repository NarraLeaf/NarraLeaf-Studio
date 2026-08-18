/**
 * Authored order for the graph slots of a blueprint program (shared: migration + renderer
 * services + member tree).
 *
 * There is exactly one reconciliation rule and it lives here. A second implementation - the
 * member tree sorting one way, the service another - would show the author a layer list that
 * disagrees with which layer opens, and neither view would be wrong on its own.
 */

import type { BlueprintGraphIndex } from "../types/blueprint/document";

/** Tolerates raw parsed JSON: this runs on documents before they have been validated. */
type GraphOrderCarrier = {
  eventIds?: unknown;
  events?: unknown;
  functionIds?: unknown;
  functions?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge an order array with the record it orders.
 *
 * The two are views of one list and they can disagree: an edit that wrote one without the
 * other, a merge that took each side from a different revision, a hand-edited file. The rule
 * is deliberately asymmetric, because the two directions do not cost the same:
 *
 *  - An id listed with no slot behind it is **dropped**. Kept, it is a row that opens
 *    nothing, and since the editor opens `[0]`, a stale id in first position would open an
 *    empty graph on a blueprint that has graphs.
 *  - A slot that no id lists is **appended**, never hidden. Its position is guesswork either
 *    way, but a slot arriving last is cosmetic, and a slot missing from the tree reads as
 *    Studio having deleted the author's work.
 *
 * Falling back to `Object.keys` for the unlisted remainder is not a guarantee of anything -
 * it is the best evidence available, and it is exactly right for a document that predates
 * v10, where key order still is the authored order.
 */
function reconcileOrder(listed: unknown, record: unknown): string[] {
  if (!isRecord(record)) {
    return [];
  }

  const ordered: string[] = [];
  const taken = new Set<string>();

  for (const id of Array.isArray(listed) ? (listed as unknown[]) : []) {
    // `hasOwnProperty` rather than a truthiness check on `record[id]`: "constructor" and
    // "toString" are perfectly legal slot ids, and an `in` test would resolve them to
    // Object.prototype and list a graph that does not exist.
    if (
      typeof id !== "string" ||
      taken.has(id) ||
      !Object.prototype.hasOwnProperty.call(record, id)
    ) {
      continue;
    }
    taken.add(id);
    ordered.push(id);
  }

  for (const id of Object.keys(record)) {
    if (taken.has(id)) {
      continue;
    }
    taken.add(id);
    ordered.push(id);
  }

  return ordered;
}

/**
 * The event layers of `graphs`, in the order the author arranged them.
 *
 * This is the list the member tree draws, and `[0]` is the layer the editor opens.
 */
export function listBlueprintEventIds(
  graphs: BlueprintGraphIndex | GraphOrderCarrier | undefined | null
): string[] {
  return reconcileOrder(graphs?.eventIds, graphs?.events);
}

/**
 * The function graphs of `graphs`, in authored order.
 *
 * The same rule for the same reason, and the asymmetry is the same asymmetry: nothing about
 * it was specific to layers. What is specific here is the stake - `functionIds[0]` is the
 * graph the editor opens for a blueprint with no event layers (`useBlueprintEditorState.ts`),
 * so without a carrier, which graph a blueprint opens on becomes a function of UUID sort
 * order. It would change under the author for no reason visible to them, and stay changed.
 */
export function listBlueprintFunctionIds(
  graphs: BlueprintGraphIndex | GraphOrderCarrier | undefined | null
): string[] {
  return reconcileOrder(graphs?.functionIds, graphs?.functions);
}

/**
 * Write the reconciled event order back onto `graphs`.
 *
 * Call this after any mutation of `events`. It is the whole maintenance burden of the array:
 * adds land at the end, deletes drop out, and everything else keeps its place.
 */
export function captureBlueprintEventOrder(graphs: BlueprintGraphIndex): void {
  graphs.eventIds = listBlueprintEventIds(graphs);
}

/** As {@link captureBlueprintEventOrder}, for `functions`. Call after any mutation of it. */
export function captureBlueprintFunctionOrder(graphs: BlueprintGraphIndex): void {
  graphs.functionIds = listBlueprintFunctionIds(graphs);
}

/**
 * Every graph program in a raw parsed blueprint document.
 *
 * Deliberately total: an unrecognisable document is skipped rather than rejected. The
 * caller's own version dispatch reports a bad document with a far better message than
 * "expected object" from an order pass would, and a throw here would turn a project that
 * merely has an odd blueprint into a project that cannot be opened at all.
 */
function forEachBlueprintGraphIndex(
  raw: unknown,
  visit: (graphs: BlueprintGraphIndex) => void
): void {
  if (!isRecord(raw) || !isRecord(raw.blueprints)) {
    return;
  }

  for (const blueprint of Object.values(raw.blueprints)) {
    if (!isRecord(blueprint) || !isRecord(blueprint.program)) {
      continue;
    }
    const graphs = blueprint.program.graphs;
    if (!isRecord(graphs)) {
      continue;
    }
    visit(graphs as unknown as BlueprintGraphIndex);
  }
}

/**
 * Derive `eventIds` for every graph program in a raw parsed blueprint document.
 *
 * This has to run on the value `JSON.parse` handed back, before anything else touches it.
 * `JSON.parse` preserves insertion order for non-integer-like keys - and every event id in
 * this codebase is a UUID, a lifecycle slot name like `mouseClick`, or `onCall`, none of
 * which are integer-like - so the key order of a document on disk today *is* the order its
 * author arranged. That is true only until the first rewrite. Populate the array after any
 * normalizing write and it records whatever order that write produced, which is not
 * recoverable and not distinguishable from the real thing.
 */
export function captureBlueprintDocumentEventOrder(raw: unknown): void {
  forEachBlueprintGraphIndex(raw, (graphs) => {
    if (isRecord(graphs.events)) {
      captureBlueprintEventOrder(graphs);
    }
  });
}

/** As {@link captureBlueprintDocumentEventOrder}, for `functions`, and on the same terms. */
export function captureBlueprintDocumentFunctionOrder(raw: unknown): void {
  forEachBlueprintGraphIndex(raw, (graphs) => {
    if (isRecord(graphs.functions)) {
      captureBlueprintFunctionOrder(graphs);
    }
  });
}
