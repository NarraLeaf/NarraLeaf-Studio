import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "./document";
import { duplicateSceneLabels, listSceneLabels, sceneLabelNames } from "./labels";

/**
 * The one label scan, which the command line's completion and the compiler's `goto` validation both
 * read. Its rules are what make "a name the menu offered always builds" true, so they are pinned here
 * rather than left implicit in either consumer.
 */

function scene(
  blocks: StoryBlock[],
  rootBlockIds = blocks.filter((block) => !block.parentId).map((block) => block.id)
): StoryScene {
  return {
    id: "scene-1",
    name: "Scene",
    runtimeName: "scene",
    rootBlockIds,
    blocks: Object.fromEntries(blocks.map((block) => [block.id, block]))
  };
}

function label(id: string, name: string, extra: Partial<StoryBlock> = {}): StoryBlock {
  return {
    id,
    kind: "control",
    parentId: null,
    childrenIds: [],
    payload: { control: "label", name },
    ...extra
  } as StoryBlock;
}

describe("listSceneLabels", () => {
  it("reads labels in document order, trimmed, skipping unnamed ones", () => {
    const found = listSceneLabels(
      scene([label("a", " intro "), label("b", "  "), label("c", "retry")])
    );
    expect(found).toEqual([
      { blockId: "a", name: "intro" },
      { blockId: "c", name: "retry" }
    ]);
  });

  it("reaches labels nested inside containers", () => {
    // A label inside an `if` branch is still a place the play head can be sent, so `/goto` must
    // see it - the scan walks the tree rather than the root list.
    const branch: StoryBlock = {
      id: "if",
      kind: "control",
      parentId: null,
      childrenIds: ["deep"],
      payload: { control: "sequence" }
    };
    const deep = label("deep", "inside", { parentId: "if" });
    expect(sceneLabelNames(scene([branch, deep], ["if"]))).toEqual(["inside"]);
  });

  it("drops a disabled label, and every label under a disabled ancestor", () => {
    // Unlike a declaration, a label has runtime behaviour: disabling really does remove the point,
    // so a `goto` still aimed at it is a broken jump the author needs told about.
    const off = label("off", "gone", { disabled: true });
    const container: StoryBlock = {
      id: "grp",
      kind: "control",
      parentId: null,
      childrenIds: ["under"],
      payload: { control: "sequence" },
      disabled: true
    };
    const under = label("under", "alsogone", { parentId: "grp" });
    expect(sceneLabelNames(scene([off, container, under], ["off", "grp"]))).toEqual([]);
  });

  it("reports the LATER declaration as the duplicate, since the first is the one that stands", () => {
    const duplicates = duplicateSceneLabels(
      scene([label("a", "intro"), label("b", "intro"), label("c", "other")])
    );
    expect(duplicates).toEqual([{ blockId: "b", name: "intro" }]);
    // ...and the offered name list collapses the pair to one entry.
    expect(sceneLabelNames(scene([label("a", "intro"), label("b", "intro")]))).toEqual(["intro"]);
  });

  it("treats two labels differing only in case as two labels, exactly as the engine does", () => {
    // `Scene.constructLabels` keys a plain `Map` on the declared string, so `intro` and `INTRO` are
    // two distinct, legal labels. Folding here used to fault the second as a duplicate the engine
    // would have accepted, and hide it from what `/goto` could address.
    const both = scene([label("a", "intro"), label("b", "INTRO")]);
    expect(duplicateSceneLabels(both)).toEqual([]);
    expect(sceneLabelNames(both)).toEqual(["intro", "INTRO"]);
  });

  it("survives a corrupted childrenIds cycle rather than spinning", () => {
    const loop: StoryBlock = {
      id: "grp",
      kind: "control",
      parentId: null,
      childrenIds: ["grp", "in"],
      payload: { control: "sequence" }
    };
    const inner = label("in", "inside", { parentId: "grp" });
    expect(sceneLabelNames(scene([loop, inner], ["grp"]))).toEqual(["inside"]);
  });
});
