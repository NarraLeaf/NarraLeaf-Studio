/**
 * Pure projection: story document -> scene graph + layered auto-layout.
 *
 * Free of React and @xyflow/react so the graph shape and the layout stay unit-testable and the
 * canvas can remain a thin renderer. Jumps never cross stories (`targetSceneId` resolves inside the
 * same document), so one document is one self-contained graph.
 */

import type {
  StoryBlock,
  StoryBlockId,
  StoryDocument,
  StoryScene,
  StorySceneId
} from "@shared/types/story";
import { listSceneBlocksInDocumentOrder, listSceneIdsInDocumentOrder } from "@shared/types/story";
import { reachableSceneIds } from "@shared/story/storyReachability";
import {
  formatStoryConditionSummary,
  type ProjectVariableNames
} from "../story/projection/storySceneProjection";

/** Node box size. The layout and the node component must agree on these. */
export const SCENE_FLOW_NODE_WIDTH = 216;
export const SCENE_FLOW_NODE_HEIGHT = 72;

/**
 * One branch row inside an expanded scene node, and the fork label above each group of them.
 *
 * The layout adds them into the node's height and reports the result in `nodeSizes`, so the canvas
 * sizes its boxes from the same numbers the packing used. A renderer that computes its own height
 * puts its rows outside a box the neighbours were spaced against.
 */
export const SCENE_FLOW_BRANCH_ROW_HEIGHT = 26;
export const SCENE_FLOW_BRANCH_HEADER_HEIGHT = 20;

/** Between an outer arm's label and an inner fork's — see {@link collectSceneArms}. */
export const SCENE_FLOW_BRANCH_LABEL_SEPARATOR = " › ";

const COLUMN_GAP = 96;
const ROW_GAP = 28;
/**
 * A hub scene with many branches — or a story with no jumps at all, where every scene is its own
 * root — would otherwise run off the bottom of the canvas as one endless column.
 */
const MAX_ROWS_PER_COLUMN = 6;

/**
 * What kind of fork put a jump on one path rather than another.
 *
 * `conditionElse` carries no text of its own — the branch is defined by the ones it is not — so the
 * renderer supplies the existing "otherwise" wording rather than the model inventing a second one.
 * `conditionElseIf` carries a condition like an `if` does, but reaching it also means every earlier
 * arm failed; without its own kind the two render as the same bare condition text and the map claims
 * a path is taken whenever the condition holds, which is not what an `else if` means.
 */
export type SceneFlowBranchKind = "choice" | "condition" | "conditionElseIf" | "conditionElse";

/** The nearest branching ancestor of a jump, as the edge label renders it. */
export type SceneFlowBranchLabel = {
  kind: SceneFlowBranchKind;
  /**
   * Option text, or the condition summary (both `condition` and `conditionElseIf` carry one).
   * Empty for `conditionElse` and for an unnamed option.
   */
  label: string;
};

export type SceneFlowJumpRef = {
  blockId: StoryBlockId;
  /** The jump sits under a choice option or a condition branch, so it only fires on some runs. */
  conditional: boolean;
  /** The fork it hangs off, when there is one. Absent exactly when `conditional` is false. */
  branch?: SceneFlowBranchLabel;
  /**
   * The row is switched off, or sits under a row that is. The compiler drops it, so this edge is
   * in the map because the author wrote it, not because a player can take it.
   */
  disabled: boolean;
};

export type SceneFlowNodeModel = {
  sceneId: StorySceneId;
  name: string;
  /** Blocks written in the scene — a rough "how much is here" signal. */
  blockCount: number;
  isEntry: boolean;
  /** Reachable from the entry scene by following jumps. Always true when the story has no entry. */
  reachable: boolean;
  /** Jumps with an empty target or one pointing at a deleted scene — the compiler rejects these. */
  danglingJumpCount: number;
  /** Jumps back into the same scene. Shown as a badge: a self-loop edge renders as a smudge. */
  selfJumpCount: number;
};

