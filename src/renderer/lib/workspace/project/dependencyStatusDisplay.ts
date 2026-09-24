/**
 * How a plugin dependency's status is written and coloured, shared by every surface that shows one.
 *
 * Three surfaces show this today - Project ▸ App's dependency list, the build dialog's Content
 * section and the Plugins panel's dependency screen - and they are describing the same fact about
 * the same table. Kept here rather than in any of them because the failure mode of two copies is not
 * a broken build but a quiet one: the same plugin reading "incompatible" in one place and "outdated"
 * in the other, with nothing to say which is true.
 */

import type { DependencyResolutionEntry, DependencyStatus } from "@shared/types/pluginDependencies";
import type { PluralKey, TranslationKey } from "@shared/i18n";

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
    & Partial<Pick<DependencyResolutionEntry, "status" | "suppressed" | "installedStatus">>;

/**
 * Every state a dependency row can be in, in the order in which each one hides the next: a plugin
 * that is not installed is not also switched off, and one Studio holds back for its version would
 * not load if it were on.
 *
 * - `missing` - not installed here.
 * - `held` - installed at a different major from the one the project was made with, so Studio holds
 *   it back from the project until the author's Rescan.
 * - `needsAuthorization` - installed, and its permissions were never approved. Ahead of `disabled`,
 *   because a plugin whose grant was declined is switched off as well, and what the Plugins panel
 *   shows and offers for it is the authorization.
 * - `disabled` - the author switched it off.
 * - `failed` - switched on, and it failed to load.
 * - `outdated` / `incompatible` - loads, at a version older than the project's, or at another major
 *   for a data-only dependency that nothing holds back.
 * - `ready` - nothing to say.
 */
export type DependencyRowState =
    | "missing"
    | "held"
    | "needsAuthorization"
    | "disabled"
    | "failed"
    | "outdated"
    | "incompatible"
    | "ready";

/** Which state a row is in - see {@link DependencyRowState}. Null before the first resolve. */
export function classifyDependencyRow(entry: DependencyStateInput): DependencyRowState | null {
    const { status, suppressed, installedEnabled, installedStatus } = entry;
    if (!status) {
        return null;
    }
    // Ahead of `suppressed`, which a hard dependency on an absent plugin also sets: there is
    // nothing here for Studio to have withheld, and "Off for this project" sends the author to look
    // for a switch that does not exist. What they need to know is that the plugin is not installed.
    if (status === "missing") {
        return "missing";
    }
    if (suppressed) {
        return "held";
    }
    if (installedStatus === "needsAuthorization") {
        return "needsAuthorization";
    }
    if (installedEnabled === false) {
        return "disabled";
    }
    if (installedStatus === "error") {
        return "failed";
    }
    if (status === "outdated" || status === "incompatible") {
        return status;
    }
    return "ready";
}

/**
 * The state word for one plugin, or null when the row needs none.
 *
 * A satisfied plugin that is loaded needs no word beside it: the row already names it and its
 * version, and "Ready" on every line is a column of noise that hides the one line that is not.
 *
 * The words for the plugin's own state come from the Plugins panel rather than from here, because
 * that panel already names each fact and an author reads the two together: `disabled` is what it
 * writes beside the switch, `suppressed` is what it writes for the plugin Studio withheld from this
 * project, and waiting for authorization and failing to load are its status and its activity words.
 * This table used to spend the switch's word on the version verdict, so the one thing the author
 * had actually done was the one thing neither panel said.
 */
