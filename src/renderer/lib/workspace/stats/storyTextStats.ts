/**
 * Word and line counts for a single story *scene*, used by the status bar to report the scene the
 * user is currently editing. Scoped to one scene so it stays cheap to recompute on edits.
 *
 * The two counts deliberately use the conventions the user already sees elsewhere:
 * - words match the dashboard's 字数, by sharing its definition rather than restating it - see
 *   {@link countBlockWords}, which both counters call.
 * - lines match the story editor / scene-tree "行": every block projects to exactly one line, so the
 *   count equals the scene's block count (see buildStorySceneTextProjection). This is the same
 *   number the story panel shows next to each scene as "N 行".
 * Comments in English per project convention.
 */

import { countWords } from "./wordCount";
import type { StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";

export interface StoryTextStats {
  /** Author-facing word/字 count across every dialogue and narration line. */
  words: number;
  /** Editor lines: one per block, matching the scene-tree "行" count. */
  lines: number;
}

/**
 * Words in one block: the single definition of what counts as prose, shared by the status bar's
 * per-scene count and the dashboard's project total so the two can never drift apart.
 *
 * Everything the player reads counts - narration, dialogue, choice prompts and choice option
 * labels. Everything else a block can carry (variable names, command arguments, notes) is
 * machinery. A new text-bearing action must be added to the switch below, and doing so changes the
 * meaning of every recorded word total: bump `WORD_COUNT_BASIS` in `@shared/types/stats` with it.
 */
export function countBlockWords(block: StoryBlock): number {
  if (block.kind !== "nodeAction") {
    return 0;
  }
  const payload = block.payload;
  switch (payload.action) {
    case "narration":
    case "dialogue":
    case "choiceOption":
      return countWords(payload.text.value);
    case "choice":
      return payload.prompt ? countWords(payload.prompt.value) : 0;
  }
  return 0;
}

export function countSceneTextStats(scene: StoryScene): StoryTextStats {
  const stats: StoryTextStats = { words: 0, lines: 0 };
  const visited = new Set<StoryBlockId>();
  const visit = (blockId: StoryBlockId): void => {
    const block = scene.blocks[blockId];
    if (!block || visited.has(blockId)) {
      return;
    }
    visited.add(blockId);
    // Every block is one projected line — mirrors buildStorySceneTextProjection so the total
    // agrees with the "N 行" the story panel shows for this scene.
    stats.lines += 1;
    stats.words += countBlockWords(block);
    for (const childId of block.childrenIds) {
      visit(childId);
    }
  };
  for (const rootId of scene.rootBlockIds) {
    visit(rootId);
  }
  return stats;
}
