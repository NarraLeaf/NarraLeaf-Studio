import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import {
  SCENE_FLOW_BRANCH_HEADER_HEIGHT,
  SCENE_FLOW_BRANCH_ROW_HEIGHT,
  SCENE_FLOW_NODE_HEIGHT,
  SCENE_FLOW_NODE_WIDTH,
  buildSceneFlowGraph
} from "./sceneFlowModel";

function jumpBlock(id: string, targetSceneId: string, parentId: string | null = null): StoryBlock {
  return { id, kind: "jump", parentId, childrenIds: [], payload: { targetSceneId } };
}

function controlBlock(id: string, childrenIds: string[]): StoryBlock {
  return {
    id,
    kind: "control",
    parentId: null,
    childrenIds,
    payload: { control: "conditionBranch", branch: "if" }
  };
}

function conditionBranchBlock(
  id: string,
  childrenIds: string[],
  branch: "if" | "elseIf" | "else",
  source?: string,
  parentId: string | null = null
): StoryBlock {
  return {
    id,
    kind: "control",
    parentId,
    childrenIds,
    payload: {
      control: "conditionBranch",
      branch,
      ...(source
        ? {
            condition: {
              kind: "expression" as const,
              expression: { source, expr: { kind: "literal" as const, value: true } }
            }
          }
        : {})
    }
  } as StoryBlock;
}

function sequenceBlock(
  id: string,
  childrenIds: string[],
  parentId: string | null = null
): StoryBlock {
  return { id, kind: "control", parentId, childrenIds, payload: { control: "sequence" } };
}

function repeatBlock(
  id: string,
  childrenIds: string[],
  parentId: string | null = null
): StoryBlock {
  return { id, kind: "control", parentId, childrenIds, payload: { control: "repeat", times: 2 } };
}

function choiceOptionBlock(
  id: string,
  childrenIds: string[],
  text: string,
  parentId: string | null = null
): StoryBlock {
  return {
    id,
    kind: "nodeAction",
    parentId,
    childrenIds,
    payload: {
      action: "choiceOption",
      text: { textId: `${id}-text`, value: text, role: "choiceText" }
    }
  } as StoryBlock;
}

function choiceBlock(
  id: string,
  childrenIds: string[],
  parentId: string | null = null
): StoryBlock {
  return {
    id,
    kind: "nodeAction",
    parentId,
    childrenIds,
    payload: {
      action: "choice",
      prompt: { textId: `${id}-prompt`, value: "", role: "choicePrompt" }
    }
  } as StoryBlock;
}

/** A `choice` container with `count` options, each jumping to `target(index)` when it returns one. */
function choiceScene(
  id: string,
  name: string,
  count: number,
  target: (index: number) => string | null
): StoryScene {
  const blocks: StoryBlock[] = [
    choiceBlock(
      "c1",
      Array.from({ length: count }, (_, index) => `o${index}`)
    )
  ];
  for (let index = 0; index < count; index++) {
    const targetSceneId = target(index);
    blocks.push(
      choiceOptionBlock(
        `o${index}`,
        targetSceneId === null ? [] : [`j${index}`],
        `Option ${index}`,
        "c1"
      )
    );
    if (targetSceneId !== null) {
      blocks.push(jumpBlock(`j${index}`, targetSceneId, `o${index}`));
    }
  }
  return scene(id, name, blocks);
}

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
  return {
    id,
    name,
    runtimeName: id,
    rootBlockIds: blocks.filter((block) => !block.parentId).map((block) => block.id),
    blocks: Object.fromEntries(blocks.map((block) => [block.id, block]))
  };
}

function document(scenes: StoryScene[], entrySceneId?: string): StoryDocument {
  return {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    id: "story-1",
    name: "Story",
    entrySceneId,
    chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: scenes.map((item) => item.id) }],
    scenes: Object.fromEntries(scenes.map((item) => [item.id, item]))
  } as StoryDocument;
}