export type SceneFlowEdgeModel = {
  id: string;
  source: StorySceneId;
  target: StorySceneId;
  /** Every jump block collapsed into this edge — two jumps A->B are one line, not two. */
  jumps: SceneFlowJumpRef[];
  /** Every jump on this edge is conditional, so the branch is not guaranteed. Drawn dashed. */
  conditional: boolean;
  /**
   * Every jump on this edge is switched off, so nothing the compiler emits takes it. Drawn faded.
   *
   * The map keeps drawing it: the author wrote this branch and can see that they did, which is the
   * whole difference between a flow map and a picture of the package. An edge with one live jump
   * and one disabled one is not faded - a player can still get there.
   */
  disabled: boolean;
  /**
   * The distinct forks that reach this target, in document order — what the collapsed line hides.
   * Deduplicated, so two options worded the same read as one path (they are, to a reader of the
   * map). Empty when nothing on the edge is branched.
   */
  branches: SceneFlowBranchLabel[];
};

/**
 * Which kind of question a fork asks: `choice` is the player deciding, `condition` is the state
 * deciding. Kept apart from {@link SceneFlowBranchKind} because that one names the *arm* (an `else`
 * is not an `if`), and a fork's rows are grouped and headed by the question, not by the answers.
 */
export type SceneFlowForkKind = "choice" | "condition";

/**
 * One arm of one fork, drawn as a node of its scene.
 *
 * Arms are nodes and forks are not: the fork asks, the arm answers, and it is the answer that owns
 * an outgoing jump. That is the whole reason this type exists - `SceneFlowEdgeModel` is keyed by
 * scene pair, so five options into five scenes leave one handle as five unattributed lines, and five
 * options into one scene collapse into a single line labelled with one of them.
 */
export type SceneFlowBranchNodeModel = {
  /** `scene-flow:branch:<blockId>` - the arm's own block (choiceOption / conditionBranch). */
  id: string;
  sceneId: StorySceneId;
  blockId: StoryBlockId;
  /** The container block: the `choice` action, or the `if` arm that opened the group. */
  forkId: string;
  forkKind: SceneFlowForkKind;
  /** Same vocabulary the edge labels already use, from the same derivation. */
  kind: SceneFlowBranchKind;
  /**
   * Option text / condition summary, prefixed with the owning arm when this fork is nested inside
   * another. Empty for `conditionElse` and for an unnamed option - the renderer supplies the
   * "otherwise" wording, so an empty label means "this arm has no text", never "the text is gone".
   */
  label: string;
  /** Sibling order inside the fork, and fork order inside the scene - layout ties break on these. */
  order: number;
  forkOrder: number;
  /** Distinct scenes this arm jumps to, in document order. Self and dangling targets are excluded. */
  targets: StorySceneId[];
  /**
   * This arm owns no jump of its own, so control falls back into the scene and continues past the
   * fork. Self-jumps count as falling through (the run stays in this scene either way); a dangling
   * jump does not, because the author did write a jump and it is broken, not absent.
   *
   * An arm whose *nested* fork jumps still falls through: the jump belongs to the inner arm, which
   * is a row of its own. Anything else would credit an option with an exit it does not take.
   */
  fallsThrough: boolean;
  danglingJumpCount: number;
  selfJumpCount: number;
};

/** One arm -> one scene. The option-level reading of `SceneFlowEdgeModel`, not a replacement for it. */
export type SceneFlowBranchEdgeModel = {
  /** `scene-flow:branch:<blockId>-><targetSceneId>` */
  id: string;
  sourceBranchId: string;
  sourceSceneId: StorySceneId;
  target: StorySceneId;
  jumps: SceneFlowJumpRef[];
};

export type SceneFlowGraph = {
  nodes: SceneFlowNodeModel[];
  edges: SceneFlowEdgeModel[];
  /** Every fork arm of every scene, in scene order, then fork order, then arm order. */
  branches: SceneFlowBranchNodeModel[];
  branchEdges: SceneFlowBranchEdgeModel[];
  /** Auto-layout result keyed by scene id. Manual drags override this per node. */
  positions: Record<StorySceneId, { x: number; y: number }>;
  /** What the layout packed against, for every scene. The canvas must size its boxes from this. */
  nodeSizes: Record<StorySceneId, { width: number; height: number }>;
  danglingJumpCount: number;
  unreachableCount: number;
};

