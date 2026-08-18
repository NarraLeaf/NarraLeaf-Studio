import {
  BLUEPRINT_IF_ELSE_BRANCH_PINS,
  BLUEPRINT_SWITCH_STRING_CASE_PINS,
  blueprintNodeExecOutputPinIds,
  blueprintNodeExecPins,
  isPureDataBlueprintNode,
  readVariadicPinIds
} from "./blueprintPinSemantics";
import type {
  Blueprint,
  BlueprintDocument,
  BlueprintGraphEdge,
  BlueprintGraphIr,
  BlueprintGraphNode
} from "@shared/types/blueprint/document";
import {
  BLUEPRINT_NODE_TYPE_BOOLEAN_AND,
  BLUEPRINT_NODE_TYPE_BOOLEAN_NOT,
  BLUEPRINT_NODE_TYPE_BOOLEAN_OR,
  BLUEPRINT_NODE_TYPE_BOOLEAN_XOR,
  BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
  BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL,
  BLUEPRINT_NODE_TYPE_FLOW_IF,
  BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
  BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
  BLUEPRINT_NODE_TYPE_FN_HEAD,
  BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG,
  BLUEPRINT_NODE_TYPE_LITERAL,
  BLUEPRINT_NODE_TYPE_LITERAL_STRING,
  BLUEPRINT_NODE_TYPE_STRING_EQUALS,
  BLUEPRINT_NODE_TYPE_STRING_EQUALS_IGNORE_CASE
} from "@shared/types/blueprint/graph";

/**
 * The build variant decides which branch a blueprint takes, and the branch it does not take is not
 * in the package.
 *
 * This is `@shared/story/appTagFold` for graphs, and it exists for the same reason: blueprint graphs
 * ship **verbatim**. The bundler reads `uigraphs.json`, migrates it, and puts it in the pack, so an
 * `If` that tests the variant is carried into every edition and answered on the player's machine -
 * with the content behind both arms sitting in all of them. "This screen is only in the demo" can
 * only be true if the nodes are gone from those bytes, and removing them is what this module does.
 *
 * Two processes read it and they must never disagree. The renderer asks
 * {@link collectUnfoldableAppTagGraphs} whether a build may start; the main process asks
 * {@link applyAppTagToBlueprintDocument} what the bundle carries. One implementation of "does this
 * graph reduce to a decided branch" is what keeps a refusal and a removal talking about the same set
 * of graphs.
 *
 * # What folds
 *
 * The rule is about **values**, not about nodes, and it is the story side's rule restated for a graph.
 * A value is *tainted* when it derives from a `Get App Tag`, and *resolved* when the fold worked out
 * the constant. Every resolved tainted value is replaced by a literal wherever it is consumed, and the
 * chain that produced it is then swept away as unconsumed - so `Get App Tag` feeding a text field
 * ships as the string `"Demo"`, exactly as the interpolation `{AppTag}` does in a story line. No
 * variant test is performed at play time, which is the entire property this feature protects.
 *
 * The chain is evaluated with the shipped runtime's own rules - see {@link foldableNodeValue}, which
 * mirrors `graphParamResolvers` operation for operation so a folded answer and a played one can never
 * differ. When a resolved value lands on the condition of an `If`, an `If Else` or a `Switch String`,
 * the branch is decided as well: execution is rewired past the node, the arms this edition cannot
 * enter stop being reachable, and everything that only they reached is deleted along with the pure
 * data nodes that fed it.
 *
 * A graph with no `Get App Tag` in it comes back **by reference**, untouched. This runs over every
 * blueprint on every Dev Mode reload, and a walk that rebuilt each graph would churn the whole
 * project on a save that touched one node - as well as constant-fold expressions that have nothing to
 * do with variants. That last part is not only a cost: a fold is only ever applied to a value that
 * traces back to `Get App Tag`, so an author's `Equal` between two literals keeps both of its arms.
 *
 * # What is refused
 *
 * Three things, and all three are refused in *every* build including the release one, because
 * `AppTag` has no play-time value: a graph these describe cannot be compiled under any variant.
 *
 *  - **A tainted value the fold could not resolve, consumed by anything.** `Get App Tag` compared with
 *    a variable gives `"Demo" == gold`: a variant test performed on the player's machine, in every
 *    package, with both arms of whatever it decides present in all of them. That is the leak. The
 *    node surviving is not the test - substituting always removes it - the test is whether what it
 *    fed came out a constant.
 *  - **A node type the pin table has not heard of**, in a graph that is folding. A plugin node's
 *    execution pins are unknown here, so a sweep past one might leave a whole arm of a decided branch
 *    behind - and that result is indistinguishable from a correct fold until someone finds the
 *    content in a shipped package. A graph with no `Get App Tag` is untouched, so a project full of
 *    plugin nodes still builds; only a graph that both folds and holds one is refused.
 *  - **A fold that would delete a `Fn` head.** A `Call Fn` elsewhere names that head by id, and a
 *    graph whose call points at nothing is worse than one that was never folded.
 *
 * A refused graph is returned exactly as it came in. Not folded as far as it would go: the whole
 * point of the refusal is that the remaining sweep cannot be trusted, and a half-folded graph reaching
 * a pack would be the failure this module exists to prevent. The build stops, so nothing ships;
 * Dev Mode and the preview carry the graph whole, which is what they already do for a story the
 * gate would have refused.
 */