describe("buildSceneFlowGraph", () => {
  it("turns jump blocks into edges between scenes", () => {
    const graph = buildSceneFlowGraph(
      document([scene("a", "Opening", [jumpBlock("j1", "b")]), scene("b", "Hallway", [])], "a")
    );

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ source: "a", target: "b", conditional: false });
    expect(graph.nodes.map((node) => node.sceneId)).toEqual(["a", "b"]);
    expect(graph.nodes[0].isEntry).toBe(true);
  });

  it("leaves an in-scene goto out of the map entirely (§12.6)", () => {
    // The map is about scene-to-scene structure. A `goto` moves the play head WITHIN a scene and
    // unloads nothing, so it is neither an edge, a self-jump, nor a dangling one - drawing it
    // would put line-level control flow on a map whose whole value is that it is not that.
    const gotoBlock = {
      id: "g1",
      kind: "control",
      parentId: null,
      childrenIds: [],
      payload: { control: "goto", targetLabel: "start" }
    } as unknown as StoryBlock;
    const labelBlock = {
      id: "l1",
      kind: "control",
      parentId: null,
      childrenIds: [],
      payload: { control: "label", name: "start" }
    } as unknown as StoryBlock;
    const graph = buildSceneFlowGraph(
      document([scene("a", "Opening", [labelBlock, gotoBlock]), scene("b", "Hallway", [])], "a")
    );

    expect(graph.edges).toHaveLength(0);
    expect(
      graph.nodes.map((node) => ({
        id: node.sceneId,
        self: node.selfJumpCount,
        dangling: node.danglingJumpCount
      }))
    ).toEqual([
      { id: "a", self: 0, dangling: 0 },
      { id: "b", self: 0, dangling: 0 }
    ]);
  });

  it("collapses repeated jumps between the same pair into one edge", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [jumpBlock("j1", "b"), jumpBlock("j2", "b")]),
          scene("b", "Hallway", [])
        ],
        "a"
      )
    );

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].jumps.map((jump) => jump.blockId)).toEqual(["j1", "j2"]);
  });

  it("finds jumps nested under control flow and marks the edge conditional", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [controlBlock("c1", ["j1"]), jumpBlock("j1", "b", "c1")]),
          scene("b", "Hallway", [])
        ],
        "a"
      )
    );

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].conditional).toBe(true);
    expect(graph.edges[0].jumps[0].conditional).toBe(true);
  });

  it("does not treat ordering containers as branches", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [sequenceBlock("s1", ["j1"]), jumpBlock("j1", "b", "s1")]),
          scene("b", "Hallway", [])
        ],
        "a"
      )
    );

    expect(graph.edges[0].conditional).toBe(false);
    expect(graph.edges[0].branches).toEqual([]);
  });

  it("labels a jump under a choice option with the option text", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [
            choiceOptionBlock("o1", ["j1"], "Open the door"),
            jumpBlock("j1", "b", "o1")
          ]),
          scene("b", "Hallway", [])
        ],
        "a"
      )
    );

    expect(graph.edges[0].conditional).toBe(true);
    expect(graph.edges[0].branches).toEqual([{ kind: "choice", label: "Open the door" }]);
  });

  it("labels a jump under a condition branch with the expression source, and else without one", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [
            conditionBranchBlock("if1", ["j1"], "if", "gold >= 100"),
            jumpBlock("j1", "b", "if1"),
            conditionBranchBlock("else1", ["j2"], "else"),
            jumpBlock("j2", "c", "else1")
          ]),
          scene("b", "Vault", []),
          scene("c", "Street", [])
        ],
        "a"
      )
    );

    const toB = graph.edges.find((edge) => edge.target === "b");
    const toC = graph.edges.find((edge) => edge.target === "c");
    expect(toB?.branches).toEqual([{ kind: "condition", label: "gold >= 100" }]);
    expect(toC?.branches).toEqual([{ kind: "conditionElse", label: "" }]);
  });

  it("distinguishes an else-if arm from an if with the same condition", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [
            conditionBranchBlock("if1", ["j1"], "if", "gold >= 100"),
            jumpBlock("j1", "b", "if1"),
            conditionBranchBlock("elif1", ["j2"], "elseIf", "gold >= 10"),
            jumpBlock("j2", "c", "elif1")
          ]),
          scene("b", "Vault", []),
          scene("c", "Stall", [])
        ],
        "a"
      )
    );

    expect(graph.edges.find((edge) => edge.target === "b")?.branches).toEqual([
      { kind: "condition", label: "gold >= 100" }
    ]);
    expect(graph.edges.find((edge) => edge.target === "c")?.branches).toEqual([
      { kind: "conditionElseIf", label: "gold >= 10" }
    ]);
  });

  it("takes the nearest fork when a branch is nested inside another", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [
            conditionBranchBlock("if1", ["o1"], "if", "gold >= 100"),
            choiceOptionBlock("o1", ["s1"], "Buy it", "if1"),
            sequenceBlock("s1", ["j1"], "o1"),
            jumpBlock("j1", "b", "s1")
          ]),
          scene("b", "Shop", [])
        ],
        "a"
      )
    );

    expect(graph.edges[0].branches).toEqual([{ kind: "choice", label: "Buy it" }]);
  });

  it("aggregates several branch paths onto one edge and drops duplicates", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [
            choiceOptionBlock("o1", ["j1"], "Left"),
            jumpBlock("j1", "b", "o1"),
            choiceOptionBlock("o2", ["j2"], "Right"),
            jumpBlock("j2", "b", "o2"),
            choiceOptionBlock("o3", ["j3"], "Left"),
            jumpBlock("j3", "b", "o3")
          ]),
          scene("b", "Hallway", [])
        ],
        "a"
      )
    );

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].jumps).toHaveLength(3);
    expect(graph.edges[0].branches).toEqual([
      { kind: "choice", label: "Left" },
      { kind: "choice", label: "Right" }
    ]);
  });

  it("keeps an edge unconditional when any one of its jumps is unbranched", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [
            choiceOptionBlock("o1", ["j1"], "Left"),
            jumpBlock("j1", "b", "o1"),
            jumpBlock("j2", "b")
          ]),
          scene("b", "Hallway", [])
        ],
        "a"
      )
    );

    expect(graph.edges[0].conditional).toBe(false);
    expect(graph.edges[0].branches).toEqual([{ kind: "choice", label: "Left" }]);
  });

  it("counts jumps with a missing or deleted target as dangling instead of dropping them", () => {
    const graph = buildSceneFlowGraph(
      document([scene("a", "Opening", [jumpBlock("j1", ""), jumpBlock("j2", "ghost")])], "a")
    );

    expect(graph.edges).toHaveLength(0);
    expect(graph.danglingJumpCount).toBe(2);
    expect(graph.nodes[0].danglingJumpCount).toBe(2);
  });

  it("reports self-jumps as a node badge rather than an edge", () => {
    const graph = buildSceneFlowGraph(document([scene("a", "Loop", [jumpBlock("j1", "a")])], "a"));

    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes[0].selfJumpCount).toBe(1);
  });

  it("flags scenes the entry cannot reach", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [jumpBlock("j1", "b")]),
          scene("b", "Hallway", []),
          scene("c", "Orphan", [])
        ],
        "a"
      )
    );

    expect(graph.unreachableCount).toBe(1);
    expect(graph.nodes.find((node) => node.sceneId === "c")?.reachable).toBe(false);
  });

  it("makes no reachability claim when the story declares no entry scene", () => {
    const graph = buildSceneFlowGraph(
      document([scene("a", "Opening", []), scene("b", "Other", [])])
    );

    expect(graph.unreachableCount).toBe(0);
    expect(graph.nodes.every((node) => node.reachable)).toBe(true);
  });

  it("lays scenes out in jump-distance columns", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "One", [jumpBlock("j1", "b")]),
          scene("b", "Two", [jumpBlock("j2", "c")]),
          scene("c", "Three", [])
        ],
        "a"
      )
    );

    expect(graph.positions.a.x).toBe(0);
    expect(graph.positions.b.x).toBeGreaterThan(graph.positions.a.x);
    expect(graph.positions.c.x).toBeGreaterThan(graph.positions.b.x);
  });

  it("wraps a tall layer into sub-columns instead of one endless column", () => {
    const scenes = Array.from({ length: 9 }, (_, index) =>
      scene(`s${index}`, `Scene ${index}`, [])
    );
    const graph = buildSceneFlowGraph(document(scenes));

    const xs = new Set(scenes.map((item) => graph.positions[item.id].x));
    expect(xs.size).toBe(2);
    // Nothing stacked deeper than the per-column cap.
    const perColumn = new Map<number, number>();
    for (const item of scenes) {
      const column = graph.positions[item.id].x;
      perColumn.set(column, (perColumn.get(column) ?? 0) + 1);
    }
    expect(Math.max(...perColumn.values())).toBeLessThanOrEqual(5);
  });

  it("terminates on a jump cycle", () => {
    const graph = buildSceneFlowGraph(
      document(
        [scene("a", "One", [jumpBlock("j1", "b")]), scene("b", "Two", [jumpBlock("j2", "a")])],
        "a"
      )
    );

    expect(graph.edges).toHaveLength(2);
    expect(Object.keys(graph.positions)).toHaveLength(2);
  });
});