export type SceneFlowGraphOptions = {
  /**
   * Scenes drawn with their branch rows showing. Absent or empty reproduces the collapsed map
   * exactly - same nodes, same edges, same positions - because that is the default view, and a map
   * whose boxes move when a new field lands is a map the author stops trusting.
   */
  expandedSceneIds?: ReadonlySet<StorySceneId>;
  /**
   * Display names for `saved` variables declared only in the project registry, so a condition arm
   * reading one is labelled `好感 >= 5` rather than `variable >= 5`.
   *
   * Optional because the graph shape does not depend on it — every test and every caller that only
   * wants topology keeps working — but a map is read, and after the declaration migration the
   * registry is the ONLY place a saved variable is declared, so a caller with services must pass it.
   */
  variableNames?: ProjectVariableNames;
};

/**
 * How the map words one arm — and, by returning null for everything else, the test for whether a
 * block *is* an arm.
 *
 * Only two blocks fork: a choice option (the player picks) and a condition branch (the state
 * decides). `sequence` / `parallel` / `race` / `repeat` are *ordering*, not choosing: every jump
 * inside them runs, so a jump under a `sequence` is as certain as one at the top of the scene. The
 * previous rule stopped at any `control` ancestor and so drew half the maps dashed for no reason.
 *
 * One function serves both the edge labels and the branch nodes on purpose. Two readings of the same
 * `if` drift the first time a condition kind is added, and then the line and the row it leaves from
 * word the same fork two ways.
 */
function describeArm(
  block: StoryBlock,
  scene: StoryScene,
  document: StoryDocument,
  variableNames?: ProjectVariableNames
): SceneFlowBranchLabel | null {
  if (block.kind === "nodeAction" && block.payload.action === "choiceOption") {
    return { kind: "choice", label: block.payload.text.value.trim() };
  }
  if (block.kind === "control" && block.payload.control === "conditionBranch") {
    if (block.payload.branch === "else") {
      return { kind: "conditionElse", label: "" };
    }
    return {
      kind: block.payload.branch === "elseIf" ? "conditionElseIf" : "condition",
      label: formatStoryConditionSummary(block.payload.condition, scene, document, variableNames)
    };
  }
  return null;
}

/** The arm block a jump belongs to, plus how that arm reads. */
type SceneFlowOwningArm = {
  block: StoryBlock;
  branch: SceneFlowBranchLabel;
};

/**
 * The nearest fork above a jump — the thing that decides whether this jump is the one that runs.
 *
 * Nearest wins: an option nested inside an `if` is reached by picking that option, and the option is
 * what a reader of the map needs to see. It is also what makes a nested fork's rows the owners of
 * their own jumps rather than the outer option's.
 */
function resolveOwningArm(
  scene: StoryScene,
  block: StoryBlock,
  document: StoryDocument,
  variableNames?: ProjectVariableNames
): SceneFlowOwningArm | null {
  const seen = new Set<StoryBlockId>();
  let parentId = block.parentId;
  // A corrupted document must not hang the editor, hence the visited set.
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = scene.blocks[parentId];
    if (!parent) {
      return null;
    }
    const branch = describeArm(parent, scene, document, variableNames);
    if (branch) {
      return { block: parent, branch };
    }
    parentId = parent.parentId;
  }
  return null;
}

/** Same fork, worded the same way — the dedupe key for an edge's branch list. */
function branchKey(branch: SceneFlowBranchLabel): string {
  return `${branch.kind}:${branch.label}`;
}

/** An arm under construction: its jumps are attributed in a second pass over the scene. */
type SceneFlowArmDraft = {
  node: SceneFlowBranchNodeModel;
  /** Jumps this arm owns, grouped by target in the order the author wrote them. */
  jumpsByTarget: Map<StorySceneId, SceneFlowJumpRef[]>;
};

