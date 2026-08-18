import { describe, expect, it } from "vitest";
import { APP_TAG_ID_RELEASE, RELEASE_APP_TAG } from "@shared/types/appTag";
import {
  STORY_DOCUMENT_SCHEMA_VERSION,
  type StoryBlock,
  type StoryConditionRef,
  type StoryDocument,
  type StoryScene,
  type StoryTextSegment
} from "@shared/types/story";
import {
  createStoryExpressionScope,
  parseStoryExpression
} from "@shared/utils/storyExpressionParser";
import {
  applyAppTagToStoryDocument,
  collectNestedCutPoints,
  collectUnfoldableAppTagUses,
  foldStoryExpression,
  staticConditionValue
} from "./appTagFold";

/**
 * The fold, and the elimination it drives.
 *
 * The assertion that matters most, and the reason this file exists, is that an eliminated branch is
 * gone from `scene.blocks` - not merely unlinked from `childrenIds`. The story compiler runs inside
 * the shipped game, so a block left in that map ships its every line to the player whatever the
 * parent points at, and a test that only checked the links would pass on a package that still
 * carried the demo's dialogue.
 */

/** The two editions every document case below is produced as. */
const RELEASE = { tagName: RELEASE_APP_TAG.name, tagId: APP_TAG_ID_RELEASE };
const DEMO = { tagName: "Demo", tagId: "tag-demo" };

const SCOPE = createStoryExpressionScope(
  [{ name: "gold", ref: { scope: "scene", variableId: "var-gold" } }],
  { scenes: [{ id: "scene-1", name: "Intro" }] }
);

function parse(source: string) {
  return parseStoryExpression(source, SCOPE).expression;
}

function condition(source: string): StoryConditionRef {
  return { kind: "expression", expression: parse(source) };
}

function segment(value: string): StoryTextSegment {
  return { textId: `text-${value}`, value, role: "narration" };
}

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

function scene(blocks: StoryBlock[], rootBlockIds: string[]): StoryScene {
  return {
    id: "scene-1",
    name: "Intro",
    runtimeName: "intro",
    rootBlockIds,
    blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry]))
  };
}

function document(built: StoryScene): StoryDocument {
  return {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    id: "story-1",
    name: "Story",
    chapters: [],
    scenes: { [built.id]: built }
  };
}

/** `if <source> { narration }` `else { narration }`, as the flat block map a scene really holds. */
function conditionScene(
  branches: {
    branch: "if" | "elseIf" | "else";
    source?: string;
    line: string;
    disabled?: boolean;
  }[]
): StoryScene {
  const blocks: StoryBlock[] = [];
  const branchIds: string[] = [];
  branches.forEach((entry, index) => {
    const branchId = `branch-${index}`;
    const lineId = `line-${index}`;
    branchIds.push(branchId);
    blocks.push(
      block({
        id: branchId,
        kind: "control",
        parentId: "cond",
        childrenIds: [lineId],
        payload: {
          control: "conditionBranch",
          branch: entry.branch,
          ...(entry.source ? { condition: condition(entry.source) } : {})
        },
        ...(entry.disabled ? { disabled: true } : {})
      })
    );
    blocks.push(
      block({
        id: lineId,
        kind: "nodeAction",
        parentId: branchId,
        payload: { action: "narration", text: segment(entry.line) }
      })
    );
  });
  blocks.push(
    block({
      id: "cond",
      kind: "control",
      childrenIds: branchIds,
      payload: { control: "condition" }
    })
  );
  return scene(blocks, ["cond"]);
}