/** What one graph folds against: `Get App Tag` becomes the variant's name and nothing else. */
export type AppTagGraphFoldOptions = {
  /** The variant's own name, exactly as the variant list stores it. Release is "main". */
  tagName: string;
};

/** Why a graph cannot be folded. Each maps to one line of build console copy. */
export type AppTagGraphRefusalReason =
  /** A `Get App Tag` whose value did not end up deciding a branch. */
  | "unresolved"
  /** A node type the shared pin table does not know, in a graph that folds. */
  | "unknownNode"
  /** The fold would have deleted a `Fn` head that a `Call Fn` may name. */
  | "fnHeadRemoved";

/** One reason one graph was refused, named by the node that caused it. */
export type AppTagGraphRefusal = {
  reason: AppTagGraphRefusalReason;
  nodeId: string;
  nodeType: string;
};

/**
 * What folding one graph produced.
 *
 * One shape rather than a success/failure union, for the reason the story side gives: the transform
 * reads `ir`, the gate reads `refusals`, and `mentioned` is what keeps both of them off the graphs
 * that have nothing to do with variants.
 */
export type AppTagGraphFold = {
  /** The folded graph. Reference-identical to the input when nothing changed. */
  ir: BlueprintGraphIr;
  /** Whether the graph held a `Get App Tag` at all. */
  mentioned: boolean;
  /** Non-empty when the graph could not be folded; `ir` is then the input, unchanged. */
  refusals: AppTagGraphRefusal[];
};

/** One refused graph, located well enough for a build console line to name it. */
export type UnfoldableAppTagGraph = AppTagGraphRefusal & {
  blueprintId: string;
  blueprintName: string;
  graphId: string;
  /** The event or function layer's own name, or its id when it was never named. */
  graphName: string;
};

// ── Runtime value rules, restated ────────────────────────────────────────────────────────────────
//
// Every coercion below is copied from `graphParamResolvers` rather than invented. A fold that
// disagreed with the executor about what `"main" == "Main"` is worth would delete the arm the game
// would have run, which is a wrong package rather than a failed build.

function toBlueprintBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
  }
  return Boolean(value);
}

