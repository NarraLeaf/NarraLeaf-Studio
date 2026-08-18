import type { StoryBlock, StoryDocument } from "../types/story";
import { listSceneBlocksInDocumentOrder, listScenesInDocumentOrder } from "../types/story";
import { storyExpressionMentionsAppTag } from "../types/story/expression";
import { collectBlockExpressions } from "./appTagFold";

/**
 * What the story says about the build variants, counted rather than resolved.
 *
 * The build dialog states the content boundary of the variant it is about to produce, and this is
 * where that number comes from. It counts what the author wrote rather than running the fold: the
 * fold also drops whole scenes, and it can only do that in the main process where the blueprints
 * are, so a renderer running half of it would print a number that is true of neither the dialog nor
 * the package. A count of the rows that decide the boundary is the same fact wherever it is read.
 */
export type AppTagStoryUsage = {
  /** How many cut points name each variant, by variant id. An id with none is absent. */
  cutPointsByTagId: Record<string, number>;
  /** How many rows across the project read `AppTag`, and so say something different per variant. */
  variantRows: number;
};

export function countAppTagStoryUsage(documents: readonly StoryDocument[]): AppTagStoryUsage {
  const cutPointsByTagId: Record<string, number> = {};
  let variantRows = 0;

  for (const document of documents) {
    for (const scene of listScenesInDocumentOrder(document)) {
      // A disabled subtree is compiled out, so it decides nothing about what a package
      // contains - the same rule the fold and the build gates already apply.
      for (const block of listSceneBlocksInDocumentOrder(scene, {
        skipSubtree: (b) => Boolean(b.disabled)
      })) {
        const cutTagId = cutPointTagId(block);
        if (cutTagId) {
          cutPointsByTagId[cutTagId] = (cutPointsByTagId[cutTagId] ?? 0) + 1;
        }
        if (
          collectBlockExpressions(block).some((expression) =>
            storyExpressionMentionsAppTag(expression.ast)
          )
        ) {
          variantRows += 1;
        }
      }
    }
  }
  return { cutPointsByTagId, variantRows };
}

function cutPointTagId(block: StoryBlock): string | null {
  if (block.kind !== "control" || block.payload.control !== "cut") {
    return null;
  }
  return block.payload.appTagId.trim() || null;
}