export function describeDependencyState(entry: DependencyStateInput): DependencyStateDisplay | null {
    switch (classifyDependencyRow(entry)) {
        case null:
        case "ready":
            return null;
        case "missing":
            return { labelKey: DEPENDENCY_STATUS_LABEL_KEYS.missing, className: DEPENDENCY_STATUS_TEXT_STYLES.missing };
        case "held":
            return { labelKey: "project.dependencies.status.suppressed", className: "text-danger" };
        case "needsAuthorization":
            return { labelKey: "plugins.status.needsAuthorization", className: "text-warning" };
        case "disabled":
            // Nothing loads, which is what `missing` looks like from inside the project.
            return { labelKey: "project.dependencies.status.disabled", className: "text-danger" };
        case "failed":
            return { labelKey: "plugins.workspace.activity.failed", className: "text-danger" };
        case "outdated":
            return { labelKey: DEPENDENCY_STATUS_LABEL_KEYS.outdated, className: DEPENDENCY_STATUS_TEXT_STYLES.outdated };
        case "incompatible":
            return {
                labelKey: DEPENDENCY_STATUS_LABEL_KEYS.incompatible,
                className: DEPENDENCY_STATUS_TEXT_STYLES.incompatible,
            };
    }
}

/** One sentence of the banner above the dependency list: a state, and how many rows are in it. */
export interface DependencyBannerLine {
    key: PluralKey;
    count: number;
}

export interface DependencyBanner {
    /** Danger while any plugin the project uses contributes nothing; a warning otherwise. */
    tone: "danger" | "warning";
    lines: DependencyBannerLine[];
}

const BANNER_KEYS: Record<Exclude<DependencyRowState, "ready">, PluralKey> = {
    missing: "project.dependencies.banner.missing",
    held: "project.dependencies.banner.held",
    needsAuthorization: "project.dependencies.banner.needsAuthorization",
    disabled: "project.dependencies.banner.disabled",
    failed: "project.dependencies.banner.failed",
    outdated: "project.dependencies.banner.outdated",
    incompatible: "project.dependencies.banner.incompatible",
};

/** The states in which the plugin contributes nothing to the project. */
const UNAVAILABLE: ReadonlySet<DependencyRowState> = new Set(["missing", "held", "needsAuthorization", "disabled", "failed"]);

/**
 * Whether the plugin this row names contributes nothing to the project as things stand.
 *
 * Deliberately narrower than "not satisfied": an outdated plugin loads, registers everything it
 * contributes, and the project works, so counting it would raise a warning with nothing to do about
 * it. What this asks is whether the author's own blueprint nodes, widgets and story rows have
 * quietly become unknown types - which they have in all five of absent, held back for its version,
 * waiting for its permissions, switched off, and failed to start.
 *
 * Derived from {@link classifyDependencyRow} rather than stated again, because the banner over the
 * dependency list is derived from it too. The two used to be written separately and the shorter one
 * left out the last two states, so a project whose only trouble was a plugin waiting for
 * authorization opened without a word while the banner below called it a problem in red.
 */
export function isDependencyUnavailable(entry: DependencyStateInput): boolean {
    const state = classifyDependencyRow(entry);
    return state !== null && UNAVAILABLE.has(state);
}

/**
 * The banner over the dependency list, or null when every row is ready.
 *
 * One sentence per state the rows are in, each saying what the state is and where it is put right.
 * It used to be one of two fixed sentences picked by the resolution's overall verdict, and the red
 * one said "installed version incompatible" for a plugin that was not installed at all - the
 * verdict is `blocked` for any hard dependency that is withheld, and an absent one is withheld too.
 * A banner that names a cause has to name the one the rows below it are actually in.
 */
export function describeDependencyBanner(entries: readonly DependencyStateInput[]): DependencyBanner | null {
    const counts = new Map<DependencyRowState, number>();
    for (const entry of entries) {
        const state = classifyDependencyRow(entry);
        if (state && state !== "ready") {
            counts.set(state, (counts.get(state) ?? 0) + 1);
        }
    }
    if (counts.size === 0) {
        return null;
    }
    const order = Object.keys(BANNER_KEYS) as Exclude<DependencyRowState, "ready">[];
    return {
        tone: [...counts.keys()].some(state => UNAVAILABLE.has(state)) ? "danger" : "warning",
        lines: order
            .filter(state => counts.has(state))
            .map(state => ({ key: BANNER_KEYS[state], count: counts.get(state)! })),
    };
}