function toBlueprintString(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * What one output pin is worth, in the two dimensions that decide this graph's fate.
 *
 * **Tainted** means the value derives from a `Get App Tag`. It is the whole safety of the branch
 * elimination: without it a graph that merely contains a `Get App Tag` somewhere would have every
 * constant comparison in it decided, and an author's half-written `else` would disappear for a reason
 * that has nothing to do with editions.
 *
 * **Resolved** means the fold computed the constant. A `Get App Tag` output is always both - it *is*
 * the variant name - and a tainted value stays resolved for as long as the chain consuming it is one
 * this file can evaluate.
 *
 * The pair is what states the rule the story side states: substitute every resolved tainted value,
 * wherever it is consumed, and refuse when a tainted value that is *not* resolved is consumed by
 * anything. An unresolved tainted value is a test the player's machine would perform, in every
 * package, which is the leak. A resolved one is a string the package simply carries.
 */
type PinValue = {
  tainted: boolean;
  resolved: boolean;
  /** Only meaningful when `resolved`. */
  value?: unknown;
};

/** An ordinary runtime value: nothing to substitute, nothing to refuse. */
const OPAQUE: PinValue = { tainted: false, resolved: false };

// ── Folding one graph ─────────────────────────────────────────────────────────────────────────────

/** The output pin `Get App Tag` publishes the variant name on. */
const APP_TAG_OUTPUT_PIN_ID = "appTag";

/** `If Else` pairs `X_condition` with `X_then`; `Switch String` pairs `X_value` with `X_output`. */
const IF_ELSE_CONDITION_SUFFIX = "_condition";
const IF_ELSE_THEN_SUFFIX = "_then";
const SWITCH_CASE_VALUE_SUFFIX = "_value";
const SWITCH_CASE_OUTPUT_SUFFIX = "_output";

/**
 * How many fixed `caseNValue` params `Switch String` reads.
 *
 * Two of them are pins on the card; the executor nevertheless looks for four, so a graph written
 * before the pins were reduced still routes. Mirrored here for the same reason every other coercion
 * is: the fold has to decide the branch the executor would have taken, not the one the card suggests.
 */
const SWITCH_STRING_LEGACY_CASE_COUNT = 4;

/**
 * Every node the fold can carry a variant name through.
 *
 * All of them publish on `result` and read `a` (and, except for `Not`, `b`), which is what lets one
 * evaluator serve them. See {@link FoldableGraph.foldableNodeValue} for why the list is short.
 */
const FOLDABLE_NODE_TYPES: ReadonlySet<string> = new Set([
  BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
  BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL,
  BLUEPRINT_NODE_TYPE_STRING_EQUALS,
  BLUEPRINT_NODE_TYPE_STRING_EQUALS_IGNORE_CASE,
  BLUEPRINT_NODE_TYPE_BOOLEAN_AND,
  BLUEPRINT_NODE_TYPE_BOOLEAN_OR,
  BLUEPRINT_NODE_TYPE_BOOLEAN_NOT,
  BLUEPRINT_NODE_TYPE_BOOLEAN_XOR
]);

export function foldAppTagInBlueprintGraph(
  ir: BlueprintGraphIr,
  options: AppTagGraphFoldOptions
): AppTagGraphFold {
  const nodes = ir.nodes ?? {};
  const appTagNodeIds = Object.keys(nodes).filter(
    (nodeId) => nodes[nodeId]?.type === BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG
  );
  if (appTagNodeIds.length === 0) {
    return { ir, mentioned: false, refusals: [] };
  }

  const unknown = Object.values(nodes).find(
    (node) => node && blueprintNodeExecPins(node.type) === null
  );
  if (unknown) {
    return {
      ir,
      mentioned: true,
      refusals: [{ reason: "unknownNode", nodeId: unknown.id, nodeType: unknown.type }]
    };
  }

  const graph = new FoldableGraph(ir, options.tagName);
  const refuse = (reason: AppTagGraphRefusalReason, nodeId: string): AppTagGraphFold => ({
    ir,
    mentioned: true,
    refusals: [{ reason, nodeId, nodeType: nodes[nodeId]?.type ?? "" }]
  });

  // 1. Decide the branches this variant settles, and drop what execution can no longer reach.
  const decisions = graph.decideBranches();
  const flowRemoved = graph.planFlowRemoval(decisions);
  const removedFnHead = [...flowRemoved].find(
    (nodeId) => nodes[nodeId]?.type === BLUEPRINT_NODE_TYPE_FN_HEAD
  );
  if (removedFnHead) {
    return refuse("fnHeadRemoved", removedFnHead);
  }
  let edges = graph.rewireEdges(decisions, flowRemoved);

  // 2. Sweep the data nodes the removal orphaned, before judging what is left. A chain that only
  //    fed a deleted arm is gone from the package either way, so it must not be able to refuse the
  //    build for a leak that is no longer in it.
  const removed = new Set(flowRemoved);
  for (const nodeId of FoldableGraph.sweepOrphans(graph.survivingNodes(removed), edges, [
    ...appTagNodeIds,
    ...feedersOf(ir.edges ?? [], flowRemoved)
  ])) {
    removed.add(nodeId);
  }
  edges = edges.filter((edge) => !removed.has(edge.from.nodeId) && !removed.has(edge.to.nodeId));

  // 3. Judge every value still flowing. A tainted value the fold resolved is a constant the package
  //    can simply carry; one it could not resolve is a variant test the player's machine would
  //    perform, in every edition, which is the leak this whole module exists to stop.
  const substitutions = new Map<string, { source: BlueprintGraphEdge["from"]; value: unknown }>();
  for (const edge of edges) {
    const pin = graph.valueOf(edge.from.nodeId, edge.from.port);
    if (!pin.tainted) {
      continue;
    }
    if (!pin.resolved) {
      return refuse("unresolved", edge.from.nodeId);
    }
    substitutions.set(`${edge.from.nodeId} ${edge.from.port}`, {
      source: edge.from,
      value: pin.value
    });
  }

  // 4. Replace each resolved source with a literal and rewire its consumers onto it, then sweep the
  //    chain that has just lost them. This is what removes the `Get App Tag` node itself.
  const nodesOut = graph.survivingNodes(removed);
  for (const [key, { source, value }] of substitutions) {
    const literalId = uniqueLiteralNodeId(nodesOut, source.nodeId);
    nodesOut[literalId] = {
      id: literalId,
      type: BLUEPRINT_NODE_TYPE_LITERAL,
      params: { value: value as never },
      // Carried over so a node the editor could open still sits where its source sat.
      ...(nodes[source.nodeId]?.meta ? { meta: nodes[source.nodeId].meta } : {})
    };
    edges = edges.map((edge) =>
      `${edge.from.nodeId} ${edge.from.port}` === key
        ? { from: { nodeId: literalId, port: "value" }, to: edge.to }
        : edge
    );
  }
  if (substitutions.size > 0) {
    const orphaned = FoldableGraph.sweepOrphans(nodesOut, edges, [
      ...appTagNodeIds,
      ...[...substitutions.values()].map((entry) => entry.source.nodeId)
    ]);
    for (const nodeId of orphaned) {
      delete nodesOut[nodeId];
    }
    edges = edges.filter(
      (edge) => !orphaned.has(edge.from.nodeId) && !orphaned.has(edge.to.nodeId)
    );
  }

  // 5. Belt and braces. Every path above removes the node, so this can only fire on a defect - and a
  //    build that refuses is a far better failure than a package carrying a live variant read.
  const survivingAppTag = appTagNodeIds.find((nodeId) => nodesOut[nodeId]);
  if (survivingAppTag) {
    return refuse("unresolved", survivingAppTag);
  }
  return { ir: graph.assemble(nodesOut, edges), mentioned: true, refusals: [] };
}

/**
 * Nodes that fed something the fold removed - the seed set for the orphan sweep.
 *
 * Read from the graph's original edges, not the rewired list: the rewired list has already dropped
 * every edge into a removed node, so it no longer remembers who was feeding one.
 */
function feedersOf(edges: readonly BlueprintGraphEdge[], removed: ReadonlySet<string>): string[] {
  return edges
    .filter((edge) => removed.has(edge.to.nodeId) && !removed.has(edge.from.nodeId))
    .map((edge) => edge.from.nodeId);
}

/** A node id no node in `nodes` answers to, derived from the source so a reader can trace it. */
function uniqueLiteralNodeId(
  nodes: Readonly<Record<string, BlueprintGraphNode>>,
  sourceNodeId: string
): string {
  const base = `${sourceNodeId}__appTag`;
  if (!nodes[base]) {
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (!nodes[candidate]) {
      return candidate;
    }
  }
}

/** Which exec output pin a decided branch node hands control to, or `null` when flow ends there. */
type BranchDecision = { takenPort: string | null };

/** The graph as it stands, for the reachability sweep that measures what the fold took away. */
const NO_DECISIONS: ReadonlyMap<string, BranchDecision> = new Map();

class FoldableGraph {
  private readonly ir: BlueprintGraphIr;
  private readonly nodes: Record<string, BlueprintGraphNode>;
  private readonly edges: readonly BlueprintGraphEdge[];
  private readonly tagName: string;
  /** Memo for {@link outputValue}; also the cycle guard, since a data cycle would recurse forever. */
  private readonly outputs = new Map<string, PinValue>();
  private readonly resolving = new Set<string>();

  public constructor(ir: BlueprintGraphIr, tagName: string) {
    this.ir = ir;
    this.nodes = ir.nodes ?? {};
    this.edges = ir.edges ?? [];
    this.tagName = tagName;
  }

  // ── Values ────────────────────────────────────────────────────────────────────────────────────

  /**
   * What feeds one data input pin.
   *
   * The two cases are `resolveDataPinValue`'s own, in its order: an incoming edge wins, and with no
   * edge the on-card literal in `params` is the value. A wired pin beating the inspector value is a
   * project-wide convention, and a fold that read them the other way round would decide the branch
   * on a number the author had left behind.
   */
  private inputValue(nodeId: string, pinId: string): PinValue {
    const edge = this.edges.find((e) => e.to.nodeId === nodeId && e.to.port === pinId);
    if (edge) {
      return this.outputValue(edge.from.nodeId, edge.from.port);
    }
    // An unwired `condition` reads as false at runtime, and is never tainted - so an `If` nobody
    // has wired up yet is left exactly where the author left it.
    if (pinId === "condition") {
      return { tainted: false, resolved: true, value: false };
    }
    return { tainted: false, resolved: true, value: this.nodes[nodeId]?.params?.[pinId] };
  }

  /** What one output pin is worth. Memoized, because one value can feed many consumers. */
  private outputValue(nodeId: string, portId: string): PinValue {
    const key = `${nodeId}\u0000${portId}`;
    const memo = this.outputs.get(key);
    if (memo) {
      return memo;
    }
    if (this.resolving.has(key)) {
      // A data cycle. Opaque rather than an error: the executor would recurse to its own depth
      // limit and answer undefined, and either way there is no constant here to substitute.
      return OPAQUE;
    }
    this.resolving.add(key);
    const value = this.computeOutputValue(nodeId, portId);
    this.resolving.delete(key);
    this.outputs.set(key, value);
    return value;
  }

  private computeOutputValue(nodeId: string, portId: string): PinValue {
    const node = this.nodes[nodeId];
    if (!node) {
      return OPAQUE;
    }
    // An execution output carries no value, so it can never be tainted. Answering otherwise would
    // make every node downstream of a `Set Text` showing the variant name look like a leak.
    if ((blueprintNodeExecOutputPinIds(node) ?? []).includes(portId)) {
      return OPAQUE;
    }
    if (node.type === BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG) {
      return portId === APP_TAG_OUTPUT_PIN_ID
        ? { tainted: true, resolved: true, value: this.tagName }
        : OPAQUE;
    }
    // The two literal nodes the executor reads straight off the source node's params, spelled the
    // same way it spells them.
    if (node.type === BLUEPRINT_NODE_TYPE_LITERAL_STRING && portId === "value") {
      return { tainted: false, resolved: true, value: String(node.params?.value ?? "") };
    }
    if (node.type === BLUEPRINT_NODE_TYPE_LITERAL && portId === "value") {
      return { tainted: false, resolved: true, value: node.params?.value };
    }
    const folded = this.foldableNodeValue(node, portId);
    if (folded) {
      return folded;
    }
    // Everything else is a value only the running game has. It still carries taint, because a node
    // this file cannot evaluate is exactly where a variant name stops being a constant, and that
    // is the case the refusal exists for. Taint is read off the incoming edges rather than a pin
    // list - the only reading available without the node registry, and it errs towards refusing.
    return { tainted: this.hasTaintedInput(node.id), resolved: false };
  }

  /** Whether anything wired into this node carries the variant name. */
  private hasTaintedInput(nodeId: string): boolean {
    return this.edges.some(
      (edge) =>
        edge.to.nodeId === nodeId && this.outputValue(edge.from.nodeId, edge.from.port).tainted
    );
  }

  /**
   * The operations the fold can carry a variant name through: strict comparison, string comparison,
   * and boolean logic.
   *
   * A deliberately short list. Every entry is a promise that this file computes exactly what
   * `graphParamResolvers` computes, and a node whose runtime behaviour is more than a line of
   * arithmetic cannot make that promise cheaply. `Concat` is the case worth naming: joining the
   * variant name onto a sentence is obviously constant to a reader, but the node is variadic and its
   * pin list lives in the registry, so this file cannot evaluate it and a graph that does it is
   * refused. Conservative on purpose - the cost of the list being short is a build that says so,
   * never a package that carries a variant test.
   *
   * `null` means "not one of these", which is different from "one of these and undecidable".
   */
  private foldableNodeValue(node: BlueprintGraphNode, portId: string): PinValue | null {
    if (portId !== "result" || !FOLDABLE_NODE_TYPES.has(node.type)) {
      return null;
    }
    const a = this.inputValue(node.id, "a");
    if (node.type === BLUEPRINT_NODE_TYPE_BOOLEAN_NOT) {
      return a.resolved
        ? { tainted: a.tainted, resolved: true, value: !toBlueprintBoolean(a.value) }
        : { tainted: a.tainted, resolved: false };
    }
    const b = this.inputValue(node.id, "b");
    const tainted = a.tainted || b.tainted;
    if (!a.resolved || !b.resolved) {
      return { tainted, resolved: false };
    }
    const resolvedAs = (value: unknown): PinValue => ({ tainted, resolved: true, value });
    switch (node.type) {
      case BLUEPRINT_NODE_TYPE_COMPARE_EQUAL:
        return resolvedAs(a.value === b.value);
      case BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL:
        return resolvedAs(a.value !== b.value);
      case BLUEPRINT_NODE_TYPE_STRING_EQUALS:
        return resolvedAs(toBlueprintString(a.value) === toBlueprintString(b.value));
      case BLUEPRINT_NODE_TYPE_STRING_EQUALS_IGNORE_CASE:
        return resolvedAs(
          toBlueprintString(a.value).toLowerCase() === toBlueprintString(b.value).toLowerCase()
        );
      case BLUEPRINT_NODE_TYPE_BOOLEAN_AND:
        return resolvedAs(toBlueprintBoolean(a.value) && toBlueprintBoolean(b.value));
      case BLUEPRINT_NODE_TYPE_BOOLEAN_OR:
        return resolvedAs(toBlueprintBoolean(a.value) || toBlueprintBoolean(b.value));
      case BLUEPRINT_NODE_TYPE_BOOLEAN_XOR:
        return resolvedAs(toBlueprintBoolean(a.value) !== toBlueprintBoolean(b.value));
      default:
        return null;
    }
  }

  // ── Branches ──────────────────────────────────────────────────────────────────────────────────

  /** Every branch node whose condition this variant settles, and which arm it takes. */
  public decideBranches(): Map<string, BranchDecision> {
    const decisions = new Map<string, BranchDecision>();
    for (const node of Object.values(this.nodes)) {
      const decision = this.decideBranch(node);
      if (decision) {
        decisions.set(node.id, decision);
      }
    }
    return decisions;
  }

  private decideBranch(node: BlueprintGraphNode | undefined): BranchDecision | null {
    if (!node) {
      return null;
    }
    if (node.type === BLUEPRINT_NODE_TYPE_FLOW_IF) {
      const condition = this.inputValue(node.id, "condition");
      if (!condition.tainted || !condition.resolved) {
        return null;
      }
      // `Boolean(...)`, not `toBlueprintBoolean(...)`: the `If` node's own executor coerces with
      // plain truthiness, and the two disagree about the string "false".
      return { takenPort: condition.value ? "true" : "false" };
    }
    if (node.type === BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE) {
      return this.decideIfElse(node);
    }
    if (node.type === BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING) {
      return this.decideSwitchString(node);
    }
    return null;
  }

  /**
   * `If Else` in its executor's order: the fixed condition first, then each added one, first true
   * wins, and `else` when none does.
   *
   * Every condition up to the deciding one has to be known - an unreadable earlier condition could
   * have claimed the flow - and at least one of them has to trace back to the variant name, or this
   * would be deleting arms of a chain that has nothing to do with editions.
   */
  private decideIfElse(node: BlueprintGraphNode): BranchDecision | null {
    const added = readVariadicPinIds(node.params, BLUEPRINT_IF_ELSE_BRANCH_PINS.storageKey).filter(
      (pinId) => pinId.endsWith(IF_ELSE_CONDITION_SUFFIX)
    );
    let tainted = false;
    for (const pinId of ["condition", ...added]) {
      const condition = this.inputValue(node.id, pinId);
      if (!condition.resolved) {
        return null;
      }
      tainted ||= condition.tainted;
      if (toBlueprintBoolean(condition.value)) {
        return tainted ? { takenPort: thenPortForIfElseCondition(pinId) } : null;
      }
    }
    return tainted ? { takenPort: "else" } : null;
  }

  /**
   * `Switch String` in its executor's order: the four legacy `caseNValue` params, then each added
   * case, and `default` when none matches. A case whose value is absent is skipped rather than
   * matched against the empty string, which is what `caseValue !== undefined` means there.
   */
  private decideSwitchString(node: BlueprintGraphNode): BranchDecision | null {
    const subject = this.inputValue(node.id, "value");
    if (!subject.resolved) {
      return null;
    }
    let tainted = subject.tainted;
    const text = toBlueprintString(subject.value);
    const addedIds = readVariadicPinIds(node.params, BLUEPRINT_SWITCH_STRING_CASE_PINS.storageKey);
    const cases: Array<{ valuePinId: string; outputPinId: string }> = [];
    for (let index = 0; index < SWITCH_STRING_LEGACY_CASE_COUNT; index += 1) {
      cases.push({ valuePinId: `case${index}Value`, outputPinId: `case${index}` });
    }
    for (const valuePinId of addedIds) {
      if (!valuePinId.endsWith(SWITCH_CASE_VALUE_SUFFIX)) {
        continue;
      }
      const outputPinId = `${valuePinId.slice(0, -SWITCH_CASE_VALUE_SUFFIX.length)}${SWITCH_CASE_OUTPUT_SUFFIX}`;
      if (addedIds.includes(outputPinId)) {
        cases.push({ valuePinId, outputPinId });
      }
    }
    for (const { valuePinId, outputPinId } of cases) {
      const candidate = this.inputValue(node.id, valuePinId);
      if (!candidate.resolved) {
        return null;
      }
      tainted ||= candidate.tainted;
      if (candidate.value !== undefined && text === toBlueprintString(candidate.value)) {
        return tainted ? { takenPort: outputPinId } : null;
      }
    }
    return tainted ? { takenPort: "default" } : null;
  }

  // ── Removal ───────────────────────────────────────────────────────────────────────────────────

  /**
   * Every node the fold takes out: the decided branch nodes, whatever execution can no longer reach,
   * and the pure data nodes left feeding nothing.
   *
   * Reachability is measured twice, and both sweeps start from the roots **the input graph had**.
   * Recomputing them from the folded graph would defeat the whole thing: once a branch is gone, the
   * first node of a dropped arm has no incoming edge either, and would promote itself to an entry
   * point. The one root that legitimately moves is a decided branch node that was an entry itself -
   * its taken arm inherits the status, or the sweep would strand the arm this edition runs.
   */
  public planFlowRemoval(decisions: ReadonlyMap<string, BranchDecision>): Set<string> {
    const removed = new Set<string>(decisions.keys());
    if (decisions.size === 0) {
      return removed;
    }
    const before = this.reachable(this.executionRoots(NO_DECISIONS), () => null);
    const after = this.reachable(
      this.executionRoots(decisions),
      (nodeId) => decisions.get(nodeId) ?? null
    );
    for (const nodeId of before) {
      if (!after.has(nodeId)) {
        removed.add(nodeId);
      }
    }
    return removed;
  }

  /**
   * Where execution starts: any node with execution pins that nothing routes into.
   *
   * Derived rather than listed, so an event head, a `Fn` head and a function entry are all covered
   * without this module holding a second opinion about node roles. A decided branch node that is
   * itself a root hands that status to whatever its taken arm points at - otherwise deleting it
   * would strand the arm this edition actually runs.
   */
  private executionRoots(decisions: ReadonlyMap<string, BranchDecision>): string[] {
    const routedInto = new Set<string>();
    for (const edge of this.edges) {
      if (this.isExecutionEdge(edge)) {
        routedInto.add(edge.to.nodeId);
      }
    }
    const roots: string[] = [];
    for (const node of Object.values(this.nodes)) {
      const pins = blueprintNodeExecPins(node.type);
      if (!pins || (pins.in.length === 0 && pins.out.length === 0) || routedInto.has(node.id)) {
        continue;
      }
      if (!decisions.has(node.id)) {
        roots.push(node.id);
        continue;
      }
      const promoted = this.followDecided(node.id, decisions);
      if (promoted) {
        roots.push(promoted.nodeId);
      }
    }
    return roots;
  }

  private isExecutionEdge(edge: BlueprintGraphEdge): boolean {
    const source = this.nodes[edge.from.nodeId];
    return (
      Boolean(source) && (blueprintNodeExecOutputPinIds(source) ?? []).includes(edge.from.port)
    );
  }

  /** Where a decided branch node hands control, following through any decided node it lands on. */
  private followDecided(
    nodeId: string,
    decisions: ReadonlyMap<string, BranchDecision>
  ): { nodeId: string; port: string } | null {
    const seen = new Set<string>();
    let cursor: string | null = nodeId;
    while (cursor && decisions.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      const takenPort: string | null = decisions.get(cursor)?.takenPort ?? null;
      if (!takenPort) {
        return null;
      }
      const current: string = cursor;
      const edge: BlueprintGraphEdge | undefined = this.edges.find(
        (e) => e.from.nodeId === current && e.from.port === takenPort
      );
      if (!edge) {
        // The taken arm goes nowhere, which is what an unconnected execution output already
        // means: flow ends here.
        return null;
      }
      if (!decisions.has(edge.to.nodeId)) {
        return { nodeId: edge.to.nodeId, port: edge.to.port };
      }
      cursor = edge.to.nodeId;
    }
    return null;
  }

  /** Execution-flow reachability from `roots`, taking only the decided arm of a decided node. */
  private reachable(
    roots: readonly string[],
    decisionOf: (nodeId: string) => BranchDecision | null
  ): Set<string> {
    const reached = new Set<string>();
    const queue = [...roots];
    while (queue.length > 0) {
      const nodeId = queue.pop() as string;
      if (reached.has(nodeId) || !this.nodes[nodeId]) {
        continue;
      }
      reached.add(nodeId);
      const decision = decisionOf(nodeId);
      const ports = decision
        ? decision.takenPort
          ? [decision.takenPort]
          : []
        : (blueprintNodeExecOutputPinIds(this.nodes[nodeId]) ?? []);
      for (const edge of this.edges) {
        if (
          edge.from.nodeId === nodeId &&
          ports.includes(edge.from.port) &&
          !reached.has(edge.to.nodeId)
        ) {
          queue.push(edge.to.nodeId);
        }
      }
    }
    return reached;
  }

  /**
   * The pure data nodes nothing consumes any more, to a fixed point.
   *
   * Seeds are the caller's, never "every unconsumed data node": an author's disconnected `String`
   * sitting on the canvas is work in progress, and deleting it would change shipped bytes for a
   * reason that has nothing to do with variants. The callers seed it with the `Get App Tag` nodes,
   * with whatever fed something the fold removed, and with the sources a literal replaced.
   *
   * Takes its own node and edge lists rather than reading the graph's, because it runs twice - once
   * over what the branch removal left and once over what the substitution left, by which point both
   * lists hold nodes the input graph never had.
   */
  public static sweepOrphans(
    nodes: Readonly<Record<string, BlueprintGraphNode>>,
    edges: readonly BlueprintGraphEdge[],
    seeds: Iterable<string>
  ): Set<string> {
    const removed = new Set<string>();
    const candidates = new Set<string>(seeds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const nodeId of [...candidates]) {
        const node = nodes[nodeId];
        if (removed.has(nodeId) || !node || !isPureDataBlueprintNode(node)) {
          candidates.delete(nodeId);
          continue;
        }
        if (edges.some((edge) => edge.from.nodeId === nodeId && !removed.has(edge.to.nodeId))) {
          continue;
        }
        removed.add(nodeId);
        candidates.delete(nodeId);
        changed = true;
        for (const edge of edges) {
          if (edge.to.nodeId === nodeId && !removed.has(edge.from.nodeId)) {
            candidates.add(edge.from.nodeId);
          }
        }
      }
    }
    return removed;
  }

  // ── Rebuilding ────────────────────────────────────────────────────────────────────────────────

  /** The edge list with the removed nodes gone and execution routed past every decided branch. */
  public rewireEdges(
    decisions: ReadonlyMap<string, BranchDecision>,
    removed: ReadonlySet<string>
  ): BlueprintGraphEdge[] {
    const edges: BlueprintGraphEdge[] = [];
    for (const edge of this.edges) {
      if (removed.has(edge.from.nodeId)) {
        continue;
      }
      if (!removed.has(edge.to.nodeId)) {
        edges.push(edge);
        continue;
      }
      // The one edge worth keeping in another shape: execution arriving at a decided branch is
      // re-aimed at the arm this edition takes, which is how the flow survives the node's
      // removal. A data wire into a removed node has nothing to be re-aimed at.
      if (!decisions.has(edge.to.nodeId) || !this.isExecutionEdge(edge)) {
        continue;
      }
      const target = this.followDecided(edge.to.nodeId, decisions);
      if (target && !removed.has(target.nodeId)) {
        edges.push({ from: edge.from, to: { nodeId: target.nodeId, port: target.port } });
      }
    }
    return edges;
  }

  /** What one output pin is worth, for the substitution pass outside this class. */
  public valueOf(nodeId: string, portId: string): PinValue {
    return this.outputValue(nodeId, portId);
  }

  /** The input graph's nodes minus the removed ones, keyed as the IR keys them. */
  public survivingNodes(removed: ReadonlySet<string>): Record<string, BlueprintGraphNode> {
    const nodes: Record<string, BlueprintGraphNode> = {};
    for (const [nodeId, node] of Object.entries(this.nodes)) {
      if (!removed.has(nodeId)) {
        nodes[nodeId] = node;
      }
    }
    return nodes;
  }

  /** The finished graph. Spreads the input so `variables` and `meta` survive untouched. */
  public assemble(
    nodes: Record<string, BlueprintGraphNode>,
    edges: BlueprintGraphEdge[]
  ): BlueprintGraphIr {
    return { ...this.ir, nodes, edges };
  }
}

