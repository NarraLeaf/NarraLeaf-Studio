import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import { buildSceneFlowGraph } from "./sceneFlowModel";
import { MAX_ROUTES, buildSceneFlowRouteMap } from "./sceneFlowRoutes";

function jumpBlock(id: string, targetSceneId: string, parentId: string | null = null): StoryBlock {
  return { id, kind: "jump", parentId, childrenIds: [], payload: { targetSceneId } };
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

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
  return {
    id,
    name,
    runtimeName: id,
    rootBlockIds: blocks.filter((block) => !block.parentId).map((block) => block.id),
    blocks: Object.fromEntries(blocks.map((block) => [block.id, block]))
  };
}

/**
 * A `choice` container with `count` options, each jumping to `target(index)` when it returns one.
 *
 * Block ids are prefixed with the scene id because a branch node's id is derived from its block's,
 * and block ids are unique per document in a real story. A fixture reusing `o0` in two scenes would
 * hand both scenes the same branch id and merge their arms - a fixture artefact that would read as
 * a routing defect.
 */
function choiceScene(
  id: string,
  name: string,
  count: number,
  target: (index: number) => string | null
): StoryScene {
  const blocks: StoryBlock[] = [
    choiceBlock(
      `${id}-c`,
      Array.from({ length: count }, (_, index) => `${id}-o${index}`)
    )
  ];
  for (let index = 0; index < count; index++) {
    const targetSceneId = target(index);
    blocks.push(
      choiceOptionBlock(
        `${id}-o${index}`,
        targetSceneId === null ? [] : [`${id}-j${index}`],
        `Option ${index}`,
        `${id}-c`
      )
    );
    if (targetSceneId !== null) {
      blocks.push(jumpBlock(`${id}-j${index}`, targetSceneId, `${id}-o${index}`));
    }
  }
  return scene(id, name, blocks);
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

function routeMap(story: StoryDocument) {
  return buildSceneFlowRouteMap(buildSceneFlowGraph(story), story);
}

describe("buildSceneFlowRouteMap endings", () => {
  it("calls the last scene of a linear story the ending and nothing before it", () => {
    const map = routeMap(
      document(
        [
          scene("a", "One", [jumpBlock("j1", "b")]),
          scene("b", "Two", [jumpBlock("j2", "c")]),
          scene("c", "Three", [])
        ],
        "a"
      )
    );

    expect(map.endings).toEqual([{ sceneId: "c", name: "Three", reachable: true }]);
    expect(map.routes).toHaveLength(1);
    expect(map.routes[0].sceneIds).toEqual(["a", "b", "c"]);
    expect(map.routes[0].endingSceneId).toBe("c");
    expect(map.routes[0].branchIds).toEqual([]);
    expect(map.routes[0].truncatedByCycle).toBe(false);
    // An unguarded exit belongs to no arm, so the step names the scene edge and no branch.
    expect(map.routes[0].steps).toEqual([
      { sceneId: "a", branchId: null, edgeId: "scene-flow:a->b" },
      { sceneId: "b", branchId: null, edgeId: "scene-flow:b->c" }
    ]);
  });

  it("still calls a scene whose only jumps are self or dangling an ending", () => {
    // "No outgoing edge" is the whole test, and neither of these produces one: the run cannot
    // leave this scene, so this is where the story stops however the author got the jump wrong.
    const map = routeMap(
      document(
        [
          scene("a", "One", [jumpBlock("j1", "b")]),
          scene("b", "Loop", [jumpBlock("j2", "b"), jumpBlock("j3", "ghost")])
        ],
        "a"
      )
    );

    expect(map.endings.map((ending) => ending.sceneId)).toEqual(["b"]);
    expect(map.routes.map((route) => route.endingSceneId)).toEqual(["b"]);
  });

  it("lists a terminal scene the entry cannot reach, flagged rather than dropped", () => {
    // An unreachable terminal is a defect worth surfacing, not an ending anyone can get. Leaving
    // it out of the list would hide it; leaving it in unflagged would inflate the ending count.
    const map = routeMap(
      document(
        [
          scene("a", "One", [jumpBlock("j1", "b")]),
          scene("b", "Two", []),
          scene("z", "Cut content", [])
        ],
        "a"
      )
    );

    expect(map.endings).toEqual([
      { sceneId: "b", name: "Two", reachable: true },
      { sceneId: "z", name: "Cut content", reachable: false }
    ]);
    expect(map.unreachableEndings).toEqual(["z"]);
  });

  it("lists the endings but claims no route when the story declares no entry scene", () => {
    // There is no "from" to enumerate from. The endings are a fact about the graph either way,
    // but calling all of them unreached would be a diagnostic about the missing entry scene.
    const map = routeMap(
      document([
        scene("a", "One", [jumpBlock("j1", "b")]),
        scene("b", "Two", []),
        choiceScene("c", "Fork", 2, () => "b")
      ])
    );

    expect(map.endings.map((ending) => ending.sceneId)).toEqual(["b"]);
    expect(map.endings[0].reachable).toBe(true);
    expect(map.routes).toEqual([]);
    expect(map.truncated).toBe(false);
    expect(map.unreachableEndings).toEqual([]);
    expect(map.deadBranchIds).toEqual([]);
  });
});

describe("buildSceneFlowRouteMap routes", () => {
  it("gives two options two routes, each carrying its own arm", () => {
    const map = routeMap(
      document(
        [
          choiceScene("a", "Fork", 2, (index) => `e${index}`),
          scene("e0", "Ending A", []),
          scene("e1", "Ending B", [])
        ],
        "a"
      )
    );

    expect(map.endings.map((ending) => ending.sceneId)).toEqual(["e0", "e1"]);
    expect(map.routes.map((route) => route.endingSceneId)).toEqual(["e0", "e1"]);
    expect(map.routes.map((route) => route.branchIds)).toEqual([
      ["scene-flow:branch:a-o0"],
      ["scene-flow:branch:a-o1"]
    ]);
    expect(map.routes.map((route) => route.sceneIds)).toEqual([
      ["a", "e0"],
      ["a", "e1"]
    ]);
    expect(map.deadBranchIds).toEqual([]);
  });

  it("gives five options into five endings five routes (the complaint this answers)", () => {
    // On the scene map this is one card with five unattributed lines out of it. The route map is
    // the reading that says which option is which ending, so five is the number that must come
    // out of it - four would mean an option silently lost its path.
    const map = routeMap(
      document(
        [
          choiceScene("a", "Crossroads", 5, (index) => `e${index}`),
          ...Array.from({ length: 5 }, (_, index) => scene(`e${index}`, `Ending ${index}`, []))
        ],
        "a"
      )
    );

    expect(map.endings).toHaveLength(5);
    expect(map.routes).toHaveLength(5);
    expect(map.truncated).toBe(false);
    expect(map.routes.map((route) => route.branchIds.length)).toEqual([1, 1, 1, 1, 1]);
    expect(map.routes.map((route) => route.endingSceneId)).toEqual(["e0", "e1", "e2", "e3", "e4"]);
    expect(new Set(map.routes.map((route) => route.id)).size).toBe(5);
    expect(map.unreachableEndings).toEqual([]);
    expect(map.deadBranchIds).toEqual([]);
  });

  it("carries a fall-through option into the scene's own later jump", () => {
    // "This option does nothing special and the scene continues" is a real path, and dropping it
    // is what makes an option look dead when it is the most ordinary thing an author writes.
    const map = routeMap(
      document(
        [
          scene("a", "Fork", [
            choiceBlock("c1", ["o0", "o1"]),
            choiceOptionBlock("o0", ["j0"], "Leave", "c1"),
            jumpBlock("j0", "b", "o0"),
            choiceOptionBlock("o1", [], "Stay", "c1"),
            jumpBlock("j9", "c")
          ]),
          scene("b", "Ending A", []),
          scene("c", "Ending B", [])
        ],
        "a"
      )
    );

    const fallThrough = map.routes.find((route) =>
      route.branchIds.includes("scene-flow:branch:o1")
    );
    expect(fallThrough?.sceneIds).toEqual(["a", "c"]);
    // It leaves by the scene's own edge, because that is the jump control reaches next.
    expect(fallThrough?.steps).toEqual([
      { sceneId: "a", branchId: "scene-flow:branch:o1", edgeId: "scene-flow:a->c" }
    ]);
    // Two, not three: `j9` is written after the menu, and the menu is exhaustive, so nothing
    // reaches `j9` without having picked an option first. Offering it as a continuation of its
    // own would invent a route on which the player made no choice at all.
    expect(map.routes).toHaveLength(2);
    expect(map.routes.map((route) => route.endingSceneId)).toEqual(["b", "c"]);
    expect(map.routes.every((route) => route.branchIds.length === 1)).toBe(true);
    expect(map.deadBranchIds).toEqual([]);
  });

  it("still offers an unguarded exit written before the menu as a path of its own", () => {
    // The order is the whole difference: this jump leaves the scene before the menu is ever
    // shown, so a route that takes it and answers nothing is exactly what the author wrote.
    const map = routeMap(
      document(
        [
          scene("a", "Fork", [
            jumpBlock("j9", "c"),
            choiceBlock("c1", ["o0", "o1"]),
            choiceOptionBlock("o0", ["j0"], "Leave", "c1"),
            jumpBlock("j0", "b", "o0"),
            choiceOptionBlock("o1", [], "Stay", "c1")
          ]),
          scene("b", "Ending A", []),
          scene("c", "Ending B", [])
        ],
        "a"
      )
    );

    const standalone = map.routes.find((route) => route.branchIds.length === 0);
    expect(standalone?.sceneIds).toEqual(["a", "c"]);
    expect(standalone?.steps).toEqual([
      { sceneId: "a", branchId: null, edgeId: "scene-flow:a->c" }
    ]);
    expect(map.routes).toHaveLength(3);
  });

  it("does not let a condition group gate the exit written after it", () => {
    // An `if` with no `else` is skipped whole when the condition is false and the scene walks
    // straight into `j9`. Only a menu is exhaustive; treating a condition as one would silently
    // delete the most ordinary path in a branching script.
    const map = routeMap(
      document(
        [
          scene("a", "Gate", [
            conditionBranchBlock("if1", ["j1"], "if", "gold >= 5"),
            jumpBlock("j1", "b", "if1"),
            jumpBlock("j9", "c")
          ]),
          scene("b", "Ending A", []),
          scene("c", "Ending B", [])
        ],
        "a"
      )
    );

    expect(map.routes.map((route) => route.endingSceneId)).toEqual(["b", "c"]);
    expect(map.routes.find((route) => route.endingSceneId === "c")?.branchIds).toEqual([]);
  });

  it("does not let a menu nested inside a condition arm gate the rest of the scene", () => {
    // The scene continues past the `if` whether or not the arm ever ran, so the menu inside it
    // guarantees nothing about `j9`.
    const map = routeMap(
      document(
        [
          scene("a", "Gate", [
            conditionBranchBlock("if1", ["c1"], "if", "gold >= 5"),
            choiceBlock("c1", ["o0"], "if1"),
            choiceOptionBlock("o0", ["j0"], "Buy it", "c1"),
            jumpBlock("j0", "b", "o0"),
            jumpBlock("j9", "c")
          ]),
          scene("b", "Ending A", []),
          scene("c", "Ending B", [])
        ],
        "a"
      )
    );

    expect(
      map.routes.some((route) => route.branchIds.length === 0 && route.endingSceneId === "c")
    ).toBe(true);
  });

  it("gives the five-option crossroads exactly the routes a player can walk", () => {
    // The acceptance shape: four options that jump, one that only continues into the scene's
    // trailing jump, and a branch inside the scene one of them leads to. Six routes - one per
    // way through - and not a seventh on which nobody chose anything.
    const map = routeMap(
      document(
        [
          scene("crossroads", "Crossroads", [
            choiceBlock("c1", ["o0", "o1", "o2", "o3", "o4"]),
            choiceOptionBlock("o0", ["j0"], "Walk to the river with her", "c1"),
            jumpBlock("j0", "river", "o0"),
            choiceOptionBlock("o1", ["j1"], "Go straight home", "c1"),
            jumpBlock("j1", "alone", "o1"),
            choiceOptionBlock("o2", ["j2"], "Stop by the library", "c1"),
            jumpBlock("j2", "summer-ends", "o2"),
            choiceOptionBlock("o3", ["j3"], "Follow the stranger", "c1"),
            jumpBlock("j3", "stranger", "o3"),
            choiceOptionBlock("o4", [], "Just stand there", "c1"),
            jumpBlock("j9", "nothing")
          ]),
          scene("river", "River", [
            conditionBranchBlock("if1", ["jr1"], "if", "Affection >= 3"),
            jumpBlock("jr1", "two-of-us", "if1"),
            conditionBranchBlock("else1", ["jr2"], "else"),
            jumpBlock("jr2", "summer-ends", "else1")
          ]),
          scene("two-of-us", "Two of Us", []),
          scene("alone", "Alone", []),
          scene("summer-ends", "Summer Ends", []),
          scene("stranger", "The Stranger", []),
          scene("nothing", "Nothing Happened", [])
        ],
        "crossroads"
      )
    );

    expect(map.routes).toHaveLength(6);
    expect(map.routes.map((route) => route.endingSceneId)).toEqual([
      "two-of-us",
      "summer-ends",
      "alone",
      "summer-ends",
      "stranger",
      "nothing"
    ]);
    // Every route is a decision path: none of them reaches an ending having chosen nothing.
    expect(map.routes.every((route) => route.branchIds.length > 0)).toBe(true);
    // "Just stand there" reaches the trailing jump by falling through, which is the whole point
    // of gating it rather than deleting it.
    expect(map.routes[5].branchIds).toEqual(["scene-flow:branch:o4"]);
    expect(map.endings.map((ending) => ending.sceneId)).toEqual([
      "two-of-us",
      "alone",
      "summer-ends",
      "stranger",
      "nothing"
    ]);
    expect(map.deadBranchIds).toEqual([]);
    expect(map.unreachableEndings).toEqual([]);
  });

  it("ends the route at the scene itself when a fall-through option has nowhere to continue", () => {
    // The scene has an exit, so it is not a terminal scene - but this arm does not take it, the
    // scene runs out, and the story stops here. The arm must still count as walked, or the rail
    // reports a live option as dead.
    const map = routeMap(
      document(
        [
          choiceScene("a", "Fork", 2, (index) => (index === 0 ? "b" : null)),
          scene("b", "Ending", [])
        ],
        "a"
      )
    );

    expect(map.endings.map((ending) => ending.sceneId)).toEqual(["b"]);
    const stopped = map.routes.find((route) => route.endingSceneId === "a");
    expect(stopped?.steps).toEqual([]);
    expect(stopped?.branchIds).toEqual(["scene-flow:branch:a-o1"]);
    expect(stopped?.truncatedByCycle).toBe(false);
    expect(map.deadBranchIds).toEqual([]);
  });

  it("keeps the shared middle of a diamond on every route through it", () => {
    const map = routeMap(
      document(
        [
          choiceScene("a", "Fork", 2, (index) => (index === 0 ? "b" : "c")),
          scene("b", "Left", [jumpBlock("jb", "d")]),
          scene("c", "Right", [jumpBlock("jc", "d")]),
          choiceScene("d", "Second fork", 2, (index) => (index === 0 ? "e" : "f")),
          scene("e", "Ending A", []),
          scene("f", "Ending B", [])
        ],
        "a"
      )
    );

    expect(map.routes).toHaveLength(4);
    expect(map.routes.every((route) => route.sceneIds.includes("d"))).toBe(true);
    expect(map.routes.map((route) => route.sceneIds)).toEqual([
      ["a", "b", "d", "e"],
      ["a", "b", "d", "f"],
      ["a", "c", "d", "e"],
      ["a", "c", "d", "f"]
    ]);
    // Two forks deep, so every route names both decisions it made.
    expect(map.routes.every((route) => route.branchIds.length === 2)).toBe(true);
    expect(map.endings.map((ending) => ending.sceneId)).toEqual(["e", "f"]);
    expect(map.deadBranchIds).toEqual([]);
  });

  it("cuts a cycle instead of walking it, and says the path was cut", () => {
    const map = routeMap(
      document(
        [scene("a", "One", [jumpBlock("j1", "b")]), scene("b", "Two", [jumpBlock("j2", "a")])],
        "a"
      )
    );

    expect(map.routes).toHaveLength(1);
    expect(map.routes[0].truncatedByCycle).toBe(true);
    // The closing hop is not a step: `sceneIds` promises no repeats, and the flag is what says
    // the path did not stop here because the story ended.
    expect(map.routes[0].sceneIds).toEqual(["a", "b"]);
    expect(map.routes[0].endingSceneId).toBe("b");
    expect(map.endings).toEqual([]);
  });

  it("still enumerates the paths a loop hangs off", () => {
    const map = routeMap(
      document(
        [
          scene("a", "Hub", [jumpBlock("j1", "b")]),
          scene("b", "Loop", [jumpBlock("j2", "a"), jumpBlock("j3", "c")]),
          scene("c", "Ending", [])
        ],
        "a"
      )
    );

    expect(
      map.routes.map((route) => ({ end: route.endingSceneId, cut: route.truncatedByCycle }))
    ).toEqual([
      { end: "b", cut: true },
      { end: "c", cut: false }
    ]);
    expect(map.unreachableEndings).toEqual([]);
  });

  it("reports arms no route walks as dead options", () => {
    const map = routeMap(
      document(
        [
          scene("a", "One", [jumpBlock("j1", "b")]),
          scene("b", "Ending", []),
          choiceScene("o", "Orphaned fork", 2, (index) => (index === 0 ? "p" : "q")),
          scene("p", "Cut ending", []),
          scene("q", "Cut ending too", [])
        ],
        "a"
      )
    );

    expect(map.routes).toHaveLength(1);
    expect(map.deadBranchIds).toEqual(["scene-flow:branch:o-o0", "scene-flow:branch:o-o1"]);
    expect(map.unreachableEndings).toEqual(["p", "q"]);
    expect(
      map.endings.filter((ending) => !ending.reachable).map((ending) => ending.sceneId)
    ).toEqual(["p", "q"]);
  });

  it("stops at the cap and says it stopped, instead of presenting the cap as the total", () => {
    // Eight two-way forks in a row is 256 paths - a shape a real script reaches without anyone
    // noticing. A rail showing 200 of them with no marker reads as "these are all the routes".
    const forks = 8;
    const map = routeMap(
      document(
        [
          ...Array.from({ length: forks }, (_, index) =>
            choiceScene(`s${index}`, `Fork ${index}`, 2, () => `s${index + 1}`)
          ),
          scene(`s${forks}`, "Ending", [])
        ],
        "s0"
      )
    );

    expect(map.routes).toHaveLength(MAX_ROUTES);
    expect(map.truncated).toBe(true);
    expect(new Set(map.routes.map((route) => route.id)).size).toBe(MAX_ROUTES);
  });

  it("does not claim truncation when the story has exactly as many routes as the cap", () => {
    // The flag is set where work is skipped, not by comparing counts, so the boundary case does
    // not tell the author routes are missing when none are.
    const map = routeMap(
      document(
        [
          choiceScene("a", "Fork", MAX_ROUTES, (index) => `e${index}`),
          ...Array.from({ length: MAX_ROUTES }, (_, index) =>
            scene(`e${index}`, `Ending ${index}`, [])
          )
        ],
        "a"
      )
    );

    expect(map.routes).toHaveLength(MAX_ROUTES);
    expect(map.truncated).toBe(false);
  });

  it("gives equal documents equal route ids, so a selection survives an unrelated edit", () => {
    const build = () =>
      document(
        [
          choiceScene("a", "Fork", 3, (index) => (index === 1 ? null : `e${index}`)),
          scene("e0", "Ending A", [jumpBlock("j1", "e2")]),
          scene("e2", "Ending B", [])
        ],
        "a"
      );

    const first = routeMap(build());
    const second = routeMap(build());

    expect(first.routes.map((route) => route.id)).toEqual(second.routes.map((route) => route.id));
    expect(new Set(first.routes.map((route) => route.id)).size).toBe(first.routes.length);
  });
});
