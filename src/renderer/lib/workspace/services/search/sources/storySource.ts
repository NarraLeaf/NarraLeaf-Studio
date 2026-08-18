import type { StoryBlock, StoryDocument, StoryId } from "@shared/types/story";
import {
  isStoryDeclarationBlock,
  listSceneBlocksInDocumentOrder,
  listScenesInDocumentOrder
} from "@shared/types/story";
import { getStoryTextSegment } from "@/lib/story/storyRowProjection";
import {
  richRunsToPlain,
  segmentToRuns
} from "@/apps/workspace/modules/story/scene-editor/richText";
import { Services } from "../../services";
import { StoryService } from "../../story/StoryService";
import { CharacterService } from "../../core/CharacterService";
import type { SearchEntryFields, SearchIndexEntry } from "../searchIndexModel";
import type { SearchSource } from "../searchSource";

export interface StoryExtractionOptions {
  /**
   * A Studio character's display name, for dialogue that names one.
   *
   * Injected rather than looked up, because the extractor is pure and the cast lives in a service.
   * Absent (a test, a caller with no cast) simply means a character-bound line falls back to its
   * bare `speakerName`, which is the only other name the document itself carries.
   */
  resolveCharacterName?: (characterId: string) => string | undefined;
}

/**
 * The speaker a dialogue line should be *filtered* by - a display name, never an id.
 *
 * `speaker:` is a name filter, so it has to hold the name a person would type. A line either names a
 * Studio character (whose name the dialogue box will show) or carries a bare typed one; a dangling
 * `characterId` falls through to whatever bare name is also on the payload rather than reporting
 * nothing at all.
 */
function dialogueSpeaker(
  block: StoryBlock,
  resolveCharacterName?: (characterId: string) => string | undefined
): string | undefined {
  if (block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
    return undefined;
  }
  const { characterId, speakerName } = block.payload;
  if (characterId) {
    const resolved = resolveCharacterName?.(characterId);
    if (resolved) {
      return resolved;
    }
  }
  return speakerName || undefined;
}

/**
 * Story slice: the story and its scenes as navigable entities, every block's prose
 * (dialogue/narration/choice/note text), and the story's variable declarations. Scenes land in
 * "scene" and the story itself in "story"; blocks land in "storyText"; declaration rows land in
 * "variable" (v6: the row IS the variable, whatever its scope, so every entry jumps straight to its
 * declaring row).
 *
 * The scene entry is what makes typing a scene name go to that scene instead of listing its lines:
 * it is a `scene`-group entry, and that group sorts above `storyText`.
 */
export function extractStoryEntries(
  document: StoryDocument,
  options: StoryExtractionOptions = {}
): SearchIndexEntry[] {
  const entries: SearchIndexEntry[] = [];
  const storyName = document.name;

  if (storyName) {
    entries.push({
      id: `storydoc:${document.id}`,
      group: "story",
      text: storyName,
      fields: { storyId: document.id, storyName },
      target: { kind: "storyFlow", storyId: document.id, storyName }
    });
  }

  // Ranking only reorders matches; everything that ties keeps index order, which is why both loops
  // walk the authored order rather than the records.
  for (const scene of listScenesInDocumentOrder(document)) {
    const context = `${storyName} › ${scene.name}`;
    const sceneFields: SearchEntryFields = {
      storyId: document.id,
      storyName,
      sceneId: scene.id,
      sceneName: scene.name
    };

    if (scene.name) {
      entries.push({
        id: `sceneref:${document.id}:${scene.id}`,
        group: "scene",
        text: scene.name,
        detail: storyName,
        // The runtime name is what a `/jump` writes, so authors do search for it.
        aux: scene.runtimeName && scene.runtimeName !== scene.name ? scene.runtimeName : undefined,
        fields: sceneFields,
        target: {
          kind: "storyScene",
          storyId: document.id,
          sceneId: scene.id,
          storyName,
          sceneName: scene.name
        }
      });
    }

    for (const block of listSceneBlocksInDocumentOrder(scene)) {
      if (isStoryDeclarationBlock(block)) {
        if (!block.payload.name) {
          continue;
        }
        entries.push({
          id: `storyvar:${document.id}:${scene.id}:${block.id}`,
          group: "variable",
          text: block.payload.name,
          detail: context,
          fields: sceneFields,
          target: {
            kind: "storyBlock",
            storyId: document.id,
            sceneId: scene.id,
            blockId: block.id,
            storyName,
            sceneName: scene.name
          }
        });
        continue;
      }
      const segment = getStoryTextSegment(block);
      if (!segment) {
        continue;
      }
      const text = richRunsToPlain(segmentToRuns(segment)).trim();
      if (!text) {
        continue;
      }
      const speaker = dialogueSpeaker(block, options.resolveCharacterName);
      entries.push({
        id: `story:${document.id}:${scene.id}:${block.id}`,
        group: "storyText",
        text,
        detail: context,
        fields: {
          ...sceneFields,
          ...(segment.textId ? { textId: segment.textId } : {}),
          ...(speaker ? { speaker } : {})
        },
        target: {
          kind: "storyBlock",
          storyId: document.id,
          sceneId: scene.id,
          blockId: block.id,
          storyName,
          sceneName: scene.name
        }
      });
    }
  }

  return entries;
}

/**
 * Every story, one slice each.
 *
 * The only partitioned source, and the reason partitioning exists at all: a keystroke in one story
 * must not re-extract the other twenty. `onLibraryChanged` is deliberately the coarse event -
 * creates and deletes change the slice set, and a *rename* changes the `story › scene` context line
 * baked into every entry of that story, so all three want the whole source resynced.
 *
 * No `dedupKey`: two lines that read identically are two lines the author may want to visit
 * separately, and collapsing them would turn "find every occurrence" into "find one of them".
 */
export const storySource: SearchSource<StoryId> = {
  id: "story",
  groups: ["story", "scene", "storyText", "variable"],
  dependsOn: [Services.Story, Services.Character],
  partition: async (ctx) => {
    const storyService = ctx.services.get<StoryService>(Services.Story);
    // Stories load lazily elsewhere; search needs the whole library once.
    await storyService.loadLibrary();
    return storyService.listStories().map((entry) => entry.id);
  },
  extract: async (ctx, storyId) => {
    const storyService = ctx.services.get<StoryService>(Services.Story);
    const characterService = ctx.services.get<CharacterService>(Services.Character);
    const document = await storyService.loadStory(storyId);
    return extractStoryEntries(document, {
      resolveCharacterName: (characterId) =>
        characterService.getCharacter(characterId)?.profile.getProfile().name || undefined
    });
  },
  watch: (ctx, signal) => {
    const storyService = ctx.services.get<StoryService>(Services.Story);
    const unsubs = [
      storyService.onDocumentChanged(({ storyId }) => signal.invalidate(storyId)),
      storyService.onLibraryChanged(() => signal.invalidateAll())
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }
};