function thenPortForIfElseCondition(conditionPinId: string): string {
  if (conditionPinId === "condition") {
    return "then";
  }
  return conditionPinId.endsWith(IF_ELSE_CONDITION_SUFFIX)
    ? `${conditionPinId.slice(0, -IF_ELSE_CONDITION_SUFFIX.length)}${IF_ELSE_THEN_SUFFIX}`
    : "then";
}

// ── Whole documents ───────────────────────────────────────────────────────────────────────────────

type GraphCarrier = {
  id: string;
  name?: string;
  graph?: BlueprintGraphIr;
  meta?: Record<string, unknown>;
};

/**
 * Every graph a blueprint holds - events, functions and macros.
 *
 * Macros are walked although nothing writes `graphs.macros` today, for the reason every other
 * blueprint walker walks them: a node buried in one would ship exactly like a node on an event, and
 * costing nothing while the record is empty is the cheapest way not to be the walker that forgot.
 */
function eachGraphSlot(
  blueprint: Blueprint
): Array<{ slot: "events" | "functions" | "macros"; carrier: GraphCarrier }> {
  if (blueprint.program.kind !== "graph") {
    return [];
  }
  const graphs = blueprint.program.graphs;
  return [
    ...Object.values(graphs.events ?? {}).map((carrier) => ({ slot: "events" as const, carrier })),
    ...Object.values(graphs.functions ?? {}).map((carrier) => ({
      slot: "functions" as const,
      carrier
    })),
    ...Object.values(graphs.macros ?? {}).map((carrier) => ({ slot: "macros" as const, carrier }))
  ];
}