describe("foldStoryExpression", () => {
  it("returns an expression that never names the variant untouched", () => {
    const ast = parse("gold >= 100").ast;
    const fold = foldStoryExpression(ast, { tagName: "Demo" });
    expect(fold.ast).toBe(ast);
    expect(fold.mentioned).toBe(false);
    expect(fold.unfoldable).toBe(false);
  });

  it("reduces the constant to the variant's name", () => {
    expect(foldStoryExpression(parse("AppTag").ast, { tagName: "Demo" }).ast).toEqual({
      kind: "literal",
      value: "Demo"
    });
  });

  it('reduces it to "main" in a release build, whatever the author\'s language', () => {
    // Spelled out rather than read off the model: the word is what an author types into an
    // expression, and it has to be the same one in every Studio and in the package.
    expect(foldStoryExpression(parse("AppTag").ast, RELEASE).ast).toEqual({
      kind: "literal",
      value: "main"
    });
  });

  it("decides a comparison exactly and case-sensitively", () => {
    const ast = parse('AppTag == "Demo"').ast;
    expect(foldStoryExpression(ast, { tagName: "Demo" }).ast).toEqual({
      kind: "literal",
      value: true
    });
    expect(foldStoryExpression(ast, { tagName: "main" }).ast).toEqual({
      kind: "literal",
      value: false
    });
    expect(foldStoryExpression(ast, { tagName: "demo" }).ast).toEqual({
      kind: "literal",
      value: false
    });
  });

  it("reports a comparison the build cannot decide", () => {
    for (const source of [
      "AppTag == gold",
      "AppTag == visited(Intro)",
      'gold > 0 ? AppTag : "x"'
    ]) {
      const fold = foldStoryExpression(parse(source).ast, { tagName: "Demo" });
      expect(fold.mentioned, source).toBe(true);
      expect(fold.unfoldable, source).toBe(true);
    }
  });

  it("keeps only the arm a decided test selects, so the other's variable read never survives", () => {
    const fold = foldStoryExpression(parse('AppTag == "Demo" ? "demo" : gold').ast, {
      tagName: "Demo"
    });
    expect(fold.unfoldable).toBe(false);
    expect(fold.ast).toEqual({ kind: "literal", value: "demo" });
  });

  it("short-circuits where the evaluator does", () => {
    expect(
      foldStoryExpression(parse('AppTag == "Demo" && gold > 0').ast, { tagName: "main" }).ast
    ).toEqual({ kind: "literal", value: false });
    expect(
      foldStoryExpression(parse('AppTag == "Demo" || gold > 0').ast, { tagName: "Demo" }).ast
    ).toEqual({ kind: "literal", value: true });
  });

  it("never freezes a random roll into the package", () => {
    // Reported rather than evaluated: baking one roll into the bytes would make every play of
    // every copy take the same branch.
    expect(
      foldStoryExpression(parse('AppTag == "Demo" ? random() : 0').ast, { tagName: "Demo" })
        .unfoldable
    ).toBe(true);
    expect(
      foldStoryExpression(parse('AppTag == "Demo" ? random() : 0').ast, { tagName: "main" }).ast
    ).toEqual({ kind: "literal", value: 0 });
  });
});

describe("staticConditionValue", () => {
  it("leaves every condition the game decides alone", () => {
    expect(staticConditionValue(condition("gold >= 100"), { tagName: "Demo" })).toBe("unknown");
    expect(staticConditionValue(undefined, { tagName: "Demo" })).toBe("unknown");
    expect(
      staticConditionValue({ kind: "blueprint", blueprintId: "bp" }, { tagName: "Demo" })
    ).toBe("unknown");
  });

  it("does not fold an ordinary condition that happens to be constant", () => {
    // `/if true` is the author's own row, not a variant decision. Deciding it here would delete
    // the `else` they are still writing.
    expect(staticConditionValue(condition("true"), { tagName: "Demo" })).toBe("unknown");
  });

  it("decides a condition that names the variant", () => {
    expect(staticConditionValue(condition('AppTag == "Demo"'), { tagName: "Demo" })).toBe("true");
    expect(staticConditionValue(condition('AppTag == "Demo"'), { tagName: "main" })).toBe("false");
  });
});

