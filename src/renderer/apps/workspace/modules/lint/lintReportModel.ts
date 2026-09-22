import type { TranslationKey } from "@shared/i18n";
import { nonRedundantLintLocation } from "@/lib/lint/locationText";
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
 *  - **A group opens short when it is very long.** One rule can be the whole report - 9070 of a
 *    measured project's 9084 warnings were `voice/missing` - and a group that opened whole put
 *    every group after it out of reach of the scrollbar. See {@link LINT_GROUP_PREVIEW_LIMIT}.
 *  - **A row's identity is its locator, not its sentence.** Twelve missing translations produce
 *    twelve copies of one message; what tells them apart is where each one is - scene and row - and
 *    what the row says. Hence {@link lintEntryLocator}, and hence the locator being a column of its
 *    own rather than a suffix that gets ellipsed away first.
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
    /**
     * Whether the group holds more than one severity.
     *
     * Grouped by rule it is almost always false - severity is resolved per rule, so a rule's
     * findings share one - which is what lets the entry rows drop the severity word entirely and let
     * the coloured heading say it once. The exception is real (a context finding is forced to
     * `error` under a rule the project set to `warning`), so the flag exists rather than the
     * assumption.
     */
    mixedSeverity: boolean;
    entries: LintReportEntry[];
};

/**
 * One rendered line: a group heading, an entry under it, or the row that opens the rest of a group.
 *
 * `more` is the tail of a group the report opened short - see {@link LINT_GROUP_PREVIEW_LIMIT}. It
 * carries no count of its own: the heading above it already says how many findings the group holds,
 * and two numbers that have to agree are one number too many.
 */
export type LintReportRow =
    | { kind: "group"; key: string; group: LintEntryGroup }
    | { kind: "entry"; key: string; group: LintEntryGroup; entry: LintReportEntry }
    | { kind: "more"; key: string; group: LintEntryGroup };

/**
 * How many of a group's findings the report opens with.
 *
 * One rule can be the whole report: a real project measured 9084 warnings of which 9070 were
 * `voice/missing`, 99.8% from one rule, and the fourteen findings the other rules had to make were
 * on the far side of nine thousand rows of the same sentence. Grouping alone did not fix that -
 * every group opened whole, so the groups after the loud one were unreachable by scrolling.
 *
 * So a group opens showing enough of itself to be recognised and says, on its last row, that there
 * is more. Nothing is hidden: the count on the heading is the whole count, the rest is one press
 * away, and the severity filter and the find both still see every finding.
 */
export const LINT_GROUP_PREVIEW_LIMIT = 20;

/**
 * The smallest tail worth folding away.
 *
 * A row that opens four more rows costs a row and a press to save three, so a group only a little
 * over the limit is shown whole instead.
 */
export const LINT_GROUP_PREVIEW_SLACK = 5;

export type LintGroupLabels = {
    ruleTitle: (ruleId: LintRuleId) => string;
    locationLabel: (location: LintLocation) => string;
};

/** `lint.rule.<slug>.title` - the rule's own name, as the settings panel spells it. */
export function lintRuleTitleKey(ruleId: LintRuleId): TranslationKey {
    return `lint.rule.${deriveLintRuleSlug(ruleId)}.title` as TranslationKey;
}

/**
 * `lint.rule.<slug>.description` - the one clause that says what the rule is looking for.
 *
 * Written for the settings panel and shown here on the group heading's hover, because "Dead end" is
 * a name for a problem, not an explanation of one; a reader meeting it for the first time in a
 * report should not have to go and open a settings panel to find out what it means.
 */
