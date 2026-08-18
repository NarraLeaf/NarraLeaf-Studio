import { listSceneBlocksInDocumentOrder, type StoryScene } from "@shared/types/story";
import { getStoryTextSegment } from "@/lib/story/storyRowProjection";
import type { LintContext, LintStoryEntry } from "./context";
import type { LintFinding, LintLocation } from "./types";

/**
 * Turning a block id into something an author can find: a row number, and the row's own words.
 *
 * **Why this is one function and not a field every rule fills in.** A rule knows the block it is
 * unhappy about; it does not know - and should not have to compute - where that block sits in the
 * scene. Twenty-seven rules each walking the document to count rows would be twenty-seven chances to
 * count differently, and the first rule written after this one would simply forget. So rules go on
 * naming a `blockId` and the engine resolves the pair on the way out, once per sweep.
 *
 * **The number is the editor's number.** `buildVisibleRows` numbers a scene by walking
 * `rootBlockIds` in order and descending into every child; `listSceneBlocksInDocumentOrder` walks
 * exactly the same tree the same way. Both count disabled rows, because the editor draws them. A
 * report that said "line 12" about a row the gutter calls 14 would be worse than one that said
 * nothing.
 */

/** Longest excerpt kept. Past this the row is clipped with an ellipsis; the report tab truncates further. */
const EXCERPT_MAX_CHARS = 64;

export type StoryRowLocation = { line: number; excerpt?: string };

/** Resolves `(storyId, sceneId, blockId)` to a row number, memoised per scene. */
export type StoryRowLocator = (
  storyId: string,
  sceneId: string,
  blockId: string
) => StoryRowLocation | null;

/**
 * One locator over a whole sweep.
 *
 * Scenes are indexed on first use rather than up front: a project can hold hundreds of scenes and a
 * clean sweep asks about none of them. Every scene that *is* asked about is walked once, which is
 * what keeps a rule that reports four hundred rows from being four hundred traversals.
 */
export function createStoryRowLocator(stories: readonly LintStoryEntry[]): StoryRowLocator {
  const byStory = new Map<string, LintStoryEntry>();
  for (const entry of stories) {
    byStory.set(entry.id, entry);
  }

  const indexed = new Map<string, Map<string, StoryRowLocation>>();

  const indexFor = (storyId: string, sceneId: string): Map<string, StoryRowLocation> | null => {
    const key = `${storyId}\u0000${sceneId}`;
    const cached = indexed.get(key);
    if (cached) {
      return cached;
    }
    const scene = byStory.get(storyId)?.document.scenes[sceneId];
    if (!scene) {
      return null;
    }
    const index = indexScene(scene);
    indexed.set(key, index);
    return index;
  };

  return (storyId, sceneId, blockId) => indexFor(storyId, sceneId)?.get(blockId) ?? null;
}

function indexScene(scene: StoryScene): Map<string, StoryRowLocation> {
  const index = new Map<string, StoryRowLocation>();
  listSceneBlocksInDocumentOrder(scene).forEach((block, position) => {
    const excerpt = excerptOf(block);
    index.set(block.id, excerpt ? { line: position + 1, excerpt } : { line: position + 1 });
  });
  return index;
}

/**
 * The row's text, whitespace flattened and clipped, or nothing.
 *
 * Deliberately the author's own string and not `describeStoryBlock`'s rendered line: a description
 * is prose in whatever language the sweep happened to run in, and this value is carried in a report
 * that outlives the sweep and is read in the language the reader picked afterwards. Dialogue is
 * dialogue in every locale.
 *
 * A segment whose whole content is an inline value (`{playerName}`) projects to an empty string -
 * the plain projection drops interpolation runs - and yields no excerpt, which beats an excerpt that
 * says nothing.
 */
function excerptOf(block: Parameters<typeof getStoryTextSegment>[0]): string | undefined {
  const value = getStoryTextSegment(block)?.value.replace(/\s+/g, " ").trim();
  if (!value) {
    return undefined;
  }
  return value.length > EXCERPT_MAX_CHARS ? `${value.slice(0, EXCERPT_MAX_CHARS - 1)}…` : value;
}

/**
 * A finding with its story location filled in, or the finding unchanged.
 *
 * Unchanged is the answer for everything that is not a story row, and also for a row whose scene has
 * since gone (a context built from one snapshot, a finding held from another): a missing number is a
 * missing number, and inventing one would put the reader on the wrong row.
 */
export function annotateStoryLocation<T extends { location: LintLocation }>(
  finding: T,
  locate: StoryRowLocator
): T {
  const location = finding.location;
  if (location.kind !== "story" || !location.sceneId || !location.blockId) {
    return finding;
  }
  const resolved = locate(location.storyId, location.sceneId, location.blockId);
  if (!resolved) {
    return finding;
  }
  return { ...finding, location: { ...location, ...resolved } };
}

/** Convenience for callers holding a whole context: `annotateStoryLocation` over a rule's output. */
export function annotateStoryLocations(
  ctx: LintContext,
  findings: readonly LintFinding[]
): LintFinding[] {
  const locate = createStoryRowLocator(ctx.stories);
  return findings.map((finding) => annotateStoryLocation(finding, locate));
}
