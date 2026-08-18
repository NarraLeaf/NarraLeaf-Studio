import { describe, expect, it } from "vitest";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { BLUEPRINT_NODE_TYPE_GAME_START_STORY } from "@shared/types/blueprint/graph";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import {
  STORY_DOCUMENT_SCHEMA_VERSION,
  type StoryDocument,
  type StoryScene
} from "@shared/types/story";
import { RELEASE_APP_TAG, type ProjectAppTag } from "@shared/types/appTag";
import {
  EMPTY_STORY_EXPRESSION_SCOPE,
  parseStoryExpression
} from "@shared/utils/storyExpressionParser";
import { createTestLintContext } from "../testContext";
import type { LintContext, LintStoryEntry } from "../context";
import type { LintFinding, LintRuleId } from "../types";
import { STORY_LINT_RULES } from "./story";

/**
 * The ten `story` rules.
 *
 * Every rule is checked both ways - a fixture that must produce a finding and one that must produce
 * nothing - because a rule that never fires and a rule that always fires are equally useless and
 * only the pair distinguishes them. Beyond that the cases here are the three things this kind of
 * rule is usually wrong about: a `disabled` row (authored, but not in the runtime, so never a
 * finding), a name resolved in the wrong scope, and a scene that ends in a branch rather than in a
 * bare jump.
 */

// --- fixtures ---------------------------------------------------------------

type BlockSpec = {
  id: string;
  kind: string;
  payload: unknown;
  disabled?: boolean;
  children?: BlockSpec[];
};

/** Wires `parentId` / `childrenIds` / `rootBlockIds` from a nested spec, so tests state only the tree. */
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

function story(
  id: string,
  name: string,
  scenes: StoryScene[],
  entrySceneId?: string
): LintStoryEntry {
  const document = {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    id,
    name,
    chapters: [],
    scenes: Object.fromEntries(scenes.map((entry) => [entry.id, entry])),
    ...(entrySceneId ? { entrySceneId } : {})
  } as StoryDocument;
  return { id, name, document };
}

function text(value: string, role = "narration") {
  return { textId: `text-${value || "empty"}`, value, role };
}

const narration = (id: string, value = "line"): BlockSpec => ({
  id,
  kind: "nodeAction",
  payload: { action: "narration", text: text(value) }
});
const label = (id: string, name: string): BlockSpec => ({
  id,
  kind: "control",
  payload: { control: "label", name }
});
const goto = (id: string, targetLabel: string): BlockSpec => ({
  id,
  kind: "control",
  payload: { control: "goto", targetLabel }
});
const jump = (id: string, targetSceneId: string): BlockSpec => ({
  id,
  kind: "jump",
  payload: { targetSceneId }
});
const invalid = (id: string, source: string): BlockSpec => ({
  id,
  kind: "invalid",
  payload: { source }
});
const choice = (id: string, children: BlockSpec[]): BlockSpec => ({
  id,
  kind: "nodeAction",
  payload: { action: "choice" },
  children
});
const option = (id: string, value: string, children: BlockSpec[] = []): BlockSpec => ({
  id,
  kind: "nodeAction",
  payload: { action: "choiceOption", text: text(value, "choiceText") },
  children
});
const condition = (id: string, branches: BlockSpec[]): BlockSpec => ({
  id,
  kind: "control",
  payload: { control: "condition" },
  children: branches
});
const branch = (id: string, arm: "if" | "elseIf" | "else", children: BlockSpec[]): BlockSpec => ({
  id,
  kind: "control",
  payload: { control: "conditionBranch", branch: arm },
  children
});

