# Branch topology, variable divergence and the route map

Card `2026-07-31-001`. Branch `feat/story-branch-topology`, worktree `D:/Temp/nls-branchmap`.

## The complaint

> 分支图只到"场景"粒度。但一个场景里 5 个选项通向 5 个结局，在图上就是一张卡。
> 选项级分支拓扑、好感度分歧线、路线图都不存在。

All three are true today, and they are true of *both* surfaces at once, because the Dev Mode
"Scenes" tab is not a second graph — `StoryRuntimeDebugPanel`'s `SceneTab` imports
`buildSceneFlowGraph` and `SceneFlowCanvas` straight from the workspace module. Whatever the model
learns, both surfaces learn.

What exists (`sceneFlowModel.ts`): nodes are 1:1 with scenes; edges are keyed by **scene pair**, so
five options into five scenes are five lines all leaving one handle, and five options into one scene
are a single line labelled `第一个选项 +4`. The option's identity survives only as a deduped label
string. There is no route, ending, or variable concept anywhere near the map.

## What ships

Three layers, each a pure module plus its rendering, all additive — with everything collapsed and no
variable focused, the map is byte-for-byte what it draws today. That is deliberate: the scene map is
the right default for orientation, and 200 option nodes on first paint would be a downgrade.

### M1 — Option-level branch topology

A **fork** is a `choice` container or an `if/elseIf/else` group inside a scene. A **branch** is one
arm of a fork (one `choiceOption`, one `conditionBranch`). Branches become real nodes with their own
source handle, so "五个选项通向五个结局" draws as five lines leaving five distinct points.

Expansion is per scene and opt-in. A scene with forks grows a chevron and a fork count; expanded, the
scene node becomes a React Flow parent whose children are its branch nodes, and the scene's outgoing
edges re-anchor from the scene handle to the branch that owns them.

Model additions (all new fields — `nodes`/`edges`/`positions` keep their present meaning and every
one of the 19 existing tests in `sceneFlowModel.test.ts` stays green unchanged):

```ts
export type SceneFlowForkKind = "choice" | "condition";

export type SceneFlowBranchNodeModel = {
    /** `scene-flow:branch:<blockId>` — the arm's own block (choiceOption / conditionBranch). */
    id: string;
    sceneId: StorySceneId;
    blockId: StoryBlockId;
    /** The container block: the `choice` action, or the first arm of the if-group. */
    forkId: string;
    forkKind: SceneFlowForkKind;
    /** Same vocabulary the edge labels already use. */
    kind: SceneFlowBranchKind;
    /** Option text / condition summary; empty for `conditionElse` and unnamed options. */
    label: string;
    /** Sibling order inside the fork, and fork order inside the scene — layout ties break on these. */
    order: number;
    forkOrder: number;
    /** Distinct scenes this arm jumps to, in document order. */
    targets: StorySceneId[];
    /** No jump under this arm: control falls back into the scene and continues past the fork. */
    fallsThrough: boolean;
    danglingJumpCount: number;
    selfJumpCount: number;
};

export type SceneFlowBranchEdgeModel = {
    /** `scene-flow:branch:<blockId>-><targetSceneId>` */
    id: string;
    sourceBranchId: string;
    sourceSceneId: StorySceneId;
    target: StorySceneId;
    jumps: SceneFlowJumpRef[];
};
```

`SceneFlowGraph` gains `branches`, `branchEdges`, and `nodeSizes: Record<StorySceneId, {width, height}>`.

Rules, and the reasons they are these rules:

- **Only the nearest fork owns a jump**, matching the existing `resolveJumpBranch`. A jump under an
  `if` nested inside an option belongs to the `if` arm, and that arm is a branch node of the scene
  too — forks nest, branch nodes do not. A nested fork's branch nodes are listed after their parent
  fork's, flagged with the ancestor arm's label as a prefix (`「跟她走」 › 好感 ≥ 5`) rather than
  drawn as a second level of boxes. Two levels of nesting is where a readable map stops, and the
  prefix keeps the provenance without the geometry.
- **A branch with no jump is not dropped** — `fallsThrough: true`. "This option does nothing special
  and rejoins the scene" is exactly the thing an author needs to see, and today the map shows nothing
  at all for it.
- `sequence` / `parallel` / `race` / `repeat` remain non-forks (existing invariant, tested).
- `control: "goto"` (in-scene label jump) remains invisible (existing invariant, tested).

**Layout.** `buildSceneFlowGraph(document, options?)` takes `{ expandedSceneIds?: ReadonlySet<StorySceneId> }`.
An expanded scene's height becomes `SCENE_FLOW_NODE_HEIGHT + rows * SCENE_FLOW_BRANCH_ROW_HEIGHT`;
`layoutPositions` stops assuming a uniform box and packs each column by actual height. Default (no
expansion) reproduces the current positions exactly — assert this in a test.

**Persistence.** Expanded scene ids go on the editor-tab payload next to `positions`/`viewport`, never
into the story document (`sceneFlowTabId.ts` already documents why). Dev Mode keeps them in React
state; its embed is ephemeral by construction.

### M2 — Variable divergence (好感度分歧线)

New pure module `sceneFlowVariables.ts`. Answers: *which arm moves 好感 and by how much, and what
range can the counter be in by the time the player reaches this scene.*

