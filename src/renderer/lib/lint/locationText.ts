import type { LintLocation } from "./types";

/**
 * How a finding's site is spelled, and when saying it would only repeat the sentence beside it.
 *
 * Shared by the two surfaces that print a finding as one line - the report tab's locator column and
 * the build console - because "is this location worth printing next to this message" has exactly one
 * right answer and two places that need it. It used to live in `BuildService`, where the report tab
 * could not reach it, and the report tab therefore stuttered: `dialog.png  dialog.png is not used
 * anywhere`.
 */

/** Joins a composite location; the same string takes one apart again. */
export const LINT_LOCATION_SEPARATOR = " / ";

/**
 * The site as a reader would name it, on one line; empty for a project-wide finding, which has no
 * site. A story row ends in `:12`, the number the scene editor's gutter prints for it - the same
 * `path:line` a compiler writes, and the only thing that tells two findings of one rule in one scene
 * apart in a build log.
 *
 * The report tab does not use this: it has a column for the row number and knows the project's own
 * name, so it spells a location its own way (`lintLocationLabel`).
 */
export function describeLintLocation(location: LintLocation): string {
  switch (location.kind) {
    case "project":
      return "";
    case "asset":
      return location.assetName;
    case "story": {
      const scene = location.sceneName
        ? `${location.storyName}${LINT_LOCATION_SEPARATOR}${location.sceneName}`
        : location.storyName;
      return location.line === undefined ? scene : `${scene}:${location.line}`;
    }
    case "blueprint":
      return location.blueprintName ?? location.blueprintId;
    case "surface":
      return location.elementName
        ? `${location.surfaceName}${LINT_LOCATION_SEPARATOR}${location.elementName}`
        : location.surfaceName;
    case "character":
      return location.characterName;
  }
}

/**
 * What is left of a location once the message has had its say - which for some rules is nothing.
 *
 * Most rules now state a predicate and leave the subject to the locator ("Jumps to ending, which
 * this scene never declares"), but a few genuinely name their own subject inside the sentence:
 * `assets/unused` says "dialog.png is not used anywhere", and `assets/missing` names the referring
 * field, which is finer than the location it is filed under. Printing the site beside one of those
 * reads as a stutter.
 *
 * Dropping the whole thing would be too blunt for a composite one: `Demo / At the Station` beside a
 * message that only said "At the Station" still carries the story name, which the sentence has no
 * room for and the reader has no other way to get. So each segment is judged on its own and only the
 * ones the message already said are dropped.
 *
 * Substring matching, deliberately: what makes a segment redundant is that the reader has already
 * read it, not that the message equals it. `{location}` params like "Narra (profile.thumbnail)"
 * carry the site with a suffix, and that is still a repeat of "Narra".
 */
export function nonRedundantLintLocation(location: string, message: string): string {
  if (!location || message.includes(location)) {
    return "";
  }
  const segments = location.split(LINT_LOCATION_SEPARATOR);
  if (segments.length < 2) {
    // Nothing to take apart, and the whole of it is new: print it.
    return location;
  }
  return segments.filter((segment) => !message.includes(segment)).join(LINT_LOCATION_SEPARATOR);
}
