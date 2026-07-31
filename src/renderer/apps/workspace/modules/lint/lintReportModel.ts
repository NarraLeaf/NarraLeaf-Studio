import type { TranslationKey } from "@shared/i18n";
import {
    LINT_SEVERITY_ORDER,
    deriveLintRuleSlug,
    type LintLocation,
    type LintReportEntry,
    type LintRuleId,
    type LintSeverity,
} from "@/lib/lint";

/**
 * The lint report tab - everything about it that is not React.
 *
 * The tab renders a flat, windowed list, so all the shaping happens here: filter, group, order,
 * flatten. Two decisions worth knowing before editing:
 *
 *  - **Grouping is by RULE by default, not by location.** A project-wide sweep answers "what is
 *    wrong with this project", and the useful unit of that answer is the rule: twelve missing
 *    translations are one thing to go and do, not twelve unrelated problems scattered across twelve
 *    scenes. By location is the second reading (what is wrong with *this* scene), so it is a toggle
 *    rather than the default.
 *  - **Group order is worst-severity-first, then by title.** Not registry order and not category
 *    order: the reader is looking for what is broken, and a report that opened on `story/empty-scene`
 *    because "story" sorts before "variables" buries the errors under the notes.
 *
 * Nothing here resolves i18n itself - labels arrive as {@link LintGroupLabels} callbacks, so this
 * whole file is testable without a translator or a running workspace.
 */

export type LintGroupMode = "rule" | "location";

/** The severity filter, plus the "show everything" state the three severities cannot express. */
export type LintSeverityFilter = LintSeverity | "all";

export const LINT_GROUP_MODES: readonly LintGroupMode[] = ["rule", "location"] as const;

export const LINT_SEVERITY_FILTERS: readonly LintSeverityFilter[] = ["all", "error", "warning", "info"] as const;

export type LintEntryGroup = {
    /** Stable identity of the group within one grouping mode (rule id, or a location key). */
    key: string;
    title: string;
    /** Worst severity in the group; what the group sorts on and what its heading is coloured by. */
    severity: LintSeverity;
    entries: LintReportEntry[];
};

/** One rendered line: a group heading, or an entry under it. */
export type LintReportRow =
    | { kind: "group"; key: string; group: LintEntryGroup }
    | { kind: "entry"; key: string; group: LintEntryGroup; entry: LintReportEntry };

export type LintGroupLabels = {
    ruleTitle: (ruleId: LintRuleId) => string;
    locationLabel: (location: LintLocation) => string;
};

/** `lint.rule.<slug>.title` - the rule's own name, as the settings panel spells it. */
export function lintRuleTitleKey(ruleId: LintRuleId): TranslationKey {
    return `lint.rule.${deriveLintRuleSlug(ruleId)}.title` as TranslationKey;
}

export function lintSeverityLabelKey(severity: LintSeverity): TranslationKey {
    return `lint.severity.${severity}` as TranslationKey;
}

/**
 * A location as one readable line.
 *
 * `projectName` is what a project-scope finding is filed under. It is the project's own name rather
 * than a translated word like "Project" because that is the value the author recognises, and because
 * a heading that read "Project" would be the only heading in the list that named a category instead
 * of a thing.
 */
export function lintLocationLabel(location: LintLocation, projectName: string): string {
    switch (location.kind) {
        case "project":
            return projectName;
        case "asset":
            return location.assetName || location.assetId;
        case "story":
            return location.sceneName
                ? `${location.storyName} / ${location.sceneName}`
                : location.storyName;
        case "blueprint":
            return location.blueprintName || location.blueprintId;
        case "character":
            return location.characterName || location.characterId;
    }
}

/**
 * The identity a location groups by - coarser than the label, and coarser than the location itself.
 *
 * A scene is the finest grain worth a heading: keying on `blockId` too would produce a group per row
 * of dialogue, which is a list of one-item groups wearing a grouped list's clothes.
 */
export function lintLocationKey(location: LintLocation): string {
    switch (location.kind) {
        case "project":
            return "project";
        case "asset":
            return `asset:${location.assetId}`;
        case "story":
            return `story:${location.storyId}:${location.sceneId ?? ""}`;
        case "blueprint":
            return `blueprint:${location.blueprintId}:${location.graphId ?? ""}`;
        case "character":
            return `character:${location.characterId}`;
    }
}

export function filterLintEntries(
    entries: readonly LintReportEntry[],
    filter: LintSeverityFilter,
): LintReportEntry[] {
    return filter === "all" ? [...entries] : entries.filter(entry => entry.severity === filter);
}

/**
 * Bucket the entries, worst first.
 *
 * Insertion order inside a group is the report's own order, which is registry order - the sweep
 * already visits stories in document order, so the entries of one rule read in the order the author
 * would walk the project.
 */
export function groupLintEntries(
    entries: readonly LintReportEntry[],
    mode: LintGroupMode,
    labels: LintGroupLabels,
): LintEntryGroup[] {
    const groups = new Map<string, LintEntryGroup>();

    for (const entry of entries) {
        const key = mode === "rule" ? entry.ruleId : lintLocationKey(entry.location);
        const existing = groups.get(key);
        if (existing) {
            existing.entries.push(entry);
            if (LINT_SEVERITY_ORDER[entry.severity] < LINT_SEVERITY_ORDER[existing.severity]) {
                existing.severity = entry.severity;
            }
            continue;
        }
        groups.set(key, {
            key,
            title:
                mode === "rule"
                    ? labels.ruleTitle(entry.ruleId)
                    : labels.locationLabel(entry.location),
            severity: entry.severity,
            entries: [entry],
        });
    }

    return [...groups.values()].sort((a, b) => {
        const bySeverity = LINT_SEVERITY_ORDER[a.severity] - LINT_SEVERITY_ORDER[b.severity];
        if (bySeverity !== 0) {
            return bySeverity;
        }
        const byTitle = a.title.localeCompare(b.title);
        return byTitle !== 0 ? byTitle : a.key.localeCompare(b.key);
    });
}

/**
 * Groups → one flat row list, which is what the windowed list measures and scrolls.
 *
 * Headings are rows rather than sticky containers because a virtualiser can only window one flat
 * sequence; a nested list of scrollers would either window nothing or window each group separately,
 * and a report of four thousand findings is exactly the case this exists for.
 */
export function flattenLintGroups(groups: readonly LintEntryGroup[]): LintReportRow[] {
    const rows: LintReportRow[] = [];
    for (const group of groups) {
        rows.push({ kind: "group", key: `g:${group.key}`, group });
        group.entries.forEach((entry, index) => {
            rows.push({ kind: "entry", key: `e:${group.key}:${index}`, group, entry });
        });
    }
    return rows;
}
