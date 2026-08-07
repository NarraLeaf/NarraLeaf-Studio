/**
 * How a plugin dependency's status is written and coloured, shared by every surface that shows one.
 *
 * Two surfaces show this today - Project ▸ App's dependency list and the build dialog's Content
 * section - and they are describing the same fact about the same table. Kept here rather than in
 * either of them because the failure mode of two copies is not a broken build but a quiet one: the
 * same plugin reading "incompatible" in one place and "outdated" in the other, with nothing to say
 * which is true.
 */

import type { DependencyStatus } from "@shared/types/pluginDependencies";
import type { TranslationKey } from "@shared/i18n";

/**
 * Colour for the word, and only for the word.
 *
 * There used to be a coloured dot in front of every plugin's name as well. A green one on a plugin
 * that is simply fine says nothing the row does not already say, and a column of them reads as a
 * service dashboard rather than a list of plugins. The rows that need attention now say so in one
 * place instead of two.
 */
export const DEPENDENCY_STATUS_TEXT_STYLES: Record<DependencyStatus, string> = {
    satisfied: "text-success",
    outdated: "text-warning",
    missing: "text-danger",
    incompatible: "text-danger",
};

export const DEPENDENCY_STATUS_LABEL_KEYS: Record<DependencyStatus, TranslationKey> = {
    satisfied: "project.dependencies.status.ready",
    outdated: "project.dependencies.status.outdated",
    missing: "project.dependencies.status.missing",
    incompatible: "project.dependencies.status.incompatible",
};

/**
 * Whether a dependency is worth saying anything about.
 *
 * A satisfied, unsuppressed plugin needs no word beside it: the row already names it and its
 * version, and "Ready" on every line is a column of noise that hides the one line that is not.
 */
export function dependencyNeedsAttention(status: DependencyStatus, suppressed: boolean): boolean {
    return suppressed || status !== "satisfied";
}
