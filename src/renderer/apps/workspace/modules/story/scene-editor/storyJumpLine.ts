import type { StoryBlock, StoryScene, StorySceneId } from "@shared/types/story";
import { noStoryRowCharacters } from "@/lib/story/storyRowProjection";
import { ACTION_TRIGGER, toDisplayedCommandLine } from "./commandTrigger";
import { projectStoryCommandLine } from "./storyCommandLine";

/**
 * The `/jump` line that would take the run to `targetSceneId`, spelled the way the author writes it.
 *
 * Derived by projecting a jump block rather than by concatenating strings, so the verb follows the
 * author's command language, the scene name is quoted by the same rule a committed row is, and a
 * `/jump` that grows a parameter tomorrow needs no second writer here. The scene flow map hands this
 * to the editor as a line to be typed, not as a block to be inserted — the author still has to press
 * Enter — so it has to be text an author could have typed themselves.
 *
 * `trigger` is the key this author actually presses (`editor.slashAtAlias`); only the first character
 * ever differs, and the commit path folds it back to "/" whichever they use.
 */
export function writeStoryJumpLine(
  targetSceneId: StorySceneId,
  scenes: Record<StorySceneId, StoryScene>,
  trigger: "/" | "@" = ACTION_TRIGGER
): string {
  // A scene deleted between the gesture and this call. The projection would name it with the row's
  // "unknown scene" placeholder — right on a row REPORTING a broken jump, wrong here, where it
  // would put words nobody wrote into a line the author is one keystroke from committing. The
  // empty string is the refusal; callers open no slot at all rather than a broken one.
  if (!scenes[targetSceneId]) {
    return "";
  }
  const block: StoryBlock = {
    // Never inserted and never persisted: the projection reads `kind` and `payload` and nothing
    // else, and the block the author's Enter creates is built fresh by the command spec.
    id: "story-jump-line-draft",
    kind: "jump",
    parentId: null,
    childrenIds: [],
    payload: { targetSceneId }
  };
  const projection = projectStoryCommandLine(block, { character: noStoryRowCharacters, scenes });
  if (!projection) {
    return "";
  }
  return toDisplayedCommandLine(projection.source, trigger);
}
