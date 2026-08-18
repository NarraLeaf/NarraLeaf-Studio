import { describe, expect, it } from "vitest";
import { compileStudioStoryToNlr } from "./storyCompiler";
import type { StoryDocument } from "@shared/types/story";

/**
 * A save restores element state by element id. The engine names elements by their position in a
 * walk of the action tree unless the host names them, and a position moves the moment a line is
 * written ahead of it - so the id in an old save would still exist and would mean a different
 * element. That failure is silent, which is why it is worth a test of its own.
 */

const BACKGROUND = "11111111-1111-4111-8111-111111111111";

function narration(id: string, text: string) {
  return {
    kind: "nodeAction",
    id,
    parentId: null,
    childrenIds: [],
    payload: { action: "narration", text: { textId: `${id}-text`, role: "narration", value: text } }
  };
}

function background(id: string) {
  return {
    kind: "action",
    id,
    parentId: null,
    childrenIds: [],
    payload: { action: "setBackground", assetId: BACKGROUND }
  };
}

function document(): StoryDocument {
  return {
    schemaVersion: 16,
    id: "story-1",
    name: "Story",
    scenes: {
      "scene-a": {
        id: "scene-a",
        name: "One",
        runtimeName: "one",
        rootBlockIds: ["a1"],
        blocks: { a1: narration("a1", "first") }
      },
      "scene-b": {
        id: "scene-b",
        name: "Two",
        runtimeName: "two",
        rootBlockIds: ["b1"],
        blocks: { b1: narration("b1", "second") }
      }
    }
  } as unknown as StoryDocument;
}

/** `elementId -> the state a save would carry for it`, as the engine would serialize it. */
async function elementStates(doc: StoryDocument): Promise<Map<string, string>> {
  const compiled = await compileStudioStoryToNlr({
    document: doc,
    sceneId: "scene-a",
    resolveAssetUrl: (assetId: string) => `test://${assetId}`
  } as Parameters<typeof compileStudioStoryToNlr>[0]);
  const story = compiled.story as unknown as {
    constructStory(): unknown;
    getAllElementStates(): { id: string; data?: unknown }[];
  };
  story.constructStory();
  return new Map(
    story.getAllElementStates().map((state) => [state.id, JSON.stringify(state.data ?? null)])
  );
}

describe("element ids", () => {
  it("names every element from the document rather than by position", async () => {
    const states = await elementStates(document());
    expect(states.size).toBeGreaterThan(0);
    expect([...states.keys()].filter((id) => /^e-\d+$/.test(id))).toEqual([]);
  });

  it("keeps each id pointing at the same element when a line is inserted ahead of it", async () => {
    const before = await elementStates(document());

    const edited = document();
    edited.scenes["scene-a"].blocks.a0 = background("a0") as never;
    edited.scenes["scene-a"].rootBlockIds.unshift("a0");
    const after = await elementStates(edited);

    // Every id the old save carries must still describe what it described. An id that survives
    // while its state changes shape is the corruption case, not a pass.
    const moved = [...before.keys()].filter(
      (id) => after.has(id) && after.get(id) !== before.get(id)
    );
    expect(moved).toEqual([]);
    expect([...before.keys()].filter((id) => !after.has(id))).toEqual([]);
  });

  it("names a scene's own background and layers after the scene", async () => {
    // Only the entry scene's elements appear: the walk follows the action tree, and nothing in
    // this document jumps to the second scene. That is the engine's reach, not a naming gap.
    const states = await elementStates(document());
    expect(states.has("nl:scene:scene-a:background")).toBe(true);
    expect(states.has("nl:scene:scene-a:layer:background")).toBe(true);
    expect(states.has("nl:scene:scene-a:layer:displayable")).toBe(true);
  });
});
