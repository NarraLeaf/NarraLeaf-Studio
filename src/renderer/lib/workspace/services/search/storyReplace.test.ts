import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services, type WorkspaceContext } from "../services";
import { applyStoryReplace, planForEdit, planStoryReplace } from "./storyReplace";
import { indexEntries, type SearchIndexEntry } from "./searchIndexModel";
import { compileMatcher, type TextMatchOptions } from "./textMatcher";

vi.mock("@/lib/app/writeFreeze", () => ({
  getProjectWriteFreeze: () => frozen
}));

let frozen: unknown = null;

const LABEL = { key: "workspace.history.entry.replaceText" as TranslationKey };
const PLAIN: TextMatchOptions = { caseSensitive: false, wholeWord: false, regex: false };

// ---------------------------------------------------------------------------
// A workspace just big enough to plan against
// ---------------------------------------------------------------------------

type BlockSpec = { id: string; text: string };

function narrationBlock(spec: BlockSpec): StoryBlock {
  return {
    id: spec.id,
    kind: "nodeAction",
    parentId: null,
    childrenIds: [],
    payload: {
      action: "narration",
      text: { textId: `t-${spec.id}`, value: spec.text, role: "narration" }
    }
  };
}

function scene(id: string, name: string, blocks: BlockSpec[]): StoryScene {
  return {
    id,
    name,
    runtimeName: id,
    rootBlockIds: blocks.map((block) => block.id),
    blocks: Object.fromEntries(blocks.map((block) => [block.id, narrationBlock(block)]))
  };
}

function storyDocument(id: string, name: string, scenes: StoryScene[]): StoryDocument {
  return {
    id,
    name,
    version: 1,
    chapters: [],
    scenes: Object.fromEntries(scenes.map((item) => [item.id, item]))
  } as unknown as StoryDocument;
}

/** The `storyText` entries the story source would have produced for these documents. */
function entriesFor(documents: readonly StoryDocument[]): SearchIndexEntry[] {
  const entries: SearchIndexEntry[] = [];
  for (const document of documents) {
    for (const sceneItem of Object.values(document.scenes)) {
      for (const blockId of sceneItem.rootBlockIds) {
        const block = sceneItem.blocks[blockId];
        const payload = block.payload as { action: string; text: { value: string } };
        entries.push({
          id: `story:${document.id}:${sceneItem.id}:${blockId}`,
          group: "storyText",
          text: payload.text.value,
          detail: `${document.name} › ${sceneItem.name}`,
          fields: {
            storyId: document.id,
            storyName: document.name,
            sceneId: sceneItem.id,
            sceneName: sceneItem.name
          },
          target: {
            kind: "storyBlock",
            storyId: document.id,
            sceneId: sceneItem.id,
            blockId,
            storyName: document.name,
            sceneName: sceneItem.name
          }
        });
      }
    }
  }
  return entries;
}

/**
 * A context over in-memory documents.
 *
 * The two services `storyReplace` reads are faked (a real `StoryService` wants a project on disk),
 * but {@link HistoryService} is the real one - the undo cycle is half of what is being tested here,
 * and `pushCommand` had no production caller before this feature.
 */
function makeContext(documents: StoryDocument[], entries?: SearchIndexEntry[]) {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const indexed = indexEntries(entries ?? entriesFor(documents));
  const history = new HistoryService();
  /** Every `updateBlocks` call, so "one write per story" is checkable rather than assumed. */
  const batches: Array<{ storyId: string; count: number }> = [];

  const storyService = {
    getStoryDocument(storyId: string): StoryDocument {
      const document = byId.get(storyId);
      if (!document) {
        throw new Error(`Story document not loaded: ${storyId}`);
      }
      return document;
    },
    updateBlocks(
      storyId: string,
      edits: readonly { sceneId: string; blockId: string; payload: StoryBlock["payload"] }[]
    ): void {
      const document = this.getStoryDocument(storyId);
      batches.push({ storyId, count: edits.length });
      for (const edit of edits) {
        document.scenes[edit.sceneId].blocks[edit.blockId].payload = edit.payload;
      }
    }
  };

  const searchService = { listEntries: () => indexed };

  const ctx = {
    project: {} as never,
    services: {
      get(id: Services) {
        if (id === Services.Story) return storyService;
        if (id === Services.Search) return searchService;
        if (id === Services.History) return history;
        throw new Error(`Unexpected service ${id}`);
      }
    }
  } as unknown as WorkspaceContext;

  history.setContext(ctx);
  return { ctx, history, batches, byId, documents };
}