/**
 * Every fork arm of a scene, in the order the walk meets them.
 *
 * A `choice` container's arms are its direct options. A condition's arms are a run of consecutive
 * `conditionBranch` siblings: `if` opens the run, `elseIf`/`else` extend it, and anything else
 * between them ends it. Grouping by sibling run rather than by a stored id is not a shortcut — the
 * arms *are* plain siblings, nothing in the document records which `if` an `else` answers, and the
 * compiler chains them by exactly the same adjacency.
 *
 * Nesting is carried in the label, not in the geometry: an inner fork's arms are arms of the same
 * scene, prefixed with the arm that owns them (`跟她走 › gold >= 5`). A second level of boxes is
 * where a map stops being readable, and the prefix keeps the provenance without it.
 */
function collectSceneArms(
  scene: StoryScene,
  document: StoryDocument,
  variableNames?: ProjectVariableNames
): SceneFlowArmDraft[] {
  const drafts: SceneFlowArmDraft[] = [];
  // Scene-wide: a corrupted `childrenIds` cycle must not recurse forever, and a block two parents
  // both claim belongs to the one the author reads first.
  const visited = new Set<StoryBlockId>();
  let nextForkOrder = 0;

  const childBlocks = (ids: readonly StoryBlockId[]): StoryBlock[] =>
    ids
      .map((childId) => scene.blocks[childId])
      .filter((child): child is StoryBlock => Boolean(child));

  /** Emits one arm and returns the label its own subtree should be prefixed with. */
  const record = (
    block: StoryBlock,
    branch: SceneFlowBranchLabel,
    fork: { id: StoryBlockId; kind: SceneFlowForkKind; order: number },
    order: number,
    ownerLabel: string
  ): string => {
    // An arm with no text of its own keeps none: `label === ""` is the renderer's signal to word
    // it "otherwise", and a lone prefix trailing a separator reads as a label that got cut off.
    const label =
      branch.label && ownerLabel
        ? `${ownerLabel}${SCENE_FLOW_BRANCH_LABEL_SEPARATOR}${branch.label}`
        : branch.label;
    drafts.push({
      node: {
        id: `scene-flow:branch:${block.id}`,
        sceneId: scene.id,
        blockId: block.id,
        forkId: fork.id,
        forkKind: fork.kind,
        kind: branch.kind,
        label,
        order,
        forkOrder: fork.order,
        targets: [],
        fallsThrough: true,
        danglingJumpCount: 0,
        selfJumpCount: 0
      },
      jumpsByTarget: new Map()
    });
    return label;
  };

  const visit = (ids: readonly StoryBlockId[], ownerLabel: string): void => {
    let openFork: {
      id: StoryBlockId;
      kind: SceneFlowForkKind;
      order: number;
      arms: number;
    } | null = null;
    for (const block of childBlocks(ids)) {
      if (visited.has(block.id)) {
        continue;
      }
      visited.add(block.id);

      if (block.kind === "control" && block.payload.control === "conditionBranch") {
        const branch = describeArm(block, scene, document, variableNames);
        if (branch) {
          // An `elseIf`/`else` with no `if` above it is corrupt rather than a continuation
          // of whatever ran before it, so it opens a fork of its own instead of joining a
          // stranger's and claiming to be the alternative to it.
          if (!openFork || block.payload.branch === "if") {
            openFork = { id: block.id, kind: "condition", order: nextForkOrder++, arms: 0 };
          }
          const label = record(block, branch, openFork, openFork.arms, ownerLabel);
          openFork.arms += 1;
          visit(block.childrenIds, label);
          continue;
        }
      }
      // Any sibling that is not a condition arm ends the run.
      openFork = null;

      if (block.kind === "nodeAction" && block.payload.action === "choice") {
        const options = childBlocks(block.childrenIds).filter(
          (child) => child.kind === "nodeAction" && child.payload.action === "choiceOption"
        );
        if (options.length > 0) {
          const fork = { id: block.id, kind: "choice" as const, order: nextForkOrder++ };
          let order = 0;
          for (const option of options) {
            const branch = visited.has(option.id)
              ? null
              : describeArm(option, scene, document, variableNames);
            if (!branch) {
              continue;
            }
            visited.add(option.id);
            const label = record(option, branch, fork, order, ownerLabel);
            order += 1;
            visit(option.childrenIds, label);
          }
        }
      }
      visit(block.childrenIds, ownerLabel);
    }
  };

  visit(scene.rootBlockIds, "");
  return drafts;
}