describe("buildSceneFlowGraph branch topology", () => {
  it("gives five options into five scenes five arms leaving five distinct points", () => {
    // The complaint this whole layer answers: on the scene map these are five lines out of one
    // handle, and nothing on the map says which option is which line.
    const graph = buildSceneFlowGraph(
      document(
        [
          choiceScene("a", "Crossroads", 5, (index) => `e${index}`),
          ...Array.from({ length: 5 }, (_, index) => scene(`e${index}`, `Ending ${index}`, []))
        ],
        "a"
      )
    );

    expect(graph.branches).toHaveLength(5);
    expect(graph.branchEdges).toHaveLength(5);
    expect(new Set(graph.branchEdges.map((edge) => edge.sourceBranchId)).size).toBe(5);
    expect(graph.branches.map((branch) => branch.label)).toEqual([
      "Option 0",
      "Option 1",
      "Option 2",
      "Option 3",
      "Option 4"
    ]);
    expect(graph.branches.map((branch) => branch.targets)).toEqual([
      ["e0"],
      ["e1"],
      ["e2"],
      ["e3"],
      ["e4"]
    ]);
    expect(
      graph.branches.every((branch) => branch.forkId === "c1" && branch.forkKind === "choice")
    ).toBe(true);
    expect(graph.branches.map((branch) => branch.order)).toEqual([0, 1, 2, 3, 4]);
    expect(graph.branchEdges[0]).toMatchObject({
      id: "scene-flow:branch:o0->e0",
      sourceBranchId: "scene-flow:branch:o0",
      sourceSceneId: "a",
      target: "e0"
    });
    expect(graph.branchEdges[0].jumps.map((jump) => jump.blockId)).toEqual(["j0"]);
  });

  it("keeps five arms into one scene distinct while the scene edge stays collapsed", () => {
    // Both readings coexist on purpose: the scene map answers "does anything reach the hallway",
    // the branch map answers "which of these five options does". Collapsing the second into the
    // first is what made the option's identity survive only as a deduped label string.
    const graph = buildSceneFlowGraph(
      document([choiceScene("a", "Crossroads", 5, () => "b"), scene("b", "Hallway", [])], "a")
    );

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].jumps).toHaveLength(5);
    expect(graph.branches).toHaveLength(5);
    expect(graph.branchEdges).toHaveLength(5);
    expect(graph.branchEdges.every((edge) => edge.target === "b")).toBe(true);
    expect(new Set(graph.branchEdges.map((edge) => edge.sourceBranchId)).size).toBe(5);
  });

  it("keeps an option that only continues, as a fall-through arm with no edge", () => {
    const graph = buildSceneFlowGraph(
      document([choiceScene("a", "Fork", 2, (index) => (index === 0 ? null : "a"))], "a")
    );

    expect(graph.branchEdges).toHaveLength(0);
    expect(graph.branches.map((branch) => branch.fallsThrough)).toEqual([true, true]);
    // A self-jump restarts the scene rather than leaving it, so the run continues here either way.
    expect(graph.branches[1].selfJumpCount).toBe(1);
    expect(graph.branches.map((branch) => branch.targets)).toEqual([[], []]);
  });

  it("groups if / else-if / else into one fork and a second if into another", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [
            conditionBranchBlock("if1", ["j1"], "if", "gold >= 100"),
            jumpBlock("j1", "b", "if1"),
            conditionBranchBlock("elif1", ["j2"], "elseIf", "gold >= 10"),
            jumpBlock("j2", "c", "elif1"),
            conditionBranchBlock("else1", [], "else"),
            conditionBranchBlock("if2", ["j3"], "if", "mood > 3"),
            jumpBlock("j3", "b", "if2"),
            conditionBranchBlock("else2", [], "else")
          ]),
          scene("b", "Vault", []),
          scene("c", "Stall", [])
        ],
        "a"
      )
    );

    expect(graph.branches.map((branch) => branch.forkId)).toEqual([
      "if1",
      "if1",
      "if1",
      "if2",
      "if2"
    ]);
    expect(graph.branches.map((branch) => branch.forkOrder)).toEqual([0, 0, 0, 1, 1]);
    expect(graph.branches.map((branch) => branch.order)).toEqual([0, 1, 2, 0, 1]);
    expect(graph.branches.map((branch) => branch.kind)).toEqual([
      "condition",
      "conditionElseIf",
      "conditionElse",
      "condition",
      "conditionElse"
    ]);
    expect(graph.branches.map((branch) => branch.label)).toEqual([
      "gold >= 100",
      "gold >= 10",
      "",
      "mood > 3",
      ""
    ]);
    expect(graph.branches.every((branch) => branch.forkKind === "condition")).toBe(true);
  });

  it("stands an else-if with no if above it up as its own fork", () => {
    // Corrupt rather than a continuation of whatever ran before it: joining a stranger's group
    // would have the map claim this arm is the alternative to a condition it never answered.
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [
            sequenceBlock("s1", []),
            conditionBranchBlock("elif1", [], "elseIf", "gold >= 10")
          ])
        ],
        "a"
      )
    );

    expect(
      graph.branches.map((branch) => ({ forkId: branch.forkId, order: branch.order }))
    ).toEqual([{ forkId: "elif1", order: 0 }]);
  });

  it("gives a jump under a fork nested in an option to the inner arm, prefixed with the outer one", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [
            choiceBlock("c1", ["o1"]),
            choiceOptionBlock("o1", ["if1"], "跟她走", "c1"),
            conditionBranchBlock("if1", ["j1"], "if", "gold >= 5", "o1"),
            jumpBlock("j1", "b", "if1")
          ]),
          scene("b", "River", [])
        ],
        "a"
      )
    );

    expect(graph.branches.map((branch) => branch.label)).toEqual(["跟她走", "跟她走 › gold >= 5"]);
    // Forks nest; branch nodes do not - both arms are rows of scene `a`, ordered outer fork first.
    expect(graph.branches.map((branch) => branch.forkOrder)).toEqual([0, 1]);
    expect(graph.branches.map((branch) => branch.targets)).toEqual([[], ["b"]]);
    // The option owns no jump of its own, so it does not get credit for the inner arm's exit.
    expect(graph.branches[0].fallsThrough).toBe(true);
    expect(graph.branchEdges).toHaveLength(1);
    expect(graph.branchEdges[0].sourceBranchId).toBe("scene-flow:branch:if1");
  });

  it("does not turn ordering containers into arms", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Opening", [
            sequenceBlock("s1", ["j1"]),
            jumpBlock("j1", "b", "s1"),
            repeatBlock("r1", ["j2"]),
            jumpBlock("j2", "b", "r1")
          ]),
          scene("b", "Hallway", [])
        ],
        "a"
      )
    );

    expect(graph.branches).toHaveLength(0);
    expect(graph.branchEdges).toHaveLength(0);
    expect(graph.edges).toHaveLength(1);
  });

  it("puts a deleted jump target on the arm that wrote it instead of dropping the arm", () => {
    const graph = buildSceneFlowGraph(document([choiceScene("a", "Fork", 1, () => "ghost")], "a"));

    expect(graph.branches).toHaveLength(1);
    expect(graph.branches[0].danglingJumpCount).toBe(1);
    expect(graph.branches[0].targets).toEqual([]);
    // Not a fall-through: the author did write an exit here, and it is broken rather than absent.
    expect(graph.branches[0].fallsThrough).toBe(false);
    expect(graph.branchEdges).toHaveLength(0);
  });

  /**
   * The story is only readable if the map says which counter the fork asks about.
   *
   * A `saved` variable is declared in the project registry, not in the story - after the declaration
   * migration that is the ONLY place it is declared - so an arm testing one has no row to read its
   * name off. Without `variableNames` `describeVariableRef` falls back to the word it prints for a
   * declaration that was DELETED, and a perfectly valid fork reads to the author like a broken one.
   */
  it("labels a condition arm on a registry-only saved variable with the variable's name", () => {
    const story = document(
      [
        scene("a", "Opening", [
          {
            id: "if1",
            kind: "control",
            parentId: null,
            childrenIds: ["j1"],
            payload: {
              control: "conditionBranch",
              branch: "if",
              condition: {
                kind: "variable",
                target: { scope: "saved", variableId: "sv-1" },
                operator: "isTrue"
              }
            }
          } as StoryBlock,
          jumpBlock("j1", "b", "if1")
        ]),
        scene("b", "River", [])
      ],
      "a"
    );

    expect(
      buildSceneFlowGraph(story, { variableNames: new Map([["saved:sv-1", "好感"]]) }).branches.map(
        (branch) => branch.label
      )
    ).toEqual(["好感 isTrue"]);
    // The regression this guards: the same fork with no registry in hand.
    expect(buildSceneFlowGraph(story).branches.map((branch) => branch.label)).toEqual([
      "variable isTrue"
    ]);
  });

  it("terminates on a corrupted childrenIds cycle", () => {
    const graph = buildSceneFlowGraph(
      document(
        [
          scene("a", "Loop", [
            conditionBranchBlock("if1", ["if2"], "if", "gold >= 1"),
            conditionBranchBlock("if2", ["if1"], "if", "gold >= 2", "if1")
          ])
        ],
        "a"
      )
    );

    expect(graph.branches.map((branch) => branch.blockId)).toEqual(["if1", "if2"]);
    expect(graph.branches.map((branch) => branch.label)).toEqual([
      "gold >= 1",
      "gold >= 1 › gold >= 2"
    ]);
  });
});

