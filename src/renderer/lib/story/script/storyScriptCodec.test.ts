import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument, StoryScene, StoryTextSegment } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { isValidStoryEntityId } from "@shared/utils/storyId";
import {
  assertStoryScriptSceneValid,
  exportStoryScript,
  parseStoryScript,
  planStoryScriptImport,
  storyScriptDigest
} from "./storyScriptCodec";
import type {
  StoryScriptExportOptions,
  StoryScriptScenePlan,
  StoryScriptSpeakerLabeller,
  StoryScriptSpeakerResolver
} from "./storyScriptTypes";

/**
 * The merge rules, one test each. Every one of them is a promise the confirm dialog makes on this
 * file's behalf, and the two that would be silent if they broke - `textId` preservation and the `»`
 * label never being read - are the ones worth reading twice.
 */

const SCENE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const STORY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ALICE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const SANAE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
/** A second character with the same display name - nothing forbids it (`renameCharacter` checks nothing). */
const ALICE_TWIN = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
/** A character the author deleted. Deleting one does not touch the story documents that name it. */
const GHOST = "cccccccc-cccc-4ccc-8ccc-ccccccccccc9";

const N1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const D1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const NT1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3";
const A1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";
const C1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd5";
const O1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd6";
const J1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd7";

const CHARACTERS: Record<string, string> = {
  [ALICE]: "Alice",
  [SANAE]: "早苗",
  [ALICE_TWIN]: "Alice"
};

function segment(textId: string, value: string, role: StoryTextSegment["role"]): StoryTextSegment {
  return { textId, value, role };
}

function makeBlock(
  id: string,
  kind: StoryBlock["kind"],
  payload: unknown,
  childrenIds: string[] = []
): StoryBlock {
  return { id, kind, parentId: null, childrenIds, payload } as StoryBlock;
}