function textOf(document: StoryDocument, sceneId: string, blockId: string): string {
  const payload = document.scenes[sceneId].blocks[blockId].payload as { text: { value: string } };
  return payload.text.value;
}

function matcher(query: string, overrides: Partial<TextMatchOptions> = {}) {
  return compileMatcher(query, { ...PLAIN, ...overrides });
}

beforeEach(() => {
  frozen = null;
});

// ---------------------------------------------------------------------------

describe("planStoryReplace", () => {
  it("plans across several scenes of several stories, counting occurrences and not rows", () => {
    const prologue = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [
        { id: "b1", text: "早上好，因子。" },
        // Two hits on one line: one index entry, two occurrences.
        { id: "b2", text: "早上好。早上好。" },
        { id: "b3", text: "晚上好。" }
      ]),
      scene("sc2", "Corridor", [{ id: "b4", text: "走廊里没有人。早上好？" }])
    ]);
    const side = storyDocument("s2", "Side", [
      scene("sc3", "Cafe", [{ id: "b5", text: "早上好，店长。" }])
    ]);
    const { ctx } = makeContext([prologue, side]);

    const plan = planStoryReplace(ctx, { matcher: matcher("早上好"), replacement: "早安" });

    expect(plan.applicable).toBe(true);
    expect(plan.occurrences).toBe(5);
    expect(plan.blockCount).toBe(4);
    expect(plan.sceneCount).toBe(3);
    expect(plan.storyCount).toBe(2);
    expect(plan.edits.find((edit) => edit.blockId === "b2")?.occurrences).toBe(2);
    expect(plan.edits.map((edit) => edit.after.value)).toEqual([
      "早安，因子。",
      "早安。早安。",
      "走廊里没有人。早安？",
      "早安，店长。"
    ]);
  });

  it("writes nothing while planning", () => {
    const document = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [{ id: "b1", text: "hello" }])
    ]);
    const { ctx, batches } = makeContext([document]);

    planStoryReplace(ctx, { matcher: matcher("hello"), replacement: "hi" });

    expect(batches).toEqual([]);
    expect(textOf(document, "sc1", "b1")).toBe("hello");
  });

  it("refuses the whole plan when any candidate has gone, and applies none of it", () => {
    const document = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [
        { id: "b1", text: "hello there" },
        { id: "b2", text: "hello again" }
      ])
    ]);
    const entries = entriesFor([document]);
    // The index still lists b3; the document no longer has it. This is the shape of every
    // "deleted a moment ago" race, and the author's ruling is that it stops the sweep.
    entries.push({
      ...entries[0],
      id: "story:s1:sc1:b3",
      text: "hello, gone",
      target: {
        kind: "storyBlock",
        storyId: "s1",
        sceneId: "sc1",
        blockId: "b3",
        storyName: "Prologue",
        sceneName: "Opening"
      }
    });
    const { ctx, batches } = makeContext([document], entries);

    const plan = planStoryReplace(ctx, { matcher: matcher("hello"), replacement: "hi" });

    expect(plan.applicable).toBe(false);
    expect(plan.failures).toEqual([
      { reason: "blockMissing", storyId: "s1", sceneId: "sc1", blockId: "b3" }
    ]);
    // The two live edits were still computed - the panel can say what it would have done - but
    // nothing is written.
    expect(plan.edits).toHaveLength(2);
    expect(applyStoryReplace(ctx, plan, LABEL)).toBe(false);
    expect(batches).toEqual([]);
    expect(textOf(document, "sc1", "b1")).toBe("hello there");
    expect(textOf(document, "sc1", "b2")).toBe("hello again");
  });

  it("reports a scene, a story and a text-less block as failures too", () => {
    const document = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [{ id: "b1", text: "hello" }])
    ]);
    // A block that still exists but stopped carrying text: its action was changed since.
    document.scenes.sc1.blocks.b1 = {
      id: "b1",
      kind: "jump",
      parentId: null,
      childrenIds: [],
      payload: { targetSceneId: "sc1" }
    } as unknown as StoryBlock;
    const entries = entriesFor([
      storyDocument("s1", "Prologue", [
        scene("sc1", "Opening", [{ id: "b1", text: "hello" }]),
        scene("sc9", "Deleted", [{ id: "b9", text: "hello" }])
      ])
    ]);
    entries.push({
      ...entries[0],
      id: "story:s7:sc7:b7",
      target: {
        kind: "storyBlock",
        storyId: "s7",
        sceneId: "sc7",
        blockId: "b7",
        storyName: "Gone",
        sceneName: "Gone"
      }
    });
    const { ctx } = makeContext([document], entries);

    const plan = planStoryReplace(ctx, { matcher: matcher("hello"), replacement: "hi" });

    expect(plan.failures.map((failure) => failure.reason).sort()).toEqual([
      "noTextSegment",
      "sceneMissing",
      "storyMissing"
    ]);
    expect(plan.applicable).toBe(false);
  });

  it("skips a candidate the live document no longer matches, without failing the plan", () => {
    const document = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [
        { id: "b1", text: "hello there" },
        { id: "b2", text: "typed over" }
      ])
    ]);
    // The index's copy of b2 is up to a debounce stale: it still says "hello", the row does not.
    const entries = entriesFor([document]);
    entries[1] = { ...entries[1], text: "hello, stale" };
    const { ctx } = makeContext([document], entries);

    const plan = planStoryReplace(ctx, { matcher: matcher("hello"), replacement: "hi" });

    expect(plan.failures).toEqual([]);
    expect(plan.applicable).toBe(true);
    expect(plan.edits.map((edit) => edit.blockId)).toEqual(["b1"]);
  });

  it("rewrites from the live document, never from the index's stale copy", () => {
    const document = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [{ id: "b1", text: "hello, Inko, and welcome" }])
    ]);
    const entries = entriesFor([document]);
    entries[0] = { ...entries[0], text: "hello" };
    const { ctx } = makeContext([document], entries);

    const plan = planStoryReplace(ctx, { matcher: matcher("hello"), replacement: "hi" });

    expect(plan.edits[0].after.value).toBe("hi, Inko, and welcome");
  });

  it("narrows the scope by the caller's filters, so `scene:` limits a replace", () => {
    const document = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [{ id: "b1", text: "hello" }]),
      scene("sc2", "Corridor", [{ id: "b2", text: "hello" }])
    ]);
    const { ctx } = makeContext([document]);

    const plan = planStoryReplace(ctx, {
      matcher: matcher("hello"),
      replacement: "hi",
      filters: { sceneName: "corridor" }
    });

    expect(plan.edits.map((edit) => edit.blockId)).toEqual(["b2"]);
  });

  it("expands $1 per hit in regex mode", () => {
    const document = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [{ id: "b1", text: "call inko@studio and mika@studio" }])
    ]);
    const { ctx } = makeContext([document]);

    const plan = planStoryReplace(ctx, {
      matcher: matcher("(\\w+)@studio", { regex: true }),
      replacement: "<$1>"
    });

    expect(plan.occurrences).toBe(2);
    expect(plan.edits[0].after.value).toBe("call <inko> and <mika>");
  });

  it("finds nothing for a pattern that would not compile", () => {
    const document = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [{ id: "b1", text: "hello[" }])
    ]);
    const { ctx } = makeContext([document]);

    const plan = planStoryReplace(ctx, {
      matcher: matcher("[", { regex: true }),
      replacement: "x"
    });

    expect(plan.edits).toEqual([]);
    expect(plan.applicable).toBe(false);
  });

  it("leaves scene names alone even when the query is one", () => {
    const document = storyDocument("s1", "Prologue", [
      scene("sc1", "Corridor", [{ id: "b1", text: "The corridor is empty." }])
    ]);
    const entries = entriesFor([document]);
    // The scene entry the story source also emits. Only `storyText` is a candidate.
    entries.push({
      id: "sceneref:s1:sc1",
      group: "scene",
      text: "Corridor",
      fields: { storyId: "s1", sceneId: "sc1", sceneName: "Corridor" },
      target: {
        kind: "storyScene",
        storyId: "s1",
        sceneId: "sc1",
        storyName: "Prologue",
        sceneName: "Corridor"
      }
    });
    const { ctx } = makeContext([document], entries);

    const plan = planStoryReplace(ctx, { matcher: matcher("corridor"), replacement: "hallway" });

    expect(plan.blockCount).toBe(1);
    expect(plan.edits[0].after.value).toBe("The hallway is empty.");
    expect(document.scenes.sc1.name).toBe("Corridor");
  });
});

