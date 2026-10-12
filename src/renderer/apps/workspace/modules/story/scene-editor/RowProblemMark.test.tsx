// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LintReportEntry, LintRuleId, LintSeverity } from "@/lib/lint";
import { RowProblemMark } from "./RowProblemMark";

afterEach(cleanup);

function finding(ruleId: LintRuleId, severity: LintSeverity): LintReportEntry {
    return {
        ruleId,
        severity,
        messageKey: "lint.rule.textEmpty.message",
        location: { kind: "story", storyId: "s1", storyName: "Main", sceneId: "sc1", sceneName: "Hall", blockId: "b1" },
    };
}

function mark(): HTMLElement {
    const element = document.querySelector("[data-story-row-problems], [role='img']");
    if (!(element instanceof HTMLElement)) {
        throw new Error("no mark rendered");
    }
    return element;
}

/**
 * The mark beside a story row takes the colour of the row's worst finding. A minor warning is the
 * one severity drawn without a colour of its own, so a row of them stays quiet beside a warning.
 */
describe("RowProblemMark", () => {
    it("draws a row with only minor warnings without the warning colour", () => {
        render(<RowProblemMark findings={[finding("text/overlong", "minor")]} legacyCode={null} />);
        expect(mark().className).toContain("text-fg-muted");
        expect(mark().className).not.toContain("text-warning");
    });

    it("draws the warning colour when a warning shares the row with a minor warning", () => {
        render(<RowProblemMark findings={[finding("text/overlong", "minor"), finding("text/empty", "warning")]} legacyCode={null} />);
        expect(mark().className).toContain("text-warning");
    });

    it("keeps the row's own missing-asset warning in the warning colour beside a minor finding", () => {
        render(<RowProblemMark findings={[finding("text/overlong", "minor")]} legacyCode="missingAsset" />);
        expect(mark().className).toContain("text-warning");
    });
});