describe("collectUnfoldableAppTagUses", () => {
  it("names the story, the scene, the row and the author's own text", () => {
    const built = document(
      conditionScene([{ branch: "if", source: "AppTag == gold", line: "demo" }])
    );
    expect(collectUnfoldableAppTagUses(built, { tagName: "Demo" })).toEqual([
      {
        storyId: "story-1",
        storyName: "Story",
        sceneId: "scene-1",
        sceneName: "Intro",
        blockId: "branch-0",
        source: "AppTag == gold"
      }
    ]);
  });

  it("says nothing about a disabled row", () => {
    const built = document(
      conditionScene([{ branch: "if", source: "AppTag == gold", line: "demo", disabled: true }])
    );
    expect(collectUnfoldableAppTagUses(built, { tagName: "Demo" })).toEqual([]);
  });

  it("says nothing about a comparison that decides", () => {
    const built = document(
      conditionScene([{ branch: "if", source: 'AppTag == "Demo"', line: "demo" }])
    );
    expect(collectUnfoldableAppTagUses(built, { tagName: "main" })).toEqual([]);
  });
});

describe("applyAppTagToStoryDocument", () => {
  it("deletes a branch the variant cannot take, and its whole subtree, from the block map", () => {
    const built = document(
      conditionScene([
        { branch: "if", source: 'AppTag == "Demo"', line: "only in the demo" },
        { branch: "else", line: "everywhere else" }
      ])
    );
    const out = applyAppTagToStoryDocument(built, RELEASE);
    const result = out.scenes["scene-1"];

    expect(Object.keys(result.blocks)).not.toContain("branch-0");
    // The row INSIDE the branch is the whole point: unlinking the branch would leave this here,
    // and the package would carry the demo's line.
    expect(Object.keys(result.blocks)).not.toContain("line-0");
    expect(result.blocks.cond.childrenIds).toEqual(["branch-1"]);
    expect(result.blocks["line-1"]).toBeTruthy();
  });

  it("keeps a branch that always runs and drops everything after it", () => {
    const built = document(
      conditionScene([
        { branch: "if", source: 'AppTag == "Demo"', line: "demo" },
        { branch: "elseIf", source: "gold > 0", line: "rich" },
        { branch: "else", line: "poor" }
      ])
    );
    const result = applyAppTagToStoryDocument(built, DEMO).scenes["scene-1"];

    expect(result.blocks.cond.childrenIds).toEqual(["branch-0"]);
    expect(result.blocks["line-1"]).toBeUndefined();
    expect(result.blocks["line-2"]).toBeUndefined();
  });

  it("makes the surviving else a head the compiler can build from", () => {
    const built = document(
      conditionScene([
        { branch: "if", source: 'AppTag == "Demo"', line: "demo" },
        { branch: "else", line: "everywhere else" }
      ])
    );
    const result = applyAppTagToStoryDocument(built, RELEASE).scenes["scene-1"];
    const head = result.blocks["branch-1"];

    expect(
      head.kind === "control" && head.payload.control === "conditionBranch" && head.payload.branch
    ).toBe("if");
    // An `if` with no condition compiles to a constant false, which would delete at play time
    // exactly the branch the fold just proved always runs.
    expect(
      head.kind === "control" &&
        head.payload.control === "conditionBranch" &&
        head.payload.condition
    ).toEqual({
      kind: "expression",
      expression: { source: "true", ast: { kind: "literal", value: true } }
    });
  });

  it("drops the whole condition when no branch survives", () => {
    const built = document(
      conditionScene([{ branch: "if", source: 'AppTag == "Demo"', line: "demo" }])
    );
    const result = applyAppTagToStoryDocument(built, RELEASE).scenes["scene-1"];

    expect(result.rootBlockIds).toEqual([]);
    expect(Object.keys(result.blocks)).toEqual([]);
  });

  it("leaves a condition the game decides exactly as it was", () => {
    const built = document(
      conditionScene([
        { branch: "if", source: "gold > 0", line: "rich" },
        { branch: "else", line: "poor" }
      ])
    );
    expect(applyAppTagToStoryDocument(built, RELEASE)).toBe(built);
  });

  it("does not let a disabled branch decide the chain", () => {
    // The compiler drops a disabled branch before it looks at conditions, so treating this one
    // as taken would keep a branch the runtime never sees and delete the one it does.
    const built = document(
      conditionScene([
        { branch: "if", source: 'AppTag == "Demo"', line: "demo", disabled: true },
        { branch: "elseIf", source: 'AppTag == "Demo"', line: "also demo" },
        { branch: "else", line: "everywhere else" }
      ])
    );
    const result = applyAppTagToStoryDocument(built, DEMO).scenes["scene-1"];

    expect(result.blocks["line-1"]).toBeTruthy();
    expect(result.blocks["line-2"]).toBeUndefined();
  });

  it("removes a choice option it can never show, text and all", () => {
    const built = document(
      scene(
        [
          block({
            id: "choice",
            kind: "nodeAction",
            childrenIds: ["opt"],
            payload: { action: "choice" }
          }),
          block({
            id: "opt",
            kind: "nodeAction",
            parentId: "choice",
            childrenIds: ["opt-line"],
            payload: {
              action: "choiceOption",
              text: segment("Buy the full game"),
              hiddenWhen: condition('AppTag != "Demo"')
            }
          }),
          block({
            id: "opt-line",
            kind: "nodeAction",
            parentId: "opt",
            payload: { action: "narration", text: segment("thanks") }
          })
        ],
        ["choice"]
      )
    );
    const result = applyAppTagToStoryDocument(built, RELEASE).scenes["scene-1"];

    expect(result.blocks.opt).toBeUndefined();
    expect(result.blocks["opt-line"]).toBeUndefined();
    expect(result.blocks.choice.childrenIds).toEqual([]);
  });

  it("folds a loop's stop condition and an inline interpolation, source included", () => {
    const built = document(
      scene(
        [
          block({
            id: "loop",
            kind: "control",
            payload: { control: "repeat", until: condition('AppTag == "Demo"') }
          }),
          block({
            id: "line",
            kind: "nodeAction",
            payload: {
              action: "narration",
              text: {
                textId: "t1",
                value: "edition",
                role: "narration",
                rich: [{ interpolation: { kind: "expression", expression: parse("AppTag") } }]
              }
            }
          })
        ],
        ["loop", "line"]
      )
    );
    const result = applyAppTagToStoryDocument(built, DEMO).scenes["scene-1"];
    const loop = result.blocks.loop;
    const line = result.blocks.line;

    expect(
      loop.kind === "control" && loop.payload.control === "repeat" && loop.payload.until
    ).toEqual({
      kind: "expression",
      expression: { source: "true", ast: { kind: "literal", value: true } }
    });
    // The stored source is re-printed from the folded tree: a source still reading `AppTag`
    // beside a tree that says `"Demo"` would be two answers to one question.
    expect(
      line.kind === "nodeAction" && line.payload.action === "narration" && line.payload.text.rich
    ).toEqual([
      {
        interpolation: {
          kind: "expression",
          expression: { source: '"Demo"', ast: { kind: "literal", value: "Demo" } }
        }
      }
    ]);
  });
});