/** Six anchored rows covering all five line shapes, plus a `jump` (which can never take children). */
function fixture(): StoryDocument {
  const blocks: StoryBlock[] = [
    makeBlock(N1, "nodeAction", {
      action: "narration",
      text: segment("t1", "早上好", "narration")
    }),
    makeBlock(D1, "nodeAction", {
      action: "dialogue",
      characterId: ALICE,
      text: segment("t2", "你好", "dialogue")
    }),
    makeBlock(NT1, "note", { text: segment("t3", "给译者的备注", "note") }),
    makeBlock(A1, "action", {
      action: "setBackground",
      assetId: "bg-1",
      transition: { kind: "dissolve", durationMs: 500 }
    }),
    makeBlock(C1, "nodeAction", { action: "choice" }, [O1]),
    makeBlock(O1, "nodeAction", {
      action: "choiceOption",
      text: segment("t4", "跟他打招呼", "choiceText")
    }),
    makeBlock(J1, "jump", { targetSceneId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1" })
  ];
  blocks[5].parentId = C1;
  const scene: StoryScene = {
    id: SCENE_ID,
    name: "第一场",
    runtimeName: "scene_1",
    rootBlockIds: [N1, D1, NT1, A1, C1, J1],
    blocks: Object.fromEntries(blocks.map((target) => [target.id, target]))
  };
  return {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    id: STORY_ID,
    name: "Story",
    chapters: [
      { id: "ffffffff-ffff-4fff-8fff-fffffffffff1", name: "Chapter", sceneIds: [SCENE_ID] }
    ],
    scenes: { [SCENE_ID]: scene }
  };
}

const exportOptions: StoryScriptExportOptions = {
  mode: "roundtrip",
  label: (scene, blockId) => `${scene.blocks[blockId]?.kind ?? "?"} label`,
  speaker: (scene, blockId) => {
    const target = scene.blocks[blockId];
    if (!target || target.kind !== "nodeAction" || target.payload.action !== "dialogue") {
      return "";
    }
    return target.payload.characterId
      ? (CHARACTERS[target.payload.characterId] ?? "")
      : (target.payload.speakerName ?? "");
  }
};

const resolveSpeaker: StoryScriptSpeakerResolver = (label) => {
  const found = Object.entries(CHARACTERS).find(([, name]) => name === label);
  return found ? { characterId: found[0] } : { speakerName: label };
};

/** UUID v4 shaped and deterministic, with a distinct tag so a freshly minted id is recognisable. */
function idFactory(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `99999999-9999-4999-8999-${next.toString(16).padStart(12, "0")}`;
  };
}

function anchorIndex(lines: string[], anchor: number): number {
  const index = lines.findIndex((line) => line.endsWith(`⟦${anchor}⟧`));
  expect(index, `anchor ${anchor} is in the file`).toBeGreaterThanOrEqual(0);
  return index;
}

type PlanOptions = {
  live?: StoryDocument;
  resolver?: StoryScriptSpeakerResolver | null;
  /** `null` drops the labeller, which is the only way to reach the codec's resolve-everything fallback. */
  speakerLabel?: StoryScriptSpeakerLabeller | null;
};

function planOf(
  text: string,
  document: StoryDocument,
  options: PlanOptions = {}
): StoryScriptScenePlan {
  const parsed = parseStoryScript(text);
  if (!parsed.ok) {
    throw new Error(`parse failed: ${parsed.error.code} ${parsed.error.message}`);
  }
  const plan = planStoryScriptImport({
    script: parsed.script,
    live: options.live ?? document,
    generateId: idFactory(),
    ...(options.resolver === null ? {} : { resolveSpeaker: options.resolver ?? resolveSpeaker }),
    // The product passes the very labeller the export ran through, so that is the default here.
    ...(options.speakerLabel === null
      ? {}
      : { speakerLabel: options.speakerLabel ?? exportOptions.speaker })
  });
  return plan.scenes[0];
}

/** The fixture with its one dialogue row given a different speaker binding. */
function withSpeaker(document: StoryDocument, speaker: Record<string, string>): StoryDocument {
  document.scenes[SCENE_ID].blocks[D1] = makeBlock(D1, "nodeAction", {
    action: "dialogue",
    ...speaker,
    text: segment("t2", "你好", "dialogue")
  });
  return document;
}

/** Export the merged scene again: equal bytes is the strongest statement that nothing moved. */
function reexport(plan: StoryScriptScenePlan, document: StoryDocument): string {
  return exportStoryScript(
    { ...document, scenes: { ...document.scenes, [SCENE_ID]: plan.scene } },
    [SCENE_ID],
    exportOptions
  );
}

function edit(document: StoryDocument, mutate: (lines: string[]) => void): StoryScriptScenePlan {
  const lines = exportStoryScript(document, [SCENE_ID], exportOptions).split("\n");
  mutate(lines);
  return planOf(lines.join("\n"), document);
}

function textOf(block: StoryBlock | undefined): StoryTextSegment | null {
  if (!block) {
    return null;
  }
  if (block.kind === "note") {
    return block.payload.text;
  }
  if (block.kind === "nodeAction" && "text" in block.payload) {
    return block.payload.text;
  }
  return null;
}

describe("story script export", () => {
  it("writes the shapes the format promises, and only anchors the roundtrip mode", () => {
    const document = fixture();
    const text = exportStoryScript(document, [SCENE_ID], exportOptions);
    const body = text.split("\n").filter((line) => line.includes("⟦"));

    expect(body[0]).toBe("早上好 ⟦1⟧");
    expect(body[1]).toBe("Alice: 你好 ⟦2⟧");
    expect(body[2]).toBe("// 给译者的备注 ⟦3⟧");
    expect(body[3]).toBe("» action label ⟦4⟧");
    expect(body[4]).toBe("» nodeAction label ⟦5⟧");
    expect(body[5]).toBe("  - 跟他打招呼 ⟦6⟧");
    expect(text).toContain("#nlscript 1");
    expect(text).toContain(`#story ${STORY_ID}`);
    expect(text).toContain("#datahash ");
    expect(text).toContain("#data\n");
  });

  it("is byte-stable in review mode, and review mode carries no anchors and no snapshot", () => {
    const document = fixture();
    const options: StoryScriptExportOptions = { ...exportOptions, mode: "review" };
    const first = exportStoryScript(document, [SCENE_ID], options);
    const second = exportStoryScript(document, [SCENE_ID], options);

    expect(first).toBe(second);
    expect(first).not.toContain("⟦");
    expect(first).not.toContain("#data");
    expect(first).not.toContain("#origin");
    expect(first).toContain("Alice: 你好");
    // Deliberately not importable: with no snapshot there is nothing to restore an action from.
    const parsed = parseStoryScript(first);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("dataMissing");
    }
  });
});

