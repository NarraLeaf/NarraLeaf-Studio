import { describe, expect, it } from "vitest";
import {
  STORY_DOCUMENT_SCHEMA_VERSION,
  type StoryDocument,
  type StoryScene
} from "@shared/types/story";
import { buildVisibleRows } from "@/apps/workspace/modules/story/scene-editor/storySceneBlockUtils";
import type { LintStoryEntry } from "./context";
import type { LintFinding } from "./types";
import { annotateStoryLocation, createStoryRowLocator } from "./storyLocator";

/**
 * Row numbers, and the one property that matters about them: they are the *editor's* numbers.
 *
 * The last case here runs the scene through `buildVisibleRows` - the function the scene editor's
 * gutter is drawn from - and asserts the two agree row for row. Everything else in the report can be
 * argued about; a line number that points at the wrong line cannot be argued about, it is just
 * wrong, and nothing short of comparing the two producers catches it drifting.
 */

type BlockSpec = {
  id: string;
  kind: string;
  payload: unknown;
  disabled?: boolean;
  children?: BlockSpec[];
};

function scene(id: string, name: string, specs: BlockSpec[]): StoryScene {
  const blocks: Record<string, unknown> = {};
  const walk = (spec: BlockSpec, parentId: string | null): string => {
    const childrenIds = (spec.children ?? []).map((child) => walk(child, spec.id));
    blocks[spec.id] = {
      id: spec.id,
      kind: spec.kind,
      parentId,
      childrenIds,
      payload: spec.payload,
      ...(spec.disabled ? { disabled: true } : {})
    };
    return spec.id;
  };
  const rootBlockIds = specs.map((spec) => walk(spec, null));
  return { id, name, runtimeName: name, rootBlockIds, blocks } as unknown as StoryScene;
}

function story(id: string, name: string, scenes: StoryScene[]): LintStoryEntry {
  const document = {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    id,
    name,
    chapters: [],
    scenes: Object.fromEntries(scenes.map((entry) => [entry.id, entry]))
  } as StoryDocument;
  return { id, name, document };
}

const narration = (id: string, value: string): BlockSpec => ({
  id,
  kind: "nodeAction",
  payload: { action: "narration", text: { textId: `t-${id}`, role: "narration", value } }
});
const jump = (id: string): BlockSpec => ({
  id,
  kind: "jump",
  payload: { targetSceneId: "nowhere" }
});
const group = (id: string, children: BlockSpec[]): BlockSpec => ({
  id,
  kind: "control",
  payload: { control: "sequence", mode: "do" },
  children
});

/** n1, a group holding two rows, then a jump: rows 1..5 of one scene. */
const nested = scene("sc1", "Opening", [
  narration("n1", "It rained all week."),
  group("g", [narration("c1", "  Inside,   nobody spoke.  "), narration("c2", "")]),
  jump("j")
]);

const finding = (blockId?: string, sceneId: string | undefined = "sc1"): LintFinding => ({
  ruleId: "story/dead-end",
  messageKey: "lint.rule.storyDeadEnd.message",
  location: {
    kind: "story",
    storyId: "st1",
    storyName: "Chapter One",
    sceneId,
    sceneName: "Opening",
    blockId
  }
});