describe("applyStoryReplace", () => {
  it("writes one batch per story", () => {
    const one = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [{ id: "b1", text: "hello" }]),
      scene("sc2", "Corridor", [{ id: "b2", text: "hello" }])
    ]);
    const two = storyDocument("s2", "Side", [scene("sc3", "Cafe", [{ id: "b3", text: "hello" }])]);
    const { ctx, batches } = makeContext([one, two]);

    const plan = planStoryReplace(ctx, { matcher: matcher("hello"), replacement: "hi" });
    expect(applyStoryReplace(ctx, plan, LABEL)).toBe(true);

    // Two stories, two mutations - and therefore two `documentChanged` events, not three.
    expect(batches).toEqual([
      { storyId: "s1", count: 2 },
      { storyId: "s2", count: 1 }
    ]);
    expect(textOf(one, "sc1", "b1")).toBe("hi");
    expect(textOf(one, "sc2", "b2")).toBe("hi");
    expect(textOf(two, "sc3", "b3")).toBe("hi");
  });

  it("refuses to write while the workspace is frozen, and records no history", () => {
    const document = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [{ id: "b1", text: "hello" }])
    ]);
    const { ctx, history, batches } = makeContext([document]);
    const plan = planStoryReplace(ctx, { matcher: matcher("hello"), replacement: "hi" });

    frozen = { reason: "revision" };

    expect(applyStoryReplace(ctx, plan, LABEL)).toBe(false);
    expect(batches).toEqual([]);
    expect(history.canUndo(projectHistoryScope())).toBe(false);
  });

  it("replaces one row on its own, as its own undo step", () => {
    const document = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [
        { id: "b1", text: "hello" },
        { id: "b2", text: "hello" }
      ])
    ]);
    const { ctx, history } = makeContext([document]);
    const plan = planStoryReplace(ctx, { matcher: matcher("hello"), replacement: "hi" });

    expect(applyStoryReplace(ctx, planForEdit(plan.edits[1]), LABEL)).toBe(true);

    expect(textOf(document, "sc1", "b1")).toBe("hello");
    expect(textOf(document, "sc1", "b2")).toBe("hi");
    expect(history.undo(projectHistoryScope())).toBe(true);
    expect(textOf(document, "sc1", "b2")).toBe("hello");
  });
});

