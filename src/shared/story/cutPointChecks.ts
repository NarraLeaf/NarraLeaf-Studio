import {
  listSceneBlocksInDocumentOrder,
  listScenesInDocumentOrder,
  type StoryDocument,
  type StorySceneId
} from "@shared/types/story";
import { collectCutPoints, type CutPointSite } from "./appTagFold";
import { reachableSceneIds } from "./storyReachability";

/**
 * What a variant's cut points come to, judged against the story they are written in.
 *
 * Two questions, both about the same rows and both answered here so the surfaces that report them
 * cannot drift from one another: does a given cut point do anything at all, and does the story reach
 * an ending this variant never cuts.
 *
 * # Why these are not one check
 *
 * A cut that removes nothing is a mistake with one right answer - the row is inert, the package is
 * the whole book, and the author has to move it or delete it. A fork with an uncut branch is not a
 * mistake at all in general: a demo that offers two routes and cuts one of them is a demo that ships
 * one route whole, which an author may perfectly well intend. So the first blocks and the second
 * only says so.
 *
 * # What is deliberately NOT here
 *
 * **"Every path that reaches an ending must have a cut point" is not a check and must never become
 * one.** A linear visual novel has exactly one path, correctly configured, and a rule of that shape
 * would stop its own author's build with nothing wrong. The only thing said here is the narrower
 * fact that a fork's branches disagree with one another - which is evidence the author meant to cut
 * both and reached only one - and it is said as a warning, never as a refusal.
 */

/** A fork whose branches disagree about whether this variant ends there. */
export type UncutForkSite = {
  storyId: string;
  storyName: string;
  /** The scene the routes part at. What an author opens to see both of them. */
  sceneId: StorySceneId;
  sceneName: string;
  /** How many of its branches never reach a cut point naming this variant. */
  uncutBranches: number;
};

/** Every cut point naming this variant that would take no shipped content with it. */
export function collectInertCutPoints(document: StoryDocument, appTagId: string): CutPointSite[] {
  return collectCutPoints(document).filter((cut) => cut.appTagId === appTagId && !cut.removes);
}

/** Every cut point naming this variant, inert ones included. */
export function collectVariantCutPoints(document: StoryDocument, appTagId: string): CutPointSite[] {
  return collectCutPoints(document).filter((cut) => cut.appTagId === appTagId);
}

/**
 * Every place the story parts into routes where some routes end for this variant and some do not.
 *
 * A fork is a scene that jumps to more than one other scene. Its branches are those targets, and a
 * branch "ends here" when any scene the story can reach from it holds a cut point naming this
 * variant. Reported only when the branches disagree: if none of them cuts, this variant simply does
 * not cut in this part of the story, which is a different fact and not this one.
 *
 * The reach of one branch is asked of {@link reachableSceneIds}, the single traversal, with the
 * document's own entry scene taken off the copy handed to it. That seed is unconditional in the
 * traversal - correctly, since every other caller wants where a story can start - and leaving it in
 * would make every branch reach the whole story and no fork ever disagree.
 */
export function collectUncutForks(document: StoryDocument, appTagId: string): UncutForkSite[] {
  const cutScenes = new Set(collectVariantCutPoints(document, appTagId).map((cut) => cut.sceneId));
  if (cutScenes.size === 0) {
    // Nothing to disagree with. A variant that cuts nowhere in this story is not a fork problem.
    return [];
  }
  // Entry seed removed rather than the traversal reimplemented; see the note above.
  const fromBranch: StoryDocument = { ...document, entrySceneId: undefined };
  const found: UncutForkSite[] = [];

  for (const scene of listScenesInDocumentOrder(document)) {
    const targets: StorySceneId[] = [];
    const blocks = listSceneBlocksInDocumentOrder(scene, {
      skipSubtree: (block) => Boolean(block.disabled)
    });
    for (const block of blocks) {
      const target = block.kind === "jump" ? block.payload.targetSceneId : undefined;
      // Distinct targets the document actually has: two rows jumping to the same scene are one
      // route, and a jump to a scene that is gone is not a route at all.
      if (target && document.scenes?.[target] && !targets.includes(target)) {
        targets.push(target);
      }
    }
    if (targets.length < 2) {
      continue;
    }
    let cutBranches = 0;
    let uncutBranches = 0;
    for (const target of targets) {
      const reach = reachableSceneIds(fromBranch, { entrySceneIds: [target], fallback: "none" });
      if ([...reach].some((sceneId) => cutScenes.has(sceneId))) {
        cutBranches += 1;
      } else {
        uncutBranches += 1;
      }
    }
    if (cutBranches > 0 && uncutBranches > 0) {
      found.push({
        storyId: document.id,
        storyName: document.name,
        sceneId: scene.id,
        sceneName: scene.name,
        uncutBranches
      });
    }
  }
  return found;
}