function blueprintWithStartStory(
  params: Record<string, unknown>,
  wiredPins: string[] = []
): BlueprintDocument {
  return {
    schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
    blueprints: {
      "bp-1": {
        id: "bp-1",
        name: "Title screen",
        owner: { kind: "globalMain" },
        frontend: "visual",
        programKind: "graph",
        program: {
          kind: "graph",
          graphs: {
            events: {
              "ev-1": {
                id: "ev-1",
                graph: {
                  nodes: {
                    "n-1": { id: "n-1", type: BLUEPRINT_NODE_TYPE_GAME_START_STORY, params }
                  },
                  edges: wiredPins.map((port) => ({
                    from: { nodeId: "n-source", port: "value" },
                    to: { nodeId: "n-1", port }
                  }))
                }
              }
            },
            functions: {}
          }
        }
      }
    },
    // No owner record names the blueprint, which this rule reads anyway: an entry that can start
    // a scene is worth reading wherever it sits. See `blueprintDocumentGraphCarriers`.
    ownerRecords: {}
  } as BlueprintDocument;
}

function run(id: LintRuleId, ctx: LintContext): LintFinding[] {
  const rule = STORY_LINT_RULES.find((entry) => entry.id === id);
  if (!rule) {
    throw new Error(`no such rule: ${id}`);
  }
  const findings = rule.run(ctx, {});
  if (findings instanceof Promise) {
    throw new Error("story rules are synchronous");
  }
  return findings;
}

function ctxWith(...stories: LintStoryEntry[]): LintContext {
  return createTestLintContext({ stories });
}

// --- story/invalid-command --------------------------------------------------

describe("story/invalid-command", () => {
  it("reports an unresolved command line", () => {
    const findings = run(
      "story/invalid-command",
      ctxWith(story("s1", "Main", [scene("sc1", "Prologue", [invalid("b1", "/se ")])]))
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyInvalidCommand.message");
    expect(findings[0].target).toEqual({
      kind: "storyBlock",
      storyId: "s1",
      sceneId: "sc1",
      blockId: "b1",
      storyName: "Main",
      sceneName: "Prologue"
    });
  });

  it("says nothing about a story whose rows all resolve", () => {
    expect(
      run(
        "story/invalid-command",
        ctxWith(story("s1", "Main", [scene("sc1", "Prologue", [narration("b1")])]))
      )
    ).toEqual([]);
  });

  it("ignores a disabled invalid row", () => {
    const document = scene("sc1", "Prologue", [{ ...invalid("b1", "/se "), disabled: true }]);
    expect(run("story/invalid-command", ctxWith(story("s1", "Main", [document])))).toEqual([]);
  });
});

// --- story/goto-missing -----------------------------------------------------

describe("story/goto-missing", () => {
  it("reports a goto naming a label the scene does not declare", () => {
    const findings = run(
      "story/goto-missing",
      ctxWith(story("s1", "Main", [scene("sc1", "Prologue", [goto("b1", "retry")])]))
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyGotoMissing.message");
    expect(findings[0].messageParams).toEqual({ label: "retry" });
    expect(findings[0].location).toMatchObject({ kind: "story", sceneId: "sc1", blockId: "b1" });
  });

  it("accepts a goto whose label is declared in the same scene", () => {
    const findings = run(
      "story/goto-missing",
      ctxWith(
        story("s1", "Main", [scene("sc1", "Prologue", [label("b0", "retry"), goto("b1", "retry")])])
      )
    );
    expect(findings).toEqual([]);
  });

  it("does not resolve a label declared in another scene", () => {
    const findings = run(
      "story/goto-missing",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [goto("b1", "retry")]),
          scene("sc2", "Chapter 1", [label("b2", "retry")])
        ])
      )
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageParams).toEqual({ label: "retry" });
  });

  it("ignores a disabled goto", () => {
    const findings = run(
      "story/goto-missing",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [{ ...goto("b1", "retry"), disabled: true }])
        ])
      )
    );
    expect(findings).toEqual([]);
  });

  it("ignores a goto inside a disabled container", () => {
    const findings = run(
      "story/goto-missing",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [
            {
              id: "g1",
              kind: "control",
              payload: { control: "sequence" },
              disabled: true,
              children: [goto("b1", "retry")]
            }
          ])
        ])
      )
    );
    expect(findings).toEqual([]);
  });

  it("does not see a label whose own row is disabled", () => {
    const findings = run(
      "story/goto-missing",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [
            { ...label("b0", "retry"), disabled: true },
            goto("b1", "retry")
          ])
        ])
      )
    );
    expect(findings).toHaveLength(1);
  });
});

