import type { TranslationKey } from "@shared/i18n";
import { factoryLayerNameKey } from "@shared/types/ui-editor/ownerLabels";
import { resolveBlueprintNodeTitle } from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";
import type { LintLocation } from "./types";

/** The translator a location is spelled with. Optional: without one, stored words are printed as stored. */
export type LintLocationTranslate = (key: TranslationKey) => string;

type BlueprintLintLocation = Extract<LintLocation, { kind: "blueprint" }>;

/**
 * A blueprint location's layer, as the member tree names it: a layer Studio seeded under the title of
 * the event that starts it (`factoryLayerNameKey`), any other under the name the author gave it.
 * Empty for a layer with no name.
 */
export function blueprintLocationLayerLabel(location: BlueprintLintLocation, translate?: LintLocationTranslate): string {
    const name = location.layerName ?? "";
    const key = location.graphId ? factoryLayerNameKey(location.graphId, name) : undefined;
    return key && translate ? translate(key) : name;
}

/** A blueprint location's node, by the title its card shows; empty when the finding names no node. */
export function blueprintLocationNodeLabel(location: BlueprintLintLocation, translate?: LintLocationTranslate): string {
    if (!location.nodeTitle) {
        return "";
    }
    return translate ? resolveBlueprintNodeTitle(location.nodeTitle, translate) : location.nodeTitle;
}

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
export function describeLintLocation(location: LintLocation, translate?: LintLocationTranslate): string {
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
        // The layer and the node: one blueprint holds several findings of one rule, and its name
        // alone printed them as the same line.
        case "blueprint":
            return [
                location.blueprintName ?? location.blueprintId,
                blueprintLocationLayerLabel(location, translate),
                blueprintLocationNodeLabel(location, translate),
            ].filter(Boolean).join(LINT_LOCATION_SEPARATOR);
        case "surface":
            return location.elementName
                ? `${location.surfaceName}${LINT_LOCATION_SEPARATOR}${location.elementName}`
                : location.surfaceName;
        case "component":
            return location.elementName
                ? `${location.componentName}${LINT_LOCATION_SEPARATOR}${location.elementName}`
                : location.componentName;
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
    return segments.filter(segment => !message.includes(segment)).join(LINT_LOCATION_SEPARATOR);
}
