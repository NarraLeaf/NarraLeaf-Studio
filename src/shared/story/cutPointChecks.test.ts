import { describe, expect, it } from "vitest";
import {
  STORY_DOCUMENT_SCHEMA_VERSION,
  type StoryBlock,
  type StoryDocument,
  type StoryScene
} from "@shared/types/story";
import { collectCutPoints } from "./appTagFold";
import { collectInertCutPoints, collectUncutForks } from "./cutPointChecks";

/**
 * What a variant's cut points come to.
 *
 * The case that matters most is the pair at the top: a cut point at the very end of a scene produces
 * a package identical to the one without it, and an author who wrote it believes their demo stops
 * there. Every other assertion here exists to keep that one from firing on rows that are doing their
 * job - a cut on one branch of a fork removes that branch, whatever happens to the scenes after it.
 */

const DEMO = "tag-demo";

let nextId = 0;

function block(partial: Partial<StoryBlock> & Pick<StoryBlock, "kind" | "payload">): StoryBlock {
  nextId += 1;
  return {
    id: partial.id ?? `b${nextId}`,
    parentId: partial.parentId ?? null,
    childrenIds: partial.childrenIds ?? [],
    ...partial
  } as StoryBlock;
}

function line(id: string, parentId: string | null = null): StoryBlock {
  return block({
    id,
    kind: "nodeAction",
    parentId,
    payload: { action: "narration", text: { textId: `text-${id}`, value: id, role: "narration" } }
  });
}

function cut(
  id: string,
  appTagId = DEMO,
  extra?: { disabled?: boolean; parentId?: string }
): StoryBlock {
  return block({ id, kind: "control", payload: { control: "cut", appTagId }, ...extra });
}

function jump(id: string, targetSceneId: string): StoryBlock {
  return block({ id, kind: "jump", payload: { targetSceneId } });
}

function scene(id: string, blocks: StoryBlock[], rootBlockIds: string[]): StoryScene {
  return {
    id,
    name: id,
    runtimeName: id,
    rootBlockIds,
    blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry]))
  };
}

function story(scenes: StoryScene[], entrySceneId?: string): StoryDocument {
  return {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    id: "story-1",
    name: "Story",
    chapters: [{ id: "chapter-1", name: "Chapter 1", sceneIds: scenes.map((entry) => entry.id) }],
    scenes: Object.fromEntries(scenes.map((entry) => [entry.id, entry])),
    ...(entrySceneId ? { entrySceneId } : {})
  };
}

describe("collectCutPoints", () => {
  it("says a row with content after it removes something", () => {
    const built = story([scene("s1", [line("a"), cut("c"), line("b")], ["a", "c", "b"])]);

    expect(collectCutPoints(built)).toEqual([
      expect.objectContaining({
        sceneId: "s1",
        blockId: "c",
        appTagId: DEMO,
        removes: true
      })
    ]);
  });

  it("says a row at the very end of its scene removes nothing", () => {
    const built = story([scene("s1", [line("a"), cut("c")], ["a", "c"])]);

    expect(collectCutPoints(built)[0].removes).toBe(false);
  });

  it("counts only content, so a tail of other cut points is still nothing", () => {
    const built = story([
      scene("s1", [line("a"), cut("c"), cut("d", "tag-other")], ["a", "c", "d"])
    ]);

    expect(collectCutPoints(built)[0].removes).toBe(false);
  });

  it("counts only shipped content, so a disabled tail is still nothing", () => {
    const built = story([
      scene(
        "s1",
        [
          line("a"),
          cut("c"),
          block({
            id: "b",
            kind: "nodeAction",
            disabled: true,
            payload: { action: "narration", text: { textId: "t", value: "b", role: "narration" } }
          })
        ],
        ["a", "c", "b"]
      )
    ]);

    expect(collectCutPoints(built)[0].removes).toBe(false);
  });

  it("leaves a nested row out entirely, since no build honours one", () => {
    const built = story([
      scene(
        "s1",
        [
          block({
            id: "group",
            kind: "control",
            childrenIds: ["c"],
            payload: { control: "sequence" }
          }),
          cut("c", DEMO, { parentId: "group" })
        ],
        ["group"]
      )
    ]);

    expect(collectCutPoints(built)).toEqual([]);
  });

  it("leaves a disabled row out, since it decides nothing", () => {
    const built = story([
      scene("s1", [line("a"), cut("c", DEMO, { disabled: true }), line("b")], ["a", "c", "b"])
    ]);

    expect(collectCutPoints(built)).toEqual([]);
  });
});