```ts
export type SceneFlowDelta =
    | { op: "add"; amount: number }        // /inc, /dec, or a longhand `x = x + 2`
    | { op: "set"; value: number }         // /set with a numeric literal
    | { op: "unknown" };                   // any other expression, or a read of another variable

export type SceneFlowVariableEffect = {
    variableKey: string;                   // storyVariableRefKey
    delta: SceneFlowDelta;
    /** The write sits under a *deeper* fork than the arm this effect is attributed to. */
    certain: boolean;
};
```

- Extraction reuses the same **structural** recognition `describeAssignment` already does — a binary
  `+`/`-` whose left operand reads the assignment target is an increment. Structural, not a stored
  flag, so `/set 好感 好感 + 2` typed longhand counts as `+2` exactly like `/inc 好感 2` does. Anything
  else is `unknown` and says so; the map never guesses a number it cannot derive.
- Effects are collected per **branch** (the arm's whole subtree) and per **scene** (writes outside any
  fork), so a scene node can show its own net movement.
- **Cumulative range.** For a focused numeric variable, forward-propagate `[min, max]` from the entry
  scene over the scene graph in layer order, seeded with the declaration's default. A cycle that
  contains a non-zero `add` makes the range unbounded; a single `unknown` anywhere upstream poisons
  every scene downstream. Both render as `?`, never as a number. Honesty over completeness — a
  route planner that quietly rounds an unknown to zero is worse than one that admits it.

**Focus mode** (Scene Flow header picker, numeric declarations only, `saved`/`persistent` first):

- Branch edges get a delta chip (`+2`, `−1`, `=5`, `?`).
- Scene nodes get a range chip (`好感 0–7`).
- Everything that does not touch the variable drops to 30% opacity, so the divergence line is
  literally the line that is still bright.

### M3 — Route map (路线图)

New pure module `sceneFlowRoutes.ts`.

- **An ending is derived, not authored**: a reachable scene with no outgoing edge (no jumps, or only
  dangling/self ones). No schema change, so no v13 migration, and no second place for an author to
  forget to tick a box. Authored ending *markers* — several endings behind one scene, gated on
  variables — are deliberately deferred; see "Not in this card".
- **A route is a decision path**: the ordered sequence of branch arms taken from the entry scene to an
  ending. DFS over the branch graph, each scene visited at most once per path (cycle cut).
- **The cap is stated, never silent.** `MAX_ROUTES = 200`; past it the rail says
  "200+ routes (truncated)" and the diagnostics stay computed over what was enumerated, labelled as
  such. A map that silently shows 200 of 4000 routes reads as "these are all the routes".

Route rail — a slim, collapsible list down the right of the Scene Flow tab, grouped by ending:

- Selecting an **ending** highlights the union of every route reaching it and dims the rest.
- Selecting a **route** highlights that one path and lists its decisions
  (`序章 → 「跟她走」 → 河边 → 「好感 ≥ 5」 → 真结局`) — the walkthrough, readable.
- With a variable focused, each route carries its final value for it, so "which choices give me the
  好感 route" is answered by sorting the list.
- Diagnostics: endings no route reaches, and branch arms that lie on no route at all (dead options).

### M4 — Dev Mode

The panel inherits M1–M3 for free. On top:

- Expansion and the variable picker work in the embed (ephemeral state).
- The variable picker reads the **live** runtime value where the bridge has one, so the chip shows
  where the current run actually sits inside the static range.
- The path taken so far in this run is drawn as a trail: visited scenes and the branch edges the run
  took render highlighted, ahead-of-playhead stays normal. This is the thing the workspace tab
  structurally cannot show.

## Not in this card, and why

- **Authored ending markers.** Multiple endings behind one scene, distinguished by variable state, is
  a real shape and it needs a schema field. `StoryDocument` is at v12 and a bump is a migration; that
  is worth doing on evidence of the derived version being insufficient, not ahead of it. Derived
  endings cover the common layout (one scene per ending) with zero schema cost.
- **Editing from the map.** Unchanged: the map reports the story, it does not edit it. A line drawn
  between two boxes hides which block owns the jump and what guards it.
- **Cross-story routes.** Jumps never cross documents; one document is one graph.

## Work items

| WI | Owns | Depends on |
|----|------|------------|
| WI-1 | `sceneFlowModel.ts` + test: branch nodes/edges, `nodeSizes`, height-aware layout | — |
| WI-2 | `sceneFlowVariables.ts` + test | WI-1 types |
| WI-3 | `sceneFlowRoutes.ts` + test | WI-1 types |
| WI-4 | `SceneFlowCanvas.tsx`, `SceneFlowNode.tsx`, new `SceneFlowBranchNode.tsx` | WI-1/2/3 |
| WI-5 | `SceneFlowTab.tsx`, new `SceneFlowRouteRail.tsx`, `sceneFlowTabId.ts`, i18n | WI-1/2/3 |
| WI-6 | `StoryRuntimeDebugPanel.tsx`, devMode i18n | WI-4/5 |

## Acceptance

Driven in the real app on an isolated instance out of this worktree, not by unit tests alone:
a story whose scene contains a five-option choice must draw five distinct lines from five distinct
points; focusing a numeric variable must dim the untouched paths and label the touched ones; the
route rail must list the endings and highlight one route's decisions.
