import { LINT_SEVERITY_ORDER, type LintReportEntry, type LintRuleId, type LintSeverity } from "./types";

/**
 * How many findings each rule made, for the consoles that print a sweep as a stream of lines.
 *
 * A report tab can group and fold; a console cannot. It prints findings in order and a real sweep
 * is routinely one rule repeated - a measured project returned 9084 warnings of which 9070 came
 * from `voice/missing`, so the fourteen findings every other rule made were somewhere inside nine
 * thousand copies of one sentence. The tally is the one block that states that shape, and it is
 * printed beside the summary at the end, which is the part of a long log an operator reads.
 *
 * It replaces nothing: every finding is still printed on its own line, and the report file still
 * carries all of them.
 */
export type LintRuleTally = {
    ruleId: LintRuleId;
    count: number;
    /**
     * The worst severity the rule's own findings carry.
     *
     * Almost always the rule's configured severity, since that is what a finding is filed at; a
     * context finding forced to `error` under a rule the project set to `warning` is the exception
     * the report tab's `mixedSeverity` exists for, and it decides which line this rule prints on.
     */
    severity: LintSeverity;
};

/**
 * Worst severity first, then the loudest rule, then by id.
 *
 * Severity leads because that is the order the whole report is read in, and the count leads inside
 * one severity because the question the tally answers is which rule is drowning the rest.
 */
export function tallyLintFindingsByRule(entries: readonly LintReportEntry[]): LintRuleTally[] {
    const byRule = new Map<LintRuleId, LintRuleTally>();
    for (const entry of entries) {
        const tally = byRule.get(entry.ruleId);
        if (!tally) {
            byRule.set(entry.ruleId, { ruleId: entry.ruleId, count: 1, severity: entry.severity });
            continue;
        }
        tally.count += 1;
        if (LINT_SEVERITY_ORDER[entry.severity] < LINT_SEVERITY_ORDER[tally.severity]) {
            tally.severity = entry.severity;
        }
    }
    return [...byRule.values()].sort((a, b) => {
        const bySeverity = LINT_SEVERITY_ORDER[a.severity] - LINT_SEVERITY_ORDER[b.severity];
        if (bySeverity !== 0) {
            return bySeverity;
        }
        return b.count - a.count || a.ruleId.localeCompare(b.ruleId);
    });
}
