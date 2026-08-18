import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import { buildDocumentDiff, DocumentChange, DocumentDiff } from "../diff";
import { authoredName, change, diffKeyed, fromToParams, sameJsonValue } from "./diffHelpers";
import { isJsonObject } from "./parseHelpers";

/**
 * What changed in the project's blueprints, in the units an author sees on a graph canvas: graphs,
 * nodes and the wires between them.
 *
 * # Addressing, which is the contract
 *
 * As in the interface document beside it, a row's `path` names the thing it is about so a consumer
 * can locate it **without reading display text**:
 *
 * ```
 * ["ownerRecords", <ownerKey>]                        which blueprint is live for one owner slot
 * ["blueprints", <blueprintId>]                       a blueprint appeared, went, or its own fields changed
 * ["blueprints", <blueprintId>, <field>]              one of those fields
 * ["blueprints", <blueprintId>, "eventIds"]           the author's order of the event layers
 * ["blueprints", <blueprintId>, <slot>, <graphId>]    one graph, where <slot> is events|functions|macros
 * ["blueprints", <blueprintId>, <slot>, <graphId>, <field>]
 * ["blueprints", <blueprintId>, <slot>, <graphId>, "nodes", <nodeId>[, <property>]]
 * ["blueprints", <blueprintId>, <slot>, <graphId>, "edges", <edgeKey>]
 * ["graphs", <graphId>[, "nodes", <nodeId>[, <property>]]]   the older root-level IR, same shape
 * ["graphs", <graphId>, "edges", <edgeKey>]
 * ```
 *
 * The segments alternate key, id, key, id, so a consumer reads a fixed index rather than parsing.
 * `<edgeKey>` is `<fromNode>:<fromPort>-><toNode>:<toPort>`, built from the document because an edge
 * is the one thing here that carries no id of its own; it is a key, not a caption, and splitting it
 * gives back the four ids a canvas needs to draw the wire.
 *
 * # Moving a node is not editing it
 *
 * A node's canvas position lives in `meta.editorLayout`, and dragging one changes nothing about what
 * the game does. Reported as "this node changed" it would rank equal with a parameter that decides
 * which scene runs next - so a position is its own leaf, at `[…, "nodes", <nodeId>, "editorLayout"]`
 * with `kind: "moved"`, and the rest of `meta` is compared with that key taken out of both sides.
 * A parameter edit is `[…, "nodes", <nodeId>, "params"]` with `kind: "changed"`. Path and kind both
 * separate them, so a consumer can tell them apart either way round.
 *
 * # Two more rules the shape follows from
 *
 *  - **A node is the group.** One node whose parameters and position both changed is one group of
 *    two leaves, not two rows about one node - the same reason an element is the group next door.
 *  - **A wire is only reported when both its ends survive.** Deleting a node deletes every edge
 *    touching it, and six edge rows beside "a node was removed" describe one act seven times. Edges
 *    are compared over the nodes both sides hold, which leaves exactly the rewiring the author did.
 *
 * Pure and non-throwing, per the `DocumentSpec.diff` contract. Nothing may assume a field exists:
 * `uiGraphsSpec` does not migrate, so these documents can be older than anything this build writes.
 *
 * Labels are translation keys and never display names. A node's `type` is an identifier like
 * `blueprint.event.head.appBoot`, whose human name comes from a lookup the renderer owns and which
 * falls back to English when it misses - so it is not spelled into a label and is never a `subject`.
 */