describe("story script merge rules", () => {
  it("takes an untouched row verbatim from the snapshot", () => {
    const document = fixture();
    const plan = edit(document, () => {});

    expect(plan.scene).toEqual(document.scenes[SCENE_ID]);
    expect(plan.stats).toEqual({
      unchanged: 7,
      edited: 0,
      added: 0,
      removed: 0,
      cloned: 0,
      moved: 0
    });
    expect(plan.diagnostics).toEqual([]);
    expect(plan.stale).toBe(false);
    expect(plan.missing).toBe(false);
  });

  it("keeps the block id AND the textId when the words change", () => {
    const document = fixture();
    const plan = edit(document, (lines) => {
      lines[anchorIndex(lines, 1)] = "早上好，你今天来得真早 ⟦1⟧";
    });

    const before = document.scenes[SCENE_ID].blocks[N1];
    const after = plan.scene.blocks[N1];
    expect(after.id).toBe(N1);
    expect(textOf(after)?.textId).toBe(textOf(before)?.textId);
    expect(textOf(after)?.value).toBe("早上好，你今天来得真早");
    expect(textOf(after)?.rich).toBeUndefined();
    expect(after.kind).toBe(before.kind);
    expect(plan.stats.edited).toBe(1);
    expect(plan.stats.unchanged).toBe(6);
  });

  it("keeps the action and drops the edit when a » row was rewritten as prose", () => {
    const document = fixture();
    const plan = edit(document, (lines) => {
      lines[anchorIndex(lines, 4)] = "我把这行改成了散文 ⟦4⟧";
    });

    expect(plan.scene.blocks[A1]).toEqual(document.scenes[SCENE_ID].blocks[A1]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "shapeMismatchAction", severity: "error" })
    );
    expect(plan.stats.edited).toBe(0);
  });

  it("keeps the text and drops the edit when a prose row was rewritten as a » line", () => {
    const document = fixture();
    const plan = edit(document, (lines) => {
      lines[anchorIndex(lines, 1)] = "» 我把这行改成了动作 ⟦1⟧";
    });

    // The other direction of the same refusal, and a different sentence: the row that survived is
    // text, not an action, so a message naming an action would describe the wrong half of the file.
    expect(plan.scene.blocks[N1]).toEqual(document.scenes[SCENE_ID].blocks[N1]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "shapeMismatchText", severity: "error" })
    );
    expect(plan.stats.edited).toBe(0);
  });

  it("gives every copy after the first a fresh id and a fresh textId", () => {
    const document = fixture();
    const plan = edit(document, (lines) => {
      const at = anchorIndex(lines, 1);
      lines.splice(at + 1, 0, lines[at]);
    });

    const original = plan.scene.blocks[N1];
    const clone = Object.values(plan.scene.blocks).find(
      (target) => target.id !== N1 && textOf(target)?.value === "早上好"
    );
    expect(original.id).toBe(N1);
    expect(textOf(original)?.textId).toBe("t1");
    expect(clone).toBeDefined();
    expect(isValidStoryEntityId(clone?.id)).toBe(true);
    // Two rows cannot share a translation unit or a voice take, so the copy gets its own.
    expect(textOf(clone as StoryBlock)?.textId).not.toBe("t1");
    expect(isValidStoryEntityId(textOf(clone as StoryBlock)?.textId)).toBe(true);
    expect(plan.stats.cloned).toBe(1);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "duplicateAnchor", severity: "warning" })
    );
  });

  it("drops a line whose anchor names nothing in the snapshot", () => {
    const document = fixture();
    const plan = edit(document, (lines) => {
      lines[anchorIndex(lines, 1)] = "幽灵行 ⟦99⟧";
    });

    expect(plan.scene.blocks[N1]).toBeUndefined();
    expect(Object.keys(plan.scene.blocks)).toHaveLength(6);
    expect(plan.stats.removed).toBe(1);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unknownAnchor", severity: "error" })
    );
  });

  it("creates a row with fresh UUID v4 ids for an unanchored prose line", () => {
    const document = fixture();
    const plan = edit(document, (lines) => {
      lines.splice(anchorIndex(lines, 1) + 1, 0, "作者新写的一行");
    });

    const created = Object.values(plan.scene.blocks).find(
      (target) => textOf(target)?.value === "作者新写的一行"
    );
    expect(created).toBeDefined();
    expect(isValidStoryEntityId(created?.id)).toBe(true);
    expect(isValidStoryEntityId(textOf(created as StoryBlock)?.textId)).toBe(true);
    expect(textOf(created as StoryBlock)?.role).toBe("narration");
    expect(plan.scene.rootBlockIds[1]).toBe(created?.id);
    expect(plan.stats.added).toBe(1);
    expect(plan.diagnostics).toEqual([]);
  });

  it("creates nothing for an unanchored » line", () => {
    const document = fixture();
    const plan = edit(document, (lines) => {
      lines.splice(anchorIndex(lines, 1) + 1, 0, "» 背景 → forest_day");
    });

    expect(Object.keys(plan.scene.blocks)).toHaveLength(7);
    expect(plan.stats.added).toBe(0);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "opaqueWithoutAnchor", severity: "error" })
    );
  });

  it("removes a row whose line is gone", () => {
    const document = fixture();
    const plan = edit(document, (lines) => {
      lines.splice(anchorIndex(lines, 3), 1);
    });

    expect(plan.scene.blocks[NT1]).toBeUndefined();
    expect(plan.scene.rootBlockIds).toEqual([N1, D1, A1, C1, J1]);
    expect(plan.stats.removed).toBe(1);
    // N1, D1 and the option keep their position; the three roots after the gap shifted up, which
    // is a move, not an edit.
    expect(plan.stats.unchanged).toBe(3);
    expect(plan.stats.moved).toBe(3);
  });

  it("rebuilds the tree from the indentation and counts the difference as moved", () => {
    const document = fixture();
    const plan = edit(document, (lines) => {
      const first = anchorIndex(lines, 1);
      const second = anchorIndex(lines, 2);
      [lines[first], lines[second]] = [lines[second], lines[first]];
    });

    expect(plan.scene.rootBlockIds).toEqual([D1, N1, NT1, A1, C1, J1]);
    expect(plan.stats.moved).toBe(2);
    expect(plan.stats.unchanged).toBe(5);
    expect(plan.stats.edited).toBe(0);
    expect(plan.diagnostics).toEqual([]);
  });

  it("never lets a jump row take children, however the author indented under it", () => {
    const document = fixture();
    const plan = edit(document, (lines) => {
      const note = lines.splice(anchorIndex(lines, 3), 1)[0];
      lines.splice(anchorIndex(lines, 7) + 1, 0, `  ${note}`);
    });

    expect(plan.scene.blocks[J1].childrenIds).toEqual([]);
    expect(plan.scene.blocks[NT1].parentId).toBeNull();
    expect(plan.scene.rootBlockIds).toEqual([N1, D1, A1, C1, J1, NT1]);
    // `assembleScene` asserts this internally; stating it here is what makes the guarantee visible.
    expect(() => assertStoryScriptSceneValid(plan.scene)).not.toThrow();
  });

  it("drops a new option that has no choice to belong to", () => {
    const document = fixture();
    const plan = edit(document, (lines) => {
      lines.splice(anchorIndex(lines, 1) + 1, 0, "- 无处安放的选项");
    });

    expect(Object.keys(plan.scene.blocks)).toHaveLength(7);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unplaceableLine", severity: "error" })
    );
  });
});