export function lintRuleDescriptionKey(ruleId: LintRuleId): TranslationKey {
    return `lint.rule.${deriveLintRuleSlug(ruleId)}.description` as TranslationKey;
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
        case "surface":
            return location.elementName
                ? `${location.surfaceName} / ${location.elementName}`
                : location.surfaceName;
        // The definition's name and nothing in its place when it has none: its id is a UUID, and a
        // component with no name is still told apart by the widget named after it.
        case "component":
            return location.elementName
                ? `${location.componentName} / ${location.elementName}`
                : location.componentName;
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
        // The page, never the widget on it: keying on the element too would give every unwired
        // button a heading of its own, which is the one-item-groups failure the story case avoids.
        case "surface":
            return `surface:${location.surfaceId}`;
        // The definition, never the widget in it, for the reason the page is keyed above.
        case "component":
            return `component:${location.componentId}`;
        case "character":
            return `character:${location.characterId}`;
    }
}

/**
 * Where one entry is, spelled for the column that stands at the head of its row.
 *
 * Two shapes, because the heading above already carries one half of the answer:
 *
 *  - Grouped by RULE the heading names the rule, so the row has to say where: `Chapter One /
 *    Opening:12`, a compiler's `file:line` and read the same way.
 *  - Grouped by LOCATION the heading already names the scene, so the row says only the row: `12`.
 *    Repeating the scene on every line of its own group would be the same stutter the messages were
 *    just relieved of.
 *
 * The message gets the third say: a handful of rules name their own subject inside the sentence
 * ("dialog.png is not used anywhere"), and for those the label is dropped rather than printed twice
 * - the same judgement, from the same function, the build console makes.
 *
 * A finding with no row (a whole scene, an asset, the project) simply has no number, and grouped by
 * location it gets no locator at all - an empty cell, not a placeholder standing in for one.
 */
export function lintEntryLocator(
    location: LintLocation,
    mode: LintGroupMode,
    locationLabel: (location: LintLocation) => string,
    message: string,
): { label: string; line: number | null } {
    return {
        // Split rather than pre-joined so the row can let the *label* ellipse and keep the number:
        // "Chapter One / Openi…" is still a place, "Chapter One / Op…" with the row number cut off
        // is the one part of the locator the reader came for, gone.
        label: mode === "location" ? "" : nonRedundantLintLocation(locationLabel(location), message),
        line: lintEntryLine(location),
    };
}

/** The row number a story finding carries, or null for everything that is not one row of a scene. */
export function lintEntryLine(location: LintLocation): number | null {
    return location.kind === "story" && location.line !== undefined ? location.line : null;
}

