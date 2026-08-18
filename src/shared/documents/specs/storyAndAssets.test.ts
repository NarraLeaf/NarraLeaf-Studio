import { describe, expect, it } from "vitest";
import {
  ASSETS_METADATA_DOCUMENT_PATH,
  AssetsMetadataShard,
  assetsMetadataSpec,
  STORY_DOCUMENT_PATH,
  storyDocumentSpec
} from "@shared/documents/specs";
import { countDocumentChanges } from "@shared/documents/diff";
import { resolveDocumentSpecForPath } from "@shared/documents/registry";
import { DocumentCorruptError, DocumentParseContext } from "@shared/documents/types";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story/document";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story/document";

/**
 * `parse` without `loadDocument`, so a rejection can be inspected rather than quarantined. The
 * context is the same one `documentDiff.ts` builds when it parses a revision's blob.
 */
function contextFor(
  path: string,
  kind: "story" | "assets-metadata",
  text: string
): DocumentParseContext {
  return {
    path,
    corrupt(reason: string): never {
      throw new DocumentCorruptError({ kind, path, reason, text });
    }
  };
}

function parseStory(path: string, value: unknown): StoryDocument {
  return storyDocumentSpec.parse(value, contextFor(path, "story", JSON.stringify(value)));
}

function parseShard(path: string, value: unknown): AssetsMetadataShard {
  return assetsMetadataSpec.parse(
    value,
    contextFor(path, "assets-metadata", JSON.stringify(value))
  );
}

const STORY_PATH = "editor/story/stories/story-1/storydoc.json";
const IMAGE_SHARD = "assets/assets.metadata.image.json";

function block(id: string, text: string, overrides: Partial<StoryBlock> = {}): StoryBlock {
  return {
    id,
    kind: "nodeAction",
    parentId: null,
    childrenIds: [],
    payload: { action: "narration", text: { textId: `t-${id}`, value: text } },
    ...overrides
  } as StoryBlock;
}

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
  return {
    id,
    name,
    runtimeName: name,
    rootBlockIds: blocks.map((one) => one.id),
    blocks: Object.fromEntries(blocks.map((one) => [one.id, one]))
  };
}

function story(...scenes: StoryScene[]): StoryDocument {
  return {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    id: "story-1",
    name: "A Story",
    chapters: [{ id: "ch1", name: "Chapter One", sceneIds: scenes.map((one) => one.id) }],
    scenes: Object.fromEntries(scenes.map((one) => [one.id, one]))
  };
}

function diffStory(base: StoryDocument, head: StoryDocument, limit = 200) {
  return storyDocumentSpec.diff!(base, head, { limit });
}

function shard(assets: Record<string, Record<string, unknown>>): AssetsMetadataShard {
  return { type: "image", assets };
}

function diffAssets(base: AssetsMetadataShard, head: AssetsMetadataShard, limit = 200) {
  return assetsMetadataSpec.diff!(base, head, { limit });
}

