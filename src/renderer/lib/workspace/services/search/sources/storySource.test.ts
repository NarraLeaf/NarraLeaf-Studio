import { describe, expect, it } from "vitest";
import { extractStoryEntries } from "./storySource";
import { indexEntries, querySearchIndex } from "../searchIndexModel";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { StoryBlock, StoryDocument } from "@shared/types/story";

function dialogueBlock(
  id: string,
  text: string,
  speaker?: { characterId?: string; speakerName?: string }
): StoryBlock {
  return {
    id,
    kind: "nodeAction",
    parentId: null,
    childrenIds: [],
    payload: {
      action: "dialogue",
      ...speaker,
      text: { value: text, textId: `t-${id}`, role: "dialogue" }
    }
  } as StoryBlock;
}

function storyDoc(): StoryDocument {
  return {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    id: "story-1",
    name: "Main Story",
    entrySceneId: "scene-1",
    chapters: [{ id: "ch-1", name: "Chapter 1", sceneIds: ["scene-1"] }],
    scenes: {
      "scene-1": {
        id: "scene-1",
        name: "Opening",
        runtimeName: "opening",
        rootBlockIds: ["b1", "b2", "b3", "v1", "sv1"],
        blocks: {
          // Bound to a Studio character: its speaker is the character's display name.
          b1: dialogueBlock("b1", "Good morning, Inko!", { characterId: "c1" }),
          b2: {
            id: "b2",
            kind: "jump",
            parentId: null,
            childrenIds: [],
            payload: {}
          } as unknown as StoryBlock,
          // A speaker with no Studio character behind it, carried as a bare name.
          b3: dialogueBlock("b3", "Good morning to you too.", { speakerName: "Passer-by" }),
          v1: {
            id: "v1",
            kind: "declaration",
            parentId: null,
            childrenIds: [],
            payload: { scope: "scene", name: "Affection", valueType: "number", storageKey: "v1" }
          } as StoryBlock,
          sv1: {
            id: "sv1",
            kind: "declaration",
            parentId: null,
            childrenIds: [],
            payload: { scope: "saved", name: "Route Flag", valueType: "boolean", storageKey: "sv1" }
          } as StoryBlock
        }
      }
    }
  } as unknown as StoryDocument;
}

const resolveCharacterName = (characterId: string) => (characterId === "c1" ? "Inko" : undefined);

describe("extractStoryEntries", () => {
  const entries = extractStoryEntries(storyDoc(), { resolveCharacterName });

  it("indexes block prose with story › scene context and a block jump target", () => {
    const prose = entries.find((e) => e.group === "storyText");
    expect(prose).toMatchObject({
      text: "Good morning, Inko!",
      detail: "Main Story › Opening",
      target: { kind: "storyBlock", storyId: "story-1", sceneId: "scene-1", blockId: "b1" }
    });
  });

  it("skips blocks without a text segment", () => {
    expect(entries.filter((e) => e.group === "storyText")).toHaveLength(2);
  });

  // The reported failure: typing a scene's name returned the lines inside it and never the scene.
  it("indexes the scene itself, so its name navigates to the scene", () => {
    const scene = entries.find((e) => e.group === "scene");
    expect(scene).toMatchObject({
      text: "Opening",
      detail: "Main Story",
      target: { kind: "storyScene", storyId: "story-1", sceneId: "scene-1" }
    });
  });

  it("keeps the runtime name searchable without showing it", () => {
    const scene = entries.find((e) => e.group === "scene");
    expect(scene?.aux).toBe("opening");
  });

  it("indexes the story itself, landing on its flow map", () => {
    expect(entries.find((e) => e.group === "story")).toMatchObject({
      text: "Main Story",
      target: { kind: "storyFlow", storyId: "story-1" }
    });
  });

  it("ranks the scene above its own lines for a query that matches both", () => {
    const groups = querySearchIndex(indexEntries(entries), "opening");
    expect(groups[0]?.group).toBe("scene");
  });

  it("indexes scene variable declarations as variable entries jumping to their row", () => {
    const sceneVar = entries.find((e) => e.text === "Affection");
    expect(sceneVar).toMatchObject({
      group: "variable",
      target: { kind: "storyBlock", sceneId: "scene-1", blockId: "v1" }
    });
  });

  it("indexes saved variable declarations against their declaring row", () => {
    const savedVar = entries.find((e) => e.text === "Route Flag");
    expect(savedVar).toMatchObject({
      group: "variable",
      target: { kind: "storyBlock", sceneId: "scene-1", blockId: "sv1" }
    });
  });

  it("keeps the text segment id on the entry so translations and takes can be joined onto the line", () => {
    expect(entries.find((e) => e.group === "storyText")?.fields?.textId).toBe("t-b1");
  });
});

/**
 * `speaker:` read `fields.speaker`, and no extractor had ever set it - the filter matched nothing in
 * the shipping app, and passed in tests only because the fixtures were hand-built entries. These
 * assertions run the real extractor, which is the difference that matters.
 */
describe("extractStoryEntries: the speaker facet", () => {
  it("names the Studio character a line is bound to", () => {
    const entries = extractStoryEntries(storyDoc(), { resolveCharacterName });
    expect(entries.find((e) => e.id.endsWith(":b1"))?.fields?.speaker).toBe("Inko");
  });

  it("carries a bare typed speaker for a line with no character behind it", () => {
    const entries = extractStoryEntries(storyDoc(), { resolveCharacterName });
    expect(entries.find((e) => e.id.endsWith(":b3"))?.fields?.speaker).toBe("Passer-by");
  });

  it("falls back to the bare name when the character id resolves to nothing", () => {
    // No resolver at all: a caller with no cast to hand still gets whatever the document says.
    const entries = extractStoryEntries(storyDoc());
    expect(entries.find((e) => e.id.endsWith(":b1"))?.fields?.speaker).toBeUndefined();
    expect(entries.find((e) => e.id.endsWith(":b3"))?.fields?.speaker).toBe("Passer-by");
  });

  it("leaves narration and declarations without a speaker", () => {
    const entries = extractStoryEntries(storyDoc(), { resolveCharacterName });
    expect(entries.find((e) => e.text === "Affection")?.fields?.speaker).toBeUndefined();
  });

  it("actually filters extracted entries - the regression", () => {
    const entries = indexEntries(extractStoryEntries(storyDoc(), { resolveCharacterName }));
    const inko = querySearchIndex(entries, "morning speaker:Inko").find(
      (g) => g.group === "storyText"
    );
    expect(inko?.hits.map((h) => h.entry.text)).toEqual(["Good morning, Inko!"]);

    const passerBy = querySearchIndex(entries, "morning speaker:passer").find(
      (g) => g.group === "storyText"
    );
    expect(passerBy?.hits.map((h) => h.entry.text)).toEqual(["Good morning to you too."]);

    expect(querySearchIndex(entries, "morning speaker:nobody")).toEqual([]);
  });
});