/**
 * Every graph in the document that names the variant without deciding a branch with it.
 *
 * What the build gate reads. The variant's name is passed for completeness only: whether a graph
 * reduces is a property of the graph, so a chain that stops at a text field stops under every
 * variant, which is why one refusal covers them all.
 */
export function collectUnfoldableAppTagGraphs(
  document: BlueprintDocument | null,
  options: AppTagGraphFoldOptions
): UnfoldableAppTagGraph[] {
  return Object.values(document?.blueprints ?? {}).flatMap((blueprint) =>
    collectUnfoldableAppTagGraphsInBlueprint(blueprint, options)
  );
}

/**
 * The same sweep over one blueprint.
 *
 * Exported for the shared blueprint assets, which are asset files rather than entries in the
 * document - see `foldSharedBlueprints` in the bundle assembler for why they are judged there and
 * not at the build gate.
 */
export function collectUnfoldableAppTagGraphsInBlueprint(
  blueprint: Blueprint,
  options: AppTagGraphFoldOptions
): UnfoldableAppTagGraph[] {
  const found: UnfoldableAppTagGraph[] = [];
  for (const { carrier } of eachGraphSlot(blueprint)) {
    if (!carrier.graph) {
      continue;
    }
    for (const refusal of foldAppTagInBlueprintGraph(carrier.graph, options).refusals) {
      found.push({
        ...refusal,
        blueprintId: blueprint.id,
        blueprintName: blueprint.name,
        graphId: carrier.id,
        graphName: carrier.name?.trim() || carrier.id
      });
    }
  }
  return found;
}