describe("story spec: reading", () => {
  it("claims the story document's path and takes the id from it", () => {
    expect(resolveDocumentSpecForPath(STORY_PATH)).toEqual({
      spec: storyDocumentSpec,
      parameters: { storyId: "story-1" }
    });
    expect(storyDocumentSpec.pathFor({ storyId: "abc" })).toBe(
      "editor/story/stories/abc/storydoc.json"
    );
    expect(STORY_DOCUMENT_PATH).toBe("editor/story/stories/<storyId>/storydoc.json");
    // The path wins over the document's own `id`, the same rule every spec that captures one
    // follows: the file is found by path, so a document that disagreed would be written back to
    // wherever its contents claimed.
    expect(parseStory(STORY_PATH, { ...story(), id: "somewhere-else" }).id).toBe("story-1");
  });

  it("refuses a document a newer Studio wrote", () => {
    expect(() =>
      parseStory(STORY_PATH, { ...story(), schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION + 1 })
    ).toThrow(/newer version of Studio/);
  });

  it("refuses a scenes map or a chapters list of the wrong shape", () => {
    expect(() => parseStory(STORY_PATH, { ...story(), scenes: [] })).toThrow(/"scenes"/);
    expect(() => parseStory(STORY_PATH, { ...story(), chapters: {} })).toThrow(
      /"chapters" must be an array/
    );
  });

  /**
   * The deliberate limit of this spec, pinned so it cannot be quietly removed. `parse` does not run
   * the story migration - it lives in the renderer's `storyModel.ts` - so writing a document back
   * would save an unmigrated one under the current schema version. The refusal is what makes
   * adopting this format for writing a deliberate act rather than an accident.
   */
  it("refuses to serialize, naming why", () => {
    expect(() => storyDocumentSpec.serialize(story())).toThrow(/read-only/);
    expect(() => storyDocumentSpec.serialize(story())).toThrow(/StoryService/);
  });

  it("counts scenes, chapters and rows", () => {
    const summary = storyDocumentSpec.summarize(
      story(
        scene("s1", "Prologue", [block("b1", "hello"), block("b2", "there")]),
        scene("s2", "Act One", [block("b3", "again")])
      )
    );

    expect(summary.title).toBe("A Story");
    expect(summary.counts).toEqual([
      { key: "storyScenes", value: 2 },
      { key: "storyChapters", value: 1 },
      { key: "storyBlocks", value: 3 }
    ]);
  });
});