/**
 * Layer each scene by its shortest jump distance from a root, one connected component at a time.
 *
 * Breadth-first rather than longest-path: stories loop back (hub scenes, retry branches) and a
 * longest-path layering does not terminate on a cycle.
 */
function assignLayers(
  sceneIds: StorySceneId[],
  edges: SceneFlowEdgeModel[],
  entrySceneId: StorySceneId | undefined
): Map<StorySceneId, number> {
  const outgoing = new Map<StorySceneId, StorySceneId[]>();
  const inDegree = new Map<StorySceneId, number>(sceneIds.map((id) => [id, 0]));
  for (const edge of edges) {
    const list = outgoing.get(edge.source);
    if (list) {
      list.push(edge.target);
    } else {
      outgoing.set(edge.source, [edge.target]);
    }
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Entry scene first, then anything nothing jumps into, then whatever a cycle left stranded.
  const roots: StorySceneId[] = [];
  if (entrySceneId && inDegree.has(entrySceneId)) {
    roots.push(entrySceneId);
  }
  roots.push(...sceneIds.filter((id) => id !== entrySceneId && (inDegree.get(id) ?? 0) === 0));
  roots.push(...sceneIds.filter((id) => id !== entrySceneId && (inDegree.get(id) ?? 0) > 0));

  const layers = new Map<StorySceneId, number>();
  for (const root of roots) {
    if (layers.has(root)) {
      continue;
    }
    layers.set(root, 0);
    const queue: StorySceneId[] = [root];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      const depth = layers.get(current) ?? 0;
      for (const next of outgoing.get(current) ?? []) {
        if (layers.has(next)) {
          continue;
        }
        layers.set(next, depth + 1);
        queue.push(next);
      }
    }
  }
  return layers;
}

/**
 * Column-per-layer, rows centred on the column so the trunk of the story reads as a spine.
 *
 * Rows are stacked by their real heights rather than a uniform pitch: an expanded scene is taller
 * than its neighbours, and a fixed pitch would drop the next node straight through its branch rows.
 * Which scene lands in which sub-column is still decided by count alone, so a collapsed map packs
 * exactly as it did before heights existed — and with every height at `SCENE_FLOW_NODE_HEIGHT` the
 * arithmetic below reduces, term for term, to the pitch formula it replaced.
 */
function layoutPositions(
  sceneIds: StorySceneId[],
  layers: Map<StorySceneId, number>,
  heightBySceneId: Map<StorySceneId, number>
): Record<StorySceneId, { x: number; y: number }> {
  const columns = new Map<number, StorySceneId[]>();
  for (const sceneId of sceneIds) {
    const layer = layers.get(sceneId) ?? 0;
    const column = columns.get(layer);
    if (column) {
      column.push(sceneId);
    } else {
      columns.set(layer, [sceneId]);
    }
  }

  const positions: Record<StorySceneId, { x: number; y: number }> = {};
  let x = 0;
  for (const layer of Array.from(columns.keys()).sort((a, b) => a - b)) {
    const members = columns.get(layer) ?? [];
    // Wrap a tall layer into side-by-side sub-columns, and push the next layer past all of them.
    const subColumns = Math.max(1, Math.ceil(members.length / MAX_ROWS_PER_COLUMN));
    const rows = Math.ceil(members.length / subColumns);
    for (let subColumn = 0; subColumn * rows < members.length; subColumn++) {
      const stack = members.slice(subColumn * rows, subColumn * rows + rows);
      const extent = stack.reduce(
        (total, sceneId) => total + (heightBySceneId.get(sceneId) ?? SCENE_FLOW_NODE_HEIGHT),
        ROW_GAP * (stack.length - 1)
      );
      // Centre the stack on the axis the uniform layout centred on — half a collapsed node
      // below the origin — so an unexpanded column keeps the coordinates it has today.
      let y = SCENE_FLOW_NODE_HEIGHT / 2 - extent / 2;
      for (const sceneId of stack) {
        positions[sceneId] = {
          x: x + subColumn * (SCENE_FLOW_NODE_WIDTH + COLUMN_GAP),
          y: Math.round(y)
        };
        y += (heightBySceneId.get(sceneId) ?? SCENE_FLOW_NODE_HEIGHT) + ROW_GAP;
      }
    }
    x += subColumns * (SCENE_FLOW_NODE_WIDTH + COLUMN_GAP);
  }
  return positions;
}