/**
 * The blueprint document a package under this variant carries.
 *
 * Pure: nothing on disk is touched, and a document with no `Get App Tag` anywhere comes back by
 * reference - which matters because this runs on every Dev Mode reload over every blueprint in the
 * project.
 *
 * A graph that cannot be folded is carried through unchanged rather than throwing. The build gate is
 * what refuses those, and it has already run by the time a pack is produced; Dev Mode and the preview
 * have no gate and must keep running, exactly as they do for a story the gate would have refused.
 */
export function applyAppTagToBlueprintDocument(
  document: BlueprintDocument,
  options: AppTagGraphFoldOptions
): BlueprintDocument {
  let documentChanged = false;
  const blueprints: Record<string, Blueprint> = {};
  for (const [blueprintId, blueprint] of Object.entries(document.blueprints ?? {})) {
    const next = applyAppTagToBlueprint(blueprint, options);
    documentChanged ||= next !== blueprint;
    blueprints[blueprintId] = next;
  }
  return documentChanged ? { ...document, blueprints } : document;
}

/** One blueprint's graphs, folded. Reference-identical when none of them mentioned the variant. */
export function applyAppTagToBlueprint(
  blueprint: Blueprint,
  options: AppTagGraphFoldOptions
): Blueprint {
  if (blueprint.program.kind !== "graph") {
    return blueprint;
  }
  const graphs = blueprint.program.graphs;
  let changed = false;
  const foldSlot = <T extends GraphCarrier>(
    entries: Record<string, T> | undefined
  ): Record<string, T> | undefined => {
    if (!entries) {
      return entries;
    }
    const next: Record<string, T> = {};
    for (const [graphId, carrier] of Object.entries(entries)) {
      const ir = carrier?.graph;
      const folded = ir ? foldAppTagInBlueprintGraph(ir, options).ir : undefined;
      if (!folded || folded === ir) {
        next[graphId] = carrier;
        continue;
      }
      changed = true;
      next[graphId] = { ...carrier, graph: folded };
    }
    return next;
  };
  const events = foldSlot(graphs.events);
  const functions = foldSlot(graphs.functions);
  const macros = foldSlot(graphs.macros);
  if (!changed) {
    return blueprint;
  }
  return {
    ...blueprint,
    program: {
      ...blueprint.program,
      graphs: {
        ...graphs,
        ...(events ? { events } : {}),
        ...(functions ? { functions } : {}),
        ...(macros ? { macros } : {})
      }
    }
  };
}