/**
 * The three states a display name cannot describe.
 *
 * Import asks "did the author change this label?", never "what does this label resolve to?" - because
 * `character -> display name` is neither total (a deleted character prints nothing) nor injective (two
 * characters may share a name, and a temp speaker may be spelled like one). Every case below is a file
 * the author did not touch, so the only correct outcome is no outcome at all.
 */
describe("story script speakers on an untouched round trip", () => {
  it("keeps a row bound to a character that no longer exists", () => {
    const document = withSpeaker(fixture(), { characterId: GHOST });
    const text = exportStoryScript(document, [SCENE_ID], exportOptions);
    // Nothing can print a name for a deleted character, so the line carries an empty label.
    expect(text).toContain(": 你好 ⟦2⟧");

    const plan = planOf(text, document);
    const after = plan.scene.blocks[D1];
    expect(
      after.kind === "nodeAction" &&
        after.payload.action === "dialogue" &&
        after.payload.characterId
    ).toBe(GHOST);
    expect(
      after.kind === "nodeAction" &&
        after.payload.action === "dialogue" &&
        "speakerName" in after.payload
    ).toBe(false);
    expect(plan.scene).toEqual(document.scenes[SCENE_ID]);
    expect(plan.stats).toEqual({
      unchanged: 7,
      edited: 0,
      added: 0,
      removed: 0,
      cloned: 0,
      moved: 0
    });
    expect(reexport(plan, document)).toBe(text);
  });

  it("keeps the binding when another character shares the display name", () => {
    const document = withSpeaker(fixture(), { characterId: ALICE_TWIN });
    const text = exportStoryScript(document, [SCENE_ID], exportOptions);
    expect(text).toContain("Alice: 你好 ⟦2⟧");

    const plan = planOf(text, document);
    const after = plan.scene.blocks[D1];
    // Rebinding to the first Alice would take her appearance and her voice takes with it.
    expect(
      after.kind === "nodeAction" &&
        after.payload.action === "dialogue" &&
        after.payload.characterId
    ).toBe(ALICE_TWIN);
    expect(plan.scene).toEqual(document.scenes[SCENE_ID]);
    expect(plan.stats.edited).toBe(0);
    expect(reexport(plan, document)).toBe(text);
  });

  it("leaves a temp speaker unbound even when a character is named the same", () => {
    const document = withSpeaker(fixture(), { speakerName: "Alice" });
    const text = exportStoryScript(document, [SCENE_ID], exportOptions);
    expect(text).toContain("Alice: 你好 ⟦2⟧");

    const plan = planOf(text, document);
    const after = plan.scene.blocks[D1];
    expect(
      after.kind === "nodeAction" &&
        after.payload.action === "dialogue" &&
        after.payload.speakerName
    ).toBe("Alice");
    expect(
      after.kind === "nodeAction" &&
        after.payload.action === "dialogue" &&
        "characterId" in after.payload
    ).toBe(false);
    expect(plan.scene).toEqual(document.scenes[SCENE_ID]);
    expect(plan.stats.edited).toBe(0);
    expect(reexport(plan, document)).toBe(text);
  });

  it("never unbinds a character over an empty label, even with no labeller to compare against", () => {
    const document = withSpeaker(fixture(), { characterId: GHOST });
    const text = exportStoryScript(document, [SCENE_ID], exportOptions);
    const plan = planOf(text, document, { speakerLabel: null });

    const after = plan.scene.blocks[D1];
    expect(
      after.kind === "nodeAction" &&
        after.payload.action === "dialogue" &&
        after.payload.characterId
    ).toBe(GHOST);
    expect(plan.stats.edited).toBe(0);
  });
});