describe("applyStoryReplace - undo", () => {
  function twoStoryWorkspace() {
    const one = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [{ id: "b1", text: "hello there" }]),
      scene("sc2", "Corridor", [{ id: "b2", text: "say hello" }])
    ]);
    const two = storyDocument("s2", "Side", [
      scene("sc3", "Cafe", [{ id: "b3", text: "hello hello" }])
    ]);
    return { ...makeContext([one, two]), one, two };
  }

  it("undo, redo and undo again all restore the whole sweep in one press", () => {
    const { ctx, history, one, two } = twoStoryWorkspace();
    const plan = planStoryReplace(ctx, { matcher: matcher("hello"), replacement: "hi" });
    expect(plan.occurrences).toBe(4);
    expect(applyStoryReplace(ctx, plan, LABEL)).toBe(true);

    const scope = projectHistoryScope();
    const after = () => [
      textOf(one, "sc1", "b1"),
      textOf(one, "sc2", "b2"),
      textOf(two, "sc3", "b3")
    ];

    expect(after()).toEqual(["hi there", "say hi", "hi hi"]);

    expect(history.undo(scope)).toBe(true);
    expect(after()).toEqual(["hello there", "say hello", "hello hello"]);

    expect(history.redo(scope)).toBe(true);
    expect(after()).toEqual(["hi there", "say hi", "hi hi"]);

    expect(history.undo(scope)).toBe(true);
    expect(after()).toEqual(["hello there", "say hello", "hello hello"]);
  });

  it("leaves exactly one entry on the project stack for a sweep of any size", () => {
    const { ctx, history } = twoStoryWorkspace();
    const plan = planStoryReplace(ctx, { matcher: matcher("hello"), replacement: "hi" });
    applyStoryReplace(ctx, plan, LABEL);

    const scope = projectHistoryScope();
    expect(history.describe().find((entry) => entry.scopeId === scope)?.undo).toBe(1);
    expect(history.peekUndo(scope)).toEqual(LABEL);
    history.undo(scope);
    expect(history.canUndo(scope)).toBe(false);
  });

  it("rebuilds the payload from the live block, so a field changed since is not reverted", () => {
    const document = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [{ id: "b1", text: "hello" }])
    ]);
    // A dialogue row rather than narration, so the payload carries something besides its text.
    document.scenes.sc1.blocks.b1 = {
      id: "b1",
      kind: "nodeAction",
      parentId: null,
      childrenIds: [],
      payload: {
        action: "dialogue",
        speakerName: "Inko",
        text: { textId: "t-b1", value: "hello", role: "dialogue" }
      }
    } as unknown as StoryBlock;
    const { ctx, history } = makeContext([document]);

    const plan = planStoryReplace(ctx, { matcher: matcher("hello"), replacement: "hi" });
    applyStoryReplace(ctx, plan, LABEL);

    // The author renames the speaker after the replace. Replaying a stored payload would put
    // "Inko" back, silently, on an undo they asked for a different reason.
    const payload = document.scenes.sc1.blocks.b1.payload as { speakerName: string };
    payload.speakerName = "Mika";

    expect(history.undo(projectHistoryScope())).toBe(true);
    expect(textOf(document, "sc1", "b1")).toBe("hello");
    expect((document.scenes.sc1.blocks.b1.payload as { speakerName: string }).speakerName).toBe(
      "Mika"
    );
  });

  it("skips a block that has gone by undo time and still restores the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx, history, one, two } = twoStoryWorkspace();
    const plan = planStoryReplace(ctx, { matcher: matcher("hello"), replacement: "hi" });
    applyStoryReplace(ctx, plan, LABEL);

    delete one.scenes.sc2.blocks.b2;

    expect(history.undo(projectHistoryScope())).toBe(true);
    expect(textOf(one, "sc1", "b1")).toBe("hello there");
    expect(textOf(two, "sc3", "b3")).toBe("hello hello");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("records no entry when there is nothing to apply", () => {
    const document = storyDocument("s1", "Prologue", [
      scene("sc1", "Opening", [{ id: "b1", text: "hello" }])
    ]);
    const { ctx, history } = makeContext([document]);

    const plan = planStoryReplace(ctx, { matcher: matcher("nothing here"), replacement: "x" });

    expect(plan.applicable).toBe(false);
    expect(applyStoryReplace(ctx, plan, LABEL)).toBe(false);
    expect(history.canUndo(projectHistoryScope())).toBe(false);
  });
});