// ── Cut points and the scenes they orphan ─────────────────────────────────────────────────────────

function namedScene(
  id: string,
  name: string,
  blocks: StoryBlock[],
  rootBlockIds: string[]
): StoryScene {
  return {
    id,
    name,
    runtimeName: id,
    rootBlockIds,
    blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry]))
  };
}

/** A story of several scenes, all filed under one chapter - the shape `createStory` produces. */
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

function line(id: string, text: string, parentId: string | null = null): StoryBlock {
  return block({
    id,
    kind: "nodeAction",
    parentId,
    payload: { action: "narration", text: segment(text) }
  });
}

type CutPlacement = { parentId?: string | null; disabled?: boolean };

function cut(id: string, appTagId: string, extra?: CutPlacement): StoryBlock {
  return block({ id, kind: "control", payload: { control: "cut", appTagId }, ...extra });
}

function jump(id: string, targetSceneId: string): StoryBlock {
  return block({ id, kind: "jump", payload: { targetSceneId } });
}

/** `before`, the cut point, `after`, then a group holding one line. */
function cutScene(appTagId: string, extra?: CutPlacement): StoryScene {
  return namedScene(
    "scene-1",
    "Intro",
    [
      line("a", "before the cut"),
      cut("c", appTagId, extra),
      line("b", "after the cut"),
      block({
        id: "group",
        kind: "control",
        childrenIds: ["inner"],
        payload: { control: "sequence" }
      }),
      line("inner", "inside the group", "group")
    ],
    ["a", "c", "b", "group"]
  );
}