describe("story script speakers", () => {
  it("rebinds a dialogue row when the label resolves to another character", () => {
    const document = fixture();
    const plan = edit(document, (lines) => {
      lines[anchorIndex(lines, 2)] = "早苗: 你好 ⟦2⟧";
    });

    const after = plan.scene.blocks[D1];
    expect(
      after.kind === "nodeAction" &&
        after.payload.action === "dialogue" &&
        after.payload.characterId
    ).toBe(SANAE);
    expect(textOf(after)?.textId).toBe("t2");
    expect(textOf(after)?.value).toBe("你好");
    expect(plan.stats.edited).toBe(1);
  });

  it("carries an unknown label as a temp speaker and clears the character", () => {
    const document = fixture();
    const plan = edit(document, (lines) => {
      lines[anchorIndex(lines, 2)] = "？？？: 你好 ⟦2⟧";
    });

    const after = plan.scene.blocks[D1];
    expect(
      after.kind === "nodeAction" &&
        after.payload.action === "dialogue" &&
        after.payload.speakerName
    ).toBe("？？？");
    expect(
      after.kind === "nodeAction" &&
        after.payload.action === "dialogue" &&
        "characterId" in after.payload
    ).toBe(false);
  });

  it("reports a speaker change it can see when no resolver was supplied, and ignores it", () => {
    const document = fixture();
    // A bare `speakerName` is the one label this file can recompute on its own.
    document.scenes[SCENE_ID].blocks[D1] = makeBlock(D1, "nodeAction", {
      action: "dialogue",
      speakerName: "旁白甲",
      text: segment("t2", "你好", "dialogue")
    });
    const lines = exportStoryScript(document, [SCENE_ID], exportOptions).split("\n");
    lines[anchorIndex(lines, 2)] = "旁白乙: 你好，改过的台词 ⟦2⟧";
    const plan = planOf(lines.join("\n"), document, { resolver: null });

    const after = plan.scene.blocks[D1];
    expect(
      after.kind === "nodeAction" &&
        after.payload.action === "dialogue" &&
        after.payload.speakerName
    ).toBe("旁白甲");
    // The text edit on the same line still lands - only the speaker is refused.
    expect(textOf(after)?.value).toBe("你好，改过的台词");
    expect(textOf(after)?.textId).toBe("t2");
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "speakerUnresolved", severity: "warning" })
    );
  });

  it("leaves a character-bound row alone, silently, when no resolver was supplied", () => {
    const document = fixture();
    const lines = exportStoryScript(document, [SCENE_ID], exportOptions).split("\n");
    lines[anchorIndex(lines, 2)] = "早苗: 你好，改过的台词 ⟦2⟧";
    const plan = planOf(lines.join("\n"), document, { resolver: null });

    const after = plan.scene.blocks[D1];
    // The label was a display name this file cannot recompute, so the change is undetectable -
    // and the binding survives, which is the only outcome that cannot lose a voice take.
    expect(
      after.kind === "nodeAction" &&
        after.payload.action === "dialogue" &&
        after.payload.characterId
    ).toBe(ALICE);
    expect(textOf(after)?.value).toBe("你好，改过的台词");
    expect(plan.diagnostics).toEqual([]);
  });
});