/** The author's own words on the row, when the engine could take a copy of them. */
export function lintEntryExcerpt(location: LintLocation): string {
    return location.kind === "story" ? location.excerpt ?? "" : "";
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
 * Inside a group, order depends on what the group *is*:
 *
 *  - By RULE, the report's own order is already right: every entry shares the rule, so what is left
 *    is location, and the sweep visits stories in document order.
 *  - By LOCATION, the group is one scene and the reader is walking it, so the entries are put back
 *    into row order. The report's severity-first order would send them down the scene and back up
 *    again (4, 12, 21, 8, 25) for a reading that has one obvious sequence. Nothing is lost: severity
 *    is still on the rule name at the end of every row.
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
            if (entry.severity !== existing.entries[0].severity) {
                existing.mixedSeverity = true;
            }
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
            mixedSeverity: false,
            entries: [entry],
        });
    }

    if (mode === "location") {
        for (const group of groups.values()) {
            // A finding about the whole scene names no row and leads it; `sort` is stable, so
            // everything else keeps the report's order among equals.
            group.entries.sort((a, b) => (lintEntryLine(a.location) ?? 0) - (lintEntryLine(b.location) ?? 0));
        }
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
 * The folds a reader would see while a find is running: theirs, minus every group holding a hit.
 *
 * Folding is how a reader puts a rule aside, and a find that inherited it would answer "no results"
 * about something plainly in the report. This is a view over their folds rather than a change to
 * them - it is recomputed from the query, so closing the find restores every one.
 *
 * Returns the given set unchanged when nothing opens, so a memo over it keeps its identity and the
 * row list is not rebuilt for a query that changed nothing.
 */
export function unfoldGroupsWithHits(
    groups: readonly LintEntryGroup[],
    collapsed: ReadonlySet<string>,
    holdsHit: (entry: LintReportEntry) => boolean,
): ReadonlySet<string> {
    if (collapsed.size === 0) {
        return collapsed;
    }
    let opened: Set<string> | null = null;
    for (const group of groups) {
        if (collapsed.has(group.key) && group.entries.some(holdsHit)) {
            opened = opened ?? new Set(collapsed);
            opened.delete(group.key);
        }
    }
    return opened ?? collapsed;
}

/**
 * How many of a group's findings are on the list: all of them, or the preview.
 *
 * `whole` holds the groups the reader has asked to see in full. A group inside the limit is never
 * cut, so the answer for most groups in most reports is "all of them" and the report reads exactly
 * as it did before one rule grew to nine thousand findings.
 */
export function lintGroupShownCount(group: LintEntryGroup, whole?: ReadonlySet<string>): number {
    if (whole?.has(group.key) || group.entries.length <= LINT_GROUP_PREVIEW_LIMIT + LINT_GROUP_PREVIEW_SLACK) {
        return group.entries.length;
    }
    return LINT_GROUP_PREVIEW_LIMIT;
}

/**
 * The groups a reader would see in full while a find is running: theirs, plus every group whose
 * only hits are below the preview.
 *
 * The sibling of {@link unfoldGroupsWithHits}, and for the same reason: a hit the report is not
 * drawing is a hit the find would report and then fail to scroll to. A group whose hits are all
 * inside the preview is left short - the hits are already on the list, and opening nine thousand
 * rows to show a row that was never hidden is not what the reader asked for.
 *
 * Returns the given set unchanged when nothing opens, so a memo over it keeps its identity.
 */
export function showGroupsWholeForHits(
    groups: readonly LintEntryGroup[],
    whole: ReadonlySet<string>,
    holdsHit: (entry: LintReportEntry) => boolean,
): ReadonlySet<string> {
    let opened: Set<string> | null = null;
    for (const group of groups) {
        const shown = lintGroupShownCount(group, whole);
        if (shown === group.entries.length) {
            continue;
        }
        for (let index = shown; index < group.entries.length; index += 1) {
            if (holdsHit(group.entries[index])) {
                opened = opened ?? new Set(whole);
                opened.add(group.key);
                break;
            }
        }
    }
    return opened ?? whole;
}

/**
 * Groups → one flat row list, which is what the windowed list measures and scrolls.
 *
 * Headings are rows rather than sticky containers because a virtualiser can only window one flat
 * sequence; a nested list of scrollers would either window nothing or window each group separately,
 * and a report of four thousand findings is exactly the case this exists for.
 *
 * A collapsed group keeps its heading and drops its entries; a group over the preview limit keeps
 * its heading, its first findings and a row that opens the rest. Between them they are what makes a
 * real report readable: `localization/missing` alone is one finding per line per target locale, and
 * one rule has been measured at 99.8% of a project's warnings.
 */
export function flattenLintGroups(
    groups: readonly LintEntryGroup[],
    collapsed?: ReadonlySet<string>,
    whole?: ReadonlySet<string>,
): LintReportRow[] {
    const rows: LintReportRow[] = [];
    for (const group of groups) {
        rows.push({ kind: "group", key: `g:${group.key}`, group });
        if (collapsed?.has(group.key)) {
            continue;
        }
        const shown = lintGroupShownCount(group, whole);
        for (let index = 0; index < shown; index += 1) {
            rows.push({ kind: "entry", key: `e:${group.key}:${index}`, group, entry: group.entries[index] });
        }
        if (shown < group.entries.length) {
            rows.push({ kind: "more", key: `m:${group.key}`, group });
        }
    }
    return rows;
}