const LABEL = {
  ownerRecord: "documentDiff.uiGraphs.ownerRecord",
  blueprintAdded: "documentDiff.uiGraphs.blueprintAdded",
  blueprintRemoved: "documentDiff.uiGraphs.blueprintRemoved",
  blueprintChanged: "documentDiff.uiGraphs.blueprintChanged",
  blueprintRenamed: "documentDiff.uiGraphs.blueprintRenamed",
  blueprintSource: "documentDiff.uiGraphs.blueprintSource",
  blueprintField: "documentDiff.uiGraphs.blueprintField",
  graphAdded: "documentDiff.uiGraphs.graphAdded",
  graphRemoved: "documentDiff.uiGraphs.graphRemoved",
  graphChanged: "documentDiff.uiGraphs.graphChanged",
  graphRenamed: "documentDiff.uiGraphs.graphRenamed",
  graphField: "documentDiff.uiGraphs.graphField",
  graphOrder: "documentDiff.uiGraphs.graphOrder",
  nodeAdded: "documentDiff.uiGraphs.nodeAdded",
  nodeRemoved: "documentDiff.uiGraphs.nodeRemoved",
  nodeChanged: "documentDiff.uiGraphs.nodeChanged",
  nodeParams: "documentDiff.uiGraphs.nodeParams",
  nodeMoved: "documentDiff.uiGraphs.nodeMoved",
  nodeType: "documentDiff.uiGraphs.nodeType",
  nodeField: "documentDiff.uiGraphs.nodeField",
  edgeAdded: "documentDiff.uiGraphs.edgeAdded",
  edgeRemoved: "documentDiff.uiGraphs.edgeRemoved"
} as const;

/** Where a node's canvas position is kept. Its own leaf, never folded into `meta`. */
const NODE_POSITION_KEY = "editorLayout";

/** The three graph slots a blueprint program holds, in the order the member tree lists them. */
const GRAPH_SLOTS = ["events", "functions", "macros"] as const;

/** Blueprint fields with no words of their own; the raw identifier goes in the label's `{field}`. */
const BLUEPRINT_FIELDS = [
  "owner",
  "frontend",
  "programKind",
  "members",
  "bindings",
  "meta"
] as const;

/**
 * Where a slot's authored order is written down, when it has one.
 *
 * `macros` has no companion array - nothing writes that record at all - so it has no order row and
 * its graphs come out sorted by id.
 */
const ORDER_KEY: Readonly<Record<string, string | undefined>> = {
  events: "eventIds",
  functions: "functionIds",
  macros: undefined
};

/** Read off a graph, but never reported: its identity, its name, and the graph itself. */
const GRAPH_FIELDS_NOT_REPORTED = new Set(["id", "name", "graph", "nodes", "edges"]);

export function diffUIGraphs(
  base: UIGraphDocument,
  head: UIGraphDocument,
  options: { limit: number }
): DocumentDiff {
  const rows: DocumentChange[] = [];

  // Built in reading order rather than sorted afterwards: blueprints by the name their author gave
  // them, each one's graphs in the order the author arranged the layers, each graph's nodes as they
  // sit on the canvas. Ordering has to happen before `buildDocumentDiff` truncates - a list cut to
  // the budget in id order keeps whichever rows happened to have early UUIDs.
  for (const entry of sortedByName(diffKeyed(blueprintsOf(base), blueprintsOf(head)))) {
    blueprintRows(entry.key, entry.base, entry.head, rows);
  }
  for (const entry of diffKeyed(rootGraphsOf(base), rootGraphsOf(head))) {
    rootGraphRows(entry.key, entry.base, entry.head, rows);
  }
  for (const entry of diffKeyed(ownerRecordsOf(base), ownerRecordsOf(head))) {
    rows.push(change(["ownerRecords", entry.key], entry.kind, LABEL.ownerRecord));
  }

  return buildDocumentDiff(rows, { tier: "semantic", limit: options.limit });
}