describe("cut points", () => {
  it("ends the scene at the row, block map and all", () => {
    const result = applyAppTagToStoryDocument(story([cutScene("tag-demo")]), DEMO).scenes[
      "scene-1"
    ];

    expect(result.rootBlockIds).toEqual(["a"]);
    // The rows after it are gone from the record, not merely unlinked - a block left there ships
    // its every line whatever `rootBlockIds` says.
    expect(Object.keys(result.blocks)).toEqual(["a"]);
  });

  it("drops the row and nothing else when the build is another variant", () => {
    const result = applyAppTagToStoryDocument(story([cutScene("tag-demo")]), RELEASE).scenes[
      "scene-1"
    ];

    expect(result.rootBlockIds).toEqual(["a", "b", "group"]);
    // The row itself still goes: it does nothing at play time, and leaving it in ships the id of
    // a variant the player's edition is not.
    expect(result.blocks.c).toBeUndefined();
    expect(result.blocks.inner).toBeTruthy();
  });

  it("cuts nothing for a variant the project no longer has", () => {
    // Deleting a variant keeps its rows and makes them inert. A stale row that started
    // truncating builds would be the exact opposite of that.
    const result = applyAppTagToStoryDocument(story([cutScene("tag-deleted")]), DEMO).scenes[
      "scene-1"
    ];

    expect(result.rootBlockIds).toEqual(["a", "b", "group"]);
    expect(result.blocks.c).toBeUndefined();
  });

  it("cuts nothing when it names the release variant", () => {
    const result = applyAppTagToStoryDocument(story([cutScene(APP_TAG_ID_RELEASE)]), DEMO).scenes[
      "scene-1"
    ];

    expect(result.rootBlockIds).toEqual(["a", "b", "group"]);
  });

  it("lets a disabled cut point decide nothing", () => {
    const result = applyAppTagToStoryDocument(
      story([cutScene("tag-demo", { disabled: true })]),
      DEMO
    ).scenes["scene-1"];

    expect(result.rootBlockIds).toEqual(["a", "b", "group"]);
  });

  it("keeps what came before it inside every container it sits in", () => {
    const built = story([
      namedScene(
        "scene-1",
        "Intro",
        [
          block({
            id: "group",
            kind: "control",
            childrenIds: ["kept", "c", "dropped"],
            payload: { control: "sequence" }
          }),
          line("kept", "still played", "group"),
          cut("c", "tag-demo", { parentId: "group" }),
          line("dropped", "after the cut", "group"),
          line("tail", "after the group")
        ],
        ["group", "tail"]
      )
    ]);
    const result = applyAppTagToStoryDocument(built, DEMO).scenes["scene-1"];

    expect(result.rootBlockIds).toEqual(["group"]);
    expect(result.blocks.group.childrenIds).toEqual(["kept"]);
    expect(result.blocks.dropped).toBeUndefined();
    expect(result.blocks.tail).toBeUndefined();
  });
});

