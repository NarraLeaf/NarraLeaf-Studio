import { describe, expect, it } from "vitest";
import { tallyLintFindingsByRule } from "./ruleTally";
import type { LintReportEntry, LintRuleId, LintSeverity } from "./types";

/**
 * The block that makes a console printout of a real sweep readable.
 *
 * A measured project returned 151 errors and 9084 warnings, 9070 of them from `voice/missing`. A
 * console prints findings one per line and cannot fold a rule away, so without a count per rule the
 * fourteen findings every other rule made are invisible in the stream.
 */

function entry(ruleId: LintRuleId, severity: LintSeverity): LintReportEntry {
    return {
        ruleId,
        severity,
        location: { kind: "project" },
        messageKey: "lint.message.ruleFailed",
        messageParams: { rule: ruleId },
    };
}

function many(ruleId: LintRuleId, severity: LintSeverity, count: number): LintReportEntry[] {
    return Array.from({ length: count }, () => entry(ruleId, severity));
}

describe("tallyLintFindingsByRule", () => {
    it("counts each rule and leads with the severity, then with the loudest", () => {
        const tally = tallyLintFindingsByRule([
            ...many("voice/missing", "warning", 9070),
            ...many("assets/missing", "error", 147),
            ...many("blueprint/reference-missing", "error", 3),
            ...many("assets/unused", "warning", 10),
        ]);

        expect(tally).toEqual([
            { ruleId: "assets/missing", count: 147, severity: "error" },
            { ruleId: "blueprint/reference-missing", count: 3, severity: "error" },
            { ruleId: "voice/missing", count: 9070, severity: "warning" },
            { ruleId: "assets/unused", count: 10, severity: "warning" },
        ]);
    });

    it("files a rule under the worst severity its own findings carry", () => {
        // A context finding forced to `error` under a rule the project set to `warning`.
        const tally = tallyLintFindingsByRule([
            ...many("story/dead-end", "warning", 4),
            entry("story/dead-end", "error"),
        ]);

        expect(tally).toEqual([{ ruleId: "story/dead-end", count: 5, severity: "error" }]);
    });

    it("has nothing to say about a report with no findings", () => {
        expect(tallyLintFindingsByRule([])).toEqual([]);
    });
});
