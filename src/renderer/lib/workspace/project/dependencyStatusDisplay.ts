/**
 * How a plugin dependency's status is written and coloured, shared by every surface that shows one.
 *
 * Two surfaces show this today - Project ▸ App's dependency list and the build dialog's Content
 * section - and they are describing the same fact about the same table. Kept here rather than in
 * either of them because the failure mode of two copies is not a broken build but a quiet one: the
 * same plugin reading "incompatible" in one place and "outdated" in the other, with nothing to say
 * which is true.
 */

import type { DependencyResolutionEntry, DependencyStatus } from "@shared/types/pluginDependencies";
import type { TranslationKey } from "@shared/i18n";

/**
 * Colour for the word, and only for the word.
 *
 * There used to be a coloured dot in front of every plugin's name as well. A green one on a plugin
 * that is simply fine says nothing the row does not already say, and a column of them reads as a
 * service dashboard rather than a list of plugins. The rows that need attention now say so in one
 * place instead of two.
 */
const DEPENDENCY_STATUS_TEXT_STYLES: Record<DependencyStatus, string> = {
    satisfied: "text-success",
    outdated: "text-warning",
    missing: "text-danger",
    incompatible: "text-danger",
};

const DEPENDENCY_STATUS_LABEL_KEYS: Record<DependencyStatus, TranslationKey> = {
    satisfied: "project.dependencies.status.ready",
    outdated: "project.dependencies.status.outdated",
    missing: "project.dependencies.status.missing",
    incompatible: "project.dependencies.status.incompatible",
};

/** How one plugin's state is written beside its name. */
export interface DependencyStateDisplay {
    labelKey: TranslationKey;
    /** Colour for the word - see {@link DEPENDENCY_STATUS_TEXT_STYLES}. */
    className: string;
}

/** The part of a resolution entry a row needs to write its state. */
export type DependencyStateInput = Pick<DependencyResolutionEntry, "installedEnabled">
    & Partial<Pick<DependencyResolutionEntry, "status" | "suppressed">>;

/**
 * The state word for one plugin, or null when the row needs none.
 *
 * A satisfied plugin that is loaded needs no word beside it: the row already names it and its
 * version, and "Ready" on every line is a column of noise that hides the one line that is not.
 *
 * Three of the four cases are about versions; the switched-off one is not, and it is the reason
 * this decision is a function rather than a table lookup. A plugin the author switched off is
 * installed, compatible, and contributes nothing - its nodes, widgets and actions are unknown
 * types in this project exactly as if it were absent - so the row has to say so instead of
 * reading "Ready". It is written after the author's own switch, because the word for the version
 * verdict is already taken by a state Studio decides on its own.
 */
export function describeDependencyState(entry: DependencyStateInput): DependencyStateDisplay | null {
    const { status, suppressed, installedEnabled } = entry;
    // Before the first resolve there is no verdict to write - the table names what the project
    // depends on, and nothing more.
    if (!status) {
        return null;
    }
    if (suppressed) {
        return { labelKey: "project.dependencies.status.disabled", className: DEPENDENCY_STATUS_TEXT_STYLES[status] };
    }
    if (installedEnabled === false) {
        // Nothing loads, which is what `missing` looks like from inside the project.
        return { labelKey: "project.dependencies.status.switchedOff", className: "text-danger" };
    }
    if (status !== "satisfied") {
        return { labelKey: DEPENDENCY_STATUS_LABEL_KEYS[status], className: DEPENDENCY_STATUS_TEXT_STYLES[status] };
    }
    return null;
}