export function buildSceneFlowGraph(
  document: StoryDocument,
  options?: SceneFlowGraphOptions
): SceneFlowGraph {
  // Authoring order: chapters first (that is the order the author sees in the outline), then any
  // scene no chapter claims. Layout ties break on this, so the map stays stable across rebuilds.
  const sceneIds = listSceneIdsInDocumentOrder(document);
  const entrySceneId =
    document.entrySceneId && document.scenes[document.entrySceneId]
      ? document.entrySceneId
      : undefined;

  const edgeByKey = new Map<string, SceneFlowEdgeModel>();
  const danglingBySceneId = new Map<StorySceneId, number>();
  const selfJumpsBySceneId = new Map<StorySceneId, number>();
  const branches: SceneFlowBranchNodeModel[] = [];
  const branchEdges: SceneFlowBranchEdgeModel[] = [];
  const armCountBySceneId = new Map<StorySceneId, number>();
  const forkCountBySceneId = new Map<StorySceneId, number>();

  for (const sceneId of sceneIds) {
    const scene = document.scenes[sceneId];
    const arms = collectSceneArms(scene, document, options?.variableNames);
    const armByBlockId = new Map(arms.map((arm) => [arm.node.blockId, arm]));
    // The rows the compiler would keep. A jump missing from this set is switched off, or sits
    // under a row that is - the same reading `traceReachableScenes` takes, from the same helper,
    // so the map cannot come to a different view of which rows exist.
    const liveBlockIds = new Set(
      listSceneBlocksInDocumentOrder(scene, {
        skipSubtree: (block) => Boolean(block.disabled)
      }).map((block) => block.id)
    );

    // Depth-first, so the forks this collapses into one edge are listed in the order the author
    // wrote them — which is what `SceneFlowEdgeModel.branches` promises the reader of the map.
    for (const block of listSceneBlocksInDocumentOrder(scene)) {
      if (block.kind !== "jump") {
        continue;
      }
      // Resolved before the dangling/self exits: those jumps still belong to an arm, and an
      // option whose only jump is broken must say so on its own row, not just on the scene.
      const owner = resolveOwningArm(scene, block, document, options?.variableNames);
      // An arm the fork walk never registered — an option with no `choice` container above it,
      // which the compiler diagnoses — still labels its edge, but owns no row to attribute to.
      const arm = owner ? armByBlockId.get(owner.block.id) : undefined;
      const target = block.payload.targetSceneId;
      if (!target || !document.scenes[target]) {
        danglingBySceneId.set(sceneId, (danglingBySceneId.get(sceneId) ?? 0) + 1);
        if (arm) {
          arm.node.danglingJumpCount += 1;
        }
        continue;
      }
      if (target === sceneId) {
        selfJumpsBySceneId.set(sceneId, (selfJumpsBySceneId.get(sceneId) ?? 0) + 1);
        if (arm) {
          arm.node.selfJumpCount += 1;
        }
        continue;
      }
      const key = `${sceneId}->${target}`;
      const branch = owner?.branch ?? null;
      const jump: SceneFlowJumpRef = {
        blockId: block.id,
        conditional: branch !== null,
        disabled: !liveBlockIds.has(block.id),
        ...(branch ? { branch } : {})
      };
      const existing = edgeByKey.get(key);
      if (existing) {
        existing.jumps.push(jump);
      } else {
        edgeByKey.set(key, {
          id: `scene-flow:${key}`,
          source: sceneId,
          target,
          jumps: [jump],
          conditional: false,
          disabled: false,
          branches: []
        });
      }
      if (arm) {
        // The same `SceneFlowJumpRef` object as the scene edge carries: one jump is one fact,
        // and a consumer cross-referencing the two readings must not find two of it.
        const owned = arm.jumpsByTarget.get(target);
        if (owned) {
          owned.push(jump);
        } else {
          arm.jumpsByTarget.set(target, [jump]);
        }
      }
    }

    // Fork order, then arm order inside the fork. The collection walk emits a nested fork's arms
    // between its parent's, so this sort is what makes the promised ordering true.
    arms.sort(
      (left, right) =>
        left.node.forkOrder - right.node.forkOrder || left.node.order - right.node.order
    );
    for (const arm of arms) {
      arm.node.targets = Array.from(arm.jumpsByTarget.keys());
      arm.node.fallsThrough = arm.node.targets.length === 0 && arm.node.danglingJumpCount === 0;
      branches.push(arm.node);
      for (const [target, jumps] of arm.jumpsByTarget) {
        branchEdges.push({
          id: `${arm.node.id}->${target}`,
          sourceBranchId: arm.node.id,
          sourceSceneId: sceneId,
          target,
          jumps
        });
      }
    }
    armCountBySceneId.set(sceneId, arms.length);
    forkCountBySceneId.set(sceneId, new Set(arms.map((arm) => arm.node.forkId)).size);
  }

  const edges = Array.from(edgeByKey.values()).map((edge) => {
    const seenBranches = new Set<string>();
    const branches: SceneFlowBranchLabel[] = [];
    for (const jump of edge.jumps) {
      if (!jump.branch) {
        continue;
      }
      const key = branchKey(jump.branch);
      if (!seenBranches.has(key)) {
        seenBranches.add(key);
        branches.push(jump.branch);
      }
    }
    return {
      ...edge,
      conditional: edge.jumps.every((jump) => jump.conditional),
      disabled: edge.jumps.every((jump) => jump.disabled),
      branches
    };
  });

  const layers = assignLayers(sceneIds, edges, entrySceneId);
  // The shared walk, told to follow disabled jumps. This map draws the document rather than
  // predicting the package, so a branch the author switched off for the afternoon still leads
  // somewhere - see `includeDisabled`. The null is kept: with no entry scene declared,
  // "unreachable" is not a claim this map can make about anything.
  const reachable = entrySceneId
    ? reachableSceneIds(document, { fallback: "none", includeDisabled: true })
    : null;

  const nodes: SceneFlowNodeModel[] = sceneIds.map((sceneId) => {
    const scene = document.scenes[sceneId];
    return {
      sceneId,
      name: scene.name,
      blockCount: Object.keys(scene.blocks).length,
      isEntry: sceneId === entrySceneId,
      reachable: reachable ? reachable.has(sceneId) : true,
      danglingJumpCount: danglingBySceneId.get(sceneId) ?? 0,
      selfJumpCount: selfJumpsBySceneId.get(sceneId) ?? 0
    };
  });

  // Expanding a scene with nothing to show would grow an empty box, so the branch count gates it.
  const heightBySceneId = new Map<StorySceneId, number>();
  const nodeSizes: Record<StorySceneId, { width: number; height: number }> = {};
  for (const sceneId of sceneIds) {
    const armCount = armCountBySceneId.get(sceneId) ?? 0;
    const expanded = armCount > 0 && Boolean(options?.expandedSceneIds?.has(sceneId));
    const height = expanded
      ? SCENE_FLOW_NODE_HEIGHT +
        (forkCountBySceneId.get(sceneId) ?? 0) * SCENE_FLOW_BRANCH_HEADER_HEIGHT +
        armCount * SCENE_FLOW_BRANCH_ROW_HEIGHT
      : SCENE_FLOW_NODE_HEIGHT;
    heightBySceneId.set(sceneId, height);
    nodeSizes[sceneId] = { width: SCENE_FLOW_NODE_WIDTH, height };
  }

  return {
    nodes,
    edges,
    branches,
    branchEdges,
    positions: layoutPositions(sceneIds, layers, heightBySceneId),
    nodeSizes,
    danglingJumpCount: nodes.reduce((total, node) => total + node.danglingJumpCount, 0),
    unreachableCount: nodes.filter((node) => !node.reachable).length
  };
}
