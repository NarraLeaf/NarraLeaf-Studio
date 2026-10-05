import { describe, expect, it } from "vitest";
import type { LintReport, LintReportEntry, LintRuleId } from "@/lib/lint";
import { indexRowProblems, isRowMarked } from "./rowProblems";

function entry(ruleId: LintRuleId, blockId: string | undefined, message = "m"): LintReportEntry {
    return {
        ruleId,
        messageKey: `lint.rule.x.${message}` as LintReportEntry["messageKey"],
        severity: "warning",
        location: { kind: "story", storyId: "s", storyName: "S", sceneId: "a", sceneName: "A", ...(blockId ? { blockId } : {}) },
    };
}

function report(entries: LintReportEntry[]): LintReport {
    return { startedAt: 0, finishedAt: 0, entries, counts: { error: 0, warning: entries.length, info: 0 }, rulesRun: [], skipped: [] };
}

describe("isRowMarked", () => {
    it("marks a row's own findings", () => {
        expect(isRowMarked(entry("story/goto-missing", "b1"))).toBe(true);
        expect(isRowMarked(entry("variables/undeclared", "b1"))).toBe(true);
    });

    it("leaves out what the row already shows, what is about a whole scene, and translation work", () => {
        expect(isRowMarked(entry("story/invalid-command", "b1"))).toBe(false);
        expect(isRowMarked(entry("story/empty-scene", undefined))).toBe(false);
        expect(isRowMarked(entry("localization/missing", "b1"))).toBe(false);
        expect(isRowMarked(entry("voice/missing", "b1"))).toBe(false);
    });
});

describe("indexRowProblems", () => {
    it("groups by row and keeps a row's array while its findings stay the same", () => {
        const first = indexRowProblems(report([entry("story/goto-missing", "b1"), entry("text/empty", "b2")]), new Map());
        expect(first.get("b1")).toHaveLength(1);
        expect(first.get("b2")).toHaveLength(1);

        // A fresh report with b1 unchanged and b2 now saying something else.
        const second = indexRowProblems(
            report([entry("story/goto-missing", "b1"), entry("text/empty", "b2", "other")]),
            first,
        );
        expect(second.get("b1")).toBe(first.get("b1"));
        expect(second.get("b2")).not.toBe(first.get("b2"));
    });

    it("forgets a row whose findings have gone", () => {
        const first = indexRowProblems(report([entry("story/goto-missing", "b1")]), new Map());
        expect(indexRowProblems(report([]), first).has("b1")).toBe(false);
        expect(indexRowProblems(null, first).size).toBe(0);
    });
});