describe("buildSceneFlowGraph layout", () => {
  /** Entry scene plus a layer of eight, which is one more than a single column takes. */
  function wrappedColumnDocument(): StoryDocument {
    return document(
      [
        scene(
          "hub",
          "Hub",
          Array.from({ length: 8 }, (_, index) => jumpBlock(`j${index}`, `s${index}`))
        ),
        ...Array.from({ length: 8 }, (_, index) => scene(`s${index}`, `Scene ${index}`, []))
      ],
      "hub"
    );
  }

  it("lays a collapsed map out exactly where it laid it before branch rows existed", () => {
    // The default view must not move under the author because a new field landed. These are the
    // literal coordinates the uniform-pitch layout produced; the height-aware one must reduce to
    // them term for term when every node is one collapsed box tall.
    const expected = {
      hub: { x: 0, y: 0 },
      s0: { x: 312, y: -150 },
      s1: { x: 312, y: -50 },
      s2: { x: 312, y: 50 },
      s3: { x: 312, y: 150 },
      s4: { x: 624, y: -150 },
      s5: { x: 624, y: -50 },
      s6: { x: 624, y: 50 },
      s7: { x: 624, y: 150 }
    };
    const graph = buildSceneFlowGraph(wrappedColumnDocument());

    expect(graph.positions).toEqual(expected);
    // The option argument is optional and an empty set is not "expand nothing in particular".
    expect(buildSceneFlowGraph(wrappedColumnDocument(), {}).positions).toEqual(expected);
    expect(
      buildSceneFlowGraph(wrappedColumnDocument(), { expandedSceneIds: new Set() }).positions
    ).toEqual(expected);
    expect(
      Object.values(graph.nodeSizes).every(
        (size) => size.width === SCENE_FLOW_NODE_WIDTH && size.height === SCENE_FLOW_NODE_HEIGHT
      )
    ).toBe(true);
  });

  it("reports a size for every scene, expanded or not", () => {
    const graph = buildSceneFlowGraph(wrappedColumnDocument());

    expect(Object.keys(graph.nodeSizes).sort()).toEqual([
      "hub",
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
      "s7"
    ]);
  });

  it("packs a column by real heights so an expanded scene does not sit under its neighbour", () => {
    const story = document(
      [
        scene("hub", "Hub", [jumpBlock("j1", "b"), jumpBlock("j2", "c")]),
        choiceScene("b", "Fork", 3, () => null),
        scene("c", "Plain", [])
      ],
      "hub"
    );
    const graph = buildSceneFlowGraph(story, { expandedSceneIds: new Set(["b"]) });

    expect(graph.nodeSizes.b.height).toBe(
      SCENE_FLOW_NODE_HEIGHT + SCENE_FLOW_BRANCH_HEADER_HEIGHT + 3 * SCENE_FLOW_BRANCH_ROW_HEIGHT
    );
    expect(graph.nodeSizes.c.height).toBe(SCENE_FLOW_NODE_HEIGHT);
    expect(graph.positions.c.y).toBeGreaterThanOrEqual(
      graph.positions.b.y + graph.nodeSizes.b.height
    );
    // Same column, so the extra height must not have pushed `c` sideways either.
    expect(graph.positions.c.x).toBe(graph.positions.b.x);
    // Collapsed again, the tall scene is a plain box: expansion is a view state, not a document one.
    expect(buildSceneFlowGraph(story).nodeSizes.b.height).toBe(SCENE_FLOW_NODE_HEIGHT);
  });

  it("does not grow a scene that has nothing to expand", () => {
    const graph = buildSceneFlowGraph(document([scene("a", "Plain", [])], "a"), {
      expandedSceneIds: new Set(["a"])
    });

    expect(graph.nodeSizes.a.height).toBe(SCENE_FLOW_NODE_HEIGHT);
  });
});

