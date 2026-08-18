import { resolveAppTag, type ProjectAppTag } from "@shared/types/appTag";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { readProjectAppTagsFromDir } from "./appTagsFile";

/**
 * Which build variant a run of this project is meant to be.
 *
 * Read here rather than carried on each launch request, for the reason the build reads the variants
 * document itself: the answer decides bytes, and a value that travelled through the renderer would
 * be one the main process could not check. What travels instead is nothing - three IPC surfaces stay
 * exactly as they were.
 *
 * # Where the choice lives, and why it is not in the project
 *
 * A machine-level habit, bucketed by project, beside `ui.runMode`. "I am working on the demo this
 * afternoon" is a fact about one author's session, not about the project: stored in `.nlproj` it
 * would ride version control into a collaborator's checkout and quietly turn *their* Dev Mode into
 * the demo, with the only sign being content going missing from a run they did not configure.
 *
 * The bucket key is `normalizeProjectPath`, which is a comparison key and nothing else - it is never
 * shown and never stored as the project's identity. Two spellings of one path are one project (a
 * native picker answers with `\`, a scripted path usually carries `/`), and without that the setting
 * would silently split in two the first time a project was opened the other way.
 *
 * Comments in English per project convention.
 */
export const RUN_VARIANT_SETTINGS_KEY = "ui.runVariantByProject";

/** Reader for the global settings store, so this stays testable without an app. */
export type RunVariantSettingsReader = { get(key: string): unknown };

/**
 * The tag a run of `projectPath` should assemble as, or null for the release edition.
 *
 * Null is the answer to every kind of absence, and deliberately so: no setting, a project that has
 * since deleted the variant, an unreadable variants document. A run that cannot resolve the author's
 * choice must fall back to the whole game rather than to a guess - the failure mode of the other
 * direction is a run that silently withholds content.
 */
export async function resolveRunVariant(
  settings: RunVariantSettingsReader,
  projectPath: string
): Promise<ProjectAppTag | null> {
  const stored = settings.get(RUN_VARIANT_SETTINGS_KEY);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return null;
  }
  const tagId = (stored as Record<string, unknown>)[normalizeProjectPath(projectPath)];
  if (typeof tagId !== "string" || !tagId.trim()) {
    return null;
  }
  const tags = await readProjectAppTagsFromDir(projectPath).catch(() => [] as ProjectAppTag[]);
  const tag = resolveAppTag(tags, tagId.trim());
  // `resolveAppTag` answers the release tag for an id nothing matches, which is exactly the
  // fallback wanted - but the caller wants to know it is running the whole game, so say null
  // rather than hand back a tag that would make the assembly think a variant was chosen.
  return tags.some((candidate) => candidate.id === tag.id) ? tag : null;
}
