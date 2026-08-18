import type { DocumentDiffEntry } from "@shared/documents/diff";
import type { DocumentKind } from "@shared/documents/types";
import type { TranslationKey } from "@shared/i18n";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";

/**
 * Which part of the project a changed file belongs to.
 *
 * A comparison arrives as a flat list of paths, and a flat list is what makes a large one
 * unreadable: forty files in tree order interleave a chapter, a palette and eighty asset records.
 * The category is the heading an author already thinks in - the panels they edit these things in -
 * so the same forty files read as "story: 3, assets: 36".
 *
 * **Derived from what already exists, never from a second path table.** The classification runs off
 * {@link DocumentKind}, which the diff producer already resolved through the document registry, and
 * falls back to {@link ProjectNameConvention} - the one declaration of where a project keeps things.
 * A private list of path prefixes here would be a copy of that layout with nothing keeping the two in
 * step, and a copy that drifts silently files an author's story under "Other".
 */
export type ChangeCategory =
  | "story"
  | "characters"
  | "interface"
  | "assets"
  | "localization"
  | "audio"
  | "settings"
  | "other";

/**
 * The order groups appear in, and it is fixed rather than by size.
 *
 * A list whose headings move depending on what the author happened to touch cannot be scanned
 * twice the same way. Roughly the order of the workspace's own panels, with the catch-all last.
 */
export const CHANGE_CATEGORY_ORDER: readonly ChangeCategory[] = [
  "story",
  "characters",
  "interface",
  "assets",
  "localization",
  "audio",
  "settings",
  "other"
];

/**
 * What each heading is called.
 *
 * Written as whole literals rather than built from the category id, so `documentDiffKeys.test.ts`
 * - which reads this directory looking for `documentDiff.*` strings - sees all eight and requires
 * them in both catalogues. A template string would put a prefix in front of it and nothing in front
 * of the author.
 */
export const CHANGE_CATEGORY_LABEL_KEY: Record<ChangeCategory, TranslationKey> = {
  story: "documentDiff.category.story",
  characters: "documentDiff.category.characters",
  interface: "documentDiff.category.interface",
  assets: "documentDiff.category.assets",
  localization: "documentDiff.category.localization",
  audio: "documentDiff.category.audio",
  settings: "documentDiff.category.settings",
  other: "documentDiff.category.other"
};

/**
 * Every document format, filed under the panel that edits it.
 *
 * A `Record` over the whole union rather than a switch with a default: adding a member to
 * {@link DocumentKind} fails to compile here, which is the only thing that stops a new format
 * arriving in the comparison as "Other" with nobody noticing.
 */
export const CHANGE_CATEGORY_BY_DOCUMENT_KIND: Record<DocumentKind, ChangeCategory> = {
  project: "settings",
  "story-index": "story",
  story: "story",
  "story-animation-index": "story",
  "story-animation": "story",
  "ui-document": "interface",
  "ui-graphs": "interface",
  /**
   * The persistent variable registry. Story rather than settings: it is a cross-cutting file on
   * disk, but the panel that edits it is the story's variables panel, and an author looking for
   * "the flag I added last night" looks under the story.
   */
  variables: "story",
  "audio-tracks": "audio",
  /**
   * What one save slot carries besides the engine's own record. Interface rather than story or
   * settings: the fields exist to be pins on the save nodes, and the only place they are edited
   * is the popover on a node card in the blueprint editor.
   */
  "save-schema": "interface",
  /**
   * The build variants the project ships as. Settings rather than assets: a variant names how the
   * project is built, and nothing in it is content the author writes.
   */
  "app-tags": "settings",
  brand: "settings",
  /**
   * The words the project spells on purpose. Settings rather than story: nothing in it is a line
   * the author wrote, and it is edited from the spellchecker's menu rather than from any panel.
   */
  dictionary: "settings",
  localization: "localization",
  "localization-keys": "localization",
  /** Voice lines are one recorded asset per text unit, and the author browses them as sound. */
  voice: "audio",
  "assets-metadata": "assets",
  "assets-groups": "assets",
  /** A shared blueprint is stored and browsed as an asset - `AssetType.Blueprint` is one. */
  blueprint: "assets",
  characters: "characters"
};

/**
 * A directory or file the project convention declares, and the heading it belongs under.
 *
 * Read for the paths a spec does not claim, which is most of what changes in a real project: the
 * bytes behind an asset, an icon, a script. Both `["editor", "story/"]` and
 * `["editor", "audio-tracks.json"]` shapes are handled by the same joining, so an entry is a
 * directory or a single file depending on what the convention says it is - not on a flag here.
 */
const CATEGORY_BY_CONVENTION_PATH: readonly (readonly [readonly string[], ChangeCategory])[] = [
  [ProjectNameConvention.EditorStory, "story"],
  [ProjectNameConvention.EditorVariableRegistry, "story"],
  [ProjectNameConvention.EditorUI, "interface"],
  [ProjectNameConvention.EditorLocalization, "localization"],
  [ProjectNameConvention.EditorVoice, "audio"],
  [ProjectNameConvention.EditorAudioTracks, "audio"],
  [ProjectNameConvention.EditorBrand, "settings"],
  [ProjectNameConvention.Assets, "assets"],
  [ProjectNameConvention.ProjectResources, "assets"],
  [ProjectNameConvention.ProjectConfig, "settings"],
  [ProjectNameConvention.Scripts, "other"],
  [ProjectNameConvention.PuppetRuntimes, "other"],
  [ProjectNameConvention.NLCache, "other"],
  // Last of the `editor/` entries, so the ones above win for their own subtrees: what is left is
  // the service stores and anything a future milestone puts beside them, all of it project setup.
  [ProjectNameConvention.Editor, "settings"]
];

/**
 * The convention's paths as prefixes, longest first.
 *
 * Longest first is what makes the table order-independent to write: `editor/story` is matched before
 * `editor`, whichever way round they are listed above, so nobody has to keep them sorted by hand for
 * the answer to stay right.
 */
const CATEGORY_PREFIXES: readonly (readonly [string, ChangeCategory])[] =
  CATEGORY_BY_CONVENTION_PATH.map(
    ([segments, category]) => [conventionPath(segments), category] as const
  ).sort((a, b) => b[0].length - a[0].length);

/** A convention entry as a comparable path: joined, forward slashes, no trailing separator. */
function conventionPath(segments: readonly string[]): string {
  return segments.join("/").replace(/\/+$/, "");
}

/**
 * Which heading a changed document belongs under.
 *
 * Total by construction: an unrecognised path is `other` rather than absent, because a comparison
 * that silently omits a file the author changed is the one failure this whole surface exists to
 * prevent.
 */
export function changeCategoryOf(
  entry: Pick<DocumentDiffEntry, "path" | "documentKind">
): ChangeCategory {
  if (entry.documentKind) {
    return CHANGE_CATEGORY_BY_DOCUMENT_KIND[entry.documentKind];
  }
  return categoryForPath(entry.path);
}

function categoryForPath(rawPath: string): ChangeCategory {
  // Windows separators are accepted for the reason `normalizeDocumentPath` accepts them: a caller
  // may hand over a host path, and a backslash must not decide what an author's file is called.
  const path = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
  for (const [prefix, category] of CATEGORY_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return category;
    }
  }
  return "other";
}