describe("story spec: diff", () => {
  it("puts different scenes on different rows and names them by the author's title", () => {
    const base = story(
      scene("s1", "Prologue", [block("b1", "hello")]),
      scene("s2", "Act One", [block("b2", "one")])
    );
    const head = story(
      scene("s1", "Prologue", [block("b1", "hello there")]),
      scene("s2", "Act One", [block("b2", "one more")])
    );

    const result = diffStory(base, head);

    expect(result.tier).toBe("semantic");
    expect(result.changes.map((change) => change.subject)).toEqual(["Prologue", "Act One"]);
    expect(result.changes[0].children).toHaveLength(1);
    expect(result.changes[0].children![0].label.key).toBe("documentDiff.story.blockChanged");
    // The row's own words, so the author can tell which line it is without opening the scene.
    expect(result.changes[0].children![0].subject).toBe("hello there");
  });

  it("reports a whole new scene as one row rather than a row per line in it", () => {
    const result = diffStory(
      story(scene("s1", "Prologue", [block("b1", "hello")])),
      story(
        scene("s1", "Prologue", [block("b1", "hello")]),
        scene("s2", "Act One", [block("b2", "one"), block("b3", "two"), block("b4", "three")])
      )
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      kind: "added",
      subject: "Act One",
      label: { key: "documentDiff.story.sceneAdded", params: { blocks: 3 } }
    });
    expect(result.changes[0].children).toBeUndefined();
  });

  /**
   * An ordered array gets ONE row for the whole array. Reported element by element, a scene whose
   * rows were resequenced reads as every row after the first change having moved - and when this
   * same list becomes a resolution it would offer to interleave two orderings into a third nobody
   * wrote.
   */
  it("reports a reordered scene as one row about the order", () => {
    const rows = [block("b1", "one"), block("b2", "two"), block("b3", "three")];
    const base = story(scene("s1", "Prologue", rows));
    const head = story({ ...scene("s1", "Prologue", rows), rootBlockIds: ["b3", "b1", "b2"] });

    const result = diffStory(base, head);

    expect(result.changes[0].children).toHaveLength(1);
    expect(result.changes[0].children![0]).toMatchObject({
      kind: "moved",
      label: { key: "documentDiff.story.blockOrder" },
      path: ["scenes", "s1", "rootBlockIds"]
    });
  });

  it("matches rows by id, so an insertion at the top is one addition and nothing else", () => {
    const existing = [block("b1", "one"), block("b2", "two")];
    const base = story(scene("s1", "Prologue", existing));
    const head = story(scene("s1", "Prologue", [block("b0", "zero"), ...existing]));

    const result = diffStory(base, head);
    const children = result.changes[0].children!;

    // One addition plus the order row - and emphatically not "every row after it changed",
    // which is what a positional walk of the same edit produces.
    expect(children.map((change) => change.label.key)).toEqual([
      "documentDiff.story.blockOrder",
      "documentDiff.story.blockAdded"
    ]);
    expect(children[1].subject).toBe("zero");
  });

  it("lists a scene's leaves in script order, not by id", () => {
    const base = story(scene("s1", "Prologue", [block("z", "first"), block("a", "second")]));
    const head = story(scene("s1", "Prologue", [block("z", "FIRST"), block("a", "SECOND")]));

    expect(diffStory(base, head).changes[0].children!.map((change) => change.subject)).toEqual([
      "FIRST",
      "SECOND"
    ]);
  });

  it("reports a renamed scene, a moved row and a disabled row with their own labels", () => {
    const base = story(scene("s1", "Prologue", [block("b1", "hello"), block("b2", "child")]));
    const head = story({
      ...scene("s1", "Opening", [
        block("b1", "hello", { childrenIds: ["b2"] }),
        block("b2", "child", { parentId: "b1", disabled: true })
      ]),
      rootBlockIds: ["b1"]
    });

    const keys = diffStory(base, head).changes[0].children!.map((change) => change.label.key);

    expect(keys).toContain("documentDiff.story.sceneRenamed");
    expect(keys).toContain("documentDiff.story.blockMoved");
    expect(keys).toContain("documentDiff.story.blockDisabled");
  });

  /**
   * A chapter's scene list changes whenever a scene is written, so comparing it raw would report
   * every new scene twice. It is compared over the scenes both sides hold, which leaves exactly
   * the acts the author performed on the CHAPTER.
   */
  it("does not repeat a new scene as a chapter change, but does report a scene moved between chapters", () => {
    const prologue = scene("s1", "Prologue", [block("b1", "hello")]);
    const act = scene("s2", "Act One", [block("b2", "one")]);
    const twoChapters = (first: string[], second: string[]): StoryDocument => ({
      ...story(prologue, act),
      chapters: [
        { id: "ch1", name: "Chapter One", sceneIds: first },
        { id: "ch2", name: "Chapter Two", sceneIds: second }
      ]
    });

    const moved = diffStory(twoChapters(["s1", "s2"], []), twoChapters(["s1"], ["s2"]));

    expect(moved.changes.map((change) => change.label.key)).toEqual([
      "documentDiff.story.chapterScenes",
      "documentDiff.story.chapterScenes"
    ]);
  });

  it("gives identical documents an empty, complete diff and never throws on a broken one", () => {
    const document = story(scene("s1", "Prologue", [block("b1", "hello")]));

    expect(diffStory(document, structuredClone(document))).toMatchObject({
      changes: [],
      total: 0,
      complete: true
    });
    expect(() =>
      diffStory({} as StoryDocument, { scenes: null } as unknown as StoryDocument)
    ).not.toThrow();
  });

  it("respects the budget and reports what it dropped", () => {
    const many = (text: string) =>
      story(
        scene(
          "s1",
          "Prologue",
          Array.from({ length: 12 }, (_, index) => block(`b${index}`, `${text} ${index}`))
        )
      );

    const result = diffStory(many("was"), many("now"), 5);

    expect(result.total).toBe(12);
    expect(result.complete).toBe(false);
    expect(countDocumentChanges([...result.changes])).toBe(12);
    expect(result.changes[0].children).toHaveLength(5);
    expect(result.changes[0].truncated).toBe(7);
  });
});