// --- story/label-duplicate --------------------------------------------------

describe("story/label-duplicate", () => {
  it("reports the second declaration, not the first", () => {
    const findings = run(
      "story/label-duplicate",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [label("b1", "retry"), label("b2", "retry")])
        ])
      )
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyLabelDuplicate.message");
    expect(findings[0].messageParams).toEqual({ label: "retry" });
    expect(findings[0].location).toMatchObject({ blockId: "b2" });
  });

  it("says nothing when a name recurs in another scene", () => {
    const findings = run(
      "story/label-duplicate",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [label("b1", "retry")]),
          scene("sc2", "Chapter 1", [label("b2", "retry")])
        ])
      )
    );
    expect(findings).toEqual([]);
  });
});

// --- story/label-unused -----------------------------------------------------

describe("story/label-unused", () => {
  it("reports a label nothing jumps to", () => {
    const findings = run(
      "story/label-unused",
      ctxWith(
        story("s1", "Main", [scene("sc1", "Prologue", [label("b1", "retry"), narration("b2")])])
      )
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyLabelUnused.message");
    expect(findings[0].messageParams).toEqual({ label: "retry" });
    expect(findings[0].location).toMatchObject({ blockId: "b1" });
  });

  it("says nothing about a label a goto addresses", () => {
    const findings = run(
      "story/label-unused",
      ctxWith(
        story("s1", "Main", [scene("sc1", "Prologue", [label("b1", "retry"), goto("b2", "retry")])])
      )
    );
    expect(findings).toEqual([]);
  });

  it("reports one finding per name, however many rows declare it", () => {
    const findings = run(
      "story/label-unused",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [label("b1", "retry"), label("b2", "retry")])
        ])
      )
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].location).toMatchObject({ blockId: "b1" });
  });
});

// --- story/jump-missing -----------------------------------------------------

describe("story/jump-missing", () => {
  it("reports a jump naming a scene the story does not have", () => {
    const findings = run(
      "story/jump-missing",
      ctxWith(story("s1", "Main", [scene("sc1", "Prologue", [jump("b1", "gone")])]))
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyJumpMissing.message");
    expect(findings[0].location).toMatchObject({ blockId: "b1" });
  });

  it("accepts a jump into a scene of the same story", () => {
    const findings = run(
      "story/jump-missing",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [jump("b1", "sc2")]),
          scene("sc2", "Chapter 1", [narration("b2")])
        ])
      )
    );
    expect(findings).toEqual([]);
  });

  it("still reports a target that only exists in another story - jumps never cross stories", () => {
    const findings = run(
      "story/jump-missing",
      ctxWith(
        story("s1", "Main", [scene("sc1", "Prologue", [jump("b1", "other")])]),
        story("s2", "Side", [scene("other", "Elsewhere", [narration("b2")])])
      )
    );
    expect(findings).toHaveLength(1);
  });

  it("reports an empty jump target", () => {
    const findings = run(
      "story/jump-missing",
      ctxWith(story("s1", "Main", [scene("sc1", "Prologue", [jump("b1", "")])]))
    );
    expect(findings).toHaveLength(1);
  });

  it("ignores a disabled jump", () => {
    const findings = run(
      "story/jump-missing",
      ctxWith(
        story("s1", "Main", [scene("sc1", "Prologue", [{ ...jump("b1", "gone"), disabled: true }])])
      )
    );
    expect(findings).toEqual([]);
  });
});

// --- story/empty-choice -----------------------------------------------------