describe("story script parse failures", () => {
  it("refuses a file with no #nlscript header", () => {
    const parsed = parseStoryScript("早上好\nAlice: 你好\n");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("notAScript");
    }
  });

  it("refuses a snapshot that does not match its #datahash", () => {
    const document = fixture();
    const text = exportStoryScript(document, [SCENE_ID], exportOptions);
    const corrupt = text.replace('"runtimeName": "scene_1"', '"runtimeName": "scene_2"');
    expect(corrupt).not.toBe(text);

    const parsed = parseStoryScript(corrupt);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("dataCorrupt");
    }
  });

  it("tolerates a text editor rewriting the line endings", () => {
    const document = fixture();
    const text = exportStoryScript(document, [SCENE_ID], exportOptions);
    const parsed = parseStoryScript(`${text.replace(/\n/g, "\r\n")}\r\n`);
    expect(parsed.ok).toBe(true);
  });

  it("refuses a version it does not know", () => {
    const parsed = parseStoryScript("#nlscript 2\n#story x\n");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("unsupportedVersion");
    }
  });
});

describe("story script staleness", () => {
  it("flags a scene the author changed since the export", () => {
    const document = fixture();
    const text = exportStoryScript(document, [SCENE_ID], exportOptions);
    const live = fixture();
    live.scenes[SCENE_ID].name = "第一场（改名）";

    const plan = planOf(text, document, { live });
    expect(plan.stale).toBe(true);
    expect(plan.missing).toBe(false);
    // Not an error: the plan still describes exactly what importing would write.
    expect(plan.diagnostics).toEqual([]);
  });

  it("flags a scene the live document no longer has", () => {
    const document = fixture();
    const text = exportStoryScript(document, [SCENE_ID], exportOptions);
    const live = fixture();
    live.scenes = {};

    const plan = planOf(text, document, { live });
    expect(plan.missing).toBe(true);
    expect(plan.stale).toBe(false);
  });

  it("reports whether the file belongs to the open story", () => {
    const document = fixture();
    const text = exportStoryScript(document, [SCENE_ID], exportOptions);
    const parsed = parseStoryScript(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const other = fixture();
    other.id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9";
    expect(
      planStoryScriptImport({ script: parsed.script, live: document, generateId: idFactory() })
        .storyMatches
    ).toBe(true);
    expect(
      planStoryScriptImport({ script: parsed.script, live: other, generateId: idFactory() })
        .storyMatches
    ).toBe(false);
  });
});

describe("story script digest", () => {
  it("matches the published FNV-1a 64 vectors", () => {
    expect(storyScriptDigest("")).toBe("cbf29ce484222325");
    expect(storyScriptDigest("a")).toBe("af63dc4c8601ec8c");
    expect(storyScriptDigest("foobar")).toBe("85944171f73967e8");
  });

  it("changes with the content and not with the encoding of the same content", () => {
    expect(storyScriptDigest("早上好")).not.toBe(storyScriptDigest("早上号"));
    expect(storyScriptDigest("早上好")).toHaveLength(16);
  });
});

describe("story script scene validity", () => {
  it("refuses a scene a jump has children in", () => {
    const document = fixture();
    const scene = document.scenes[SCENE_ID];
    scene.blocks[J1].childrenIds = [NT1];
    expect(() => assertStoryScriptSceneValid(scene)).toThrow(/jump block/);
  });

  it("refuses a scene whose parent and child disagree", () => {
    const document = fixture();
    const scene = document.scenes[SCENE_ID];
    scene.blocks[O1].parentId = N1;
    expect(() => assertStoryScriptSceneValid(scene)).toThrow(/does not agree/);
  });

  it("refuses a scene with a block no parent claims", () => {
    const document = fixture();
    const scene = document.scenes[SCENE_ID];
    scene.rootBlockIds = scene.rootBlockIds.filter((id) => id !== N1);
    expect(() => assertStoryScriptSceneValid(scene)).toThrow(/in no parent's children/);
  });
});
