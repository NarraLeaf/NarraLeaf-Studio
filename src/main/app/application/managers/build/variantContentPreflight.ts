import path from "path";
import {
  collectInertCutPoints,
  collectUncutForks,
  collectVariantCutPoints
} from "@shared/story/cutPointChecks";
import {
  isBuiltinAppTagId,
  resolveAppTag,
  resolveAppTagEndingSurface,
  type ProjectAppTagDocument
} from "@shared/types/appTag";
import type { BuildPreflightFinding } from "@shared/types/gameBuild";
import type { StoryDocument, StoryLibraryIndex } from "@shared/types/story";
import { Fs } from "@shared/utils/fs";
import { isValidStoryId } from "@shared/utils/storyId";

/**
 * What a build variant's cut points come to, asked before the author presses Build.
 *
 * # Why these three are preflight findings and not build gates
 *
 * The split between the two is stated once, here, because this is the first round that had to
 * choose. **A condition whose report needs per-row story detail belongs in the unconditional gate
 * chain** (`BuildService.start`): that chain runs in the renderer, over the documents the editor is
 * holding, so it can print a scene name beside the row and the words the author typed on it. **A
 * condition that is a property of the project's configuration belongs here**: it fits the dialog's
 * `detail` record, and - the part that earns it - it is on screen while the author is still choosing
 * what to build, rather than after they have committed to a build that then refuses.
 *
 * All three below are configuration facts about one variant: this variant's rows do nothing, this
 * variant has nowhere to land, this variant's routes disagree. Each names a scene so the author can
 * go and look, and none of them needs the row's own text to be understood.
 *
 * The two that stayed gates - an entry the build cannot decide, and `AppTag` compared with something
 * that is not a literal - are on the other side of that line: both quote the author's own expression
 * or name the blueprint node, and both read documents the main process has no loaded copy of.
 *
 * # Why the release variant is skipped entirely
 *
 * The release build is the whole project by construction: it honours no cut point, so it cannot have
 * an inert one, cannot end early, and cannot have a route that ends while its sibling does not. That
 * is also what keeps this off the common path - a release build reads no story document here at all.
 */

/** One story as this check reads it. The authored document, before any fold. */
type PreflightStory = { id: string; name: string; document: StoryDocument };

/**
 * How many cut point rows are named individually before the list stops.
 *
 * A finding per row, capped, rather than one finding with a count: each names a different scene to
 * go and open, and the first handful is what an author acts on. A project with more of them has one
 * mistake repeated, not fifty.
 */
const REPORTED_ROW_LIMIT = 10;

export type VariantContentPreflightInput = {
  projectPath: string;
  /** The variant being built. Absent is the release variant, which this check has nothing to say about. */
  appTagId: string | undefined;
  /** The variants document as preflight already read it. Never re-read here. */
  appTagDocument: ProjectAppTagDocument;
};

/**
 * Every content finding this variant's cut points produce.
 *
 * Answers an empty list for anything it could not read, deliberately. A story index that is not
 * there is a project with no stories; a document that will not parse is already the packer's to
 * report, and a dialog that refused a build over a file it merely failed to open would be refusing
 * on the strength of a question it never asked.
 */
export async function collectVariantContentFindings(
  input: VariantContentPreflightInput
): Promise<BuildPreflightFinding[]> {
  const tag = resolveAppTag(input.appTagDocument.tags, input.appTagId);
  if (isBuiltinAppTagId(tag.id)) {
    return [];
  }
  const stories = await readStories(input.projectPath);
  if (stories.length === 0) {
    return [];
  }

  const findings: BuildPreflightFinding[] = [];
  let cutting = false;
  let reportedRows = 0;

  for (const story of stories) {
    if (collectVariantCutPoints(story.document, tag.id).some((cut) => cut.removes)) {
      cutting = true;
    }
    for (const inert of collectInertCutPoints(story.document, tag.id)) {
      if (reportedRows >= REPORTED_ROW_LIMIT) {
        break;
      }
      reportedRows += 1;
      findings.push({
        code: "cut-point-inert",
        severity: "error",
        section: "content",
        detail: { variant: tag.name, story: story.name, scene: inert.sceneName }
      });
    }
  }

  // Only a variant that actually shortens the story. One that cuts nothing runs to the same end
  // the release build does, so there is nothing extra for it to land on.
  const ending = resolveAppTagEndingSurface(tag, input.appTagDocument.endingSurfaceId);
  if (cutting && !ending.value && !ending.overridden) {
    findings.push({
      code: "variant-ending-missing",
      severity: "error",
      section: "content",
      detail: { variant: tag.name }
    });
  }

  let reportedForks = 0;
  for (const story of stories) {
    for (const fork of collectUncutForks(story.document, tag.id)) {
      if (reportedForks >= REPORTED_ROW_LIMIT) {
        break;
      }
      reportedForks += 1;
      findings.push({
        code: "variant-branch-uncut",
        severity: "warning",
        section: "content",
        // The fork's scene and nothing more. How many of its routes are uncut is on the
        // model for a caller that wants it, and the sentence is the same either way.
        detail: { variant: tag.name, story: story.name, scene: fork.sceneName }
      });
    }
  }
  return findings;
}

/**
 * Every story the project holds, read off disk.
 *
 * Read here rather than through the bundle assembler, which folds and drops scenes on the way: this
 * check is about the rows the author wrote, and a document that had already had this variant's cut
 * points applied to it would have no cut points left to measure.
 */
async function readStories(projectPath: string): Promise<PreflightStory[]> {
  const index = await readJson<StoryLibraryIndex>(
    path.join(projectPath, "editor", "story", "index.json")
  );
  const entries = Array.isArray(index?.stories) ? index.stories : [];
  const stories: PreflightStory[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isValidStoryId(entry.id) || seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    const document = await readJson<StoryDocument>(
      path.join(projectPath, "editor", "story", "stories", entry.id, "storydoc.json")
    );
    if (document?.id === entry.id) {
      stories.push({ id: entry.id, name: entry.name, document });
    }
  }
  return stories;
}

/** Null for anything that is not there or will not parse; see the note on the exported function. */
async function readJson<T>(filePath: string): Promise<T | null> {
  const result = await Fs.read(filePath, "utf-8");
  if (!result.ok) {
    return null;
  }
  try {
    return JSON.parse(result.data) as T;
  } catch {
    return null;
  }
}