describe("collectNestedCutPoints", () => {
  it("names the story, the scene, the row and the variant it names", () => {
    const built = story([
      namedScene(
        "scene-1",
        "Intro",
        [
          block({
            id: "group",
            kind: "control",
            childrenIds: ["c"],
            payload: { control: "sequence" }
          }),
          cut("c", "tag-demo", { parentId: "group" })
        ],
        ["group"]
      )
    ]);

    expect(collectNestedCutPoints(built)).toEqual([
      {
        storyId: "story-1",
        storyName: "Story",
        sceneId: "scene-1",
        sceneName: "Intro",
        blockId: "c",
        appTagId: "tag-demo"
      }
    ]);
  });

  it("says nothing about a cut point at the top of its scene", () => {
    expect(collectNestedCutPoints(story([cutScene("tag-demo")]))).toEqual([]);
  });

  it("says nothing about a row inside a disabled group", () => {
    const built = story([
      namedScene(
        "scene-1",
        "Intro",
        [
          block({
            id: "group",
            kind: "control",
            childrenIds: ["c"],
            payload: { control: "sequence" },
            disabled: true
          }),
          cut("c", "tag-demo", { parentId: "group" })
        ],
        ["group"]
      )
    ]);

    expect(collectNestedCutPoints(built)).toEqual([]);
  });
});

describe("dropping the scenes the story can no longer reach", () => {
  /** Intro ends at the cut for the demo, and Ending is only reachable through the jump after it. */
  function twoScenes(): StoryDocument {
    return story(
      [
        namedScene(
          "scene-1",
          "Intro",
          [line("a", "hello"), cut("c", "tag-demo"), jump("j", "scene-2")],
          ["a", "c", "j"]
        ),
        namedScene("scene-2", "Ending", [line("b", "the secret ending")], ["b"])
      ],
      "scene-1"
    );
  }

  it("drops the scene the cut orphaned, prose and all", () => {
    const result = applyAppTagToStoryDocument(twoScenes(), {
      ...DEMO,
      sceneReachability: { entrySceneIds: [] }
    });

    expect(result.scenes["scene-2"]).toBeUndefined();
    // The assertion that matters: the words are not in the bytes, not merely out of the graph.
    expect(JSON.stringify(result)).not.toContain("the secret ending");
    expect(result.chapters[0].sceneIds).toEqual(["scene-1"]);
  });

  it("keeps a scene the story still jumps to", () => {
    const result = applyAppTagToStoryDocument(twoScenes(), {
      ...RELEASE,
      sceneReachability: { entrySceneIds: [] }
    });

    expect(result.scenes["scene-2"]).toBeTruthy();
  });

  it("keeps a scene something outside the story starts at", () => {
    const result = applyAppTagToStoryDocument(twoScenes(), {
      ...DEMO,
      sceneReachability: { entrySceneIds: ["scene-2"] }
    });

    expect(result.scenes["scene-2"]).toBeTruthy();
  });

  it("drops nothing at all when the sweep was not asked for", () => {
    // What a project with an indirect jump gets: a blueprint that can name any scene while the
    // game runs leaves the caller no way to answer, so the story ships whole rather than
    // partly swept.
    const result = applyAppTagToStoryDocument(twoScenes(), DEMO);

    expect(result.scenes["scene-2"]).toBeTruthy();
    expect(JSON.stringify(result)).toContain("the secret ending");
  });

  it("starts at the first scene when the author marked no entry", () => {
    const built = story([
      namedScene("scene-1", "Intro", [line("a", "hello")], ["a"]),
      namedScene("scene-2", "Ending", [line("b", "unreached")], ["b"])
    ]);
    const result = applyAppTagToStoryDocument(built, {
      ...DEMO,
      sceneReachability: { entrySceneIds: [] }
    });

    expect(result.scenes["scene-1"]).toBeTruthy();
    expect(result.scenes["scene-2"]).toBeUndefined();
  });
});
