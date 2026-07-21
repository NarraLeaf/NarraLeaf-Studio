/**
 * Word and line counts for a single story *scene*, used by the status bar to report the scene the
 * user is currently editing. Scoped to one scene so it stays cheap to recompute on edits.
 *
 * The two counts deliberately use the conventions the user already sees elsewhere:
 * - words match the dashboard's 字数 — text of dialogue and narration lines only.
 * - lines match the story editor / scene-tree "行": every block projects to exactly one line, so the
 *   count equals the scene's block count (see buildStorySceneTextProjection). This is the same
 *   number the story panel shows next to each scene as "N 行".
 * Comments in English per project convention.
 */

import { countWords } from "./wordCount";
import type { StoryBlockId, StoryScene } from "@shared/types/story";

export interface StoryTextStats {
    /** Author-facing word/字 count across every dialogue and narration line. */
    words: number;
    /** Editor lines: one per block, matching the scene-tree "行" count. */
    lines: number;
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
        if (block.kind === "nodeAction") {
            const payload = block.payload;
            if (payload.action === "narration") {
                stats.words += countWords(payload.text.value);
            } else if (payload.action === "dialogue") {
                stats.words += countWords(payload.text.value);
            }
        }
        for (const childId of block.childrenIds) {
            visit(childId);
        }
    };
    for (const rootId of scene.rootBlockIds) {
        visit(rootId);
    }
    return stats;
}