describe("assets-metadata spec: reading", () => {
  it("claims a shard's path and takes the asset type from the file name", () => {
    expect(resolveDocumentSpecForPath(IMAGE_SHARD)).toEqual({
      spec: assetsMetadataSpec,
      parameters: { type: "image" }
    });
    expect(assetsMetadataSpec.pathFor({ type: "audio" })).toBe("assets/assets.metadata.audio.json");
    expect(ASSETS_METADATA_DOCUMENT_PATH).toBe("assets/assets.metadata.<type>.json");
    expect(parseShard(IMAGE_SHARD, {}).type).toBe("image");
  });

  it("skips an entry that is not an object rather than refusing the whole shard", () => {
    // One bad row must not cost the author every asset of that type - which is also what the
    // reader that owns this file does (`AssetsMetadataManager.assignValidAssets`).
    const parsed = parseShard(IMAGE_SHARD, {
      good: { id: "good", name: "bg.png" },
      bad: 7,
      worse: null
    });

    expect(Object.keys(parsed.assets)).toEqual(["good"]);
  });

  it("refuses a root that is not an object", () => {
    expect(() => parseShard(IMAGE_SHARD, [])).toThrow(/at the document root/);
  });

  it("refuses to serialize, naming why", () => {
    expect(() => assetsMetadataSpec.serialize(shard({}))).toThrow(/read-only/);
    expect(() => assetsMetadataSpec.serialize(shard({}))).toThrow(/AssetsService/);
  });
});

describe("assets-metadata spec: diff", () => {
  /** The commonest collaboration case in the whole system, and the one it must not call a conflict. */
  it("reads two people importing different assets as two independent additions", () => {
    const base = shard({ a1: { id: "a1", name: "bg.png", hash: "h1" } });
    const head = shard({
      a1: { id: "a1", name: "bg.png", hash: "h1" },
      a2: { id: "a2", name: "hero.png", hash: "h2" },
      a3: { id: "a3", name: "sky.png", hash: "h3" }
    });

    const result = diffAssets(base, head);

    expect(result.tier).toBe("semantic");
    expect(
      result.changes.map((change) => [change.kind, change.subject, change.path.join("/")])
    ).toEqual([
      ["added", "hero.png", "assets/a2"],
      ["added", "sky.png", "assets/a3"]
    ]);
    // Independent means independent: no group, no shared parent, nothing that could resolve one
    // way for both.
    expect(result.changes.every((change) => change.children === undefined)).toBe(true);
  });

  it("tells replaced bytes apart from a rename", () => {
    const base = shard({ a1: { id: "a1", name: "bg.png", hash: "h1", tags: [] } });
    const head = shard({ a1: { id: "a1", name: "background.png", hash: "h2", tags: ["outdoor"] } });

    const [row] = diffAssets(base, head).changes;

    expect(row.subject).toBe("background.png");
    expect(row.children!.map((change) => change.label.key)).toEqual([
      "documentDiff.assets.renamed",
      "documentDiff.assets.content",
      "documentDiff.assets.field"
    ]);
    expect(row.children![0].label.params).toEqual({ from: "bg.png", to: "background.png" });
  });

  it("gives identical shards an empty diff and never throws on a broken one", () => {
    const document = shard({ a1: { id: "a1", name: "bg.png" } });

    expect(diffAssets(document, structuredClone(document))).toMatchObject({
      changes: [],
      total: 0,
      complete: true
    });
    expect(() => diffAssets({} as AssetsMetadataShard, document)).not.toThrow();
  });

  it("sorts by the author's own name before it truncates", () => {
    const head = shard(
      Object.fromEntries(
        ["yak", "ant", "cow", "bee"].map((name, index) => [
          `a${index}`,
          { id: `a${index}`, name: `${name}.png` }
        ])
      )
    );

    const result = diffAssets(shard({}), head, 2);

    expect(result.total).toBe(4);
    expect(result.complete).toBe(false);
    expect(result.changes.map((change) => change.subject)).toEqual(["ant.png", "bee.png"]);
  });
});