/**
 * A jump the author switched off.
 *
 * The map draws what the author wrote, so the edge stays - faded, and marked so the canvas can fade
 * it. Reachability follows it for the same reason: an author who disabled one jump for the afternoon
 * has not orphaned the half of the story behind it, and a map that said so would be reporting on a
 * package rather than on a document. The build side reads the opposite answer out of the same walk,
 * through `includeDisabled`.
 */
describe("buildSceneFlowGraph and disabled jumps", () => {
  it("keeps a disabled jump as an edge and marks it", () => {
    const story = document(
      [
        scene("a", "A", [{ ...jumpBlock("j1", "b"), disabled: true } as StoryBlock]),
        scene("b", "B", [])
      ],
      "a"
    );

    const graph = buildSceneFlowGraph(story);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].disabled).toBe(true);
    expect(graph.edges[0].jumps[0].disabled).toBe(true);
  });

  it("does not call the scene behind a disabled jump unreachable", () => {
    const story = document(
      [
        scene("a", "A", [{ ...jumpBlock("j1", "b"), disabled: true } as StoryBlock]),
        scene("b", "B", [])
      ],
      "a"
    );

    const graph = buildSceneFlowGraph(story);

    expect(graph.nodes.find((node) => node.sceneId === "b")?.reachable).toBe(true);
  });

  it("marks a jump under a disabled container", () => {
    const story = document(
      [
        scene("a", "A", [
          { ...controlBlock("c1", ["j1"]), disabled: true } as StoryBlock,
          jumpBlock("j1", "b", "c1")
        ]),
        scene("b", "B", [])
      ],
      "a"
    );

    const graph = buildSceneFlowGraph(story);

    expect(graph.edges[0].disabled).toBe(true);
  });

  it("does not fade an edge one live jump still reaches", () => {
    const story = document(
      [
        scene("a", "A", [
          { ...jumpBlock("j1", "b"), disabled: true } as StoryBlock,
          jumpBlock("j2", "b")
        ]),
        scene("b", "B", [])
      ],
      "a"
    );

    const graph = buildSceneFlowGraph(story);

    expect(graph.edges[0].disabled).toBe(false);
    expect(graph.edges[0].jumps.map((jump) => jump.disabled)).toEqual([true, false]);
  });

  it("still says nothing about reachability when no entry scene is marked", () => {
    const story = document([scene("a", "A", [jumpBlock("j1", "b")]), scene("b", "B", [])]);

    const graph = buildSceneFlowGraph(story);

    expect(graph.nodes.every((node) => node.reachable)).toBe(true);
  });
});