describe("createStoryRowLocator", () => {
  const locate = createStoryRowLocator([story("st1", "Chapter One", [nested])]);

  it("numbers rows down the document, descending into containers", () => {
    expect(["n1", "g", "c1", "c2", "j"].map((id) => locate("st1", "sc1", id)?.line)).toEqual([
      1, 2, 3, 4, 5
    ]);
  });

  it("takes the row's own words, with whitespace flattened", () => {
    expect(locate("st1", "sc1", "c1")?.excerpt).toBe("Inside, nobody spoke.");
  });

  it("has no excerpt for a row that carries no text, or whose text is blank", () => {
    expect(locate("st1", "sc1", "j")?.excerpt).toBeUndefined();
    expect(locate("st1", "sc1", "c2")?.excerpt).toBeUndefined();
  });

  it("clips a long line rather than carrying a paragraph into the report", () => {
    const long = "x".repeat(200);
    const one = createStoryRowLocator([
      story("st1", "C", [scene("sc1", "S", [narration("n1", long)])])
    ]);
    const excerpt = one("st1", "sc1", "n1")?.excerpt ?? "";
    expect(excerpt.length).toBe(64);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("answers null for a story, scene or row it does not have", () => {
    expect(locate("other", "sc1", "n1")).toBeNull();
    expect(locate("st1", "other", "n1")).toBeNull();
    expect(locate("st1", "sc1", "other")).toBeNull();
  });

  it("keeps two stories apart even when their ids and scene ids overlap around the separator", () => {
    // The per-scene cache is keyed on the two ids joined. Any separator an id could itself contain
    // - ":", "/", "-" - lets ("a:b", "c") and ("a", "b:c") produce the same key, and the second
    // lookup would then be answered with the first scene's rows: a report pointing at a row in a
    // scene the rule never looked at. Hence U+0000, which no id can hold.
    const both = createStoryRowLocator([
      story("a", "First", [scene("b:c", "S", [narration("only-in-first", "first")])]),
      story("a:b", "Second", [scene("c", "S", [narration("only-in-second", "second")])])
    ]);
    expect(both("a", "b:c", "only-in-first")?.line).toBe(1);
    expect(both("a", "b:c", "only-in-second")).toBeNull();
    expect(both("a:b", "c", "only-in-second")?.line).toBe(1);
    expect(both("a:b", "c", "only-in-first")).toBeNull();
  });
});

describe("annotateStoryLocation", () => {
  const locate = createStoryRowLocator([story("st1", "Chapter One", [nested])]);

  it("fills the row number and excerpt in, keeping everything else", () => {
    const annotated = annotateStoryLocation(finding("c1"), locate);
    expect(annotated.location).toMatchObject({
      kind: "story",
      storyName: "Chapter One",
      sceneName: "Opening",
      blockId: "c1",
      line: 3,
      excerpt: "Inside, nobody spoke."
    });
  });

  it("leaves a scene-wide finding alone - it names no row, so it gets no number", () => {
    expect(annotateStoryLocation(finding(undefined), locate).location).not.toHaveProperty("line");
  });

  it("leaves a finding whose row it cannot resolve alone, rather than guessing a number", () => {
    expect(annotateStoryLocation(finding("gone"), locate).location).not.toHaveProperty("line");
  });

  it("passes non-story locations straight through, unchanged", () => {
    const asset: LintFinding = {
      ruleId: "assets/unused",
      messageKey: "lint.rule.assetsUnused.message",
      location: { kind: "asset", assetId: "a1", assetName: "bg.png" }
    };
    expect(annotateStoryLocation(asset, locate)).toBe(asset);
  });
});

describe("the number the editor prints", () => {
  it("matches the scene editor's gutter, row for row", () => {
    const locate = createStoryRowLocator([story("st1", "Chapter One", [nested])]);
    for (const row of buildVisibleRows(nested, new Set())) {
      expect(locate("st1", "sc1", row.block.id)?.line).toBe(row.lineNumber);
    }
  });

  it("still matches when the reader has a container folded", () => {
    // Folding hides rows without renumbering them, so the two producers stay in step - which is
    // the whole reason the gutter counts the scene rather than the screen.
    const locate = createStoryRowLocator([story("st1", "Chapter One", [nested])]);
    const rows = buildVisibleRows(nested, new Set(["g"]));
    expect(rows.map((row) => row.lineNumber)).toEqual([1, 2, 5]);
    for (const row of rows) {
      expect(locate("st1", "sc1", row.block.id)?.line).toBe(row.lineNumber);
    }
  });
});
