import { describe, expect, it } from "vitest";
import { LINT_SEVERITY_ORDER, countLintSeverities, type LintSeverity } from "./types";

/**
 * The severity ladder every surface sorts and counts by.
 *
 * A minor warning is a problem, which an info is not, and one the author can leave for later, which
 * a warning is not - so it sits between them. Every list that orders findings reads this table.
 */
describe("lint severities", () => {
    it("orders error, warning, minor warning, info", () => {
        const ordered = (Object.keys(LINT_SEVERITY_ORDER) as LintSeverity[])
            .sort((a, b) => LINT_SEVERITY_ORDER[a] - LINT_SEVERITY_ORDER[b]);

        expect(ordered).toEqual(["error", "warning", "minor", "info"]);
        expect(new Set(Object.values(LINT_SEVERITY_ORDER)).size).toBe(4);
    });

    it("counts minor warnings apart from warnings", () => {
        const counts = countLintSeverities([
            { severity: "warning" },
            { severity: "minor" },
            { severity: "minor" },
            { severity: "minor" },
            { severity: "info" },
        ]);

        expect(counts).toEqual({ error: 0, warning: 1, minor: 3, info: 1 });
    });

    it("counts nothing in an empty report, every severity present", () => {
        expect(countLintSeverities([])).toEqual({ error: 0, warning: 0, minor: 0, info: 0 });
    });
});