describe("story/empty-choice", () => {
  it("reports a choice with no options", () => {
    const findings = run(
      "story/empty-choice",
      ctxWith(story("s1", "Main", [scene("sc1", "Prologue", [choice("b1", [])])]))
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyEmptyChoice.message");
    expect(findings[0].location).toMatchObject({ blockId: "b1" });
  });

  it("reports an option with no text", () => {
    const findings = run(
      "story/empty-choice",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [choice("b1", [option("o1", "Fight"), option("o2", "   ")])])
        ])
      )
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyEmptyChoice.messageEmptyOption");
    expect(findings[0].location).toMatchObject({ blockId: "o2" });
  });

  it("says nothing about a choice whose options all read", () => {
    const findings = run(
      "story/empty-choice",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [choice("b1", [option("o1", "Fight"), option("o2", "Flee")])])
        ])
      )
    );
    expect(findings).toEqual([]);
  });

  it("treats an option whose whole label is an inline value as non-empty", () => {
    const interpolated: BlockSpec = {
      id: "o1",
      kind: "nodeAction",
      payload: {
        action: "choiceOption",
        text: {
          textId: "t-1",
          value: "",
          role: "choiceText",
          rich: [
            { interpolation: { kind: "variable", target: { scope: "saved", variableId: "v1" } } }
          ]
        }
      }
    };
    const findings = run(
      "story/empty-choice",
      ctxWith(story("s1", "Main", [scene("sc1", "Prologue", [choice("b1", [interpolated])])]))
    );
    expect(findings).toEqual([]);
  });

  it("counts a choice whose only option is disabled as having none", () => {
    const findings = run(
      "story/empty-choice",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [choice("b1", [{ ...option("o1", "Fight"), disabled: true }])])
        ])
      )
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyEmptyChoice.message");
  });

  it("ignores a disabled choice entirely", () => {
    const findings = run(
      "story/empty-choice",
      ctxWith(
        story("s1", "Main", [scene("sc1", "Prologue", [{ ...choice("b1", []), disabled: true }])])
      )
    );
    expect(findings).toEqual([]);
  });

  it("ignores a blank option under a disabled choice", () => {
    const findings = run(
      "story/empty-choice",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [{ ...choice("b1", [option("o1", "")]), disabled: true }])
        ])
      )
    );
    expect(findings).toEqual([]);
  });
});

// --- story/dead-end ---------------------------------------------------------

describe("story/dead-end", () => {
  it("reports an if/else that jumps in one arm and falls through in the other", () => {
    const findings = run(
      "story/dead-end",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [
            condition("c1", [
              branch("br1", "if", [jump("j1", "sc1")]),
              branch("br2", "else", [narration("n1")])
            ])
          ])
        ])
      )
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyDeadEnd.message");
    expect(findings[0].location).toMatchObject({ blockId: "c1" });
  });

  it("says nothing about an ending - a scene that never hands control on at all", () => {
    // The whole reason for the transfer precondition: there is no end-of-game story action, so
    // every legitimate final scene looks exactly like this one.
    const findings = run(
      "story/dead-end",
      ctxWith(story("s1", "Main", [scene("sc1", "Finale", [narration("b1"), narration("b2")])]))
    );
    expect(findings).toEqual([]);
  });

  it("says nothing about a scene ending in a jump", () => {
    const findings = run(
      "story/dead-end",
      ctxWith(story("s1", "Main", [scene("sc1", "Prologue", [narration("b1"), jump("b2", "sc1")])]))
    );
    expect(findings).toEqual([]);
  });

  it("says nothing about a scene ending in a goto", () => {
    const findings = run(
      "story/dead-end",
      ctxWith(
        story("s1", "Main", [scene("sc1", "Prologue", [label("b0", "top"), goto("b1", "top")])])
      )
    );
    expect(findings).toEqual([]);
  });

  it("says nothing about a scene ending in a choice whose every option jumps", () => {
    const findings = run(
      "story/dead-end",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [
            choice("b1", [
              option("o1", "Fight", [jump("j1", "sc1")]),
              option("o2", "Flee", [jump("j2", "sc1")])
            ])
          ])
        ])
      )
    );
    expect(findings).toEqual([]);
  });

  it("reports a choice where one option falls through", () => {
    const findings = run(
      "story/dead-end",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [
            choice("b1", [
              option("o1", "Fight", [jump("j1", "sc1")]),
              option("o2", "Flee", [narration("n1")])
            ])
          ])
        ])
      )
    );
    expect(findings).toHaveLength(1);
  });

  it("skips a scene with nothing live in it", () => {
    const findings = run(
      "story/dead-end",
      ctxWith(
        story("s1", "Main", [scene("sc1", "Prologue", [{ ...narration("b1"), disabled: true }])])
      )
    );
    expect(findings).toEqual([]);
  });

  it("anchors on the last LIVE row, ignoring a disabled jump after it", () => {
    const findings = run(
      "story/dead-end",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [
            condition("c1", [branch("br1", "if", [jump("j1", "sc1")])]),
            narration("b1"),
            { ...jump("b2", "sc1"), disabled: true }
          ])
        ])
      )
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].location).toMatchObject({ blockId: "b1" });
  });

  it("does not count a disabled jump as the scene handing control on", () => {
    const findings = run(
      "story/dead-end",
      ctxWith(
        story("s1", "Main", [
          scene("sc1", "Prologue", [narration("b1"), { ...jump("b2", "sc1"), disabled: true }])
        ])
      )
    );
    expect(findings).toEqual([]);
  });
});

