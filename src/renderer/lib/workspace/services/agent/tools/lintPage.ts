/**
 * The `lint` tool's answer: one page of findings, and enough of the whole report around it that an
 * agent knows what it is not looking at.
 *
 * A project with five hundred `assets/unused` warnings buried every error-free rule behind them when
 * the answer was "the first 150", with no way to ask for the rest. So the answer always opens with a
 * count per rule over the whole report - before any filter - and the findings themselves come a page
 * at a time, narrowed by severity and by rule (an exact id, or a category prefix such as `story/`).
 *
 * Pure: the handler runs the linter and renders each finding's text; this decides which findings,
 * in what order, and what the lead line says. Kept apart so it is testable without a workspace.
 *
 * Comments in English per project convention.
 */

import type { LintSeverity } from "@/lib/lint/types";

export const SEVERITY_RANK: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };

export const LINT_PAGE_DEFAULT_LIMIT = 150;
export const LINT_PAGE_MAX_LIMIT = 500;

/** What this module needs of a report entry: its severity and its rule. */
export type LintPageEntry = { severity: LintSeverity; ruleId: string };

/** One rule's share of the whole report. `severity` is its most severe finding's. */
export type LintRuleCount = { rule: string; severity: LintSeverity; count: number };

export type LintPageRequest = {
    /** Findings below this severity are left out. */
    threshold: LintSeverity;
    /** An exact rule id, or a prefix ending in `/` for a whole category. */
    rule?: string;
    offset: number;
    limit: number;
};

export type LintPage<T> = {
    /** Every rule with a finding, over the whole report, most severe and then most numerous first. */
    byRule: LintRuleCount[];
    /** Findings the request's filters keep, before paging. */
    matched: number;
    /** The page, errors first, in the report's own order within one severity. */
    page: T[];
    /** Where the next page starts, or null on the last one. */
    nextCursor: string | null;
};

/** Whether `ruleId` is what the `rule` argument asks for. */
export function matchesLintRule(ruleId: string, rule: string | undefined): boolean {
    if (!rule) {
        return true;
    }
    return rule.endsWith("/") ? ruleId.startsWith(rule) : ruleId === rule;
}

/** Counts per rule over every entry, whatever the request filters. */
export function countLintRules(entries: readonly LintPageEntry[]): LintRuleCount[] {
    const byRule = new Map<string, LintRuleCount>();
    for (const entry of entries) {
        const existing = byRule.get(entry.ruleId);
        if (!existing) {
            byRule.set(entry.ruleId, { rule: entry.ruleId, severity: entry.severity, count: 1 });
            continue;
        }
        existing.count += 1;
        if (SEVERITY_RANK[entry.severity] < SEVERITY_RANK[existing.severity]) {
            existing.severity = entry.severity;
        }
    }
    return [...byRule.values()].sort((a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
        || b.count - a.count
        || a.rule.localeCompare(b.rule));
}

/**
 * One page of the report.
 *
 * The order is the report's own within a severity (a stable sort), so the same unchanged project
 * pages the same way twice; a cursor is an offset into that order and means nothing once the
 * project has changed.
 */
export function pageLintEntries<T extends LintPageEntry>(entries: readonly T[], request: LintPageRequest): LintPage<T> {
    const matched = entries
        .filter(entry => SEVERITY_RANK[entry.severity] <= SEVERITY_RANK[request.threshold])
        .filter(entry => matchesLintRule(entry.ruleId, request.rule))
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    const page = matched.slice(request.offset, request.offset + request.limit);
    const next = request.offset + page.length;
    return {
        byRule: countLintRules(entries),
        matched: matched.length,
        page,
        nextCursor: next < matched.length ? String(next) : null,
    };
}

/** The sentence the answer opens with: totals, the per-rule counts, and where this page sits. */
export function describeLintPage(
    counts: Record<LintSeverity, number>,
    page: Pick<LintPage<unknown>, "byRule" | "matched" | "nextCursor"> & { shown: number },
    request: LintPageRequest,
): string {
    const lines = [`${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info.`];
    if (page.byRule.length > 0) {
        lines.push(`By rule: ${page.byRule.map(item => `${item.rule} ${item.count} (${item.severity})`).join(", ")}.`);
    }
    const filters = [
        request.threshold === "info" ? null : `severity ${request.threshold} or worse`,
        request.rule ? `rule ${request.rule}` : null,
    ].filter(Boolean).join(", ");
    const scope = filters ? ` matching ${filters}` : "";
    if (page.matched === 0) {
        lines.push(`No finding${scope}.`);
    } else if (page.shown === 0) {
        lines.push(`${page.matched} finding(s)${scope}; this cursor is past the last of them.`);
    } else {
        const first = request.offset + 1;
        const last = request.offset + page.shown;
        lines.push(`${page.matched} finding(s)${scope}; showing ${first}-${last}.`
            + (page.nextCursor ? ` For the next page, call lint again with cursor "${page.nextCursor}" and the same filters.` : ""));
    }
    if (counts.error > 0) {
        lines.push("Fix every error before building.");
    }
    return lines.join("\n");
}