/** Nodes across every graph, blueprint and legacy alike - the number that tracks how much logic there is. */
export function countGraphNodes(document: UIGraphDocument | undefined): number {
  let total = 0;
  for (const blueprint of Object.values(blueprintsOf(document))) {
    for (const slot of GRAPH_SLOTS) {
      for (const graph of Object.values(graphSlot(blueprint, slot))) {
        total += Object.keys(nodesOf(irOf(graph))).length;
      }
    }
  }
  for (const graph of Object.values(rootGraphsOf(document))) {
    total += Object.keys(nodesOf(graph)).length;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Blueprints
// ---------------------------------------------------------------------------

function blueprintRows(
  blueprintId: string,
  base: Record<string, unknown> | undefined,
  head: Record<string, unknown> | undefined,
  rows: DocumentChange[]
): void {
  const path = ["blueprints", blueprintId];
  if (!base || !head) {
    const present = (head ?? base) as Record<string, unknown>;
    rows.push(
      change(
        path,
        head ? "added" : "removed",
        head ? LABEL.blueprintAdded : LABEL.blueprintRemoved,
        {
          subject: authoredName(present?.name),
          // One row for a whole blueprint, with its size in the label rather than a row per node:
          // the change the author made is "I wrote this piece of logic".
          params: { nodes: blueprintNodeCount(present) }
        }
      )
    );
    return;
  }

  const subject = authoredName(head.name) ?? authoredName(base.name);
  const children: DocumentChange[] = [];
  if (!sameJsonValue(base.name, head.name)) {
    children.push(
      change([...path, "name"], "changed", LABEL.blueprintRenamed, {
        params: fromToParams(base.name, head.name),
        subject: authoredName(head.name) ?? subject
      })
    );
  }
  // A TypeScript blueprint has no graph at all; its whole program is one string, compared whole
  // because a line-level diff of source is a different surface from a list of changes.
  if (!sameJsonValue(sourceOf(base), sourceOf(head))) {
    children.push(change([...path, "source"], "changed", LABEL.blueprintSource, { subject }));
  }
  for (const field of BLUEPRINT_FIELDS) {
    if (!sameJsonValue(base[field], head[field])) {
      children.push(
        change([...path, field], "changed", LABEL.blueprintField, { params: { field }, subject })
      );
    }
  }
  // Only when it has something to say. A blueprint's record contains its graphs, so it differs
  // whenever any node does, and a bare "the blueprint changed" beside the node rows is the same
  // news twice.
  if (children.length > 0) {
    rows.push(change(path, "changed", LABEL.blueprintChanged, { subject, children }));
  }

  for (const slot of GRAPH_SLOTS) {
    const wasGraphs = graphSlot(base, slot);
    const nowGraphs = graphSlot(head, slot);
    const byKey = new Map(diffKeyed(wasGraphs, nowGraphs).map((entry) => [entry.key, entry]));

    for (const graphId of graphOrder(graphIndexOf(base), graphIndexOf(head), slot, byKey)) {
      const entry = byKey.get(graphId);
      if (entry) {
        graphRows([...path, slot, graphId], entry.base, entry.head, rows);
      }
    }

    // The order of the layers, as one row for the whole list and only over the layers both
    // sides hold - adding one changes the array, and saying so beside "a graph was added" would
    // describe one act twice.
    const shared = new Set(
      Object.keys(nowGraphs).filter((id) => Object.prototype.hasOwnProperty.call(wasGraphs, id))
    );
    const orderKey = ORDER_KEY[slot];
    if (
      orderKey &&
      !sameJsonValue(
        declaredOrder(graphIndexOf(base), orderKey, shared),
        declaredOrder(graphIndexOf(head), orderKey, shared)
      )
    ) {
      rows.push(change([...path, orderKey], "moved", LABEL.graphOrder, { subject }));
    }
  }
}

function rootGraphRows(
  graphId: string,
  base: Record<string, unknown> | undefined,
  head: Record<string, unknown> | undefined,
  rows: DocumentChange[]
): void {
  graphRows(["graphs", graphId], base, head, rows);
}

// ---------------------------------------------------------------------------
// Graphs, nodes, edges
// ---------------------------------------------------------------------------

/**
 * One graph slot, whichever of the two records it came out of.
 *
 * A blueprint's event graph wraps its IR in `graph`, the root-level record IS the IR, and both hold
 * `{nodes, edges}` of the same shape - so `irOf` unwraps and everything below is written once.
 */
function graphRows(
  path: readonly string[],
  base: Record<string, unknown> | undefined,
  head: Record<string, unknown> | undefined,
  rows: DocumentChange[]
): void {
  if (!base || !head) {
    const present = (head ?? base) as Record<string, unknown>;
    rows.push(
      change(path, head ? "added" : "removed", head ? LABEL.graphAdded : LABEL.graphRemoved, {
        subject: authoredName(present?.name),
        params: { nodes: Object.keys(nodesOf(irOf(present))).length }
      })
    );
    return;
  }

  const subject = authoredName(head.name) ?? authoredName(base.name);
  const children: DocumentChange[] = [];
  if (!sameJsonValue(base.name, head.name)) {
    children.push(
      change([...path, "name"], "changed", LABEL.graphRenamed, {
        params: fromToParams(base.name, head.name),
        subject: authoredName(head.name) ?? subject
      })
    );
  }
  const wasFields = graphFields(base);
  const nowFields = graphFields(head);
  for (const field of [...new Set([...Object.keys(wasFields), ...Object.keys(nowFields)])].sort()) {
    if (!sameJsonValue(wasFields[field], nowFields[field])) {
      children.push(
        change([...path, field], "changed", LABEL.graphField, { params: { field }, subject })
      );
    }
  }
  if (children.length > 0) {
    rows.push(change(path, "changed", LABEL.graphChanged, { subject, children }));
  }

  const wasNodes = nodesOf(irOf(base));
  const nowNodes = nodesOf(irOf(head));
  const entries = diffKeyed(wasNodes, nowNodes);
  for (const entry of sortedByPosition(entries)) {
    nodeRows([...path, "nodes", entry.key], entry.base, entry.head, rows);
  }

  edgeRows(path, irOf(base), irOf(head), wasNodes, nowNodes, rows);
}

function nodeRows(
  path: readonly string[],
  base: Record<string, unknown> | undefined,
  head: Record<string, unknown> | undefined,
  rows: DocumentChange[]
): void {
  if (!base || !head) {
    // No `subject`: a node has no field an author names it in. Its type is Studio's own
    // vocabulary and would read, beside a translated label, as something they typed.
    rows.push(change(path, head ? "added" : "removed", head ? LABEL.nodeAdded : LABEL.nodeRemoved));
    return;
  }

  const children: DocumentChange[] = [];
  if (!sameJsonValue(base.params, head.params)) {
    children.push(change([...path, "params"], "changed", LABEL.nodeParams));
  }
  // The whole reason this leaf exists; see the note at the top of this module.
  if (!sameJsonValue(positionOf(base), positionOf(head))) {
    children.push(change([...path, NODE_POSITION_KEY], "moved", LABEL.nodeMoved));
  }
  if (!sameJsonValue(base.type, head.type)) {
    children.push(
      change([...path, "type"], "changed", LABEL.nodeType, {
        params: fromToParams(base.type, head.type)
      })
    );
  }
  if (!sameJsonValue(base.ports, head.ports)) {
    children.push(
      change([...path, "ports"], "changed", LABEL.nodeField, { params: { field: "ports" } })
    );
  }
  if (!sameJsonValue(metaWithoutPosition(base), metaWithoutPosition(head))) {
    children.push(
      change([...path, "meta"], "changed", LABEL.nodeField, { params: { field: "meta" } })
    );
  }
  rows.push(change(path, "changed", LABEL.nodeChanged, { children }));
}

function edgeRows(
  path: readonly string[],
  base: Record<string, unknown>,
  head: Record<string, unknown>,
  baseNodes: Readonly<Record<string, unknown>>,
  headNodes: Readonly<Record<string, unknown>>,
  rows: DocumentChange[]
): void {
  // Only wires whose two ends exist on BOTH sides. What is left is the rewiring the author did,
  // rather than the edges a deleted node took with it.
  const shared = (id: unknown): boolean =>
    typeof id === "string" &&
    Object.prototype.hasOwnProperty.call(baseNodes, id) &&
    Object.prototype.hasOwnProperty.call(headNodes, id);
  const keysOf = (graph: Record<string, unknown>): Set<string> => {
    const keys = new Set<string>();
    for (const edge of Array.isArray(graph.edges) ? graph.edges : []) {
      const from = (edge as { from?: { nodeId?: unknown; port?: unknown } } | null)?.from;
      const to = (edge as { to?: { nodeId?: unknown; port?: unknown } } | null)?.to;
      if (shared(from?.nodeId) && shared(to?.nodeId)) {
        keys.add(
          `${text(from?.nodeId)}:${text(from?.port)}->${text(to?.nodeId)}:${text(to?.port)}`
        );
      }
    }
    return keys;
  };

  const was = keysOf(base);
  const now = keysOf(head);
  for (const key of [...new Set([...was, ...now])].sort()) {
    if (was.has(key) === now.has(key)) {
      continue;
    }
    rows.push(
      change(
        [...path, "edges", key],
        now.has(key) ? "added" : "removed",
        now.has(key) ? LABEL.edgeAdded : LABEL.edgeRemoved
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Reading the document
// ---------------------------------------------------------------------------

function blueprintsOf(
  document: UIGraphDocument | undefined
): Record<string, Record<string, unknown>> {
  return mapOf(
    (document as { blueprintDocument?: { blueprints?: unknown } } | undefined)?.blueprintDocument
      ?.blueprints
  );
}

function ownerRecordsOf(
  document: UIGraphDocument | undefined
): Record<string, Record<string, unknown>> {
  return mapOf(
    (document as { blueprintDocument?: { ownerRecords?: unknown } } | undefined)?.blueprintDocument
      ?.ownerRecords
  );
}

function rootGraphsOf(
  document: UIGraphDocument | undefined
): Record<string, Record<string, unknown>> {
  return mapOf((document as { graphs?: unknown } | undefined)?.graphs);
}

/** `program.graphs`, which holds the three slots and the two arrays that order them. */
function graphIndexOf(blueprint: Record<string, unknown>): Record<string, unknown> {
  const program = blueprint?.program;
  const graphs = isJsonObject(program) ? program.graphs : undefined;
  return isJsonObject(graphs) ? graphs : {};
}

function graphSlot(
  blueprint: Record<string, unknown>,
  slot: string
): Record<string, Record<string, unknown>> {
  return mapOf(graphIndexOf(blueprint)[slot]);
}

/**
 * Everything about a graph that is neither its name nor its nodes and wires.
 *
 * Read from two places at once, because a blueprint's event layer is a wrapper `{id, name, graph,
 * meta}` around an IR that has a `meta` of its own. Keeping them apart under `graph.<key>` is what
 * stops an edit to one being reported as an edit to the other; a root-level graph IS its own IR, so
 * there is nothing to keep apart and the second pass is skipped.
 */
function graphFields(graph: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(graph)) {
    if (!GRAPH_FIELDS_NOT_REPORTED.has(key)) {
      out[key] = value;
    }
  }
  const ir = irOf(graph);
  if (ir !== graph) {
    for (const [key, value] of Object.entries(ir)) {
      if (key !== "nodes" && key !== "edges") {
        out[`graph.${key}`] = value;
      }
    }
  }
  return out;
}

/** A blueprint event graph wraps its IR in `graph`; a root-level graph already IS one. */
function irOf(graph: Record<string, unknown> | undefined): Record<string, unknown> {
  const inner = graph?.graph;
  return isJsonObject(inner) ? inner : (graph ?? {});
}

function nodesOf(ir: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return mapOf(ir.nodes);
}

function sourceOf(blueprint: Record<string, unknown>): unknown {
  const program = blueprint?.program;
  return isJsonObject(program) ? program.source : undefined;
}

function positionOf(node: Record<string, unknown>): unknown {
  const meta = node?.meta;
  return isJsonObject(meta) ? meta[NODE_POSITION_KEY] : undefined;
}

/** `meta` with the canvas position taken out, so a drag cannot read as an edit to anything else. */
function metaWithoutPosition(node: Record<string, unknown>): Record<string, unknown> {
  const meta = node?.meta;
  if (!isJsonObject(meta)) {
    return {};
  }
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (key !== NODE_POSITION_KEY) {
      rest[key] = value;
    }
  }
  return rest;
}

function blueprintNodeCount(blueprint: Record<string, unknown>): number {
  let total = 0;
  for (const slot of GRAPH_SLOTS) {
    for (const graph of Object.values(graphSlot(blueprint, slot))) {
      total += Object.keys(nodesOf(irOf(graph))).length;
    }
  }
  return total;
}

function mapOf(value: unknown): Record<string, Record<string, unknown>> {
  if (!isJsonObject(value)) {
    return {};
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, entry] of Object.entries(value)) {
    // An entry that is not an object is what a hand-edited document holds. Skipping it costs
    // one row; refusing the document would cost the author every row in it.
    if (isJsonObject(entry)) {
      out[key] = entry;
    }
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

interface Keyed {
  readonly key: string;
  readonly base: Record<string, unknown> | undefined;
  readonly head: Record<string, unknown> | undefined;
}

/** By the name the author gave the blueprint, then by id. Unnamed ones go last, together. */
function sortedByName<T extends Keyed>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    const left = authoredName(a.head?.name ?? a.base?.name) ?? "";
    const right = authoredName(b.head?.name ?? b.base?.name) ?? "";
    if (left !== right) {
      if (left === "") return 1;
      if (right === "") return -1;
      return left < right ? -1 : 1;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/**
 * Nodes down the canvas and then across it, which is the order an author's eye takes them in.
 *
 * A node with no position sorts last rather than at the origin: an absent `editorLayout` is a node
 * whose place on the canvas nobody has decided, and putting it at the top would push everything the
 * author DID arrange below it.
 */
function sortedByPosition<T extends Keyed>(entries: readonly T[]): T[] {
  const axis = (entry: T, key: "x" | "y"): number => {
    const position = positionOf(entry.head ?? entry.base ?? {});
    const value = isJsonObject(position) ? position[key] : undefined;
    return typeof value === "number" && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  };
  return [...entries].sort(
    (a, b) =>
      axis(a, "y") - axis(b, "y") ||
      axis(a, "x") - axis(b, "x") ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

/**
 * The graph ids of one slot, in the order the author arranged them: head's list, then base's, then
 * whatever neither list mentions, sorted so it is the same list on every run.
 */
function graphOrder(
  base: Record<string, unknown>,
  head: Record<string, unknown>,
  slot: string,
  changed: ReadonlyMap<string, unknown>
): string[] {
  const orderKey = ORDER_KEY[slot];
  const out: string[] = [];
  const seen = new Set<string>();
  const take = (id: unknown): void => {
    if (typeof id === "string" && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };

  for (const side of orderKey ? [head, base] : []) {
    const declared = side[orderKey as string];
    for (const id of Array.isArray(declared) ? declared : []) {
      take(id);
    }
  }
  for (const id of [...changed.keys()].sort()) {
    take(id);
  }
  return out;
}

/** One slot's declared order, narrowed to the ids both sides hold. */
function declaredOrder(
  graphs: Record<string, unknown>,
  orderKey: string,
  shared: ReadonlySet<string>
): string[] {
  const declared = graphs[orderKey];
  return Array.isArray(declared)
    ? declared.filter((id): id is string => typeof id === "string" && shared.has(id))
    : [];
}

/**
 * There is no `merge3` here, for the reason there is none for the interface document.
 *
 * A graph is a shape - nodes placed relative to each other and wired in an order that decides what
 * runs. Two authors who both edited one event layer can be interleaved into a graph that loads and
 * executes and that neither of them wrote, and unlike a broken layout there is nothing to see: it
 * only shows up as behaviour, later, in a build. Taking one side's whole file is a decision the
 * author can inspect; a merged graph is not.
 */