// --- story/unreachable-scene ------------------------------------------------

describe("story/unreachable-scene", () => {
  it("reports a scene no jump from the entry reaches", () => {
    const findings = run(
      "story/unreachable-scene",
      ctxWith(
        story(
          "s1",
          "Main",
          [
            scene("sc1", "Prologue", [jump("b1", "sc2")]),
            scene("sc2", "Chapter 1", []),
            scene("sc3", "Cut", [])
          ],
          "sc1"
        )
      )
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyUnreachableScene.message");
    expect(findings[0].target).toEqual({
      kind: "storyScene",
      storyId: "s1",
      sceneId: "sc3",
      storyName: "Main",
      sceneName: "Cut"
    });
  });

  it("says nothing when every scene is reachable from the entry", () => {
    const findings = run(
      "story/unreachable-scene",
      ctxWith(
        story(
          "s1",
          "Main",
          [scene("sc1", "Prologue", [jump("b1", "sc2")]), scene("sc2", "Chapter 1", [])],
          "sc1"
        )
      )
    );
    expect(findings).toEqual([]);
  });

  it("returns nothing at all when no entry point can be established", () => {
    const findings = run(
      "story/unreachable-scene",
      ctxWith(story("s1", "Main", [scene("sc1", "Prologue", []), scene("sc2", "Chapter 1", [])]))
    );
    expect(findings).toEqual([]);
  });

  it("does not flag a scene a blueprint Start Game node opens", () => {
    const ctx = createTestLintContext({
      stories: [
        story("s1", "Main", [scene("sc1", "Prologue", []), scene("sc2", "Recollection", [])], "sc1")
      ],
      blueprintDocument: blueprintWithStartStory({ storyId: "s1", sceneId: "sc2" })
    });
    expect(run("story/unreachable-scene", ctx)).toEqual([]);
  });

  it("goes silent when a Start Game node picks no target at all", () => {
    const ctx = createTestLintContext({
      stories: [
        story("s1", "Main", [scene("sc1", "Prologue", []), scene("sc2", "Cut", [])], "sc1")
      ],
      blueprintDocument: blueprintWithStartStory({ storyId: "s1" })
    });
    expect(run("story/unreachable-scene", ctx)).toEqual([]);
  });

  it("goes silent when a Start Game node wires its target, picked scene and all", () => {
    // The wire wins over the picker at execution time, so the picked scene says nothing about
    // where this node starts play - and a rule that read it would call every other scene orphaned
    // on the strength of a value the running game ignores.
    const ctx = createTestLintContext({
      stories: [
        story("s1", "Main", [scene("sc1", "Prologue", []), scene("sc2", "Cut", [])], "sc1")
      ],
      blueprintDocument: blueprintWithStartStory({ storyId: "s1", sceneId: "sc1" }, ["sceneId"])
    });
    expect(run("story/unreachable-scene", ctx)).toEqual([]);
  });

  it("leaves a story with no entry of its own alone", () => {
    const findings = run(
      "story/unreachable-scene",
      ctxWith(
        story("s1", "Main", [scene("sc1", "Prologue", [])], "sc1"),
        story("s2", "Side", [scene("sc9", "Orphan", [])])
      )
    );
    expect(findings).toEqual([]);
  });

  it("does not follow a disabled jump", () => {
    const findings = run(
      "story/unreachable-scene",
      ctxWith(
        story(
          "s1",
          "Main",
          [
            scene("sc1", "Prologue", [{ ...jump("b1", "sc2"), disabled: true }]),
            scene("sc2", "Chapter 1", [])
          ],
          "sc1"
        )
      )
    );
    expect(findings).toHaveLength(1);
  });
});

// --- story/empty-scene ------------------------------------------------------

describe("story/empty-scene", () => {
  it("reports a scene with no blocks", () => {
    const findings = run(
      "story/empty-scene",
      ctxWith(story("s1", "Main", [scene("sc1", "Prologue", [])]))
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyEmptyScene.message");
    expect(findings[0].target).toMatchObject({ kind: "storyScene", sceneId: "sc1" });
  });

  it("says nothing about a scene with content", () => {
    expect(
      run(
        "story/empty-scene",
        ctxWith(story("s1", "Main", [scene("sc1", "Prologue", [narration("b1")])]))
      )
    ).toEqual([]);
  });

  it("counts a scene whose every row is disabled as empty", () => {
    const findings = run(
      "story/empty-scene",
      ctxWith(
        story("s1", "Main", [scene("sc1", "Prologue", [{ ...narration("b1"), disabled: true }])])
      )
    );
    expect(findings).toHaveLength(1);
  });
});

// --- story/app-tag-unknown --------------------------------------------------

/** `if AppTag == "<name>"`, as the branch block a scene really holds. */
function appTagBranch(id: string, name: string): BlockSpec {
  return {
    id,
    kind: "control",
    payload: {
      control: "conditionBranch",
      branch: "if",
      condition: {
        kind: "expression",
        expression: parseStoryExpression(
          `AppTag == ${JSON.stringify(name)}`,
          EMPTY_STORY_EXPRESSION_SCOPE
        ).expression
      }
    },
    children: [narration(`${id}-line`)]
  };
}

describe("story/app-tag-unknown", () => {
  const withTags = (entry: LintStoryEntry, tags: ProjectAppTag[]): LintContext =>
    createTestLintContext({ stories: [entry], appTags: tags });

  it("reports a comparison against a variant the project does not have", () => {
    const findings = run(
      "story/app-tag-unknown",
      withTags(
        story("s1", "Main", [
          scene("sc1", "Prologue", [condition("c1", [appTagBranch("b1", "Demo")])])
        ]),
        [RELEASE_APP_TAG]
      )
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyAppTagUnknown.message");
    expect(findings[0].messageParams).toEqual({ name: "Demo" });
    expect(findings[0].target).toMatchObject({ kind: "storyBlock", blockId: "b1" });
  });

  it("says nothing about a variant the project has", () => {
    const tags = [RELEASE_APP_TAG, { id: "t-demo", name: "Demo", overrides: {} }];
    expect(
      run(
        "story/app-tag-unknown",
        withTags(
          story("s1", "Main", [
            scene("sc1", "Prologue", [condition("c1", [appTagBranch("b1", "Demo")])])
          ]),
          tags
        )
      )
    ).toEqual([]);
  });

  it("accepts the release variant by name, in a project that authored none of its own", () => {
    // `main` is what the release variant is called in every language, so a line comparing
    // against it is the one variant reference every project can write.
    expect(
      run(
        "story/app-tag-unknown",
        withTags(
          story("s1", "Main", [
            scene("sc1", "Prologue", [condition("c1", [appTagBranch("b1", "main")])])
          ]),
          [RELEASE_APP_TAG]
        )
      )
    ).toEqual([]);
  });

  it("matches the variant's name exactly, the way the fold does", () => {
    const tags = [RELEASE_APP_TAG, { id: "t-demo", name: "Demo", overrides: {} }];
    expect(
      run(
        "story/app-tag-unknown",
        withTags(
          story("s1", "Main", [
            scene("sc1", "Prologue", [condition("c1", [appTagBranch("b1", "demo")])])
          ]),
          tags
        )
      )
    ).toHaveLength(1);
  });

  it("says nothing about a disabled row", () => {
    const findings = run(
      "story/app-tag-unknown",
      withTags(
        story("s1", "Main", [
          scene("sc1", "Prologue", [
            { ...condition("c1", [appTagBranch("b1", "Demo")]), disabled: true }
          ])
        ]),
        [RELEASE_APP_TAG]
      )
    );
    expect(findings).toEqual([]);
  });
});

const cut = (id: string, appTagId = "t-demo"): BlockSpec => ({
  id,
  kind: "control",
  payload: { control: "cut", appTagId }
});

describe("story/cut-point-orphan", () => {
  const demo: ProjectAppTag = { id: "t-demo", name: "Demo", overrides: {} };

  it("reports a cut point in a project whose only variant is the release one", () => {
    const findings = run(
      "story/cut-point-orphan",
      createTestLintContext({
        stories: [story("s1", "Main", [scene("sc1", "Prologue", [narration("n1"), cut("c1")])])],
        appTags: [RELEASE_APP_TAG]
      })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyCutPointOrphan.message");
    expect(findings[0].target).toMatchObject({ kind: "storyBlock", blockId: "c1" });
  });

  it("says nothing while the project has a variant, whatever the row names", () => {
    // Including a row naming a variant that is gone: `story/app-tag-unknown` owns that, and this
    // rule is about the project having nowhere for any cut point to point.
    expect(
      run(
        "story/cut-point-orphan",
        createTestLintContext({
          stories: [
            story("s1", "Main", [scene("sc1", "Prologue", [narration("n1"), cut("c1", "t-gone")])])
          ],
          appTags: [RELEASE_APP_TAG, demo]
        })
      )
    ).toEqual([]);
  });

  it("says nothing about a disabled row", () => {
    expect(
      run(
        "story/cut-point-orphan",
        createTestLintContext({
          stories: [
            story("s1", "Main", [scene("sc1", "Prologue", [{ ...cut("c1"), disabled: true }])])
          ],
          appTags: [RELEASE_APP_TAG]
        })
      )
    ).toEqual([]);
  });
});

describe("story/cut-point-unreachable", () => {
  it("reports a cut point in a scene nothing can get to", () => {
    const findings = run(
      "story/cut-point-unreachable",
      createTestLintContext({
        stories: [
          story(
            "s1",
            "Main",
            [
              scene("sc1", "Prologue", [narration("n1")]),
              scene("sc2", "Orphan", [narration("n2"), cut("c1"), narration("n3")])
            ],
            "sc1"
          )
        ]
      })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("lint.rule.storyCutPointUnreachable.message");
    expect(findings[0].target).toMatchObject({ kind: "storyBlock", blockId: "c1" });
  });

  it("says nothing about a cut point the story can reach", () => {
    expect(
      run(
        "story/cut-point-unreachable",
        createTestLintContext({
          stories: [
            story(
              "s1",
              "Main",
              [
                scene("sc1", "Prologue", [jump("j1", "sc2")]),
                scene("sc2", "Chapter", [narration("n2"), cut("c1"), narration("n3")])
              ],
              "sc1"
            )
          ]
        })
      )
    ).toEqual([]);
  });

  it("stays silent when an entry point cannot be read at all", () => {
    // The same guard `story/unreachable-scene` carries: a wired Start Story target means no
    // reachability claim can be made, and a rule that flagged every cut point over it is one an
    // author switches off.
    expect(
      run(
        "story/cut-point-unreachable",
        createTestLintContext({
          stories: [
            story(
              "s1",
              "Main",
              [
                scene("sc1", "Prologue", [narration("n1")]),
                scene("sc2", "Orphan", [narration("n2"), cut("c1"), narration("n3")])
              ],
              "sc1"
            )
          ],
          blueprintDocument: blueprintWithStartStory({ storyId: "s1", sceneId: "sc2" }, ["sceneId"])
        })
      )
    ).toEqual([]);
  });
});