describe("collectInertCutPoints", () => {
  it("names only the rows of the variant asked about", () => {
    const built = story([
      scene("s1", [line("a"), cut("c1")], ["a", "c1"]),
      scene("s2", [line("b"), cut("c2", "tag-other")], ["b", "c2"])
    ]);

    expect(collectInertCutPoints(built, DEMO).map((entry) => entry.blockId)).toEqual(["c1"]);
  });

  it("says nothing about a cut that ends a branch the story converges out of", () => {
    // The cut removes this branch's jump. The scene it led to is still reached the other way, so
    // no scene is dropped - and the row is still doing its job, which is why it is not reported.
    const built = story([
      scene("s1", [jump("j1", "s2"), jump("j2", "s3")], ["j1", "j2"]),
      scene("s2", [cut("c"), jump("j3", "s4")], ["c", "j3"]),
      scene("s3", [jump("j4", "s4")], ["j4"]),
      scene("s4", [line("end")], ["end"])
    ]);

    expect(collectInertCutPoints(built, DEMO)).toEqual([]);
  });
});

describe("collectUncutForks", () => {
  it("reports a fork where one route ends and the other carries on", () => {
    const built = story(
      [
        scene("s1", [jump("j1", "s2"), jump("j2", "s3")], ["j1", "j2"]),
        scene("s2", [line("a"), cut("c"), line("b")], ["a", "c", "b"]),
        scene("s3", [line("d")], ["d"])
      ],
      "s1"
    );

    expect(collectUncutForks(built, DEMO)).toEqual([
      expect.objectContaining({
        sceneId: "s1",
        uncutBranches: 1
      })
    ]);
  });

  it("says nothing when every route ends", () => {
    const built = story(
      [
        scene("s1", [jump("j1", "s2"), jump("j2", "s3")], ["j1", "j2"]),
        scene("s2", [line("a"), cut("c1"), line("b")], ["a", "c1", "b"]),
        scene("s3", [line("d"), cut("c2"), line("e")], ["d", "c2", "e"])
      ],
      "s1"
    );

    expect(collectUncutForks(built, DEMO)).toEqual([]);
  });

  it("says nothing when the variant cuts nowhere in this story", () => {
    const built = story(
      [
        scene("s1", [jump("j1", "s2"), jump("j2", "s3")], ["j1", "j2"]),
        scene("s2", [line("a")], ["a"]),
        scene("s3", [line("d")], ["d"])
      ],
      "s1"
    );

    expect(collectUncutForks(built, DEMO)).toEqual([]);
  });

  it("says nothing about a linear story, which has no fork to disagree about", () => {
    const built = story(
      [
        scene("s1", [jump("j1", "s2")], ["j1"]),
        scene("s2", [line("a"), cut("c"), line("b")], ["a", "c", "b"])
      ],
      "s1"
    );

    expect(collectUncutForks(built, DEMO)).toEqual([]);
  });

  it("does not let the story's own entry scene make every route look cut", () => {
    // The entry scene holds the cut. Reachability seeds it unconditionally, so a check that
    // asked the traversal for a branch's reach without taking it off would find the cut on both
    // branches and never report anything.
    const built = story(
      [
        scene("s1", [cut("c"), jump("j1", "s2"), jump("j2", "s3")], ["c", "j1", "j2"]),
        scene("s2", [line("a"), cut("c2"), line("b")], ["a", "c2", "b"]),
        scene("s3", [line("d")], ["d"])
      ],
      "s1"
    );

    expect(collectUncutForks(built, DEMO)).toEqual([
      expect.objectContaining({
        sceneId: "s1",
        uncutBranches: 1
      })
    ]);
  });
});
